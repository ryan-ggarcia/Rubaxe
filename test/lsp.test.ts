import test from 'node:test';
import assert from 'node:assert';
import { createParser, frame } from '../src/main/lsp.ts';

test('LSP framing survives split chunks, multibyte bodies and stray stdout', () => {
  const got: unknown[] = [];
  const parse = createParser(m => got.push(m));
  const bytes = Buffer.concat([Buffer.from('Fetching gems...\n'), frame({ id: 1, result: 'ação' }), frame({ method: 'x' })]);
  for (let i = 0; i < bytes.length; i += 7) parse(bytes.subarray(i, i + 7));
  assert.deepStrictEqual(got, [{ id: 1, result: 'ação' }, { method: 'x' }]);
});
