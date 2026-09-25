// hold.tsx: the Hold check tab. A price card slides in and should sit still long enough to read; sliders shake it,
// slow it, drift it and fade it, and the real check (lib/models/motion/hold-check.ts) judges every change. Its verdict, in plain
// words, heads the controls so it flips in view as a slider drags; its exact words sit under "For agents".
import { useMemo, useState } from 'react';
import { LabBench, LabButtons, LabChoice, LabControls, LabNote, LabSlider, LabStage, LabTabIntro } from '../ui.tsx';
import { checkPriceHold, explainPriceHold, PRICE_HOLD_SECONDS, type PriceHoldParams } from './hold/price-hold.ts';
import { PriceHoldStage } from './hold/PriceHoldStage.tsx';
import './hold.css';

const CLEAN: PriceHoldParams = { entrance: 0.6, wobble: 0, drift: 0, fadeAt: 4.4, peak: 1, need: 1.5, within: 2 };

const PRICE_HOLD_PRESETS: readonly { label: string; params: PriceHoldParams }[] = [
  { label: 'Clean', params: CLEAN },
  { label: 'Shaky', params: { ...CLEAN, wobble: 2.5 } },
  { label: 'Slow arrival', params: { ...CLEAN, entrance: 3.2 } },
  { label: 'Never stops', params: { ...CLEAN, drift: 3 } },
  { label: 'Leaves too soon', params: { ...CLEAN, fadeAt: 1.8 } },
  { label: 'Too faint', params: { ...CLEAN, peak: 0.85 } },
];

export function HoldTab() {
  const [params, setParams] = useState(CLEAN);
  const set = <K extends keyof PriceHoldParams>(k: K) => (v: PriceHoldParams[K]) => setParams((p) => ({ ...p, [k]: v }));
  const verdict = useMemo(() => checkPriceHold(params), [params]);
  const pass = verdict.problem === null;

  return (
    <>
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
          <>
            <LabStage component={PriceHoldStage} inputProps={{ ...params, steady: verdict.steady, pass }} seconds={PRICE_HOLD_SECONDS} label="SCENE: BUY · HOLD: PRICE" />
            <LabNote>
              <b>Reading it:</b> the box on the left magnifies the card's corner 12× over its dashed resting outline, so a 2px shake is plain. Below, the white and blue lines are its left-right and up-down position (±10px around rest), the red how solid it is (70–100%). The green band is the longest stretch it was steady and visible; it passes when the promised bar fits inside.
            </LabNote>
          </>
        }
      >
        <section className={`hold-verdict ${pass ? 'pass' : 'fail'}`} aria-live="polite">
          <span key={pass ? 'pass' : 'fail'} className="hold-stamp">{pass ? 'Pass' : 'Fail'}</span>
          <p className="hold-plain">{explainPriceHold(verdict, params.need)}</p>
        </section>

        <LabControls>
          <LabButtons label="Try a problem" buttons={PRICE_HOLD_PRESETS.map((p) => ({ label: p.label, onClick: () => setParams(p.params) }))}
            hint="Each one breaks the hold a different way. Then drag the sliders to find exactly where it tips over." />
          <LabSlider label="Promised hold" value={params.need} min={0.5} max={4} step={0.1} onChange={set('need')} format={(v) => `${v}s`}
            hint="How long the scene says the price stays readable. Longer is harder to keep." />
          <LabSlider label="Shake" value={params.wobble} min={0} max={6} step={0.1} onChange={set('wobble')} format={(v) => `±${v}px`}
            hint="A hand-held wobble. Even ±1.1px moves it more than the 2px the check allows: tiny on the card, obvious in the zoomed corner." />
          <LabSlider label="Keeps drifting" value={params.drift} min={0} max={12} step={0.1} onChange={set('drift')} format={(v) => `${v}px/s`}
            hint="After it lands, does it keep creeping? A slow drift adds up: 2px of travel ends the steady stretch." />
          <LabSlider label="Arrival takes" value={params.entrance} min={0.2} max={4} step={0.1} onChange={set('entrance')} format={(v) => `${v}s`}
            hint="How long the slide-in lasts. It doesn't count as still until the tail of the slide is under 2px, so a slow arrival eats the hold." />
          <LabSlider label="Starts fading at" value={params.fadeAt} min={1} max={PRICE_HOLD_SECONDS} step={0.1} onChange={set('fadeAt')} format={(v) => (v >= PRICE_HOLD_SECONDS ? 'never' : `${v}s`)}
            hint="When the card begins to fade away. Below 95% solid it no longer counts as visible." />
          <LabSlider label="How solid" value={params.peak} min={0.6} max={1} step={0.01} onChange={set('peak')} format={(v) => `${Math.round(v * 100)}%`}
            hint="How see-through the card is once it's in (100% = fully solid). A see-through card never counts, however still it is." />
          <LabChoice label="Counts as still within" options={[{ value: 2, label: '2px (default)' }, { value: 4, label: '4px' }, { value: 8, label: '8px' }]} value={params.within} onChange={set('within')}
            hint="How far it may move and still count as still. A scene can loosen this for something that's meant to gently breathe." />
        </LabControls>

        <details className="hold-agents">
          <summary>For agents</summary>
          <p>The promise, as a scene writes it:</p>
          <code>expect: [{'{'} hold: 'price', for: {params.need}{params.within !== 2 && `, within: ${params.within}`} {'}'}]</code>
          <p>What the check prints after a render:</p>
          <code>{verdict.problem ?? 'Nothing. A kept hold is silent.'}</code>
          {verdict.problem && <p>The last part, "Review: studio look …", is the command that draws this same graph for a real render.</p>}
        </details>
      </LabBench>
    </>
  );
}
