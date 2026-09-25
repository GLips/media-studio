// The reference rides on TypeScript's unstable API, so an upgrade that changes it should fail here, not in `studio api`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findStudioApiExport, readStudioApiExports } from './studio-api-reference.ts';

test('every export of lib/studio/api.ts resolves to its declaration, signature and doc', () => {
  const exports = readStudioApiExports();
  assert.deepEqual(exports.filter((e) => e.file === '?' || !e.signatures.length).map((e) => e.name), []);
  const fit = findStudioApiExport(exports, 'fitTake');
  assert.equal(fit.file, 'lib/studio/take.ts');
  assert.match(fit.signatures[0], /^function fitTake<T extends Take>\(take: T, pins:/);
  assert.match(fit.doc, /^Pins take moments to scene times/);
});
