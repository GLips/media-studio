import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true, lib: ['ES2023'] },
  include: ['lib'],
});

test('an Effect-native engine exporting a promise is caught, however it is spelled; Effects and other features are not', () => {
  const findings = runCheckOnFiles('effect-native-exports', {
    'tsconfig.json': TSCONFIG,
    // Obvious: an async function.
    'lib/footage/library/engine/add-take.ts': 'export async function addTake(path: string): Promise<string> { return path; }\n',
    // Adversarial: no async and no annotation, the promise inferred from another call; and a re-export.
    'lib/footage/library/engine/library-load.ts': [
      "import { addTake } from './add-take.ts';",
      'export const loadLibrary = (path: string) => addTake(path).then((id) => [id]);',
      "export { addTake as addLibraryTake } from './add-take.ts';",
    ].join('\n'),
    // Legal: a function returning an Effect-shaped value, a constant, and a promise in a feature not on Effect.
    'lib/footage/transcript/engine/transcribe.ts': [
      'type Effect<A> = { readonly run: () => A };',
      'export const transcribe = (path: string): Effect<string> => ({ run: () => path });',
      'export const WHISPER_MODEL = "medium";',
    ].join('\n'),
    'lib/footage/capture/engine/capture.ts': 'export const capture = async () => "shot";\n',
  });
  assert.deepEqual(caught(findings), [
    'lib/footage/library/engine/add-take.ts:addTake',
    'lib/footage/library/engine/library-load.ts:addLibraryTake',
    'lib/footage/library/engine/library-load.ts:loadLibrary',
  ]);
});
