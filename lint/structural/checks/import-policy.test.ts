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

test('web code reaches engine code only through the door, and lib/ never imports web/', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*', '#web/*': './web/src/*' } }),
    'lib/output/review/engine/review-artifact.ts': 'export const readReviewArtifact = 1;\n',
    'web/src/infrastructure/studio-engine.server.ts': "export { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';\n",
    'web/src/features/review/ui/review-screen.tsx': [
      "import { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';",
      // Adversarial: the same reach spelled relatively, and a type-only one, which still names the module.
      "import { readReviewArtifact as again } from '../../../../../lib/output/review/engine/review-artifact.ts';",
      "import type { readReviewArtifact as T } from '#lib/output/review/engine/review-artifact.ts';",
      // Adversarial: a bundler query loads the same module.
      "import source from '#lib/output/review/engine/review-artifact.ts?raw';",
    ].join('\n'),
    'web/src/features/review/controllers/review-queries.server.ts': [
      // Adversarial: `.server` outside infrastructure/ is not a door.
      "import { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';",
      // Legal neighbour: the door.
      "import { readReviewArtifact as door } from '#web/infrastructure/studio-engine.server.ts';",
    ].join('\n'),
    'lib/platform/web/engine/serve.ts': "import { door } from '#web/infrastructure/studio-engine.server.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/platform/web/engine/serve.ts:#web/infrastructure/studio-engine.server.ts',
    'web/src/features/review/controllers/review-queries.server.ts:#lib/output/review/engine/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:#lib/output/review/engine/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:#lib/output/review/engine/review-artifact.ts',
    'web/src/features/review/ui/review-screen.tsx:#lib/output/review/engine/review-artifact.ts?raw',
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
    'harness/x.ts': "import { ink } from '../work/projects/p/look.ts';\n",
    // Legal neighbour: harness wiring over lib, as cli's is.
    'harness/y.ts': "import { a } from '#lib/picture/look/models/look.ts';\n",
    // Legal neighbour: a project reaching the studio.
    'work/projects/p/video.tsx': "import { a } from '#lib/picture/look/models/look.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/x.ts:../../work/projects/p/look.ts',
    'harness/x.ts:../work/projects/p/look.ts',
    'lib/picture/look/models/look.ts:../../../../work/projects/p/look.ts',
    'lib/picture/look/models/look.ts:../../../../work/projects/q/gone.ts',
  ]);
});

test('a project uses only the styles its project.ts names, public code none, and a style reaches no project or engine code', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*', '#styles/*': './work/styles/*' } }),
    'lib/output/render/engine/run.ts': 'export const run = 1;\n',
    'lib/picture/kit/models/ink.ts': 'export const ink = 1;\n',
    'work/styles/wash/style.ts': [
      "import { ink } from '#lib/picture/kit/models/ink.ts';",
      "import { run } from '#lib/output/render/engine/run.ts';",
      "import { t } from '../../projects/p/timeline.ts';",
    ].join('\n'),
    'work/styles/ink/style.ts': 'export default {};\n',
    'work/projects/p/project.ts': "export default { capability: 'silent', styles: ['wash', 'gone/../ink'] };\n",
    'work/projects/p/timeline.ts': 'export const t = 0;\n',
    'work/projects/p/scenes/intro.tsx': [
      // Legal neighbour: a style the project names, by alias and relatively.
      "import wash from '#styles/wash/style.ts';",
      "import again from '../../../styles/wash/style.ts';",
      // Adversarial: one it doesn't name.
      "import ink from '#styles/ink/style.ts';",
    ].join('\n'),
    // Adversarial: public code reaching a style through the alias.
    'lib/picture/kit/studio/paint.tsx': "import wash from '#styles/wash/style.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/picture/kit/studio/paint.tsx:#styles/wash/style.ts',
    'work/projects/p/project.ts:styles gone/../ink',
    'work/projects/p/scenes/intro.tsx:#styles/ink/style.ts',
    'work/styles/wash/style.ts:#lib/output/render/engine/run.ts',
    'work/styles/wash/style.ts:../../projects/p/timeline.ts',
  ]);
});

test('a web feature is entered through its barrel, which announces only its own modules, and its layers import down', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#web/*': './web/src/*' } }),
    'web/src/shared/ui/readout.tsx': 'export const Readout = 1;\n',
    'web/src/features/review/index.ts': [
      "export { ReviewScreen } from './ui/review-screen.tsx';",
      "export { reviewQuery } from './controllers/review-queries.ts';",
      // Adversarial: a barrel passing on another unit's export.
      "export { Readout } from '#web/shared/ui/readout.tsx';",
    ].join('\n'),
    'web/src/features/review/ui/review-screen.tsx': [
      // Legal neighbours: a layer below, and a shared primitive.
      "import { reviewQuery } from '../controllers/review-queries.ts';",
      "import { Readout } from '#web/shared/ui/readout.tsx';",
    ].join('\n'),
    'web/src/features/review/controllers/review-queries.ts': [
      // A layer above, its own barrel, and a UI primitive.
      "import { ReviewScreen } from '../ui/review-screen.tsx';",
      "import { ReviewScreen as again } from '../index.ts';",
      "import type { Readout } from '#web/shared/ui/readout.tsx';",
    ].join('\n'),
    'web/src/features/projects/ui/projects-page.tsx': [
      // Legal neighbour: another feature through its barrel.
      "import { ReviewScreen } from '#web/features/review/index.ts';",
      // Adversarial: the same feature's inner file, relatively.
      "import { ReviewScreen as inner } from '../../review/ui/review-screen.tsx';",
    ].join('\n'),
    'web/src/routes/index.tsx': [
      "import { ReviewScreen } from '#web/features/review/index.ts';",
      "import { reviewQuery } from '#web/features/review/controllers/review-queries.ts';",
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'web/src/features/projects/ui/projects-page.tsx:../../review/ui/review-screen.tsx',
    'web/src/features/review/controllers/review-queries.ts:#web/shared/ui/readout.tsx',
    'web/src/features/review/controllers/review-queries.ts:../index.ts',
    'web/src/features/review/controllers/review-queries.ts:../ui/review-screen.tsx',
    'web/src/features/review/index.ts:#web/shared/ui/readout.tsx',
    'web/src/routes/index.tsx:#web/features/review/controllers/review-queries.ts',
  ]);
});

test('each web place imports only below it, and a .server module is reached from a feature\'s controllers only', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#web/*': './web/src/*', '#lib/*': './lib/*' } }),
    'lib/output/review/engine/review-artifact.ts': 'export const readReviewArtifact = 1;\n',
    'web/src/routeTree.gen.ts': 'export const routeTree = 1;\n',
    'web/src/features/review/index.ts': "export { ReviewScreen } from './ui/review-screen.tsx';\n",
    'web/src/features/review/ui/review-screen.tsx': "import { fileResponse } from '#web/infrastructure/media-response.server.ts';\n",
    // Legal neighbour: a controller calling the door inside its server functions.
    'web/src/features/review/controllers/review-artifact.ts': "import { readReviewArtifact } from '#web/infrastructure/studio-engine.server.ts';\n",
    'web/src/infrastructure/studio-engine.server.ts': "export { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';\n",
    'web/src/infrastructure/media-response.server.ts': [
      "import { ReviewScreen } from '../features/review/index.ts';",
      "import { Readout } from '#web/shared/ui/readout.tsx';",
      // Adversarial: a server module that isn't the door, reaching engine code.
      "import { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';",
    ].join('\n'),
    'web/src/infrastructure/providers/query-client.ts': 'export const queryClient = 1;\n',
    'web/src/shared/ui/readout.tsx': [
      "import { ReviewScreen } from '#web/features/review/index.ts';",
      "import { queryClient } from '../../infrastructure/providers/query-client.ts';",
      // Legal neighbour: a sibling primitive.
      "import { colors } from './theme.stylex.ts';",
    ].join('\n'),
    'web/src/shared/ui/theme.stylex.ts': 'export const colors = 1;\n',
    'web/src/router.tsx': [
      "import { ReviewScreen } from '#web/features/review/index.ts';",
      // Legal neighbours: the generated route tree and a client-safe adapter.
      "import { routeTree } from './routeTree.gen.ts';",
      "import { queryClient } from '#web/infrastructure/providers/query-client.ts';",
    ].join('\n'),
    'web/src/routes/__root.tsx': [
      "import { getRouter } from '../router.tsx';",
      // Adversarial: type-only still names the server module.
      "import type { fileResponse } from '#web/infrastructure/media-response.server.ts';",
    ].join('\n'),
  });
  assert.deepEqual(caught(findings), [
    'web/src/features/review/ui/review-screen.tsx:#web/infrastructure/media-response.server.ts',
    'web/src/infrastructure/media-response.server.ts:#lib/output/review/engine/review-artifact.ts',
    'web/src/infrastructure/media-response.server.ts:#web/shared/ui/readout.tsx',
    'web/src/infrastructure/media-response.server.ts:../features/review/index.ts',
    'web/src/router.tsx:#web/features/review/index.ts',
    'web/src/routes/__root.tsx:#web/infrastructure/media-response.server.ts',
    'web/src/routes/__root.tsx:../router.tsx',
    'web/src/shared/ui/readout.tsx:#web/features/review/index.ts',
    'web/src/shared/ui/readout.tsx:../../infrastructure/providers/query-client.ts',
  ]);
});
