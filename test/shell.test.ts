import test from 'node:test';
import assert from 'node:assert';
import { quote } from '../src/main/shell.ts';

test('quote: simple tokens stay bare (keeps bundle/rake .bat shims working), spaces get quoted', () => {
  if (process.platform === 'win32') {
    assert.strictEqual(quote('bundle'), 'bundle');
    assert.strictEqual(quote('spec/a_spec.rb'), 'spec/a_spec.rb');
    assert.strictEqual(quote('C:\\sp ace\\a.rb'), '"C:\\sp ace\\a.rb"');
    assert.strictEqual(quote('a"b'), '"a""b"');
  } else {
    assert.strictEqual(quote('bundle'), "'bundle'");
    assert.strictEqual(quote("a'b"), "'a'\\''b'");
  }
});
