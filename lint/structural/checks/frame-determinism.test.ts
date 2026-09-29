import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('ambient randomness and clocks are caught however they are reached, in code that draws, and nowhere else', () => {
  const findings = runCheckOnFiles('frame-determinism', {
    // Obvious: a scene reading the clock and Math.random.
    'work/projects/p/scenes/intro.tsx': 'export const r = Math.random() + Date.now();\n',
    // Adversarial: through globalThis, a computed key, destructuring, and a bare Date() or new Date().
    'lib/picture/stamp-paint/models/recipe.ts': [
      "const { random } = Math;", "const t = globalThis.performance['now']();", 'const id = crypto.randomUUID();',
      'const now = new Date();', 'const stamp = Date();', 'const bytes = window.crypto.getRandomValues(new Uint8Array(4));',
    ].join('\n'),
    'work/styles/ink/style.ts': 'export const seed = performance.now();\n',
    'work/projects/p/scenes/intro/sky.ts': 'export const jitter = () => Math.random();\n',
    // Legal neighbours: a date from an argument, a seeded stream, an erased type, and an unrelated `now`.
    'lib/picture/motion/models/when.ts': [
      'export const at = (iso: string) => new Date(iso);', "import { seededRandom } from './random.ts';",
      'export type Clock = ReturnType<typeof Date.now>;', 'export const clock = { now: () => 0 };', 'export const t = clock.now();',
    ].join('\n'),
    // Not held: engine code times a render, a capture stamps provenance, and a spec may do either.
    'lib/output/render/engine/session.ts': 'export const started = performance.now();\n',
    'work/projects/p/capture.ts': 'export const at = new Date().toISOString();\n',
    'lib/picture/stamp-paint/models/recipe.test.ts': 'const r = Math.random();\n',
  });
  assert.deepEqual(caught(findings), [
    'lib/picture/stamp-paint/models/recipe.ts:Date()',
    'lib/picture/stamp-paint/models/recipe.ts:Math.random',
    'lib/picture/stamp-paint/models/recipe.ts:crypto.getRandomValues',
    'lib/picture/stamp-paint/models/recipe.ts:crypto.randomUUID',
    'lib/picture/stamp-paint/models/recipe.ts:new Date()',
    'lib/picture/stamp-paint/models/recipe.ts:performance.now',
    'work/projects/p/scenes/intro.tsx:Date.now',
    'work/projects/p/scenes/intro.tsx:Math.random',
    'work/projects/p/scenes/intro/sky.ts:Math.random',
    'work/styles/ink/style.ts:performance.now',
  ]);
});
