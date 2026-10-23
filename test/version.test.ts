import test from 'node:test';
import assert from 'node:assert';
import { isNewer } from '../src/main/version.ts';

test('isNewer compares numerically and ranks a release above its prereleases', () => {
  assert.strictEqual(isNewer('0.2.0', '0.1.0'), true);
  assert.strictEqual(isNewer('0.10.0', '0.9.9'), true);
  assert.strictEqual(isNewer('1.0.0', '1.0.0'), false);
  assert.strictEqual(isNewer('0.1.0', '0.2.0'), false);
  assert.strictEqual(isNewer('1.0.0', '1.0.0-beta.1'), true);
  assert.strictEqual(isNewer('1.0.0-beta.1', '1.0.0'), false);
  assert.strictEqual(isNewer('1.1', '1.0.9'), true);
  assert.strictEqual(isNewer('latest', '0.1.0'), false);
});
