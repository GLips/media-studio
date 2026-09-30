import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true },
  include: ['lib', 'cli'],
});

test('an open dictionary of opaque values is caught in any spelling, once, at its declaration; closed keys and typed values are not', () => {
  const findings = runCheckOnFiles('no-opaque-record', {
    'tsconfig.json': TSCONFIG,
    // Obvious: the Record spelling, and an alias to it used elsewhere, reported at the alias only.
    'lib/timing/cues/models/bag.ts': 'export type Bag = Record<string, unknown>;\n',
    'cli/read.ts': "import type { Bag } from '../lib/timing/cues/models/bag.ts';\nexport const read = (bag: Bag) => bag;\n",
    // Adversarial: a bag imported by name from a declaration file no check walks is reported at its use.
    'lib/timing/cues/models/vendor.d.ts': 'export type Payload = Record<string, unknown>;\n',
    'lib/timing/cues/engine/load.ts': "import type { Payload } from '../models/vendor';\nexport const load = (payload: Payload) => payload;\n",
    // Adversarial: wrapped, an interface's index signature, a mapped type over string, any as the value.
    'lib/picture/brush/engine/wrapped.ts': [
      'export type Loose = Partial<Record<string, any>>;',
      'export interface Settings { [key: string]: object }',
      'export type Mapped = { [K in string]: unknown };',
    ].join('\n'),
    // Legal neighbours: closed keys, a typed value, an array, and `as const`.
    'lib/picture/brush/models/closed.ts': [
      "export type Dirty = Record<'draft' | 'paid', unknown>;",
      'export type Handlers = Record<string, () => void>;',
      'export type List = unknown[];',
      "export const KEYS = ['a', 'b'] as const;",
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'lib/picture/brush/engine/wrapped.ts:Partial<Record<string, any>>',
    'lib/picture/brush/engine/wrapped.ts:interface Settings',
    'lib/picture/brush/engine/wrapped.ts:{ [K in string]: unknown }',
    'lib/timing/cues/engine/load.ts:Payload',
    'lib/timing/cues/models/bag.ts:Record<string, unknown>',
  ]);
});
