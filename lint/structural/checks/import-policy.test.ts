import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a project importing another project is caught through an alias; an unknown alias is refused', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#shared-project/*': './projects/other/*' } }),
    'projects/other/look.ts': 'export const ink = 1;\n',
    'projects/p/video.tsx': [
      "import { ink } from '../other/look.ts';",
      // Adversarial: the same crossing spelled as an alias.
      "import { ink as again } from '#shared-project/look.ts';",
      "import { x } from '#nowhere';",
      // Adversarial: an absolute path, and a relative one climbing out of the repo.
      "import { h } from '/etc/hosts.ts';",
      "import { u } from '../../../elsewhere/x.ts';",
      // Legal neighbour: its own file.
      "import { t } from './timeline.ts';",
    ].join('\n'),
    'projects/p/timeline.ts': 'export const t = 0;\n',
  });
  assert.deepEqual(caught(findings), [
    'projects/p/video.tsx:#nowhere',
    'projects/p/video.tsx:#shared-project/look.ts',
    'projects/p/video.tsx:../../../elsewhere/x.ts',
    'projects/p/video.tsx:../other/look.ts',
    'projects/p/video.tsx:/etc/hosts.ts',
  ]);
});

test('a project reaches lib/studio only through #studio, and lib/studio reaches lib/engine only from a spec', () => {
  const findings = runCheckOnFiles('import-policy', {
    'package.json': JSON.stringify({ imports: { '#studio': './lib/studio/api.ts', '#studio/*': './lib/studio/*', '#engine/*': './lib/engine/*' } }),
    'lib/studio/api.ts': "export * from './kit/kit.tsx';\n",
    'lib/studio/kit/kit.tsx': 'export const Card = 1;\n',
    'lib/engine/bundle/tsx-test-hooks.ts': 'export {};\n',
    'projects/p/video.tsx': [
      "import { Card } from '../../lib/studio/api.ts';",
      // Adversarial: a relative path to a module behind the barrel, and a type-only one.
      "import { Card as again } from '../../lib/studio/kit/kit.tsx';",
      "import type { Card as T } from '../../lib/studio/kit/kit.tsx';",
      // Legal neighbours: the barrel alias and the folder alias.
      "import { Card as a } from '#studio';",
      "import { Card as b } from '#studio/kit/kit.tsx';",
    ].join('\n'),
    // A studio module reaching the engine; its spec, run in Node, may.
    'lib/studio/kit/hooks.tsx': "import '#engine/bundle/tsx-test-hooks.ts';\n",
    'lib/studio/kit/kit.test.ts': "import '../../engine/bundle/tsx-test-hooks.ts';\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/studio/kit/hooks.tsx:#engine/bundle/tsx-test-hooks.ts',
    'projects/p/video.tsx:../../lib/studio/api.ts',
    'projects/p/video.tsx:../../lib/studio/kit/kit.tsx',
    'projects/p/video.tsx:../../lib/studio/kit/kit.tsx',
  ]);
});
