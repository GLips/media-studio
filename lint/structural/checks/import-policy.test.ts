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

test('a project reaches lib/studio only through #studio, and lib/studio reaches lib/engine only from a spec', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/studio/api.ts', '#studio/*': './lib/studio/*', '#engine/*': './lib/engine/*' } }),
    'lib/studio/api.ts': "export * from './kit/kit.tsx';\n",
    'lib/studio/kit/kit.tsx': 'export const Card = 1;\n',
    'lib/engine/bundle/tsx-test-hooks.ts': 'export {};\n',
    'work/projects/p/video.tsx': [
      "import { Card } from '../../../lib/studio/api.ts';",
      // Adversarial: a relative path to a module behind the barrel, and a type-only one.
      "import { Card as again } from '../../../lib/studio/kit/kit.tsx';",
      "import type { Card as T } from '../../../lib/studio/kit/kit.tsx';",
      // Legal neighbours: the barrel alias and the folder alias.
      "import { Card as a } from '#studio';",
      "import { Card as b } from '#studio/kit/kit.tsx';",
    ].join('\n'),
    // A studio module reaching the engine; its spec, run in Node, may.
    'lib/studio/kit/hooks.tsx': "import '#engine/bundle/tsx-test-hooks.ts';\n",
    'lib/studio/kit/kit.test.ts': "import '#engine/bundle/tsx-test-hooks.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/studio/kit/hooks.tsx:#engine/bundle/tsx-test-hooks.ts',
    'work/projects/p/video.tsx:../../../lib/studio/api.ts',
    'work/projects/p/video.tsx:../../../lib/studio/kit/kit.tsx',
    'work/projects/p/video.tsx:../../../lib/studio/kit/kit.tsx',
  ]);
});

test('an import into a lib folder from outside it uses the alias; a relative path within the folder stays legal', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#models/*': './lib/models/*', '#sfx/*': './lib/sfx/*' } }),
    'lib/models/timeline/grid.ts': 'export const grid = 1;\n',
    'lib/models/timeline/cue.ts': "import { grid } from './grid.ts';\nimport { g } from '../timeline/grid.ts';\n",
    'lib/sfx/library.ts': 'export const library = 1;\n',
    'lib/engine/render/render.ts': [
      "import { grid } from '../../models/timeline/grid.ts';",
      // Adversarial: a dynamic import and a re-export make the same crossing.
      "export { library } from '../../sfx/library.ts';",
      "const lazy = () => import('../../sfx/library.ts');",
      "import { grid as aliased } from '#models/timeline/grid.ts';",
    ].join('\n'),
    // A root file one level above lib crosses too, however short its path.
    'remotion.config.ts': "import { grid } from './lib/models/timeline/grid.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/engine/render/render.ts:../../models/timeline/grid.ts',
    'lib/engine/render/render.ts:../../sfx/library.ts',
    'lib/engine/render/render.ts:../../sfx/library.ts',
    'remotion.config.ts:./lib/models/timeline/grid.ts',
  ]);
});

test('web client code reaches lib/engine only through a .server door in infrastructure/, and lib/ never imports web/', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#engine/*': './lib/engine/*', '#web/*': './web/src/*' } }),
    'lib/engine/review/review-artifact.ts': 'export const readReviewArtifact = 1;\n',
    'web/src/infrastructure/studio-engine.server.ts': "export { readReviewArtifact } from '#engine/review/review-artifact.ts';\n",
    'web/src/features/review/ui/review-screen.tsx': [
      "import { readReviewArtifact } from '#engine/review/review-artifact.ts';",
      // Adversarial: the same reach spelled relatively, and a type-only one, which still names the module.
      "import { readReviewArtifact as again } from '../../../../../lib/engine/review/review-artifact.ts';",
      "import type { readReviewArtifact as T } from '#engine/review/review-artifact.ts';",
      // Legal neighbour: the door.
      "import { readReviewArtifact as door } from '#web/infrastructure/studio-engine.server.ts';",
    ].join('\n'),
    // Adversarial: `.server` outside infrastructure/ is not a door.
    'web/src/features/review/controllers/review-queries.server.ts': "import { readReviewArtifact } from '#engine/review/review-artifact.ts';\n",
    'lib/engine/web/serve.ts': "import { door } from '#web/infrastructure/studio-engine.server.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/engine/web/serve.ts:#web/infrastructure/studio-engine.server.ts',
    'web/src/features/review/controllers/review-queries.server.ts:#engine/review/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:#engine/review/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:#engine/review/review-artifact.ts',
    // Twice: a client reaching the engine, and a lib folder reached by a relative path.
    'web/src/features/review/ui/review-screen.tsx:../../../../../lib/engine/review/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:../../../../../lib/engine/review/review-artifact.ts',
  ]);
});

test('nothing outside work/ imports into it, whether or not the workspace is there to back the path', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#models/*': './lib/models/*' } }),
    'work/projects/p/look.ts': 'export const ink = 1;\n',
    'lib/models/look/look.ts': [
      "import { ink } from '../../../work/projects/p/look.ts';",
      // Adversarial: a path the snapshot doesn't hold, as in a clean clone.
      "import { gone } from '../../../work/projects/q/gone.ts';",
    ].join('\n'),
    'cli/commands/x.ts': "import { ink } from '../../work/projects/p/look.ts';\n",
    // Legal neighbour: a project reaching the studio.
    'work/projects/p/video.tsx': "import { a } from '#models/look/look.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/x.ts:../../work/projects/p/look.ts',
    'lib/models/look/look.ts:../../../work/projects/p/look.ts',
    'lib/models/look/look.ts:../../../work/projects/q/gone.ts',
  ]);
});
