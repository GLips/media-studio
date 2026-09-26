import { Code, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { LAB_FORMAT } from '#studio/lab/lab-format.ts';
import {
  STAGGER_PRODUCT_DROP_PAIR_SIZE, STAGGER_PRODUCT_DROP_SECONDS, StaggerProductDropPair,
} from '#studio/lab/stagger/stagger-product-drop.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { LabBench } from '../lab-bench.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabSlider } from '../lab-slider.tsx';
import { LabStage } from '../lab-stage.tsx';

/** One product page entering two ways side by side: everything at once, and one hero move with the rest following. */
export function LabStaggerHeroBench() {
  const [headStart, setHeadStart] = useState(0.35);
  const [followEach, setFollowEach] = useState(0.06);

  return (
    <Stack gap="sm" component="section">
      <Stack gap={4}>
        <Readout label>one dominant move</Readout>
        <Text maw="80ch">The same product page, entering two ways. On the left, every piece starts at the same moment with its own big move: nothing leads, so your eye darts around. On the right the product makes the one big move, and the button, menu and other inks follow a beat later with a small, quick ripple.</Text>
      </Stack>
      <LabBench stage={
        <LabStage component={StaggerProductDropPair} inputProps={{ headStart, each: followEach }} seconds={STAGGER_PRODUCT_DROP_SECONDS}
          format={{ ...STAGGER_PRODUCT_DROP_PAIR_SIZE, fps: LAB_FORMAT.fps }} label="SAME PAGE, TWO ENTRANCES" controls={false} />
      }>
        <LabControls stacked>
          <LabSlider label="Hero's head start" value={headStart} min={0} max={0.8} step={0.05} onChange={setHeadStart} format={(v) => `${v.toFixed(2)}s`}
            hint="How long the product moves alone before the rest join. At 0 they all start together and the hero stops leading." />
          <LabSlider label="Gap between the followers" value={followEach} min={0} max={0.2} step={0.01} onChange={setFollowEach} format={(v) => `${v.toFixed(2)}s`}
            hint="The ripple among the supporting pieces, nearest the hero first. Small is the point: they should read as one wave behind it." />
        </LabControls>
        <LabForAgents>
          <Text size="sm" c="dimmed">Followers start at <Code>headStart + stagger(i, 8, {'{'} each, fps {'}'})</Code>, with the gap as <Code>each</Code>. The hero uses <Code>motionDurations.enter.large</Code> on <Code>motionCurves.expressive.entrance</Code>; followers use <Code>enter.small</Code> on <Code>productive.entrance</Code>.</Text>
        </LabForAgents>
      </LabBench>
    </Stack>
  );
}
