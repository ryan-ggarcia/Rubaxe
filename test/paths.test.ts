import test from 'node:test';
import assert from 'node:assert';
import { testCandidates, implCandidates, fuzzyScore, languageFor, relativeTo, parseRakeTasks } from '../src/renderer/paths.ts';

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
});

test('relativeTo ignores drive-letter case and rejects outside paths', () => {
  assert.strictEqual(relativeTo('C:\\proj', 'c:\\proj\\app\\a.rb'), 'app/a.rb');
  assert.strictEqual(relativeTo('C:\\proj', 'C:\\project\\a.rb'), undefined);
});

test('rake -AT output parsing', () => {
  const out = 'rake db:migrate   # Migrate the database\nrake routes\n(in /x)\n';
  assert.deepStrictEqual(parseRakeTasks(out), [{ name: 'db:migrate', desc: 'Migrate the database' }, { name: 'routes', desc: '' }]);
});
