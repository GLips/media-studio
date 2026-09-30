import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true },
  include: ['lib', 'cli'],
});

test('an annotation deleting a written literal\'s keys is caught at a variable, a property and a concise return; closed keys, accumulators and calls are not', () => {
  const findings = runCheckOnFiles('no-known-value-widening', {
    'tsconfig.json': TSCONFIG,
    // Obvious: an open dictionary over a literal, though its value type is precise.
    'lib/output/render/engine/handlers.ts': 'type Handler = () => void;\nexport const handlers: Record<string, Handler> = { start: () => {} };\n',
    // Adversarial: a parenthesised concise return, a class property typed `object`, and `unknown` over a number.
    'cli/commands/sizes.ts': [
      'export const sizes = (): Readonly<Record<string, number>> => ({ small: 1 });',
      'export class Box { shape: object = { w: 1 }; }',
      'export const scale: unknown = 2;',
    ].join('\n'),
    // Legal neighbours: closed keys, an empty accumulator, and a call's result (a boundary, not a widening).
    'lib/output/render/models/closed.ts': [
      "export const modes: Record<'start' | 'stop', number> = { start: 1, stop: 2 };",
      'export const acc: Record<string, number> = {};',
      "export const parsed: unknown = JSON.parse('1');",
      // A lookup table read by a computed key relies on its open key domain; a typed array has no keys to lose.
      "const ROLES: Record<string, 'video'> = { 'video.tsx': 'video' };",
      'export const roleOf = (file: string) => ROLES[file];',
      'export const samples: Float32Array = new Float32Array(4);',
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/sizes.ts:return Readonly<Record<string, number>>',
    'cli/commands/sizes.ts:scale: unknown',
    'cli/commands/sizes.ts:shape: object',
    'lib/output/render/engine/handlers.ts:handlers: Record<string, Handler>',
  ]);
});
