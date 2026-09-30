import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true },
  include: ['lib', 'cli'],
});

test('a typeof over an untyped value is caught, even in a callback inside a guard; a guard\'s body and a typed union are not', () => {
  const findings = runCheckOnFiles('no-runtime-typeof', {
    'tsconfig.json': TSCONFIG,
    // Obvious: branching on an unknown.
    'cli/commands/flag.ts': "export const flag = (raw: unknown) => (typeof raw === 'string' ? raw : '');\n",
    // Adversarial: a guard whose callback tests its own untyped element, and an `object` operand.
    'lib/platform/config/engine/guard.ts': [
      'export function isList(value: unknown): value is string[] {',
      "  return Array.isArray(value) && value.every((item: any) => typeof item === 'string');",
      '}',
      "export const kind = (shape: object) => typeof shape;",
    ].join('\n'),
    // Legal neighbours: a guard's parse step, a receiver guard, a typed union and an existence test.
    'lib/platform/config/models/typed.ts': [
      "export const isText = (value: unknown): value is string => typeof value === 'string';",
      "export class Ledger { isLedger(): this is Ledger { return typeof this === 'object'; } }",
      "export const width = (v: string | number) => (typeof v === 'string' ? v.length : v);",
      "export const hasGlobal = () => typeof globalThis === 'undefined';",
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/flag.ts:typeof raw',
    'lib/platform/config/engine/guard.ts:typeof item',
    'lib/platform/config/engine/guard.ts:typeof shape',
  ]);
});
