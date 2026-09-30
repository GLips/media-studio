import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIB_LAYERS } from '../../policy/studio-tree.ts';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const PACKAGE = JSON.stringify({ imports: { '#lib/*': './lib/*', '#studio': './lib/api.ts' } });
// A fixture holds a few features, so every other declared foundation is reported absent; the specs set those aside.
const onlyEdges = (found: string[]) => found.filter((key) => !key.includes(':absent:'));

test('a foundation imports foundations of its layer or below, never a peer; a peer imports any foundation', () => {
  const findings = runCheckOnFiles('feature-layers', {
    'package.json': PACKAGE,
    'lib/platform/temp/engine/studio-temp.ts': 'export const temp = 1;\n',
    'lib/platform/git/engine/git.ts': [
      // Legal: a foundation of its own layer.
      "import { temp } from '#lib/platform/temp/engine/studio-temp.ts';",
      // Obvious: a peer, by alias. Adversarial: a type-only import of the same peer by a relative climb, from a test.
      "import { paint } from '#lib/picture/paint/models/paint.ts';",
    ].join('\n'),
    'lib/platform/git/engine/git.test.ts': "import type { Paint } from '../../../picture/paint/models/paint.ts';\n",
    // Legal: a peer building on foundations.
    'lib/picture/paint/models/paint.ts': "import { temp } from '#lib/platform/temp/engine/studio-temp.ts';\nexport type Paint = {};\nexport const paint = 1;\n",
  });
  assert.deepEqual(onlyEdges(caught(findings)), ['lib/platform/git:→ lib/picture/paint']);
});

test('a foundation imports down the layers, never up', () => {
  const findings = runCheckOnFiles('feature-layers', {
    'package.json': PACKAGE,
    'lib/platform/temp/engine/studio-temp.ts': 'export const temp = 1;\n',
    // Legal: vocabulary stands on platform.
    'lib/picture/frame/models/frame.ts': "import { temp } from '#lib/platform/temp/engine/studio-temp.ts';\nexport const frame = temp;\n",
    // Upward: vocabulary reaching into authoring.
    'lib/picture/motion/models/motion.ts': "import { video } from '#lib/picture/video/models/video.ts';\nexport const motion = video;\n",
    'lib/picture/video/models/video.ts': "import { frame } from '#lib/picture/frame/models/frame.ts';\nexport const video = frame;\n",
  });
  assert.deepEqual(onlyEdges(caught(findings)), ['lib/picture/motion:→ lib/picture/video']);
});

test('a declared foundation that is no feature is reported on the policy', () => {
  const findings = runCheckOnFiles('feature-layers', { 'package.json': PACKAGE, 'lib/platform/temp/engine/studio-temp.ts': 'export const temp = 1;\n' });
  const expected = LIB_LAYERS.flatMap((layer) => layer.features).filter((feature) => feature !== 'platform/temp')
    .map((feature) => `lint/policy/studio-tree.ts:absent:${feature}`);
  assert.deepEqual(caught(findings), expected.toSorted());
});
