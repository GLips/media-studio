import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const OPTIONS = { strict: true, jsx: 'preserve', module: 'preserve', moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true };

test('a governed TypeScript file its program neither includes nor imports is caught; one reached by import, and tool config, are not', () => {
  const findings = runCheckOnFiles('typed-tree', {
    'tsconfig.json': JSON.stringify({ compilerOptions: OPTIONS, include: ['lib', 'work/projects/*/video.tsx'] }),
    'web/tsconfig.json': JSON.stringify({ compilerOptions: OPTIONS, include: ['src/routes'] }),
    // Obvious: cli/ is in no include and nothing imports it.
    'cli/studio.ts': 'export const run = 1;\n',
    // Adversarial: a web file compiled only by the root program is still uncompiled by its own (web's).
    'web/src/shared/format.ts': 'export const format = 1;\n',
    'lib/output/web/engine/uses-web.ts': "import { format } from '../../../../web/src/shared/format.ts';\nexport const f = format;\n",
    // Legal neighbours: a scene reached by import from an included video, tool config, and JavaScript.
    'work/projects/p/video.tsx': "import { scene } from './scenes/x.tsx';\nexport const v = scene;\n",
    'work/projects/p/scenes/x.tsx': 'export const scene = 1;\n',
    'web/vite.config.ts': 'export default {};\n',
    'lib/output/web/engine/plain.js': 'export const js = 1;\n',
  });
  assert.deepEqual(caught(findings), ['cli/studio.ts:tsconfig.json', 'web/src/shared/format.ts:web/tsconfig.json']);
});
