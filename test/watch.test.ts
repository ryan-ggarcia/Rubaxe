import test from 'node:test';
import assert from 'node:assert';
import { watchIgnored } from '../src/main/watch.ts';

test('watchIgnored: skips tool folders, keeps .git/HEAD and .git/index', () => {
  for (const p of ['.git', '.git\\objects\\ab\\cd', '.git/refs/heads/main', 'node_modules/x/y.js', 'app\\tmp\\cache', 'log/dev.log',
    '.ruby-lsp/Gemfile', 'coverage/index.html', '.bundle/config', 'vendor/bundle/ruby/gem.rb', 'vendor\\bundle']) assert.ok(watchIgnored(p), p);
  for (const p of ['.git/HEAD', '.git\\index', 'app/models/user.rb', 'vendor/plugin.rb', 'lib\\logger.rb', 'HEAD']) assert.ok(!watchIgnored(p), p);
});
