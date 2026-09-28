import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

const RUNNER = { 'lib/models/timeline/retime.ts': 'export const assertTimelineRetimes = (t: unknown) => t;\n' };
const TIMELINE = 'export const timeline = {};\n';

test('a timed project that doesn\'t call the retime runner is caught, however it half-registers', () => {
  const findings = runCheckOnFiles('retime-registration', {
    ...RUNNER,
    'lib/studio/kit/kit.ts': "export { assertTimelineRetimes as retimes } from '../../models/timeline/retime.ts';\n",
    // Legal: calls the runner, here through a kit's rename.
    'work/projects/ok/timeline.ts': TIMELINE,
    'work/projects/ok/timeline.test.ts': "import { retimes } from '../../../lib/studio/kit/kit.ts';\nimport { timeline } from './timeline.ts';\nretimes(timeline);\n",
    // Legal: no timeline.ts, so nothing timed to register.
    'work/projects/voice/video.tsx': 'export default {};\n',
    // Obvious: no test at all.
    'work/projects/bare/timeline.ts': TIMELINE,
    // Adversarial: imports the runner but never calls it; imports it type-only; calls a look-alike of its own.
    'work/projects/idle/timeline.ts': TIMELINE,
    'work/projects/idle/timeline.test.ts': "import { assertTimelineRetimes } from '../../../lib/models/timeline/retime.ts';\nvoid assertTimelineRetimes;\n",
    'work/projects/typed/timeline.ts': TIMELINE,
    'work/projects/typed/timeline.test.ts': "import type { assertTimelineRetimes } from '../../../lib/models/timeline/retime.ts';\ndeclare const f: typeof assertTimelineRetimes;\nf(1);\n",
    'work/projects/fake/timeline.ts': TIMELINE,
    'work/projects/fake/timeline.test.ts': 'const assertTimelineRetimes = (t: unknown) => t;\nassertTimelineRetimes(1);\n',
  });
  assert.deepEqual(caught(findings), [
    'work/projects/bare/timeline.ts:no timeline.test.ts',
    'work/projects/fake/timeline.ts:runner not called',
    'work/projects/idle/timeline.ts:runner not called',
    'work/projects/typed/timeline.ts:runner not called',
  ]);
});
