// stagger.tsx: the lab's stagger tab: a row of ink cards entering one after another, driven by lib/studio's
// `stagger` (seconds between neighbours, a cap on the whole spread, where the ripple starts), and a side-by-side of
// a product page entering all at once against one hero move with the rest following.
import { useState } from 'react';
import { stagger, type StaggerFrom } from '../../../lib/studio/motion.ts';
import { LabBench, LabButtons, LabChoice, LabControls, LabNote, LabSlider, LabStage, LabTabIntro } from '../ui.tsx';
import { STAGGER_INKS, StaggerInkRow, staggerInkRowSeconds } from './stagger/ink-row.tsx';
import {
  STAGGER_PRODUCT_DROP_PAIR_SIZE, STAGGER_PRODUCT_DROP_SECONDS, StaggerProductDropPair,
} from './stagger/product-drop.tsx';
import './stagger.css';

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

export function StaggerTab() {
  const [count, setCount] = useState(8);
  const [each, setEach] = useState(0.08);
  const [maxSlider, setMaxSlider] = useState(MAX_SLIDER_TOP);
  const [origin, setOrigin] = useState<OriginChoice>('start');
  const [picked, setPicked] = useState(3);
  const [headStart, setHeadStart] = useState(0.35);
  const [followEach, setFollowEach] = useState(0.06);

  const max = maxSlider >= MAX_SLIDER_TOP ? null : maxSlider;
  const pickedCard = Math.min(picked, count);
  const from: StaggerFrom = origin === 'pick' ? pickedCard - 1 : origin;
  const rowProps = { count, each, max, from };
  const uncapped = stagger(count - 1, count, { each, from: 'start' });
  const staggerCall = `stagger(i, ${count}, { each: ${each}${max === null ? '' : `, max: ${max}`}, from: ${typeof from === 'number' ? from : `'${from}'`} })`;

  return (
    <>
      <LabTabIntro
        number={2}
        title="Stagger & choreography"
        what={<>A <b>stagger</b> is when a group of things arrives one after another instead of all together, like a row of dominoes falling. Each card makes the same move; only its start time shifts. It turns a crowd of moving things into a single ripple the eye can follow.</>}
        when="Whenever a video shows a list, a grid or a set of cards appearing: search results, product tiles, the steps of a plan, the rows of a table."
        bad="Everything pops in at the same instant, so the eye has nowhere to land. Or the gap between cards is so long that a list of twenty takes five seconds and the viewer is waiting for the last one."
        good="One element leads with the big move and the rest follow in a quick, even ripple that finishes while it still feels like one gesture. Long lists get squeezed so they never drag."
      />

      <LabBench stage={
        <>
          <LabStage component={StaggerInkRow} inputProps={rowProps} seconds={staggerInkRowSeconds(rowProps)} label="A ROW OF CARDS ENTERING" />
          <div className="stagger-pick">
            <span className="hud">START THE RIPPLE AT CARD</span>
            <div className="stagger-pick-row">
              {STAGGER_INKS.slice(0, count).map((ink, i) => (
                <button key={ink.name} type="button" title={ink.name}
                  className={origin === 'pick' && pickedCard === i + 1 ? 'on' : undefined}
                  style={{ borderBottomColor: ink.hex }}
                  onClick={() => { setOrigin('pick'); setPicked(i + 1); }}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </>
      }>
        <LabControls>
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
        <details className="stagger-agents">
          <summary>For agents</summary>
          <p>The row is <code>stagger()</code> from <code>lib/studio/motion.ts</code>: gap between cards is <code>each</code>, longest total spread is <code>max</code>, where the ripple starts is <code>from</code> (<code>'start' | 'center' | 'edges' | 'end'</code> or a card index). Right now:</p>
          <pre>{staggerCall}</pre>
        </details>
      </LabBench>
      <LabNote>
        The chart under the cards is the timing: one bar per card, from the moment it starts moving to the moment it lands, filling in as it plays. The red line is <b>now</b>. Watch how the bars' left edges spread out as you raise the gap, and how the blue box (the cap on the total spread) squeezes them back in.
      </LabNote>

      <section className="stagger-compare">
        <div className="stagger-compare-head">
          <span className="hud">ONE DOMINANT MOVE</span>
          <p>The same product page, entering two ways. On the left, every piece starts at the same moment with its own big move: nothing leads, so your eye darts around. On the right the product makes the one big move, and the button, menu and other inks follow a beat later with a small, quick ripple.</p>
        </div>
        <LabBench stage={
          <LabStage component={StaggerProductDropPair} inputProps={{ headStart, each: followEach }} seconds={STAGGER_PRODUCT_DROP_SECONDS}
            width={STAGGER_PRODUCT_DROP_PAIR_SIZE.width} height={STAGGER_PRODUCT_DROP_PAIR_SIZE.height} label="SAME PAGE, TWO ENTRANCES" controls={false} />
        }>
          <LabControls>
            <LabSlider label="Hero's head start" value={headStart} min={0} max={0.8} step={0.05} onChange={setHeadStart} format={(v) => `${v.toFixed(2)}s`}
              hint="How long the product moves alone before the rest join. At 0 they all start together and the hero stops leading." />
            <LabSlider label="Gap between the followers" value={followEach} min={0} max={0.2} step={0.01} onChange={setFollowEach} format={(v) => `${v.toFixed(2)}s`}
              hint="The ripple among the supporting pieces, nearest the hero first. Small is the point: they should read as one wave behind it." />
          </LabControls>
          <details className="stagger-agents">
            <summary>For agents</summary>
            <p>Followers start at <code>headStart + stagger(i, 8, {'{'} each {'}'})</code>, with the gap as <code>each</code>. The hero uses <code>motionDurations.enter.large</code> on <code>motionCurves.expressive.entrance</code>; followers use <code>enter.small</code> on <code>productive.entrance</code>.</p>
          </details>
        </LabBench>
      </section>
      <LabNote>
        <b>Takeaway:</b> decide what the viewer should look at first and give only that the big move. Everything else arrives smaller, a little later, and close together.
      </LabNote>
    </>
  );
}
