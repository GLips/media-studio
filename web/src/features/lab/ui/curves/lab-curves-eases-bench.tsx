import { Code, Stack } from '@mantine/core';
import { useState } from 'react';
import {
  EASES_DURATIONS, EASES_FAMILIES, EASES_ROLES, EasesStage, easesLoopSeconds, type EasesDurationKey, type EasesRole,
} from '#studio/lab/curves/curves-eases-stage.tsx';
import { CURVES_STAGE_SIZE, CURVES_WATCH_SPEEDS, SPRINGS_LOOKS, type SpringsLook } from '#studio/lab/curves/curves-springs-stage.tsx';
import { LabBench } from '../lab-bench.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabForAgentsCode } from '../lab-for-agents-code.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabStage } from '../lab-stage.tsx';

/** The studio's easing curves racing the same card over the same move, with what the card is doing and how it's seen. */
export function LabCurvesEasesBench() {
  const [role, setRole] = useState<EasesRole>('entrance');
  const [durationKey, setDurationKey] = useState<EasesDurationKey>('enterLarge');
  const [look, setLook] = useState<SpringsLook>('videoBlur');
  const [slow, setSlow] = useState<number>(1);
  const picked = EASES_DURATIONS.find((d) => d.value === durationKey)!;
  const { fps } = SPRINGS_LOOKS.find((l) => l.value === look)!;

  return (
    <Stack gap="md">
      <LabBench
        stage={
          <LabStage
            // A Player can't change its rate in place, so a new look mounts a new one.
            key={look}
            component={EasesStage}
            inputProps={{ role, seconds: picked.seconds, look, slow }}
            seconds={easesLoopSeconds(picked.seconds, role) * slow}
            format={{ ...CURVES_STAGE_SIZE, fps }}
            label="THE STUDIO'S CURVES, SAME MOVE"
          />
        }
      >
        <LabControls stacked>
          <LabChoice label="What the card is doing" options={EASES_ROLES} value={role} onChange={setRole} hint={EASES_ROLES.find((r) => r.value === role)!.why} />
          <LabChoice
            label="How long the move takes"
            options={EASES_DURATIONS.map((d) => ({ value: d.value, label: `${d.label} · ${d.seconds}s` }))}
            value={durationKey}
            onChange={setDurationKey}
            hint="The studio’s standard lengths, short because the viewer sees each move once, at full speed."
          />
          <LabChoice label="Seen as" options={SPRINGS_LOOKS} value={look} onChange={setLook} hint="A video is 30 pictures a second; the reel blurs each one like a camera would, so quick moves smear instead of jumping." />
          <LabChoice label="Watch at" options={CURVES_WATCH_SPEEDS} value={slow} onChange={setSlow} />
        </LabControls>
      </LabBench>
      <LabNote>
        Each small graph is the curve: time runs left to right, the distance covered goes up. A steep stretch is fast, a flat one slow. Linear is a straight line, which is why it starts and stops dead. Fades don’t race here: they use <b>Even</b> (<Code>motionCurves.dissolve</Code>), one symmetric curve, because a fade shouldn’t visibly speed up.
      </LabNote>
      <LabForAgents>
        <LabForAgentsCode>{[
          ...EASES_FAMILIES.filter((f) => f.value !== 'linear').map((f) => `seg(t, start, start + motionDurations.${picked.token}, motionCurves.${f.value}.${role})`),
          `// motionDurations.${picked.token} = ${picked.seconds}s`,
        ].join('\n')}</LabForAgentsCode>
      </LabForAgents>
    </Stack>
  );
}
