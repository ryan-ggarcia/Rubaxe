# Especificação de comportamento

Descrição, com palavras nossas, do que cada área faz. É a única entrada da implementação (veja [CLEAN_ROOM.md](CLEAN_ROOM.md)).

## Interface (referência: VS Code)

- Layout: barra de título com caixa de busca central · barra de atividades à esquerda · barra lateral · área de abas e editor · painel inferior · barra de status.
- Cores (tema Dark Modern): barras `#181818`, editor `#1F1F1F`, bordas `#2B2B2B`, destaque `#0078D4`, texto `#CCCCCC`, texto secundário `#9D9D9D`, campos `#313131` com borda `#3C3C3C`.
- Aba ativa: fundo do editor, texto branco, linha de destaque no topo. Aba com alterações: bolinha no lugar do "x".
- Atalhos: Ctrl+P arquivos, Ctrl+Shift+P comandos, Ctrl+Shift+F busca, Ctrl+B barra lateral, Ctrl+J painel, Ctrl+, configurações, Ctrl+S salvar, Ctrl+W fechar aba.
- No VS Code puro, Ruby tem só realce de sintaxe; a inteligência vem de servidores de linguagem.

## Suporte Ruby (referência: RubyMine)

**Áreas e peso relativo** (proporção de código do plugin): linguagem e modelo de símbolos > inteligência de código > inspeções > suporte a Rails > ações > gerenciadores de versão > execução > RSpec > refatoração > depurador > documentação YARD > Bundler > Rake > Minitest > SDK.

**Configurações oferecidas:** interpretador Ruby e gems · Bundler · RuboCop · caminhos do Rails · inteligência de código · RBS · profiler · Docker.

**RuboCop:** usar a configuração do projeto ou a padrão; corrigir automaticamente ao salvar; modo servidor (mais rápido); alternativa com a gem Standard.

**Estilo de código Ruby (opções):** espaços em volta de `=>`, de chaves de hash e de bloco, de operadores (atribuição, comparação, range, potência), de pipes de bloco e dentro de arrays; alinhar o lado direito de atribuições e hashes em sequência; alinhar expressões binárias quebradas (nenhum, indentado, pelo primeiro operando); alinhar cadeias de métodos quebradas (nenhum, pelo receptor, pelos pontos); indentar `when` dentro de `case`; indentar `private`/`protected`/`public` e os métodos depois deles; transformar `{ }` em `do…end` ao apertar Enter dentro do bloco; declarações vazias em uma ou várias linhas. Dois presets: padrão e o estilo "omakase" do Rails.

**Tipos de execução:** script Ruby, servidor Rails, tarefa Rake, RSpec, Minitest/Test::Unit, Cucumber, IRB, aplicação Rack, Capistrano, comando qualquer, conexão de depuração remota.

**RSpec:** rodar todos os specs de uma pasta (com filtro de nome de arquivo), um arquivo, vários arquivos, um exemplo pela linha ou por ID (`arquivo[1:2]`); runner próprio opcional; opção de backtrace completo.

**Versões do Ruby:** detectar rbenv, rvm, asdf, chruby, mise e o Ruby do sistema; respeitar `.ruby-version`.

**Ir para teste:** `app/x.rb` ↔ `spec/x_spec.rb` ou `test/x_test.rb`; `lib/x.rb` ↔ `spec/x_spec.rb` ou `spec/lib/x_spec.rb`; quando o teste não existe, oferecer criá-lo.

**Dicas no editor (inlay hints, a partir de assinaturas RBS):** tipo de atributo, de parâmetro de bloco, do `self` no bloco, de constante, de coleção, de variável global, de parâmetro e de retorno de método.

**Depurador:** breakpoints, watches, console para avaliar expressões, anexar a um processo em execução e seguir subprocessos automaticamente.

**Bundler:** install, update, outdated, lock, clean, pack, init, criar gem; avisar quando uma gem do Gemfile não está instalada.

**Rake:** listar as tarefas do projeto e executá-las; recarregar a lista.

**Rails:** alternar entre model, controller, view, helper, layout, rotas e schema; executar generators; console e servidor; completar rotas e chaves de i18n; renomear em conjunto model/controller/view/migration.

**Ações no código (intentions):** trocar `{}` ↔ `do…end`; hash rocket ↔ sintaxe `chave:`; `if` ↔ ternário; `if` em linha ↔ bloco; inverter `if/else`; juntar e dividir `if`s aninhados ou em sequência; string ↔ símbolo; concatenação → interpolação; heredoc → heredoc indentado; `_` em números longos; parâmetros numerados ↔ nomeados; ordenar hash por chave; mover string para i18n; extrair bloco para método; introduzir e embutir variável local.

**Inspeções (categorias):** prováveis bugs (referência não resolvida, número de argumentos, chave duplicada, `rescue` vazio, chamada a método privado, tipos incompatíveis); fluxo de dados (`nil`, objeto congelado alterado, código inalcançável, variável não usada); fluxo de controle; código redundante; estilo; nomes fora da convenção; métricas (classe grande demais); Rails; RSpec; YARD; gems.

## Completar Ruby em views ERB (referência: RubyMine; comparação: Ruby LSP, Solargraph)

Pesquisa de 29/10/2026, só com fontes públicas (registro em [CLEAN_ROOM.md](CLEAN_ROOM.md)). `RUBY-n` são issues públicas do YouTrack da JetBrains; `ruby-lsp#n`, `ruby-lsp-rails#n`, `herb#n` são issues/PRs no GitHub. Sem fonte, o item fica marcado **não confirmado**.

**Ligação view → controller/action (RubyMine)**
- Convenção de caminho: `app/views/<caminho>/<action>.<formato>.erb` pertence a `<Caminho>Controller#<action>`; há ícone na margem da action para a view e da view de volta, e o "símbolo relacionado" liga as duas (ajuda: *Rails navigation*). Caminhos não padrão de views são importados do próprio Rails (ajuda: *Rails | Paths*).
- Controllers pais: as `@variáveis` da classe do controller **e dos ancestrais** ficam visíveis na view (RUBY-4470, dado como já implementado em 2012). Indica que ele junta as variáveis da classe inteira, não só da action. **Não confirmado** se separa por action.
- `before_action` no `ApplicationController`: houve relato de variável não encontrada (RUBY-11945, versão 4.5.2, encerrado em 2025 sem confirmação). Variável atribuída num método chamado pela action: fechado como duplicado (RUBY-4210). **Não confirmado** hoje.
- Layouts: relato de variável do controller não resolvida em `layouts/<controller>` (RUBY-5809, encerrado sem confirmação). **Não confirmado.**
- `render` explícito (`render :edit`, `render "outra/view"`) e mailers (`app/views/<mailer>/<método>` ↔ `app/mailers/<mailer>.rb`): nenhuma fonte pública. **Não confirmado.**

**`@variáveis` e seu tipo (RubyMine)**
- Atribuições do controller são resolvidas e completadas na view (RUBY-1737), inclusive `@a, @b = …` (RUBY-7661). Renomear e buscar usos atravessam view e controller (RUBY-7344, RUBY-2950).
- Regressão aberta desde 2019: o nome da `@variável` não aparece no completar da view, embora seja resolvido (RUBY-25051).
- Tipo: o pedido de propagar o tipo do controller para a view foi encerrado sem confirmação (RUBY-2018); `@variável.` na view não oferece as colunas do `schema.rb` (RUBY-26813, aberto desde 2020). Conclusão: o tipo vem da inferência comum da atribuição (`Category.find` → `Category`) e o completar de métodos do model na view é parcial.
- Não há anotação de tipo em templates (`# @param`, `# @type`): pedidos abertos (RUBY-28237, RUBY-34738).

**Helpers (RubyMine)**
- Helpers do app (`app/helpers/*.rb`) são resolvidos e completados na view (RUBY-2136, RUBY-1738). Até 2020 o completar só trazia o `ApplicationHelper`; desde a 2020.2 traz todos, conferido em Rails 4 e 6 (RUBY-9002). Isso segue o padrão do Rails (todo controller inclui todos os helpers; só o helper com o nome do controller quando `config.action_controller.include_all_helpers = false` — API *ActionController::Helpers*).
- `helper_method :x` vira helper da view (RUBY-1741); `helper Modulo` e `helper :all` são entendidos (RUBY-1742, RUBY-2070); no controller, `helpers.` (Rails 5+) é completado (RUBY-9002).
- Helpers do Rails (`link_to` etc.) resolvem para os módulos de helpers do Action View (RUBY-21052). `f.` dentro de `form_for`/`form_with` completa só parte dos métodos do construtor (RUBY-17509, aberto).
- Funciona em ERB, não em Haml (RUBY-28870, aberto).

**Locals de partials (RubyMine)**
- Em `_category.html.erb` existe a local `category`, com tipo tirado de `collection:`/`object:`; `as:` troca o nome (RUBY-3056, RUBY-2491).
- Locals de `render partial:, locals: {…}` vindas de outra view são reconhecidas (RUBY-7663, com falhas pontuais em 2011); vindas de `render locals:` no controller, não (RUBY-16193, aberto).
- *Strict locals* do Rails 7.1 (`<%# locals: (post:, title: "x") -%>` no topo do partial): resolução, completar, buscar usos e ir para declaração em ERB desde a 2023.3 (RUBY-31987), em Haml desde a 2024.1 (RUBY-32179).
- `local_assigns` aparece como não encontrado em partials (RUBY-34203, reproduzido na 2025.1.1; RUBY-24085), ambos abertos.

**VS Code + Ruby LSP 0.26.11 + ruby-lsp-rails 0.4.8 (o que o Rubaxe usa hoje)**
- O ERB vira um script Ruby solto: o HTML é apagado e o Ruby é analisado no nível do topo, onde `self` é `Object` (ruby-lsp#2235; código MIT da gem instalada).
- Completar de `@variável`: só as do próprio `Object` — as do controller nunca aparecem.
- Método sem receptor (`link_to`, helper do app): o completar procura métodos de `Object`, então não aparecem. Só o "ir para definição" tem exceção para ERB (receptor `Object` → procura pelo nome em qualquer lugar); por isso F12 em `link_to` funciona e o completar não.
- Tipo adivinhado pelo nome (ligado por padrão, documentado como experimental): `@category.` e `category.` usam a classe `Category` se ela existir; `@categories` não adivinha nada (não há `Categories`). Associações entram como métodos via ruby-lsp-rails; colunas do banco não, só no hover e nos argumentos de `where`/`find_by`.
- ruby-lsp-rails não tem nada para variáveis de controller nem helpers em views; para views, só lentes da action para a view (e hover, no PR aberto ruby-lsp-rails#734). O PR de "ir para definição" em `render` dentro de ERB (ruby-lsp-rails#659) foi fechado em 10/2026 porque o language server do Herb já cobre isso. Nenhuma issue ou roadmap público pede `@variáveis` ou helpers na view: **o limite não deve acabar sozinho**.
- Herb (language server HTML+ERB, MIT): completa helpers de tag do Action View, nomes de partials, opções do `render` e strict locals (herb#1368, herb#2108); sua análise já rastreia `@variáveis` e locals entre templates (herb#1667). **Não confirmado** se completa as `@variáveis` do controller.

**Solargraph + solargraph-rails**
- Solargraph não processa `.erb` (castwide/vscode-solargraph#142, castwide/solargraph#633, abertos); o autor aponta como obstáculos o parser e saber qual controller e quais helpers estão no escopo do template. solargraph-rails cobre colunas do `schema.rb`, associações e finders só em arquivos Ruby; para views há só um pedido aberto (iftheshoefritz/solargraph-rails#62).

**Convenções do Rails** (guias *Layouts and Rendering* e *Action View Overview*)
- Sem `render`, a action usa `app/views/<controller_path>/<action>`; se não existe, o Rails procura no caminho do controller pai (herança de templates). Layout: `layouts/<controller>`, senão o do pai, até `application`.
- A view recebe todas as `@variáveis` da instância do controller no momento do render: da action, dos `before_action`, dos métodos chamados e dos pais.
- Partial `_nome`: local `nome` com `object:`/`collection:`; `as:` troca o nome; `local_assigns` é o Hash das locals passadas; strict locals declaram as locals aceitas e seus padrões.

**Menor comportamento recomendado para o Rubaxe** (completar próprio dentro de `<% %>`, somado ao do Ruby LSP, sem rótulos repetidos)
1. Controller da view por convenção: `app/views/<p>/x.erb` → `app/controllers/<p>_controller.rb`; se não existir, `app/mailers/<p>.rb`. Layout `layouts/<p>` → o controller `<p>`. Action = nome do arquivo até o primeiro ponto.
2. `@variáveis`: todas as atribuídas (`@x =`, `@x ||=`, `@a, @b =`) em qualquer método do controller e dos pais (`class X < Y`, arquivo pela convenção, até o `ApplicationController`), as da action primeiro. Cobre `before_action`, métodos auxiliares, `render :outra` e partials do mesmo diretório, ao custo de oferecer a mais — aceitável no completar, não num diagnóstico.
3. Tipo (detalhe do item e `@x.`): `Const.new`/`find`/`find_by`/`first`/`last`/`create` → instância de `Const`; `Const.all`/`where`/`order`/… → coleção de `Const`. Em `@x.` com tipo de model, somar as colunas da tabela em `db/schema.rb`; métodos e associações já vêm do Ruby LSP pelo nome singular, e `@categories.each do |category|` já funciona pelo nome da variável do bloco.
4. Helpers sem receptor: `def` públicos de todos os `app/helpers/**/*.rb` (com `include_all_helpers = false`: só `ApplicationHelper`, o helper do controller e os declarados com `helper`), nomes de `helper_method` da cadeia do controller e uma lista fixa dos helpers comuns do Action View (links, formulários, assets, texto, número, data, tag, tradução, sanitização, `render`, `content_for`, `provide`).
5. Partials (`_x.erb`): `local_assigns`, a local `x` e as do comentário de strict locals no topo; `x.` fica com o tipo adivinhado pelo Ruby LSP.
- **Limites aceitos:** leitura textual, sem fluxo; variáveis atribuídas em concerns, módulos incluídos ou gems não aparecem; `render template:` vindo de outro controller não é seguido; locals de `render … locals:` em outros arquivos não são buscadas; tipo só nos padrões acima (nada de `@x = servico.call`); helpers de gems (Turbo, Devise…) e métodos de `f.` ficam de fora; Haml e Slim também.
