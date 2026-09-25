import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a render that skips its snapshot, or a reader past the loader, is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('render-snapshot', {
    'lib/studio/Video.tsx': "export const TIMELINE_ARTIFACT = 'timeline.json';\n",
    'lib/engine/render/reports.ts': "export { TIMELINE_REPORT_NAME as REPORT } from './render-session.ts';\n",
    // Obvious: review reading the check's timeline, and a tool rendering past the session.
    'lab/review/server.ts': "const timeline = readJson(join(project, 'out', 'check', 'timeline.json'));\n",
    'lib/engine/render/bars.ts': "import { renderMedia } from '@remotion/renderer';\n",
    // Adversarial: a template path, the snapshot read by hand, a namespace import, and the constant through a re-export.
    'lab/manifest.ts': 'const t = readFileSync(`${project}/out/check/timeline.json`);\nconst s = `${dir}/${name}.snapshot.json`;\n',
    'lib/engine/render/sliced.ts': "import * as remotion from '@remotion/renderer';\n",
    'cli/commands/aim.ts': "import { REPORT } from '../../lib/engine/render/reports.ts';\n",
    'lab/app/aim.tsx': "import { TIMELINE_ARTIFACT } from '../../lib/studio/Video.tsx';\n",
    // Legal neighbours: the owners, prose naming the file, and the renderer's other entry points.
    'lib/engine/render/render-session.ts': "import { renderMedia } from '@remotion/renderer';\nexport const TIMELINE_REPORT_NAME = 'timeline.json';\n",
    'lib/engine/render/pipeline.ts': "import { renderFrames } from '@remotion/renderer';\nimport { TIMELINE_REPORT_NAME } from './render-session.ts';\n",
    'lib/engine/snapshot/render-snapshot.ts': "const path = `${name}.snapshot.json`;\n",
    'cli/commands/check.ts': "const description = 'then writes out/check/timeline.json (scenes, lines, words)';\n",
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/aim.ts:timeline name',
    'lab/app/aim.tsx:timeline name',
    'lab/manifest.ts:.snapshot.json',
    'lab/manifest.ts:/out/check/timeline.json',
    'lab/review/server.ts:timeline.json',
    'lib/engine/render/bars.ts:renderMedia',
    'lib/engine/render/sliced.ts:renderMedia',
  ]);
});
