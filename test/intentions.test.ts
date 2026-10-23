import test from 'node:test';
import assert from 'node:assert';
import { intentionsAt, applyEdits, addLocaleKey, enterInBraceBlock } from '../src/renderer/intentions.ts';

// Applies the intention whose title starts with `title` at line/col and returns the new text (undefined if not offered).
function apply(src: string, line: number, title: string, col = 1, spec = false): string | undefined {
  const lines = src.split('\n');
  const found = intentionsAt(lines, { sl: line, sc: col, el: line, ec: col }, { spec }).find(x => x.title.startsWith(title));
  return found && applyEdits(src, found.edits);
}
const titles = (src: string, line: number, col = 1) => intentionsAt(src.split('\n'), { sl: line, sc: col, el: line, ec: col }).map(x => x.title);

test('{ } <-> do...end, but not for hash literals', () => {
  assert.strictEqual(apply('items.each { |x| puts x }', 1, 'Converter { }'), 'items.each do |x|\n  puts x\nend');
  assert.strictEqual(apply('items.each do |x|\n  puts x\nend', 1, 'Converter do…end'), 'items.each { |x| puts x }');
  assert.strictEqual(apply('opts = { a: 1 }', 1, 'Converter { }'), undefined);
  assert.strictEqual(apply('render json: { ok: true }', 1, 'Converter { }'), undefined);
});

test('hash rocket <-> colon keys; reverse only inside braces', () => {
  assert.strictEqual(apply('h = { :a => 1, :b? => 2 }', 1, 'Converter :chave'), 'h = { a: 1, b?: 2 }');
  assert.strictEqual(apply('h = { a: 1, b: :c }', 1, 'Converter chave:'), 'h = { :a => 1, :b => :c }');
  assert.strictEqual(apply('call(a: 1)', 1, 'Converter chave:'), undefined);
});

test('sort hash keys on one line and across lines', () => {
  assert.strictEqual(apply('h = { b: 1, a: 2, c: { z: 1 } }', 1, 'Ordenar'), 'h = { a: 2, b: 1, c: { z: 1 } }');
  assert.strictEqual(apply('h = {\n  b: 1,\n  a: 2,\n  c: 3\n}', 1, 'Ordenar'), 'h = {\n  a: 2,\n  b: 1,\n  c: 3\n}');
  assert.strictEqual(apply('h = { a: 1, b: 2 }', 1, 'Ordenar'), undefined);
});

test('if/else <-> ternary, keeping a shared assignment', () => {
  assert.strictEqual(apply('if ok\n  x = 1\nelse\n  x = 2\nend', 1, 'Converter if/else'), 'x = ok ? 1 : 2');
  assert.strictEqual(apply('if ok\n  a\nelse\n  b\nend', 1, 'Converter if/else'), 'ok ? a : b');
  assert.strictEqual(apply('x = user.nil? ? 0 : 1', 1, 'Converter ternário'), 'if user.nil?\n  x = 0\nelse\n  x = 1\nend');
});

test('modifier <-> statement', () => {
  assert.strictEqual(apply('  save! if valid?', 1, 'Converter modificador'), '  if valid?\n    save!\n  end');
  assert.strictEqual(apply('unless done\n  retry_it\nend', 1, 'Converter bloco unless'), 'retry_it unless done');
  assert.strictEqual(apply('if a\n  b\nelse\n  c\nend', 1, 'Converter bloco'), undefined);
});

test('invert if, merge and split nested ifs', () => {
  assert.strictEqual(apply('if ready\n  go\nend', 1, 'Inverter'), 'unless ready\n  go\nend');
  assert.strictEqual(apply('if a > 1\n  x\nelse\n  y\nend', 1, 'Inverter'), 'if !(a > 1)\n  y\nelse\n  x\nend');
  assert.strictEqual(apply('if !ok\n  x\nelse\n  y\nend', 1, 'Inverter'), 'if ok\n  y\nelse\n  x\nend');
  assert.strictEqual(apply('if a\n  if b || c\n    go\n  end\nend', 1, 'Juntar'), 'if a && (b || c)\n  go\nend');
  assert.strictEqual(apply('if a && b\n  go\nend', 1, 'Dividir'), 'if a\n  if b\n    go\n  end\nend');
  assert.strictEqual(apply('if a && b || c\n  go\nend', 1, 'Dividir'), undefined);
});

test('string <-> symbol at the cursor', () => {
  assert.strictEqual(apply("send('save')", 1, 'Converter "save"', 8), 'send(:save)');
  assert.strictEqual(apply('send(:save)', 1, 'Converter :save', 7), "send('save')");
  assert.ok(!titles('Foo::Bar', 1, 5).some(t => t.includes('string')));
});

test('concatenation -> interpolation escapes single-quoted content', () => {
  assert.strictEqual(apply('msg = "Hi " + name + \'!\'', 1, 'Converter concatenação', 8), 'msg = "Hi #{name}!"');
  assert.strictEqual(apply('x = \'a"b\' + user.name', 1, 'Converter concatenação', 6), 'x = "a\\"b#{user.name}"');
});

test('heredoc -> squiggly re-indents the body and the terminator', () => {
  assert.strictEqual(apply('  sql = <<-SQL\nSELECT 1\n  SQL', 1, 'Converter em heredoc'), '  sql = <<~SQL\n    SELECT 1\n  SQL');
});

test('number underscores add and remove', () => {
  assert.strictEqual(apply('limit = 1000000', 1, 'Separar', 10), 'limit = 1_000_000');
  assert.strictEqual(apply('limit = 1_000_000.5', 1, 'Remover _', 10), 'limit = 1000000.5');
  assert.ok(!titles('x = 1000', 1, 6).some(t => t.startsWith('Separar')));
});

test('generate attr_* and initialize from @ivars used in the class', () => {
  const src = 'class User\n  def greet\n    "#{@name} #{@age}"\n  end\nend';
  assert.strictEqual(apply(src, 3, 'Gerar attr_reader'), 'class User\n  attr_reader :name, :age\n  def greet\n    "#{@name} #{@age}"\n  end\nend');
  assert.strictEqual(apply(src, 3, 'Gerar initialize'), 'class User\n  def initialize(name, age)\n    @name = name\n    @age = age\n  end\n\n  def greet\n    "#{@name} #{@age}"\n  end\nend');
  const declared = 'class User\n  attr_reader :name\n  def initialize(name)\n    @name = name\n  end\nend';
  assert.deepStrictEqual(titles(declared, 3).filter(t => t.startsWith('Gerar')), []);
});

test('RSpec introduce let moves the local before the example', () => {
  const src = 'describe User do\n  it "works" do\n    user = build(:user)\n    expect(user).to be_valid\n  end\nend';
  assert.strictEqual(apply(src, 3, 'Introduzir let', 1, true), 'describe User do\n  let(:user) { build(:user) }\n\n  it "works" do\n    expect(user).to be_valid\n  end\nend');
});

test('named <-> numbered block parameters', () => {
  assert.strictEqual(apply('ids = users.map { |u| u.id }', 1, 'Usar it'), 'ids = users.map { it.id }');
  assert.strictEqual(apply('h.each { |k, v| puts k, v }', 1, 'Usar parâmetros numerados'), 'h.each { puts _1, _2 }');
  assert.strictEqual(apply('users.each do |u|\n  puts u.name\n  save(u)\nend', 1, 'Usar it'), 'users.each do\n  puts it.name\n  save(it)\nend');
  assert.strictEqual(apply('h.each { |k, v| puts k }', 1, 'Usar parâmetros'), undefined); // v unused: arity would change
  assert.strictEqual(apply('ids = users.map { it.id }', 1, 'Dar nomes'), 'ids = users.map { |item| item.id }');
  assert.strictEqual(apply('h.each { puts _1, _2 }', 1, 'Dar nomes'), 'h.each { |item1, item2| puts item1, item2 }');
  assert.strictEqual(apply('describe X do\n  it "works" do\n    expect(1).to eq 1\n  end\nend', 2, 'Dar nomes'), undefined);
});

test('move string to i18n picks a free key and carries the entry', () => {
  const lines = ['flash[:notice] = "Salvo com sucesso"'];
  const found = intentionsAt(lines, { sl: 1, sc: 20, el: 1, ec: 20 }, { i18nKeys: ['strings.salvo_com_sucesso'] }).find(x => x.title.startsWith('Mover'))!;
  assert.deepStrictEqual(found.i18n, { key: 'strings.salvo_com_sucesso_2', value: 'Salvo com sucesso' });
  assert.strictEqual(applyEdits(lines[0], found.edits), "flash[:notice] = t('strings.salvo_com_sucesso_2')");
  assert.deepStrictEqual(intentionsAt(lines, { sl: 1, sc: 20, el: 1, ec: 20 }).filter(x => x.title.startsWith('Mover')), []); // no locale file
  assert.deepStrictEqual(intentionsAt(['x = "oi #{a}"', 'require "json"'], { sl: 1, sc: 6, el: 1, ec: 6 }, { i18nKeys: [] }).filter(x => x.title.startsWith('Mover')), []);
});

test('addLocaleKey appends under the root, reusing the strings scope', () => {
  assert.strictEqual(addLocaleKey('pt-BR:\n  hello: "oi"\n', 'strings.a', 'Olá'), 'pt-BR:\n  hello: "oi"\n  strings:\n    a: "Olá"\n');
  assert.strictEqual(addLocaleKey('en:\n  strings:\n    x: "1"\n  other: 2\n', 'strings.a', 'A'), 'en:\n  strings:\n    x: "1"\n    a: "A"\n  other: 2\n');
  assert.strictEqual(addLocaleKey('# nada\n', 'strings.a', 'A'), undefined);
});

test('inline variable replaces uses and removes the assignment', () => {
  assert.strictEqual(apply('def f\n  total = a + b\n  puts total\n  g(total, "total")\nend', 2, 'Embutir'), 'def f\n  puts (a + b)\n  g((a + b), "total")\nend');
  assert.strictEqual(apply('x = User.first\nputs x.name', 1, 'Embutir'), 'puts User.first.name');
  assert.strictEqual(apply('x = 1\nx += 1\nputs x', 1, 'Embutir'), undefined); // assigned twice
  assert.strictEqual(apply('x = 1\nputs 2', 1, 'Embutir'), undefined); // never used
  assert.strictEqual(apply('def a\n  x = 1\n  x\nend\ndef b\n  x\nend', 2, 'Embutir'), 'def a\n  1\nend\ndef b\n  x\nend');
});

test('merge sequential ifs with the same body', () => {
  assert.strictEqual(apply('if a\n  return 1\nend\nif b or c\n  return 1\nend', 1, 'Juntar ifs em sequência'), 'if a || (b or c)\n  return 1\nend');
  assert.strictEqual(apply('if a\n  stop\nend\nif b\n  stop\nend', 1, 'Juntar ifs em sequência'), undefined); // would run once instead of twice
  assert.strictEqual(apply('if a\n  stop\nend\nif b\n  go\nend', 1, 'Juntar ifs em sequência'), undefined);
});

test('Enter inside a one-line brace block expands it to do...end', () => {
  const r = enterInBraceBlock(['items.each { |x| puts x }'], 1, 19)!;
  assert.strictEqual(applyEdits('items.each { |x| puts x }', r.edits), 'items.each do |x|\n  puts x\nend');
  assert.deepStrictEqual(r.cursor, [2, 9]);
  assert.strictEqual(enterInBraceBlock(['items.each { |x| puts x }'], 1, 3), undefined);
  assert.strictEqual(enterInBraceBlock(['opts = { a: 1 }'], 1, 12), undefined);
});
