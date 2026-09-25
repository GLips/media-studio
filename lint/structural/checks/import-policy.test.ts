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
