import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true },
  include: ['lib', 'work'],
});

test('a known value widened and asserted back in one function is caught in either spelling; a boundary and a closure are not', () => {
  const findings = runCheckOnFiles('no-widen-then-assert', {
    'tsconfig.json': TSCONFIG,
    'lib/footage/clips/models/clip.ts': [
      'export type Clip = { id: string; frames: number };',
      "export const loadClip = (): Clip => ({ id: 'a', frames: 1 });",
      // Obvious: annotated unknown, then asserted back.
      'export function obvious(): Clip {',
      '  const stored: unknown = loadClip();',
      '  return stored as Clip;',
      '}',
      // Adversarial: widened through an assertion to an opaque record, asserted back with angle brackets.
      'export function sneaky(clip: Clip): Clip {',
      '  const bag = clip as Record<string, unknown>;',
      '  return <Clip>bag;',
      '}',
    ].join('\n'),
    // Legal neighbours: JSON.parse is `any`, so nothing known was lost; a closure's assertion has another author.
    'work/projects/p/scenes/x.tsx': [
      "import type { Clip } from '../../../../lib/footage/clips/models/clip.ts';",
      "import { loadClip } from '../../../../lib/footage/clips/models/clip.ts';",
      "export const parsed = (text: string) => { const raw: unknown = JSON.parse(text); return raw as Clip; };",
      'export function later() { const held: unknown = loadClip(); return () => held as Clip; }',
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'lib/footage/clips/models/clip.ts:<Clip>bag',
    'lib/footage/clips/models/clip.ts:stored as Clip',
  ]);
});
