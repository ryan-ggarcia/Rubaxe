import test from 'node:test';
import assert from 'node:assert';
import { pluralize, singularize, railsResource, railsRelated, parseRoutes, localeKeys } from '../src/renderer/paths.ts';

test('inflection covers regular, -y, -es, irregular and uncountable words', () => {
  for (const [s, p] of [['post', 'posts'], ['category', 'categories'], ['box', 'boxes'], ['person', 'people'], ['news', 'news'], ['day', 'days'], ['address', 'addresses']]) {
    assert.strictEqual(pluralize(s), p);
    assert.strictEqual(singularize(p), s);
  }
});

test('rails resource from models, controllers, views, helpers and tests', () => {
  assert.deepStrictEqual(railsResource('app/models/post.rb'), { ns: '', singular: 'post', plural: 'posts' });
  assert.deepStrictEqual(railsResource('app/controllers/admin/categories_controller.rb'), { ns: 'admin/', singular: 'category', plural: 'categories' });
  assert.deepStrictEqual(railsResource('app/views/posts/show.html.erb'), { ns: '', singular: 'post', plural: 'posts' });
  assert.deepStrictEqual(railsResource('app/helpers/posts_helper.rb'), { ns: '', singular: 'post', plural: 'posts' });
  assert.deepStrictEqual(railsResource('spec/models/post_spec.rb'), { ns: '', singular: 'post', plural: 'posts' });
  assert.deepStrictEqual(railsResource('test/controllers/posts_controller_test.rb'), { ns: '', singular: 'post', plural: 'posts' });
  assert.strictEqual(railsResource('app/views/layouts/application.html.erb'), undefined);
  assert.strictEqual(railsResource('lib/tasks/x.rake'), undefined);
});

test('related files of a namespaced controller include the plain model and skip itself', () => {
  const paths = railsRelated('app/controllers/admin/posts_controller.rb').map(c => c.path);
  assert.ok(paths.includes('app/models/admin/post.rb') && paths.includes('app/models/post.rb'));
  assert.ok(paths.includes('app/views/admin/posts') && paths.includes('db/schema.rb'));
  assert.ok(!paths.includes('app/controllers/admin/posts_controller.rb'));
});

test('routes table parses named routes and skips continuation rows', () => {
  const out = [
    '   Prefix Verb   URI Pattern               Controller#Action',
    '    posts GET    /posts(.:format)          posts#index',
    '          POST   /posts(.:format)          posts#create',
    ' new_post GET    /posts/new(.:format)      posts#new',
    '     post GET    /posts/:id(.:format)      posts#show',
    '     root GET    /                         posts#index',
  ].join('\n');
  assert.deepStrictEqual(parseRoutes(out).map(r => r.helper), ['posts', 'new_post', 'post', 'root']);
  assert.strictEqual(parseRoutes(out)[1].path, '/posts/new(.:format)');
});

test('locale keys flatten nested YAML and drop the locale root', () => {
  const yaml = ['en:', '  hello: "Hello"', '  posts:', '    title: Posts', '    # comment: x', '    form:', '      save: "Save"', 'pt-BR:', '  hello: Olá'].join('\n');
  assert.deepStrictEqual(localeKeys(yaml), ['hello', 'posts.title', 'posts.form.save', 'hello']);
});

test('server port is read from the Puma banner', async () => {
  const { serverPort, fileKind } = await import('../src/renderer/paths.ts');
  assert.strictEqual(serverPort('* Listening on http://127.0.0.1:3000\nUse Ctrl-C'), '3000');
  assert.strictEqual(serverPort('Listening on http://[::1]:4567'), '4567');
  assert.strictEqual(serverPort('Booting Puma'), '');
  assert.deepStrictEqual(['a.rb', 'Gemfile', 'x.html.erb', 'Gemfile.lock', 'a.yml', 'README.md', 'a.ts', 'blob'].map(fileKind), ['ruby', 'ruby', 'erb', 'lock', 'yaml', 'md', 'ts', 'file']);
});
