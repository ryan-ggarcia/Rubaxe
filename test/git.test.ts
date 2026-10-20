import test from 'node:test';
import assert from 'node:assert';
import { parseGitStatus, parseBlame } from '../src/renderer/paths.ts';

test('git status splits staged, unstaged, untracked and renames', () => {
  const out = ['## main...origin/main [ahead 1]', 'M  staged.rb', ' M edited.rb', 'MM both.rb', '?? new.rb', 'R  new_name.rb', 'old_name.rb', ' D gone.rb', ''].join('\0');
  const s = parseGitStatus(out);
  assert.strictEqual(s.branch, 'main');
  assert.deepStrictEqual(s.staged, [{ path: 'staged.rb', status: 'M', from: undefined }, { path: 'both.rb', status: 'M', from: undefined }, { path: 'new_name.rb', status: 'R', from: 'old_name.rb' }]);
  assert.deepStrictEqual(s.unstaged, [{ path: 'edited.rb', status: 'M' }, { path: 'both.rb', status: 'M' }, { path: 'new.rb', status: 'U' }, { path: 'gone.rb', status: 'D' }]);
  assert.strictEqual(parseGitStatus('## No commits yet on master\0').branch, 'master');
});

test('git blame porcelain reuses commit info for repeated hashes', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  const out = [
    `${a} 1 1 2`, 'author Ana', 'author-time 1700000000', 'summary first', 'filename x.rb', '\tline one',
    `${a} 2 2`, '\tline two',
    `${b} 3 3 1`, 'author Bia', 'author-time 1700000100', 'summary second', 'filename x.rb', '\tline three', '',
  ].join('\n');
  const lines = parseBlame(out);
  assert.deepStrictEqual(lines.map(l => [l.author, l.summary]), [['Ana', 'first'], ['Ana', 'first'], ['Bia', 'second']]);
  assert.strictEqual(lines[2].time, 1700000100);
});
