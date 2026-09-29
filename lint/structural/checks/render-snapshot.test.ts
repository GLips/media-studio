import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a render that skips its snapshot, or a reader past the loader, is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('render-snapshot', {
    'lib/picture/composition/studio/Video.tsx': "export const TIMELINE_ARTIFACT = 'timeline.json';\n",
    'lib/output/render/engine/reports.ts': "export { TIMELINE_REPORT_NAME as REPORT } from './render-session.ts';\n",
    // Obvious: review reading the check's timeline, and a tool rendering past the session.
    'lib/output/review/engine/review-target.ts': "const timeline = readJson(join(project, 'out', 'check', 'timeline.json'));\n",
    'lib/output/render/engine/bars.ts': "import { renderMedia } from '@remotion/renderer';\n",
    'lib/output/render/engine/stitch.ts': "import { renderFrames, stitchFramesToVideo } from '@remotion/renderer';\n",
    // Adversarial: a template path, the snapshot read by hand, a namespace import, and the constant through a re-export.
    'lib/timing/music/engine/music-catalog.ts': 'const t = readFileSync(`${project}/out/check/timeline.json`);\nconst s = `${dir}/${name}.snapshot.json`;\n',
    'lib/output/render/engine/sliced.ts': "import * as remotion from '@remotion/renderer';\n",
    'cli/commands/aim.ts': "import { REPORT } from '../../lib/output/render/engine/reports.ts';\n",
    'web/src/features/review/ui/aim.tsx': "import { TIMELINE_ARTIFACT } from '../../../../../lib/picture/composition/studio/Video.tsx';\n",
    // Legal neighbours: the owners, prose naming the file, and the renderer's other entry points.
    'lib/output/render/engine/render-session.ts': "import { renderMedia } from '@remotion/renderer';\nexport const TIMELINE_REPORT_NAME = 'timeline.json';\n",
    'lib/output/render/engine/pipeline.ts': "import { renderFrames } from '@remotion/renderer';\nimport { TIMELINE_REPORT_NAME } from './render-session.ts';\n",
    'lib/output/render/engine/render-snapshot.ts': "const path = `${name}.snapshot.json`;\n",
    'cli/commands/check.ts': "const description = 'then writes out/check/timeline.json (scenes, lines, words)';\n",
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/aim.ts:timeline name',
    'lib/output/render/engine/bars.ts:renderMedia',
    'lib/output/render/engine/sliced.ts:renderMedia',
    'lib/output/render/engine/stitch.ts:stitchFramesToVideo',
    'lib/output/review/engine/review-target.ts:timeline.json',
    'lib/timing/music/engine/music-catalog.ts:.snapshot.json',
    'lib/timing/music/engine/music-catalog.ts:/out/check/timeline.json',
    'web/src/features/review/ui/aim.tsx:timeline name',
  ]);
});
