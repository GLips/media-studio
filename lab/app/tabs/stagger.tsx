// stagger.tsx: the lab's stagger tab: a row of ink cards entering one after another, driven by lib/studio's
// `stagger` (seconds between neighbours, a cap on the whole spread, where the ripple starts), and a side-by-side of
// a product page entering all at once against one hero move with the rest following.
import { useState } from 'react';
import { stagger, type StaggerFrom } from '../../../lib/studio/motion.ts';
import { LabChoice, LabControls, LabNote, LabSlider, LabStage, LabTabIntro } from '../ui.tsx';
import { STAGGER_INKS, StaggerInkRow, staggerInkRowSeconds } from './stagger/ink-row.tsx';
import { STAGGER_PRODUCT_DROP_SECONDS, StaggerProductDrop } from './stagger/product-drop.tsx';
import './stagger.css';

// The max slider's far end means "no cap", so one control covers both.
const MAX_SLIDER_TOP = 3;

type OriginChoice = 'start' | 'center' | 'edges' | 'end' | 'pick';

const ORIGIN_OPTIONS = [
  { value: 'start', label: 'Start' }, { value: 'center', label: 'Centre' }, { value: 'edges', label: 'Edges' },
  { value: 'end', label: 'End' }, { value: 'pick', label: 'A card you pick' },
] as const satisfies readonly { value: OriginChoice; label: string }[];

const STAGGER_PRESETS = {
  calm: { count: 8, each: 0.08, maxSlider: MAX_SLIDER_TOP, origin: 'start' },
  long: { count: 24, each: 0.15, maxSlider: MAX_SLIDER_TOP, origin: 'start' },
  squeezed: { count: 24, each: 0.15, maxSlider: 0.6, origin: 'start' },
  ripple: { count: 13, each: 0.07, maxSlider: MAX_SLIDER_TOP, origin: 'center' },
} as const;

export function StaggerTab() {
  const [count, setCount] = useState(8);
  const [each, setEach] = useState(0.08);
  const [maxSlider, setMaxSlider] = useState(MAX_SLIDER_TOP);
  const [origin, setOrigin] = useState<OriginChoice>('start');
  const [picked, setPicked] = useState(3);
  const [headStart, setHeadStart] = useState(0.35);
  const [followEach, setFollowEach] = useState(0.06);

  const max = maxSlider >= MAX_SLIDER_TOP ? null : maxSlider;
  const from: StaggerFrom = origin === 'pick' ? Math.min(picked, count) - 1 : origin;
  const rowProps = { count, each, max, from };
  const uncapped = stagger(count - 1, count, { each, from: 'start' });

  const applyPreset = (name: keyof typeof STAGGER_PRESETS) => {
    const p = STAGGER_PRESETS[name];
    setCount(p.count); setEach(p.each); setMaxSlider(p.maxSlider); setOrigin(p.origin);
  };

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

      <LabStage component={StaggerInkRow} inputProps={rowProps} seconds={staggerInkRowSeconds(rowProps)} label="A ROW OF CARDS ENTERING" />
      <LabNote>
        The chart under the cards is the timing: one bar per card, from the moment it starts moving to the moment it lands, filling in as it plays. The red line is <b>now</b>. Watch how the bars' left edges spread out as you raise the gap, and how the blue <b>max</b> box squeezes them back in.
      </LabNote>

      <LabControls>
        <LabSlider label="Cards" value={count} min={2} max={STAGGER_INKS.length} step={1} onChange={setCount}
          hint="How many cards in the row." />
        <LabSlider label="Gap between cards (each)" value={each} min={0} max={0.3} step={0.01} onChange={setEach} format={(v) => `${v.toFixed(2)}s`}
          hint={<>How long each card waits after its neighbour. 0 is everything at once; 0.05–0.1s reads as one ripple. Without a cap, the last card starts {uncapped.toFixed(2)}s after the first.</>} />
        <LabSlider label="Longest total spread (max)" value={maxSlider} min={0} max={MAX_SLIDER_TOP} step={0.05} onChange={setMaxSlider}
          format={(v) => (v >= MAX_SLIDER_TOP ? 'no cap' : `${v.toFixed(2)}s`)}
          hint="A ceiling on the time from the first card's start to the last card's. A long list packs its cards closer so it never drags. Far right removes the cap." />
        <LabChoice label="Where the ripple starts (from)" options={ORIGIN_OPTIONS} value={origin} onChange={setOrigin}
          hint="Centre spreads outward from the middle card, edges runs in from both ends toward the middle." />
        {origin === 'pick' && (
          <LabSlider label="Starting card" value={Math.min(picked, count)} min={1} max={count} step={1} onChange={setPicked}
            format={(v) => `#${v} ${STAGGER_INKS[v - 1].name}`} hint="The ripple spreads out both ways from this card, as if you'd tapped it." />
        )}
        <LabChoice label="Try" options={[
          { value: 'calm', label: '8 cards, calm' }, { value: 'long', label: '24 cards, too slow' },
          { value: 'squeezed', label: '24 cards, capped' }, { value: 'ripple', label: 'Ripple from centre' },
        ]} value={'' as keyof typeof STAGGER_PRESETS} onChange={applyPreset}
          hint="Compare “too slow” with “capped”: same gap, but the cap fits all 24 into 0.6 seconds." />
      </LabControls>

      <section className="stagger-compare">
        <div className="stagger-compare-head">
          <span className="hud">ONE DOMINANT MOVE</span>
          <p>The same product page, entering two ways. On the left, every piece starts at the same moment with its own big move: nothing leads, so your eye darts around. On the right the product makes the one big move, and the button, menu and other inks follow a beat later with a small, quick ripple.</p>
        </div>
        <div className="stagger-compare-grid">
          <LabStage component={StaggerProductDrop} inputProps={{ mode: 'everything', headStart, each: followEach }} seconds={STAGGER_PRODUCT_DROP_SECONDS} label="EVERYTHING AT ONCE" controls={false} />
          <LabStage component={StaggerProductDrop} inputProps={{ mode: 'hero', headStart, each: followEach }} seconds={STAGGER_PRODUCT_DROP_SECONDS} label="ONE HERO LEADS" controls={false} />
        </div>
      </section>

      <LabControls>
        <LabSlider label="Hero's head start" value={headStart} min={0} max={0.8} step={0.05} onChange={setHeadStart} format={(v) => `${v.toFixed(2)}s`}
          hint="How long the product moves alone before the rest join. At 0 they all start together and the hero stops leading." />
        <LabSlider label="Followers' gap (each)" value={followEach} min={0} max={0.2} step={0.01} onChange={setFollowEach} format={(v) => `${v.toFixed(2)}s`}
          hint="The stagger among the supporting pieces, nearest the hero first. Small is the point: they should read as one wave behind it." />
      </LabControls>
      <LabNote>
        <b>Takeaway:</b> decide what the viewer should look at first and give only that the big move. Everything else arrives smaller, a little later, and close together.
      </LabNote>
    </>
  );
}
