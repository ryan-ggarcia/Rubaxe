import test from 'node:test';
import assert from 'node:assert';
import { outermost, dropPlan, rangeBetween, mdTarget, fileUrl, headingSlugs, parseInspections, camelize, underscore, needsPluralConfirm, railsRenamePlan, railsRenameText, railsReview, eventKey, gitArgs, usesStandard, isGemfile, specDirs, rspecFolderArgs, testTarget, ipcMessage, testCandidates, implCandidates, fuzzyScore, languageFor, relativeTo, parseRakeTasks, testLines, minitestNameAt, parseTestReport } from '../src/renderer/paths.ts';

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

test('eventKey uses the physical key with Alt and for Backquote', () => {
  const k = (o: object) => eventKey({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: '', code: '', ...o }, 'darwin');
  assert.strictEqual(k({ altKey: true, shiftKey: true, key: 'Ò', code: 'KeyR' }), 'shift+alt+r');
  assert.strictEqual(k({ altKey: true, key: '¡', code: 'Digit1' }), 'alt+1');
  assert.strictEqual(k({ altKey: true, shiftKey: true, key: 'Enter', code: 'Enter' }), 'shift+alt+enter');
  assert.strictEqual(k({ ctrlKey: true, shiftKey: true, key: '~', code: 'Backquote' }), 'ctrl+shift+`');
  assert.strictEqual(k({ metaKey: true, key: 'P', code: 'KeyP' }), 'ctrl+p');
});

test('git read commands skip optional locks, writes do not', () => {
  assert.deepStrictEqual(gitArgs(['status', '-z']), ['--no-optional-locks', 'status', '-z']);
  assert.deepStrictEqual(gitArgs(['branch', '--format=%(refname:short)']), ['--no-optional-locks', 'branch', '--format=%(refname:short)']);
  assert.deepStrictEqual(gitArgs(['branch', 'novo']), ['branch', 'novo']);
  assert.deepStrictEqual(gitArgs(['commit', '-m', 'x']), ['commit', '-m', 'x']);
});

test('Standard, Gemfile and RSpec folder helpers', () => {
  assert.ok(usesStandard('GEM\n  specs:\n    standard (1.40.0)\n'));
  assert.ok(!usesStandard('    standard-custom (1.0)\n    rubocop (1.0)\n'));
  assert.ok(isGemfile('/p/Gemfile.lock', '/p') && !isGemfile('/p/sub/Gemfile', '/p'));
  assert.deepStrictEqual(specDirs(['/p/spec/models/a_spec.rb', '/p/spec/b_spec.rb', '/p/lib/x.rb'], '/p'), ['spec', 'spec/models']);
  assert.deepStrictEqual(rspecFolderArgs('spec/models', ' user '), ['spec/models', '-e', 'user']);
  assert.deepStrictEqual(rspecFolderArgs('spec', ''), ['spec']);
  assert.strictEqual(testTarget({ file: 'spec/a_spec.rb', line: 5, id: './spec/a_spec.rb[1:2]' }), 'spec/a_spec.rb[1:2]');
  assert.strictEqual(testTarget({ file: 'spec/a_spec.rb', line: 5 }), 'spec/a_spec.rb:5');
  const [r] = parseTestReport(JSON.stringify({ examples: [{ id: './spec/a_spec.rb[1:2]', file_path: './spec/a_spec.rb', line_number: 5, full_description: 'x', status: 'passed' }] }), '/p');
  assert.strictEqual(r.id, './spec/a_spec.rb[1:2]');
});

test('Rails resource rename plan', () => {
  const files = ['app/models/post.rb', 'app/controllers/posts_controller.rb', 'app/helpers/posts_helper.rb', 'app/views/posts/index.html.erb', 'test/models/post_test.rb', 'spec/models/post_spec.rb', 'db/migrate/2024_create_posts.rb', 'app/models/user.rb'];
  const plan = railsRenamePlan('app/controllers/posts_controller.rb', files, 'Article', 'articles')!;
  assert.deepStrictEqual(plan.files.map(f => f.to), ['app/models/article.rb', 'test/models/article_test.rb', 'spec/models/article_spec.rb', 'app/controllers/articles_controller.rb', 'app/helpers/articles_helper.rb', 'app/views/articles']);
  assert.deepStrictEqual(plan.consts.map(c => `${c.from}>${c.to}`), ['Post>Article', 'PostTest>ArticleTest', 'PostsController>ArticlesController', 'PostsHelper>ArticlesHelper']);
  assert.strictEqual(railsRenamePlan('lib/x.rb', files, 'A', 'as'), undefined);
  assert.deepStrictEqual([camelize('blog_post'), underscore('BlogPost'), needsPluralConfirm('article'), needsPluralConfirm('person'), needsPluralConfirm('category')], ['BlogPost', 'blog_post', false, true, false]);
  assert.deepStrictEqual(railsReview('resources :posts\nroot "x"\nget :post_x', files, 'post', 'posts'), ['config/routes.rb:1: resources :posts', 'db/migrate/2024_create_posts.rb']);
});

test('Rails rename text keeps the HTTP verb and method: :post', () => {
  const t = (s: string, view = false) => railsRenameText(s, view, 'post', 'posts', 'article', 'articles').text;
  assert.strictEqual(t('    post posts_url, params: { post: { title: @post.title } }\n'), '    post articles_url, params: { article: { title: @article.title } }\n');
  assert.strictEqual(t('assert_difference("Post.count")\n  get edit_post_url(@post)\n'), 'assert_difference("Article.count")\n  get edit_article_url(@article)\n');
  assert.strictEqual(t('  # GET /posts or /posts.json\n  def set_post\n  params.expect(post: [ :title ])\n  redirect_to @post, notice: "Post was created."'), '  # GET /articles or /articles.json\n  def set_article\n  params.expect(article: [ :title ])\n  redirect_to @article, notice: "Article was created."');
  assert.strictEqual(t('<%= render post %> <%= form_with(model: post, method: :post) %> <form method="post"> <%= link_to "Back to posts", posts_path %>', true),
    '<%= render article %> <%= form_with(model: article, method: :post) %> <form method="post"> <%= link_to "Back to articles", articles_path %>');
  assert.strictEqual(railsRenameText('post :create', false, 'post', 'posts', 'article', 'articles').count, 0);
  const plan = railsRenamePlan('app/controllers/posts_controller.rb', ['app/controllers/posts_controller.rb', 'app/views/posts/_post.html.erb', 'app/views/posts/index.html.erb', 'app/models/post.rb'], 'Article', 'articles')!;
  assert.deepStrictEqual(plan.files.map(f => f.to), ['app/models/article.rb', 'app/controllers/articles_controller.rb', 'app/views/posts/_article.html.erb', 'app/views/articles']);
  assert.deepStrictEqual(plan.texts, ['app/controllers/posts_controller.rb', 'app/views/posts/_post.html.erb', 'app/views/posts/index.html.erb']);
});

test('markdown links and images resolve from the .md folder; unsafe targets do not', () => {
  const md = 'C:\\proj\\docs\\guide.md';
  assert.deepStrictEqual(mdTarget('SPEC.md', md, 'C:\\proj'), { path: 'C:\\proj\\docs\\SPEC.md' });
  assert.deepStrictEqual(mdTarget('../README.md#uso', md, 'C:\\proj'), { path: 'C:\\proj\\README.md' });
  assert.deepStrictEqual(mdTarget('./assets/my%20icon.png?raw=1', md, 'C:\\proj'), { path: 'C:\\proj\\docs\\assets\\my icon.png' });
  assert.deepStrictEqual(mdTarget('/assets/logo.png', md, 'C:\\proj'), { path: 'C:\\proj\\assets\\logo.png' });
  assert.deepStrictEqual(mdTarget('../../../../x.md', md, ''), { path: 'C:\\x.md' });
  assert.deepStrictEqual(mdTarget('img/a.png', '/home/u/p/README.md', '/home/u/p'), { path: '/home/u/p/img/a.png' });
  assert.deepStrictEqual(mdTarget('https://rubyinstaller.org', md, ''), { url: 'https://rubyinstaller.org' });
  assert.deepStrictEqual(mdTarget('#fase-1--interface', md, ''), { anchor: 'fase-1--interface' });
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', '%6Aavascript:alert(1)', 'file:///C:/x.png', 'data:text/html,x', '//evil/share/x.png', '\\\\evil\\share\\x.png', '%5C%5Cevil%5Cx.png', 'C:\\x.png', 'mailto:a@b.c', '%E0%A4%A', ''])
    assert.strictEqual(mdTarget(bad, md, 'C:\\proj'), undefined, bad);
  assert.strictEqual(fileUrl('C:\\a b\\c#1.png'), 'file:///C:/a%20b/c%231.png');
  assert.strictEqual(fileUrl('/home/ç/a?.png'), 'file:///home/%C3%A7/a%3F.png');
});

test('heading slugs follow GitHub: accents kept, punctuation dropped, repeats numbered', () => {
  assert.deepStrictEqual(headingSlugs(['Fase 1 — Interface no estilo VS Code ★', 'Instalação pelo código-fonte', 'Uso', 'Uso', 'Uso-1', ' A_b. c? ']),
    ['fase-1--interface-no-estilo-vs-code-', 'instalação-pelo-código-fonte', 'uso', 'uso-1', 'uso-1-1', 'a_b-c']);
});

test('parseInspections is defensive', () => {
  const ok = { rule: 'Nil', message: 'x', severity: 'warning', line: 1, column: 2, endLine: 1, endColumn: 5 };
  assert.deepStrictEqual(parseInspections(JSON.stringify([ok, { bad: 1 }])), [ok]);
  assert.deepStrictEqual(parseInspections('warning: foo\n[]'), []);
  assert.deepStrictEqual(parseInspections('{"a":1}'), []);
});

test('explorer multi-select: shift range, outermost items and drop targets', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepStrictEqual(rangeBetween(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepStrictEqual(rangeBetween(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepStrictEqual(rangeBetween(order, 'gone', 'c'), ['c']);
  const w = String.raw;
  assert.deepStrictEqual(outermost([w`C:\p\app`, w`c:\p\App\x.rb`, w`C:\p\apple.rb`], '\\', true), [w`C:\p\app`, w`C:\p\apple.rb`]);
  assert.deepStrictEqual(outermost(['/p/a', '/p/A/x'], '/', false), ['/p/a', '/p/A/x']);
  assert.strictEqual(dropPlan([w`C:\p\app`], w`C:\p\app`, '\\', true), undefined); // into itself
  assert.strictEqual(dropPlan([w`C:\p\app`, w`C:\p\x.rb`], w`c:\p\app\models`, '\\', true), undefined); // into its own child
  assert.deepStrictEqual(dropPlan([w`C:\p\app\a.rb`, w`C:\p\b.rb`], w`C:\p`, '\\', true), [w`C:\p\app\a.rb`]); // b.rb is already there
  assert.deepStrictEqual(dropPlan(['/p/app2', '/p/app2/x'], '/p/app', '/', false), ['/p/app2']); // app2 is not under app
});
