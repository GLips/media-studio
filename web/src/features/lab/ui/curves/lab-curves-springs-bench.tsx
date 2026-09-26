import { Code, Stack } from '@mantine/core';
import { useState } from 'react';
import { perceptualSpring } from '#models/motion/motion.ts';
import {
  CURVES_STAGE_SIZE, CURVES_WATCH_SPEEDS, SPRINGS_LADDER, SPRINGS_LOOKS, SPRINGS_MOVES, SPRINGS_TIMINGS, SpringsStage, springsLoopSeconds,
  type SpringsLook, type SpringsMove, type SpringsTiming,
} from '#studio/lab/curves/curves-springs-stage.tsx';
import { LabBench } from '../lab-bench.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabForAgentsCode } from '../lab-for-agents-code.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabSlider } from '../lab-slider.tsx';
import { LabStage } from '../lab-stage.tsx';

const LOOK_HINTS: Record<SpringsLook, string> = {
  screen: 'How a phone or browser animates: a new picture every 60th of a second. Smoother than any video, so don’t judge a video’s motion by it.',
  video: 'What a video shows: 30 pictures a second, each one sharp. Anything quick visibly jumps between pictures.',
  videoBlur: 'What a video shows with a camera’s blur on each picture, as the showcase reel renders: fast moves smear instead of jumping.',
};

/** The studio's spring at four bounces on one move, timed against a beat three ways. */
export function LabCurvesSpringsBench() {
  const [move, setMove] = useState<SpringsMove>('slide');
  const [duration, setDuration] = useState(0.5);
  const [timing, setTiming] = useState<SpringsTiming>('arrival');
  const [look, setLook] = useState<SpringsLook>('videoBlur');
  const [slow, setSlow] = useState<number>(1);
  const { fps } = SPRINGS_LOOKS.find((l) => l.value === look)!;

  return (
    <Stack gap="md">
      <LabBench
        stage={
          <LabStage
            // A Player can't change its rate in place, so a new look mounts a new one.
            key={look}
            component={SpringsStage}
            inputProps={{ move, duration, timing, look, slow }}
            seconds={springsLoopSeconds(duration) * slow}
            format={{ ...CURVES_STAGE_SIZE, fps }}
            label="ONE SPRING, FOUR BOUNCES, ONE BEAT"
          />
        }
      >
        <LabControls stacked>
          <LabChoice label="The move" options={SPRINGS_MOVES} value={move} onChange={setMove} hint="Each row goes there and back on its spring. The four rows are the same spring at four bounces." />
          <LabSlider
            label="Duration"
            value={duration}
            min={0.2}
            max={1}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={setDuration}
            hint="How long one swing takes: the spring’s pace. It stays the same at every bounce, so a bouncier spring only overshoots more. Apple’s default is 0.5s; a reel’s quick lifts are 0.2–0.4s."
          />
          <LabChoice label="Timing" options={SPRINGS_TIMINGS} value={timing} onChange={setTiming} hint={SPRINGS_TIMINGS.find((o) => o.value === timing)!.why} />
          <LabChoice label="Seen as" options={SPRINGS_LOOKS} value={look} onChange={setLook} hint={LOOK_HINTS[look]} />
          <LabChoice label="Watch at" options={CURVES_WATCH_SPEEDS} value={slow} onChange={setSlow} />
        </LabControls>
      </LabBench>
      <LabNote>
        <b>The rule for a move on a beat:</b> the beat, and the move’s hit sound, go where the spring <b>arrives</b>: the moment it has covered 98% of the way. For a bouncy spring that is when it reaches its spot at speed, just before it overshoots; for a smooth one, when it has all but stopped. So a spring starts its <Code>arrival</Code> early, and the bouncier it is, the later it can start.
      </LabNote>
      <LabForAgents>
        <LabForAgentsCode>{[
          `const s = perceptualSpring(${duration}, bounce);`,
          `s(t - (beat - s.arrival))  // arrives on the beat; its hit sound starts at the beat too`,
          ...SPRINGS_LADDER.map((r) => {
            const s = perceptualSpring(duration, r.bounce);
            return `// bounce ${r.bounce.toFixed(2)}: arrival ${s.arrival.toFixed(3)}s, settled ${s.settled.toFixed(2)}s`;
          }),
        ].join('\n')}</LabForAgentsCode>
      </LabForAgents>
    </Stack>
  );
}
