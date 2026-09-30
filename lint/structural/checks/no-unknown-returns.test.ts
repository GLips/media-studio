import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true },
  include: ['lib'],
});

test('a declared return of unknown is caught through a container and an alias; inference and generics are not', () => {
  const findings = runCheckOnFiles('no-unknown-returns', {
    'tsconfig.json': TSCONFIG,
    // Obvious: unknown returned.
    'lib/footage/fetch/engine/read.ts': "export function read(): unknown { return JSON.parse('1'); }\n",
    // Adversarial: an alias to Promise<any[]> on an interface method.
    'lib/footage/fetch/engine/client.ts': 'type Rows = Promise<any[]>;\nexport interface Client { rows(): Rows }\n',
    // Legal neighbours: an unannotated function, a generic return, a named type.
    'lib/footage/fetch/models/typed.ts': [
      "export const inferred = () => JSON.parse('1');",
      'export function load<T>(value: T): T { return value; }',
      'export const count = (): number => 1;',
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'lib/footage/fetch/engine/client.ts:rows(): Rows',
    'lib/footage/fetch/engine/read.ts:read(): unknown',
  ]);
});
