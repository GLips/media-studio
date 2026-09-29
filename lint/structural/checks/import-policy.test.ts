import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a project importing another project is caught through an alias; an unknown alias is refused', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#shared-project/*': './work/projects/other/*' } }),
    'work/projects/other/look.ts': 'export const ink = 1;\n',
    'work/projects/p/video.tsx': [
      "import { ink } from '../other/look.ts';",
      // Adversarial: the same crossing spelled as an alias.
      "import { ink as again } from '#shared-project/look.ts';",
      "import { x } from '#nowhere';",
      // Adversarial: an absolute path, and a relative one climbing out of the repo.
      "import { h } from '/etc/hosts.ts';",
      "import { u } from '../../../../elsewhere/x.ts';",
      // Legal neighbour: its own file.
      "import { t } from './timeline.ts';",
    ].join('\n'),
    'work/projects/p/timeline.ts': 'export const t = 0;\n',
  });
  assert.deepEqual(caught(findings), [
    'work/projects/p/video.tsx:#nowhere',
    'work/projects/p/video.tsx:#shared-project/look.ts',
    'work/projects/p/video.tsx:../../../../elsewhere/x.ts',
    'work/projects/p/video.tsx:../other/look.ts',
    'work/projects/p/video.tsx:/etc/hosts.ts',
  ]);
});

test('a project reaches the barrel only through #studio, and studio code reaches engine code only from a spec', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/api.ts', '#lib/*': './lib/*' } }),
    'lib/api.ts': "export * from '#lib/picture/kit/studio/kit.tsx';\n",
    'lib/picture/kit/studio/kit.tsx': 'export const Card = 1;\n',
    'lib/output/render/engine/tsx-test-hooks.ts': 'export {};\n',
    'work/projects/p/video.tsx': [
      "import { Card } from '../../../lib/api.ts';",
      // Adversarial: a relative path to a module behind the barrel, and a type-only one.
      "import { Card as again } from '../../../lib/picture/kit/studio/kit.tsx';",
      "import type { Card as T } from '../../../lib/picture/kit/studio/kit.tsx';",
      // Legal neighbours: the barrel alias and the lib alias.
      "import { Card as a } from '#studio';",
      "import { Card as b } from '#lib/picture/kit/studio/kit.tsx';",
    ].join('\n'),
    // A studio module reaching the engine; its spec, run in Node, may.
    'lib/picture/kit/studio/hooks.tsx': "import '#lib/output/render/engine/tsx-test-hooks.ts';\n",
    'lib/picture/kit/studio/kit.test.ts': "import '#lib/output/render/engine/tsx-test-hooks.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/picture/kit/studio/hooks.tsx:#lib/output/render/engine/tsx-test-hooks.ts',
    'work/projects/p/video.tsx:../../../lib/api.ts',
    'work/projects/p/video.tsx:../../../lib/picture/kit/studio/kit.tsx',
    'work/projects/p/video.tsx:../../../lib/picture/kit/studio/kit.tsx',
  ]);
});

test('an import into another feature uses #lib/*; a relative path within the feature, across its role folders too, stays legal', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*' } }),
    'lib/timing/timeline/models/grid.ts': 'export const grid = 1;\n',
    'lib/timing/timeline/models/cue.ts': "import { grid } from './grid.ts';\nimport { g } from '../models/grid.ts';\n",
    'lib/timing/timeline/studio/cue-marker.tsx': "import { grid } from '../models/grid.ts';\n",
    'lib/timing/sound/models/library.ts': 'export const library = 1;\n',
    'lib/output/render/engine/render.ts': [
      "import { grid } from '../../../timing/timeline/models/grid.ts';",
      // Adversarial: a dynamic import and a re-export make the same crossing.
      "export { library } from '../../../timing/sound/models/library.ts';",
      "const lazy = () => import('../../../timing/sound/models/library.ts');",
      "import { grid as aliased } from '#lib/timing/timeline/models/grid.ts';",
    ].join('\n'),
    // A root file one level above lib crosses too, however short its path.
    'remotion.config.ts': "import { grid } from './lib/timing/timeline/models/grid.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/output/render/engine/render.ts:../../../timing/sound/models/library.ts',
    'lib/output/render/engine/render.ts:../../../timing/sound/models/library.ts',
    'lib/output/render/engine/render.ts:../../../timing/timeline/models/grid.ts',
    'remotion.config.ts:./lib/timing/timeline/models/grid.ts',
  ]);
});

test('web client code reaches engine code only through a .server door in infrastructure/, and lib/ never imports web/', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*', '#web/*': './web/src/*' } }),
    'lib/output/review/engine/review-artifact.ts': 'export const readReviewArtifact = 1;\n',
    'web/src/infrastructure/studio-engine.server.ts': "export { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';\n",
    'web/src/features/review/ui/review-screen.tsx': [
      "import { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';",
      // Adversarial: the same reach spelled relatively, and a type-only one, which still names the module.
      "import { readReviewArtifact as again } from '../../../../../lib/output/review/engine/review-artifact.ts';",
      "import type { readReviewArtifact as T } from '#lib/output/review/engine/review-artifact.ts';",
      // Legal neighbour: the door.
      "import { readReviewArtifact as door } from '#web/infrastructure/studio-engine.server.ts';",
    ].join('\n'),
    // Adversarial: `.server` outside infrastructure/ is not a door.
    'web/src/features/review/controllers/review-queries.server.ts': "import { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';\n",
    'lib/platform/web/engine/serve.ts': "import { door } from '#web/infrastructure/studio-engine.server.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/platform/web/engine/serve.ts:#web/infrastructure/studio-engine.server.ts',
    'web/src/features/review/controllers/review-queries.server.ts:#lib/output/review/engine/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:#lib/output/review/engine/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:#lib/output/review/engine/review-artifact.ts',
    // Twice: a client reaching engine code, and a feature reached by a relative path.
    'web/src/features/review/ui/review-screen.tsx:../../../../../lib/output/review/engine/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:../../../../../lib/output/review/engine/review-artifact.ts',
  ]);
});

test('nothing outside work/ imports into it, whether or not the workspace is there to back the path', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*' } }),
    'work/projects/p/look.ts': 'export const ink = 1;\n',
    'lib/picture/look/models/look.ts': [
      "import { ink } from '../../../../work/projects/p/look.ts';",
      // Adversarial: a path the snapshot doesn't hold, as in a clean clone.
      "import { gone } from '../../../../work/projects/q/gone.ts';",
    ].join('\n'),
    'cli/commands/x.ts': "import { ink } from '../../work/projects/p/look.ts';\n",
    // Legal neighbour: a project reaching the studio.
    'work/projects/p/video.tsx': "import { a } from '#lib/picture/look/models/look.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/x.ts:../../work/projects/p/look.ts',
    'lib/picture/look/models/look.ts:../../../../work/projects/p/look.ts',
    'lib/picture/look/models/look.ts:../../../../work/projects/q/gone.ts',
  ]);
});
