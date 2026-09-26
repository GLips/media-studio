// ─── (e) Retime runner registration ───────────────────────────────────
//
// Every timed project (one with a timeline.ts) registers with the shared retime
// runner: its timeline.test.ts calls `assertTimelineRetimes`, imported from
// lib/models/timeline/retime.ts, and `npm test` runs it. The runner itself holds
// the behaviour (lengthening a scene moves what follows and keeps each move's
// length); this check holds that no timed project skips it.
//
// Negative space: a voice-led project with its timing still in video.tsx has no
// timeline.ts, so isn't held here; check (a) reports its defineScene until its
// timing moves into a timeline.ts, and then this check applies.

import { callsTo, type Finding, type StructuralCheck } from '../check-context.ts';

const ID = 'retime-registration';
export const RETIME_RUNNER = { path: 'lib/models/timeline/retime.ts', name: 'assertTimelineRetimes' } as const;

export const retimeRegistrationCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      const position = context.positionOf(file.path);
      if (position.kind !== 'project' || position.role !== 'timeline') continue;
      const testPath = file.path.replace(/timeline\.ts$/, 'timeline.test.ts');
      const test = context.fileAt(testPath);
      const report = (key: string, message: string) => findings.push({ check: ID, path: file.path, line: 1, key, message });
      if (!test) {
        report('no timeline.test.ts', `a timed project registers with the retime runner: add ${testPath} calling ${RETIME_RUNNER.name}(timeline)`);
        continue;
      }
      if (!callsTo(context, test, RETIME_RUNNER).length) {
        report('runner not called', `${testPath} doesn't call ${RETIME_RUNNER.name} from ${RETIME_RUNNER.path}, so no retime is checked`);
      }
    }
    return findings;
  },
};
