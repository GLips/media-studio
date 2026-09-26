import { Stack, Text } from '@mantine/core';
import { useMemo, useState } from 'react';
import { checkPriceHold, explainPriceHold, PRICE_HOLD_CLEAN, PRICE_HOLD_SECONDS } from '#models/lab/hold-price.ts';
import { PriceHoldStage } from '#studio/lab/hold/price-hold-stage.tsx';
import { LAB_FORMAT } from '#studio/lab/lab-format.ts';
import { LabBench } from '../lab-bench.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabForAgentsCode } from '../lab-for-agents-code.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabStage } from '../lab-stage.tsx';
import { LabTabIntro } from '../lab-tab-intro.tsx';
import { LabHoldControls } from './lab-hold-controls.tsx';
import { LabHoldVerdict } from './lab-hold-verdict.tsx';

/**
 * The Hold check tab: a price card that should sit still long enough to read, sliders that shake, slow, drift and fade
 * it, and the real check (lib/models/motion/hold-check.ts) judging every change, its verdict heading the controls.
 */
export function LabHoldTab() {
  const [params, setParams] = useState(PRICE_HOLD_CLEAN);
  const verdict = useMemo(() => checkPriceHold(params, LAB_FORMAT.fps), [params]);
  const pass = verdict.problem === null;

  return (
    <Stack gap="xl">
      <LabTabIntro
        number={4}
        title="Hold check"
        what={<>When a scene shows something the viewer has to read — a price, a headline, a number — it can promise that thing will <b>sit still and fully visible</b> for long enough, say 1.5 seconds. Each time the computer turns the scene into video frames (a render), the studio measures where that thing was on every frame and checks the promise. That's how the agent — the AI assistant that builds the videos — knows a viewer had time to read it, without a person watching every version. It checks "steady and visible", not "readable": a still, solid price can still be too small or too low-contrast, and only a person looking can tell.</>}
        when={<>A scene makes the promise in one line of its setup: "keep the price still for 1.5 seconds". Pricing, stats, the headline of a launch — anything the video is really there to say.</>}
        bad={<>The price whooshes in, wobbles a little, and fades just as your eye lands on it. Nobody on the team notices, because each of them already knows what it says.</>}
        good={<>It arrives, stops dead, and stays put for as long as it takes to read. When it doesn't, the check says which way it moved, when, and by how much, so the agent can fix the right thing.</>}
      />

      <LabBench
        stage={
          <Stack gap="md">
            <LabStage component={PriceHoldStage} inputProps={{ ...params, steady: verdict.steady, pass }} seconds={PRICE_HOLD_SECONDS} label="SCENE: BUY · HOLD: PRICE" />
            <LabNote>
              <b>Reading it:</b> the box on the left magnifies the card's corner 12× over its dashed resting outline, so a 2px shake is plain. Below, the white and blue lines are its left-right and up-down position (±10px around rest), the red how solid it is (70–100%). The green band is the longest stretch it was steady and visible; it passes when the promised bar fits inside.
            </LabNote>
          </Stack>
        }
      >
        <LabHoldVerdict pass={pass} explanation={explainPriceHold(verdict, params.need)} />
        <LabHoldControls params={params} onChange={setParams} />
        <LabForAgents>
          <Text size="sm" c="dimmed">The promise, as a scene writes it:</Text>
          <LabForAgentsCode>expect: [{'{'} hold: 'price', for: {params.need}{params.within !== 2 && `, within: ${params.within}`} {'}'}]</LabForAgentsCode>
          <Text size="sm" c="dimmed">What the check prints after a render:</Text>
          <LabForAgentsCode>{verdict.problem ?? 'Nothing. A kept hold is silent.'}</LabForAgentsCode>
          {verdict.problem && <Text size="sm" c="dimmed">The last part, "Review: studio look …", is the command that draws this same graph for a real render.</Text>}
        </LabForAgents>
      </LabBench>
    </Stack>
  );
}
