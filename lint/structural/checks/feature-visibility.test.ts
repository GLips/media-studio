import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const PACKAGE = JSON.stringify({ imports: { '#lib/*': './lib/*', '#studio': './lib/api.ts' } });

test("an import from one feature into another needs the importee's grant, however it is spelled", () => {
  const findings = runCheckOnFiles('feature-visibility', {
    'package.json': PACKAGE,
    'lib/picture/brush/models/brush.ts': 'export type Brush = {};\nexport const brush = 1;\n',
    'lib/picture/paper/models/paper.ts': 'export const paper = 1;\n',
    'lib/picture/paper/visibility.json': JSON.stringify({ 'lib/picture/paint': 'paints on it', 'lib/picture/gone': 'imported it once' }),
    'lib/picture/paint/engine/paint.ts': [
      // Obvious: an ungranted alias import. Adversarial: a relative climb and a type-only import, same importee, one file.
      "import { brush } from '#lib/picture/brush/models/brush.ts';",
      "import type { Brush } from '../../brush/models/brush.ts';",
      // Legal: granted.
      "import { paper } from '#lib/picture/paper/models/paper.ts';",
      // Legal: within its own feature.
      "import { stroke } from '../models/stroke.ts';",
    ].join('\n'),
    'lib/picture/paint/models/stroke.ts': "import type { Brush } from '../../brush/models/brush.ts';\nexport const stroke = 1;\n",
    // Adversarial: a web feature reaching another web feature. Legal: a web feature consuming lib, as cli does.
    'web/src/features/f/ui/page.tsx': "import { paper } from '#lib/picture/paper/models/paper.ts';\nimport { G } from '../../g/index.ts';\n",
    'web/src/features/g/index.ts': 'export const G = 1;\n',
    // Legal: the barrel, a project and the CLI aren't features.
    'lib/api.ts': "export { brush } from '#lib/picture/brush/models/brush.ts';\n",
    'work/projects/p/video.tsx': "import { brush } from '../../../lib/picture/brush/models/brush.ts';\n",
    'cli/paint.ts': "import { brush } from '#lib/picture/brush/models/brush.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    // Once for the pair, however many of paint's files import brush.
    'lib/picture/brush/visibility.json:missing:lib/picture/paint',
    // A grant naming a folder that is no feature.
    'lib/picture/paper/visibility.json:grant:lib/picture/gone',
    'web/src/features/g/visibility.json:missing:web/src/features/f',
  ]);
});

test('a grant outliving its import, a grant without a reason and a grant file outside a feature are reported', () => {
  const findings = runCheckOnFiles('feature-visibility', {
    'package.json': PACKAGE,
    'lib/picture/brush/models/brush.ts': 'export const brush = 1;\n',
    'lib/picture/paint/models/paint.ts': 'export const paint = 1;\n',
    'lib/picture/paper/models/paper.ts': "import { brush } from '#lib/picture/brush/models/brush.ts';\n",
    'lib/picture/brush/visibility.json': JSON.stringify({ 'lib/picture/paint': 'paints with it', 'lib/picture/paper': ' ' }),
    'lib/picture/paint/visibility.json': JSON.stringify({ 'lib/picture/brush': 'no longer imports it' }),
    'lib/picture/visibility.json': '{}',
  });
  assert.deepEqual(caught(findings), [
    // Unreadable: no import of brush is granted, and none is reported one by one either.
    'lib/picture/brush/visibility.json:unreadable',
    'lib/picture/paint/visibility.json:grant:lib/picture/brush',
    'lib/picture/visibility.json:no-feature',
  ]);
});

test('an import into or out of a feature held out until vid-108 lands needs no grant', () => {
  const findings = runCheckOnFiles('feature-visibility', {
    'package.json': PACKAGE,
    'lib/picture/stamp-paint/models/stamp.ts': "import { reel } from '#lib/picture/reel/models/reel.ts';\nexport const stamp = 1;\n",
    'lib/picture/reel/models/reel.ts': 'export const reel = 1;\n',
    'lib/picture/kit/models/kit.ts': "import { stamp } from '#lib/picture/stamp-paint/models/stamp.ts';\n",
  });
  assert.deepEqual(caught(findings), []);
});
