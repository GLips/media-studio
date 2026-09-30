import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baselineOf, baselineTier, compareToBaseline, rebaselineTier } from './baseline.ts';
import type { Finding } from './structural/check-context.ts';

const finding = (path: string, line: number, key = 'x'): Finding => ({ check: 'c', path, line, key, message: '' });

test("baselined findings report without blocking, even after they move; a new or vanished one is called out", () => {
  const baseline = baselineOf([finding('a.ts', 3), finding('a.ts', 9), finding('b.ts', 1)]);
  // Lines moved in a.ts, one more occurrence there, a new file, and b.ts's finding fixed.
  const { fresh, stale, baselined } = compareToBaseline([finding('a.ts', 5), finding('a.ts', 12), finding('a.ts', 20), finding('new.ts', 1)], baseline);
  assert.deepEqual(baselined.map((f) => `${f.path}:${f.line}`), ['a.ts:5', 'a.ts:12']);
  assert.deepEqual(fresh.map((f) => `${f.path}:${f.line}`), ['a.ts:20', 'new.ts:1']);
  assert.deepEqual(stale, [{ check: 'c', path: 'b.ts', key: 'x', count: 1 }]);
});

test("each tier judges and rewrites only its own entries in the scope's one baseline", () => {
  const both = { 'file-size': { 'a.ts': { big: 1 } }, 'arch(no-long-comments)': { 'a.ts': { '// long': 1 } } };
  assert.deepEqual(Object.keys(baselineTier(both, 'oxlint')), ['arch(no-long-comments)']);
  const rewritten = rebaselineTier(both, 'structural', [{ check: 'file-size', path: 'b.ts', line: 1, key: 'big', message: '' }]);
  assert.deepEqual(rewritten, { 'arch(no-long-comments)': { 'a.ts': { '// long': 1 } }, 'file-size': { 'b.ts': { big: 1 } } });
});
