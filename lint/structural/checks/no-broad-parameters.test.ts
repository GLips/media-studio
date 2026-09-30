import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true },
  include: ['lib', 'harness'],
});

test('a parameter typed unknown, any or object is caught in any slot; a guard\'s subject, `cause` and `this` are not', () => {
  const findings = runCheckOnFiles('no-broad-parameters', {
    'tsconfig.json': TSCONFIG,
    // Obvious: an unknown input.
    'lib/picture/stamp/engine/load.ts': 'export function load(input: unknown) { return input; }\n',
    // Adversarial: a rest of any[], a method signature's object, a Promise<unknown>, a constructor parameter property.
    'harness/run.ts': [
      'export const log = (...items: any[]) => items.length;',
      'export interface Sink { write(chunk: object): void }',
      'export const settle = (pending: Promise<unknown>) => pending;',
      'export class Holder { constructor(private readonly contents: unknown) {} }',
    ].join('\n'),
    // Legal neighbours: a guard's own subject, `cause`, the `this` annotation, and a named type.
    'lib/picture/stamp/models/guard.ts': [
      "export const isName = (value: unknown): value is string => typeof value === 'string';",
      "export const fail = (cause: unknown) => new Error('x', { cause });",
      'export function tag(this: unknown, label: string) { return label; }',
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'harness/run.ts:chunk: object',
    'harness/run.ts:contents: unknown',
    'harness/run.ts:items: any[]',
    'harness/run.ts:pending: Promise<unknown>',
    'lib/picture/stamp/engine/load.ts:input: unknown',
  ]);
});
