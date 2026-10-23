import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const helper = path.join(import.meta.dirname, '..', 'src', 'ruby', 'rubaxe_inspect.rb');
const hasRuby = !spawnSync('ruby', ['-v']).error;

type Diag = { rule: string; message: string; severity: string; line: number; column: number; endLine: number; endColumn: number };

function inspect(code: string): Diag[] {
  const r = spawnSync('ruby', [helper, '-'], { input: code, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// Linhas com o diagnóstico da regra, para comparar positivos e negativos de uma vez.
const lines = (code: string, rule: string) => inspect(code).filter(d => d.rule === rule).map(d => d.line);

test('inspect: syntax error yields [] and positions are 1-based character columns', t => {
  if (!hasRuby) return t.skip('Ruby fora do PATH');
  assert.deepStrictEqual(inspect('def (\n'), []);
  assert.deepStrictEqual(inspect('s = "ção"; nil.upcase\n'), [{
    rule: 'rubaxe/nil-call', message: '`nil` não tem o método `upcase`: esta chamada gera NoMethodError.',
    severity: 'warning', line: 1, column: 16, endLine: 1, endColumn: 22,
  }]);
});

test('inspect: YARD @param unknown, missing, and @return on initialize', t => {
  if (!hasRuby) return t.skip('Ruby fora do PATH');
  const code = `class A
  # @param a [Integer]
  # @param [String] zz
  def m1(a, b, _c, &blk); end

  # @param a [Integer]
  # @param opts [Hash]
  def m2(a, **opts); end

  # @param args [Array]
  def m3(*); end

  # @overload m4(x)
  #   @param x [Integer]
  def m4(*a); end

  # @param [Array<[String, Integer]>] a tipo que não sabemos ler
  def m5(b); end

  # Sem tags de parâmetro.
  def m6(a); end

  # @param a
  # @option opts [String] :nome
  def m7(a, opts = {}); end

  # @return [A]
  def initialize; end

  # @return [A]
  def self.initialize; end
end
`;
  assert.deepStrictEqual(lines(code, 'rubaxe/yard-param-unknown'), [3]);
  const missing = inspect(code).filter(d => d.rule === 'rubaxe/yard-param-missing');
  assert.deepStrictEqual(missing.map(d => [d.line, d.column, d.endColumn]), [[4, 13, 14]]);
  assert.deepStrictEqual(lines(code, 'rubaxe/yard-initialize-return'), [27]);
});

test('inspect: method call on nil literal', t => {
  if (!hasRuby) return t.skip('Ruby fora do PATH');
  const code = 'nil.upcase\nnil.to_s\nnil&.upcase\nnil.inspect\nnil.blank?\nnil.respond_to?(:x)\n';
  assert.deepStrictEqual(lines(code, 'rubaxe/nil-call'), [1]);
});

test('inspect: method call on a local known to be nil', t => {
  if (!hasRuby) return t.skip('Ruby fora do PATH');
  const code = `def f(x, y)
  if x.nil?
    x.length
    x.to_s
    x&.length
    [1].each { x.length }
  end
  if x == nil then x.size end
  if nil == x then x.size end
  unless x
    x.length
    x.to_s
  end
  if y.nil?
    y = []
    y.length
  end
  if x.nil?
    # nada
  else
    x.length
  end
  x.length if x
  @a.length if @a.nil?
  defined?(x.length) if x.nil?
end
`;
  assert.deepStrictEqual(lines(code, 'rubaxe/nil-guard-call'), [3, 8, 9, 11]);
});

test('inspect: arity of calls to methods defined in the same class', t => {
  if (!hasRuby) return t.skip('Ruby fora do PATH');
  const code = `class B
  def two(a, b) = a
  def opt(a, b = 1) = a
  def rest(a, *r) = a
  def kw(a, k: 1) = a
  def plain(a) = a
  def abstract(a) = raise(NotImplementedError)
  def twice(a) = a
  def twice(a, b) = a

  def run(xs)
    two(1)
    two(1, 2)
    self.two(1, 2, 3)
    opt(1, 2, 3)
    opt(1)
    rest
    rest(1, 2, 3, 4)
    kw(1, k: 2)
    plain(k: 2)
    plain(1, k: 2)
    two(*xs)
    two(1, **xs)
    xs.each { two(1) }
    instance_eval { two(1) }
    abstract
    twice(1)
    other.two(1)
  end
end

class C
  def one(a) = a
  def method_missing(*) = nil
  def run = one
end

class D
  def ok(a) = a
  def run = ok
  alias_method :ok2, :ok
end

def top(a) = a
top
top(1)
`;
  assert.deepStrictEqual(lines(code, 'rubaxe/arity'), [12, 14, 15, 17, 21, 24, 45]);
});
