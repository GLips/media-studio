import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true },
  include: ['lib', 'work'],
});

test('a type name resolving to unknown or any is caught through a chain, a container and a function body; a type parameter is not', () => {
  const findings = runCheckOnFiles('no-unknown-type-aliases', {
    'tsconfig.json': TSCONFIG,
    // Obvious: an alias to unknown.
    'lib/timing/beats/models/payload.ts': 'export type Payload = unknown;\n',
    // Adversarial: a chain through an import, a generic that ignores its parameter, an alias inside a function.
    'work/projects/p/scenes/x.tsx': [
      "import type { Payload } from '../../../../lib/timing/beats/models/payload.ts';",
      'export type Rows = Payload[];',
      'export type Boxed<T> = any;',
      'export function scene() { type Local = Promise<unknown>; const v: Local = Promise.resolve(1); return v; }',
    ].join('\n'),
    // Legal neighbours: a bare type parameter and a named shape.
    'lib/timing/beats/models/boxed.ts': 'export type Box<T> = T;\nexport type Beat = { at: number };\n',
  });
  assert.deepEqual(caught(findings), [
    'lib/timing/beats/models/payload.ts:Payload',
    'work/projects/p/scenes/x.tsx:Boxed',
    'work/projects/p/scenes/x.tsx:Local',
    'work/projects/p/scenes/x.tsx:Rows',
  ]);
});
