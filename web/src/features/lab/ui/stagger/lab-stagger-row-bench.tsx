import { Code, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { stagger, type StaggerFrom } from '#models/motion/motion.ts';
import { LAB_FORMAT } from '#studio/lab/lab-format.ts';
import { STAGGER_INKS, StaggerInkRow, staggerInkRowSeconds } from '#studio/lab/stagger/stagger-ink-row.tsx';
import { LabBench } from '../lab-bench.tsx';
import { LabButtons } from '../lab-buttons.tsx';
import { LabChoice } from '../lab-choice.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabForAgents } from '../lab-for-agents.tsx';
import { LabForAgentsCode } from '../lab-for-agents-code.tsx';
import { LabNote } from '../lab-note.tsx';
import { LabSlider } from '../lab-slider.tsx';
import { LabStage } from '../lab-stage.tsx';
import { LabStaggerOriginPicker } from './lab-stagger-origin-picker.tsx';

// The max slider's far end means "no cap", so one control covers both.
const MAX_SLIDER_TOP = 3;

type OriginChoice = 'start' | 'center' | 'edges' | 'end' | 'pick';

const ORIGIN_OPTIONS = [
  { value: 'start', label: 'Start' }, { value: 'center', label: 'Centre' }, { value: 'edges', label: 'Edges' },
  { value: 'end', label: 'End' }, { value: 'pick', label: 'A card you pick' },
] as const satisfies readonly { value: OriginChoice; label: string }[];

const STAGGER_PRESETS = [
  { label: '8 cards, calm', count: 8, each: 0.08, maxSlider: MAX_SLIDER_TOP, origin: 'start' },
  { label: '24 cards, too slow', count: 24, each: 0.15, maxSlider: MAX_SLIDER_TOP, origin: 'start' },
  { label: '24 cards, capped', count: 24, each: 0.15, maxSlider: 0.6, origin: 'start' },
  { label: 'Ripple from centre', count: 13, each: 0.07, maxSlider: MAX_SLIDER_TOP, origin: 'center' },
] as const;

/** A row of ink cards entering one after another on the studio's `stagger`, with its gap, cap and origin to drag. */
export function LabStaggerRowBench() {
  const [count, setCount] = useState(8);
  const [each, setEach] = useState(0.08);
  const [maxSlider, setMaxSlider] = useState<number>(MAX_SLIDER_TOP);
  const [origin, setOrigin] = useState<OriginChoice>('start');
  const [picked, setPicked] = useState(3);

  const max = maxSlider >= MAX_SLIDER_TOP ? null : maxSlider;
  const pickedCard = Math.min(picked, count);
  const from: StaggerFrom = origin === 'pick' ? pickedCard - 1 : origin;
  const rowProps = { count, each, max, from };
  const uncapped = stagger(count - 1, count, { each, from: 'start', fps: LAB_FORMAT.fps });
  const staggerCall = `stagger(i, ${count}, { each: ${each}${max === null ? '' : `, max: ${max}`}, from: ${typeof from === 'number' ? from : `'${from}'`}, fps })`;

  return (
    <Stack gap="md">
      <LabBench stage={
        <>
          <LabStage component={StaggerInkRow} inputProps={rowProps} seconds={staggerInkRowSeconds(rowProps)} label="A ROW OF CARDS ENTERING" />
          <LabStaggerOriginPicker count={count} picked={origin === 'pick' ? pickedCard : null}
            onPick={(card) => { setOrigin('pick'); setPicked(card); }} />
        </>
      }>
        <LabControls stacked>
          <LabButtons label="Try" buttons={STAGGER_PRESETS.map((p) => ({
            label: p.label,
            onClick: () => { setCount(p.count); setEach(p.each); setMaxSlider(p.maxSlider); setOrigin(p.origin); },
          }))} hint="Compare “too slow” with “capped”: same gap, but the cap fits all 24 into 0.6 seconds." />
          <LabSlider label="Cards" value={count} min={2} max={STAGGER_INKS.length} step={1} onChange={setCount}
            hint="How many cards in the row." />
          <LabSlider label="Gap between cards" value={each} min={0} max={0.3} step={0.01} onChange={setEach} format={(v) => `${v.toFixed(2)}s`}
            hint={<>How long each card waits after its neighbour. 0 is everything at once; 0.05–0.1s reads as one ripple. Without a cap, the last card starts {uncapped.toFixed(2)}s after the first.</>} />
          <LabSlider label="Longest total spread" value={maxSlider} min={0} max={MAX_SLIDER_TOP} step={0.05} onChange={setMaxSlider}
            format={(v) => (v >= MAX_SLIDER_TOP ? 'no cap' : `${v.toFixed(2)}s`)}
            hint="A cap on the time from the first card's start to the last card's: a long list packs its cards closer so it never drags. Far right removes the cap." />
          <LabChoice label="Where the ripple starts" options={ORIGIN_OPTIONS} value={origin} onChange={setOrigin}
            hint="Centre spreads outward from the middle card; edges runs in from both ends. Or click a numbered card under the stage." />
        </LabControls>
        <LabForAgents>
          <Text size="sm" c="dimmed">The row is <Code>stagger()</Code> from <Code>lib/models/motion/motion.ts</Code>: gap between cards is <Code>each</Code>, longest total spread is <Code>max</Code>, where the ripple starts is <Code>from</Code> (<Code>'start' | 'center' | 'edges' | 'end'</Code> or a card index). Right now:</Text>
          <LabForAgentsCode>{staggerCall}</LabForAgentsCode>
        </LabForAgents>
      </LabBench>
      <LabNote>
        The chart under the cards is the timing: one bar per card, from the moment it starts moving to the moment it lands, filling in as it plays. The red line is <b>now</b>. Watch how the bars' left edges spread out as you raise the gap, and how the blue box (the cap on the total spread) squeezes them back in.
      </LabNote>
    </Stack>
  );
}
