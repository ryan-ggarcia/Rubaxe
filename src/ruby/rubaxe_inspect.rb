# frozen_string_literal: true

# Inspeções próprias do Rubaxe sobre a AST do Prism.
# Uso: ruby rubaxe_inspect.rb <arquivo.rb>   (ou "-" para ler o código do stdin)
# Saída: array JSON de { rule, message, severity, line, column, endLine, endColumn } (1-based, coluna em caracteres).
# Regras só determinísticas: na dúvida, não reporta.
require 'prism'
require 'json'

src = ARGV.fetch(0) == '-' ? $stdin.binmode.read : File.binread(ARGV[0])
src.force_encoding(Encoding::UTF_8)
result = Prism.parse(src)
# Erro de sintaxe: o Ruby LSP já reporta.
if result.errors.any?
  print '[]'
  exit
end

# Métodos que gems comuns (ActiveSupport, json, yaml, pp) adicionam a Object/NilClass: o helper não carrega o app.
NIL_EXTENSIONS = %i[blank? present? presence presence_in try try! to_param to_query as_json to_json to_yaml deep_dup
                    duplicable? in? acts_like? instance_values instance_variable_names with_options with html_safe?
                    pretty_inspect].freeze
# Blocos que trocam o self: chamadas dentro deles não resolvem para a classe ao redor.
SELF_CHANGING = %i[instance_eval instance_exec class_eval class_exec module_eval module_exec define_method
                   define_singleton_method new define].freeze
WRITES = [Prism::LocalVariableWriteNode, Prism::LocalVariableOperatorWriteNode, Prism::LocalVariableOrWriteNode,
          Prism::LocalVariableAndWriteNode, Prism::LocalVariableTargetNode].freeze
SCOPES = [Prism::BlockNode, Prism::LambdaNode, Prism::DefNode, Prism::ClassNode, Prism::ModuleNode,
          Prism::SingletonClassNode, Prism::DefinedNode].freeze

@out = []
@defs = {}
@def_count = Hash.new(0)
@calls = []
@symbols = {}
@method_missing = {}
@prepend = {}
@docs = result.comments.each_with_object({}) do |c, h|
  h[c.location.start_line] = c if c.is_a?(Prism::InlineComment) && !c.trailing?
end

def add(rule, severity, message, line, col, end_line, end_col)
  @out << { rule: rule, message: message, severity: severity, line: line, column: col + 1, endLine: end_line,
            endColumn: end_col + 1 }
end

def add_loc(rule, severity, message, loc)
  add(rule, severity, message, loc.start_line, loc.start_character_column, loc.end_line, loc.end_character_column)
end

def nil_ok?(name, or_false)
  NIL_EXTENSIONS.include?(name) || nil.respond_to?(name) || (or_false && false.respond_to?(name))
end

# --- YARD ---------------------------------------------------------------------------------------------------------

def check_yard(node)
  line = node.def_keyword_loc.start_line - 1
  comments = []
  while (c = @docs[line])
    comments.unshift(c)
    line -= 1
  end
  return if comments.empty?

  tags = comments.filter_map do |c|
    text = c.location.slice
    m = text.match(/\A#\s?@(!?\w+)/) or next
    [m[1], c, text]
  end
  # Diretivas e @overload descrevem outra assinatura.
  return if tags.any? { |t, *| t.start_with?('!') || t == 'overload' }

  if node.name == :initialize && node.receiver.nil?
    tags.each do |t, c, text|
      next unless t == 'return'

      col = c.location.start_character_column + text.index('@return')
      add('rubaxe/yard-initialize-return', 'info',
          '@return em `initialize` não tem efeito: `new` sempre devolve o objeto criado.',
          c.location.start_line, col, c.location.start_line, col + 7)
    end
  end

  documented = {}
  param_tags = tags.select { |t, *| t == 'param' || t == 'option' }
  param_tags.each do |t, c, text|
    m = text.match(/\A#\s?@(?:param|option)\s+(?:\[[^\]]*\]\s*)?([*&]{0,2})([A-Za-z_]\w*)(?=[\s\[]|\z)/)
    return unless m # tipo ou nome que não sabemos ler: melhor não opinar

    documented[m[2]] = [t, c, m]
  end
  return unless param_tags.any? { |t, *| t == 'param' }

  ps = node.parameters
  list = ps ? [*ps.requireds, *ps.optionals, ps.rest, *ps.posts, *ps.keywords, ps.keyword_rest, ps.block].compact : []
  return if list.any?(Prism::MultiTargetNode)

  names = list.filter_map { |p| p.name.to_s if p.respond_to?(:name) && p.name }
  anonymous = names.size < list.size # *, **, &, ... ou **nil: um @param pode se referir a eles

  unless anonymous
    documented.each do |name, (t, c, m)|
      next if t != 'param' || names.include?(name)

      start = c.location.start_character_column
      add('rubaxe/yard-param-unknown', 'warning',
          "@param `#{name}` não corresponde a nenhum parâmetro de `#{node.name}`.",
          c.location.start_line, start + m.begin(1), c.location.start_line, start + m.end(2))
    end
  end

  list.each do |p|
    next if p.is_a?(Prism::BlockParameterNode) || !p.respond_to?(:name) || p.name.nil?

    name = p.name.to_s
    next if name.start_with?('_') || documented.key?(name)

    add_loc('rubaxe/yard-param-missing', 'info', "Parâmetro `#{name}` sem @param, mas outros parâmetros de " \
            "`#{node.name}` estão documentados.", (p.respond_to?(:name_loc) && p.name_loc) || p.location)
  end
end

# --- nil ----------------------------------------------------------------------------------------------------------

def check_nil_call(node)
  return unless node.receiver.is_a?(Prism::NilNode) && !node.safe_navigation? && node.message_loc
  return if nil_ok?(node.name, false)

  add_loc('rubaxe/nil-call', 'warning', "`nil` não tem o método `#{node.name}`: esta chamada gera NoMethodError.",
          node.message_loc)
end

def lvar?(node) = node.is_a?(Prism::LocalVariableReadNode)

def guarded_var(node)
  pred = node.predicate
  if node.is_a?(Prism::UnlessNode)
    return [pred.name, true] if lvar?(pred)
  elsif pred.is_a?(Prism::CallNode) && !pred.safe_navigation?
    args = pred.arguments&.arguments || []
    return [pred.receiver.name, false] if pred.name == :nil? && lvar?(pred.receiver) && args.empty? && !pred.block
    if pred.name == :== && args.size == 1
      return [pred.receiver.name, false] if lvar?(pred.receiver) && args[0].is_a?(Prism::NilNode)
      return [args[0].name, false] if pred.receiver.is_a?(Prism::NilNode) && lvar?(args[0])
    end
  end
  nil
end

def writes?(node, var)
  (WRITES.include?(node.class) && node.name == var) || node.compact_child_nodes.any? { writes?(_1, var) }
end

def calls_on(node, var, &blk)
  if node.is_a?(Prism::CallNode) && lvar?(node.receiver) && node.receiver.name == var && !node.safe_navigation?
    yield node
  end
  node.compact_child_nodes.each { calls_on(_1, var, &blk) unless SCOPES.include?(_1.class) }
end

def check_guard(node)
  var, or_false = guarded_var(node)
  return unless var && node.statements
  return if writes?(node.statements, var) # reatribuída no ramo: não sabemos mais o valor

  calls_on(node.statements, var) do |call|
    next if !call.message_loc || nil_ok?(call.name, or_false)

    what = or_false ? 'nil ou false' : 'nil'
    add_loc('rubaxe/nil-guard-call', 'warning',
            "`#{var}` é #{what} neste ramo e não tem o método `#{call.name}`: a chamada gera NoMethodError.",
            call.message_loc)
  end
end

# --- Percurso (coleta definições e chamadas para a aridade) ---------------------------------------------------------
# kind: :top (nível do arquivo), :body (corpo de classe/módulo), :sbody (class << self),
#       :instance / :singleton (dentro de um método), :opaque (self desconhecido).

def register(key, kind, node)
  k = [key, kind, node.name]
  @defs[k] = node
end

def walk(node, key, kind)
  case node
  when Prism::ClassNode, Prism::ModuleNode
    walk(node.superclass, key, kind) if node.is_a?(Prism::ClassNode) && node.superclass
    name = node.constant_path.slice
    walk(node.body, key == 'main' ? name : "#{key}::#{name}", :body) if node.body
    return
  when Prism::SingletonClassNode
    walk(node.expression, key, kind)
    walk(node.body, key, node.expression.is_a?(Prism::SelfNode) && kind == :body ? :sbody : :opaque) if node.body
    return
  when Prism::DefNode
    check_yard(node)
    @def_count[node.name] += 1
    @method_missing[key] = true if node.name == :method_missing
    inner = :opaque
    if node.receiver.nil? && (kind == :body || kind == :top)
      register(key, inner = :instance, node)
    elsif (node.receiver.nil? && kind == :sbody) || (node.receiver.is_a?(Prism::SelfNode) && kind == :body)
      register(key, inner = :singleton, node)
    end
    walk(node.parameters, key, inner) if node.parameters
    walk(node.body, key, inner) if node.body
    return
  when Prism::BlockNode, Prism::LambdaNode
    kind = :opaque unless kind == :instance || kind == :singleton
  when Prism::IfNode, Prism::UnlessNode
    check_guard(node)
  when Prism::SymbolNode
    @symbols[node.unescaped.to_sym] = true
  when Prism::CallNode
    check_nil_call(node)
    if (node.receiver.nil? || node.receiver.is_a?(Prism::SelfNode)) && !node.safe_navigation?
      @prepend[key] = true if node.name == :prepend && kind == :body
      case kind
      when :top then @calls << [key, :instance, node, true]
      when :instance, :singleton then @calls << [key, kind, node, false]
      when :body then @calls << [key, :singleton, node, true]
      end
    end
    if SELF_CHANGING.include?(node.name) && node.block.is_a?(Prism::BlockNode)
      node.compact_child_nodes.each { walk(_1, key, _1.equal?(node.block) ? :opaque : kind) }
      return
    end
  end
  node.compact_child_nodes.each { walk(_1, key, kind) }
end

# --- Aridade --------------------------------------------------------------------------------------------------------

def arity_range(defn)
  ps = defn.parameters
  return [0, 0, false] unless ps
  return if ps.keyword_rest.is_a?(Prism::NoKeywordsParameterNode)

  min = ps.requireds.size + ps.posts.size
  max = ps.rest || ps.keyword_rest.is_a?(Prism::ForwardingParameterNode) ? nil : min + ps.optionals.size
  [min, max, ps.keywords.any? || !ps.keyword_rest.nil?]
end

def describe(min, max)
  return "exatamente #{min}" if min == max
  return "pelo menos #{min}" unless max

  "de #{min} a #{max}"
end

def stub?(defn)
  first = defn.body.is_a?(Prism::StatementsNode) && defn.body.body.first
  first.is_a?(Prism::CallNode) && first.receiver.nil? && %i[raise fail].include?(first.name)
end

def check_arity
  @calls.each do |key, kind, call, ordered|
    name = call.name
    next if @def_count[name] != 1 || @symbols[name] || @method_missing[key] || @prepend[key] || !call.message_loc
    next unless (defn = @defs[[key, kind, name]])
    next if ordered && defn.location.start_offset > call.location.start_offset # ainda não definido nesse ponto
    next if stub?(defn) # método abstrato: as subclasses definem a assinatura real

    min, max, keywords = arity_range(defn)
    next unless min

    args = call.arguments&.arguments || []
    next if args.any? do |a|
      a.is_a?(Prism::SplatNode) || a.is_a?(Prism::ForwardingArgumentsNode) ||
        (a.is_a?(Prism::KeywordHashNode) && a.elements.any?(Prism::AssocSplatNode))
    end

    n = args.count { |a| !(keywords && a.is_a?(Prism::KeywordHashNode)) }
    next if n >= min && (max.nil? || n <= max)

    add_loc('rubaxe/arity', 'warning', "`#{name}` aceita #{describe(min, max)} argumento(s) posicional(is), mas " \
            "recebe #{n}: a chamada gera ArgumentError.", call.message_loc)
  end
end

walk(result.value, 'main', :top)
check_arity
print JSON.generate(@out.sort_by { [_1[:line], _1[:column]] })
