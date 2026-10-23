import test from 'node:test';
import assert from 'node:assert';
import { parseGitStatus, parseBlame, isRemoteUrl, cloneDir } from '../src/renderer/paths.ts';

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

test('remote links: only plain git URLs reach the shell', () => {
  for (const ok of ['https://github.com/a/b.git', 'http://host:8080/a/b', 'ssh://git@github.com/a/b.git', 'git://host/a.git', 'git@github.com:a/b.git', 'https://user@host.com/a/b'])
    assert.ok(isRemoteUrl(ok), ok);
  for (const bad of ['', 'https://github.com/a b.git', 'https://github.com/"a".git', "git@host:'a'", 'https://host/%PATH%', 'https://host/a!b!', '-uhttps://x/y', '--upload-pack=calc', 'ssh://-oProxyCommand/x', 'git@-oProxy:a', 'host:a/b', 'https://host/a&calc'])
    assert.ok(!isRemoteUrl(bad), bad);
});

test('remote links: absolute local repositories pass (drive with \\ or /, POSIX, file:///)', () => {
  for (const ok of ['file:///C:/repo', 'C:\\repo', 'C:\\Users\\Aluno\\repo.git', 'C:/Users/Aluno/repo.git', 'c:\\repo', 'D:/x/repo', '/home/u/repo.git', 'file:///home/u/repo.git'])
    assert.ok(isRemoteUrl(ok), ok);
});

test('remote links: local paths with shell metacharacters, options, transports or no anchor are refused', () => {
  for (const bad of [
    'C:\\My Repos\\a.git', '"C:\\repo"', '/tmp/a b', // spaces and quotes
    'C:\\repo&calc', 'C:/repo|x', 'C:\\%TEMP%\\r', 'C:\\a!b!', 'C:\\repo^x', // cmd.exe metacharacters
    '-C:/x', '-/x', 'file://-oProxy/x', // git would read an option
    'ext::calc', 'fd::3', 'C::x', // remote helpers ("<transport>::")
    'C:repo', 'CC:/repo', // drive-relative, or not a drive
    '//server/share', '\\\\server\\share\\r', // UNC: Windows would send NTLM credentials to the host
    'relative/repo', './repo', // relative to whatever folder git runs in
    'file://host/repo', 'file://localhost/C$/x', 'file:////server/share', 'file://C:/x', // file: without three slashes is a UNC share
  ])
    assert.ok(!isRemoteUrl(bad), bad);
});

test('clone folder name follows git', () => {
  assert.strictEqual(cloneDir('https://github.com/a/proj.git'), 'proj');
  assert.strictEqual(cloneDir('git@github.com:a/proj.git'), 'proj');
  assert.strictEqual(cloneDir('https://host/a/proj/'), 'proj');
  for (const local of ['C:\\a\\proj.git', 'C:\\a\\proj\\', 'C:/a/proj.git/', 'file:///home/u/proj.git'])
    assert.strictEqual(cloneDir(local), 'proj', local);
  // A path to the .git folder of a working copy clones into the working copy's name.
  for (const dotGit of ['C:\\a\\conn\\.git', 'C:/a/conn/.git/', '/srv/conn/.git', 'C:\\a\\conn\\.git\\', 'file:///home/u/conn/.git'])
    assert.strictEqual(cloneDir(dotGit), 'conn', dotGit);
});
