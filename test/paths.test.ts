import test from 'node:test';
import assert from 'node:assert';
import { ipcMessage, testCandidates, implCandidates, fuzzyScore, languageFor, relativeTo, parseRakeTasks, testLines, minitestNameAt, parseTestReport } from '../src/renderer/paths.ts';

test('go to test follows Rails and gem conventions', () => {
  assert.deepStrictEqual(testCandidates('app/models/user.rb'), ['spec/models/user_spec.rb', 'test/models/user_test.rb']);
  assert.deepStrictEqual(testCandidates('lib/foo/bar.rb'),
    ['spec/foo/bar_spec.rb', 'test/foo/bar_test.rb', 'spec/lib/foo/bar_spec.rb', 'test/lib/foo/bar_test.rb']);
  assert.deepStrictEqual(testCandidates('spec/a_spec.rb'), []);
  assert.deepStrictEqual(implCandidates('spec/models/user_spec.rb'), ['app/models/user.rb', 'lib/models/user.rb', 'models/user.rb']);
  assert.deepStrictEqual(implCandidates('test/foo/bar_test.rb'), ['app/foo/bar.rb', 'lib/foo/bar.rb', 'foo/bar.rb']);
});

test('fuzzy score prefers basename matches and rejects non-subsequences', () => {
  assert.strictEqual(fuzzyScore('xyz', 'app/models/user.rb'), -1);
  assert.ok(fuzzyScore('user', 'app/models/user.rb') > fuzzyScore('user', 'app/u/s/e/r.rb'));
});

test('ruby language detection covers extensionless files', () => {
  assert.strictEqual(languageFor('C:\\p\\Gemfile'), 'ruby');
  assert.strictEqual(languageFor('lib/tasks/db.rake'), 'ruby');
  assert.strictEqual(languageFor('README.md'), undefined);
  assert.strictEqual(languageFor('app/views/posts/index.html.erb'), 'html');
});

test('relativeTo ignores drive-letter case and rejects outside paths', () => {
  assert.strictEqual(relativeTo('C:\\proj', 'c:\\proj\\app\\a.rb'), 'app/a.rb');
  assert.strictEqual(relativeTo('C:\\proj', 'C:\\project\\a.rb'), undefined);
});

test('rake -AT output parsing', () => {
  const out = 'rake db:migrate   # Migrate the database\nrake routes\n(in /x)\n';
  assert.deepStrictEqual(parseRakeTasks(out), [{ name: 'db:migrate', desc: 'Migrate the database' }, { name: 'routes', desc: '' }]);
});

test('test lines: RSpec blocks, Minitest defs and Rails test blocks, not lookalikes', () => {
  const src = ['RSpec.describe Foo do', '  context "x" do', '    it "works" do', '    it { is_expected.to be }', '    item = 1', '    it = 2', '  end', 'end',
    'class FooTest < Minitest::Test', '  def test_ok', '  def helper', '  test "does a thing" do'].join('\n');
  assert.deepStrictEqual(testLines(src), [1, 2, 3, 4, 10, 12]);
});

test('minitest name at line finds the enclosing test, Rails names get underscores', () => {
  const src = ['class T < Minitest::Test', '  def test_one', '    assert true', '  end', '  test "does a  thing" do', '    x', '  end', 'end'].join('\n');
  assert.strictEqual(minitestNameAt(src, 3), 'test_one');
  assert.strictEqual(minitestNameAt(src, 6), 'test_does_a_thing');
  assert.strictEqual(minitestNameAt(src, 1), undefined);
});

test('test reports from RSpec json and the Minitest reporter normalize to relative paths', () => {
  const rspec = JSON.stringify({ examples: [
    { full_description: 'a works', status: 'passed', file_path: './spec/a_spec.rb', line_number: 3, run_time: 0.1 },
    { full_description: 'a fails', status: 'failed', file_path: './spec/a_spec.rb', line_number: 6, exception: { class: 'RSpec::Expectations::ExpectationNotMetError', message: 'expected 4' } },
    { full_description: 'a later', status: 'pending', file_path: './spec/a_spec.rb', line_number: 9, pending_message: 'todo' },
  ] });
  const r = parseTestReport(rspec, 'C:\\proj');
  assert.deepStrictEqual(r.map(x => [x.file, x.line, x.status]), [['spec/a_spec.rb', 3, 'passed'], ['spec/a_spec.rb', 6, 'failed'], ['spec/a_spec.rb', 9, 'pending']]);
  assert.match(r[1].message!, /expected 4/);
  const mt = JSON.stringify([{ file: 'C:/proj/test/a_test.rb', line: 4, name: 'test_ok', group: 'ATest', status: 'passed', message: null }]);
  assert.deepStrictEqual(parseTestReport(mt, 'C:\\proj')[0], { file: 'test/a_test.rb', line: 4, name: 'ATest#test_ok', status: 'passed', message: undefined, time: undefined });
});

test('ipcMessage strips the Electron IPC prefix', () => {
  assert.strictEqual(ipcMessage(new Error("Error invoking remote method 'createPath': Error: EEXIST: já existe")), 'EEXIST: já existe');
  assert.strictEqual(ipcMessage(new Error('falhou')), 'falhou');
});
