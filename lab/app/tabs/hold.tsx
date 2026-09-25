// hold.tsx: the Hold check tab. A price card slides in and should sit still long enough to read; sliders shake it,
// slow it, drift it and fade it, and the real check (lib/hold-check.ts) judges every change, its verdict and exact
// words shown beside a plain-words reading of them.
import { useMemo, useState } from 'react';
import { LabChoice, LabControls, LabNote, LabSlider, LabStage, LabTabIntro } from '../ui.tsx';
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

const sameParams = (a: PriceHoldParams, b: PriceHoldParams) => (Object.keys(a) as (keyof PriceHoldParams)[]).every((k) => a[k] === b[k]);

export function HoldTab() {
  const [params, setParams] = useState(CLEAN);
  const set = <K extends keyof PriceHoldParams>(k: K) => (v: PriceHoldParams[K]) => setParams((p) => ({ ...p, [k]: v }));
  const verdict = useMemo(() => checkPriceHold(params), [params]);
  const pass = verdict.problem === null;
  const preset = PRICE_HOLD_PRESETS.find((p) => sameParams(p.params, params))?.label ?? 'custom';

  return (
    <>
      <LabTabIntro
        number={4}
        title="Hold check"
        what={<>When a scene shows something the viewer has to read — a price, a headline, a number — it can promise that thing will <b>sit still and fully visible</b> for long enough, say 1.5 seconds. After every render the studio measures where that thing actually was on every frame and checks the promise. That's what lets an agent know a viewer had time to read it without a person watching every render. It checks "steady and visible", not "readable": a still, solid price can still be too small or too faint in colour, and only a person looking can tell.</>}
        when={<>A scene declares it in one line: <code>expect: [{'{'} hold: 'price', for: 1.5 {'}'}]</code>. Pricing, stats, the headline of a launch — anything the video is really there to say.</>}
        bad={<>The price whooshes in, wobbles a little, and fades just as your eye lands on it. Nobody on the team notices, because each of them already knows what it says.</>}
        good={<>It arrives, stops dead, and stays put for as long as it takes to read. When it doesn't, the check says which way it moved, when, and by how much, so an agent can fix the right thing.</>}
      />

      <LabStage component={PriceHoldStage} inputProps={{ ...params, steady: verdict.steady, pass }} seconds={PRICE_HOLD_SECONDS} label="SCENE: BUY · HOLD: PRICE" />

      <LabNote>
        <b>How to read the graph:</b> the white line is the card's left-right position and the blue its up-down, both zoomed to ±10px around where it comes to rest (the slide-in shoots off the top). The green band is the longest stretch the check found it steady and visible; the bar above it is the length the scene promised. It passes when the bar fits inside the band.
      </LabNote>

      <div className="hold-lab">
        <section className={`hold-verdict ${pass ? 'pass' : 'fail'}`} aria-live="polite">
          <div className="hold-verdict-head">
            <span className="hold-verdict-word">{pass ? 'Pass' : 'Fail'}</span>
            <span className="hud">expect: [{'{'} hold: 'price', for: {params.need}{params.within !== 2 && `, within: ${params.within}`} {'}'}]</span>
          </div>
          <div className="hold-verdict-body">
            <p className="hold-plain">{explainPriceHold(verdict, params.need)}</p>
            <div className="hold-raw">
              <span className="hud">What the check prints</span>
              <code>{verdict.problem ?? 'Nothing. A kept hold is silent.'}</code>
              {verdict.problem && <small>The last part, "Review: studio look …", is the command an agent runs to see this same graph for a real render.</small>}
            </div>
          </div>
        </section>

        <LabControls>
          <LabChoice label="Try a problem" options={[...PRICE_HOLD_PRESETS.map((p) => ({ value: p.label, label: p.label })), ...(preset === 'custom' ? [{ value: 'custom', label: 'Your mix' }] : [])]} value={preset}
            onChange={(label) => setParams(PRICE_HOLD_PRESETS.find((p) => p.label === label)?.params ?? params)} hint="Each one breaks the hold a different way. Then drag the sliders to find exactly where it tips over." />
          <LabSlider label="Promised hold" value={params.need} min={0.5} max={4} step={0.1} onChange={set('need')} format={(v) => `${v}s`}
            hint="How long the scene says the price stays readable. Longer is harder to keep." />
          <LabSlider label="Shake" value={params.wobble} min={0} max={6} step={0.1} onChange={set('wobble')} format={(v) => `±${v}px`}
            hint="A hand-held wobble. Even ±1.1px moves it more than the 2px the check allows — too small to see here, but a reader's eye feels it." />
          <LabSlider label="Keeps drifting" value={params.drift} min={0} max={12} step={0.1} onChange={set('drift')} format={(v) => `${v}px/s`}
            hint="After it lands, does it keep creeping? A slow drift adds up: 2px of travel ends the steady stretch." />
          <LabSlider label="Arrival takes" value={params.entrance} min={0.2} max={4} step={0.1} onChange={set('entrance')} format={(v) => `${v}s`}
            hint="How long the slide-in lasts. It doesn't count as still until the tail of the slide is under 2px, so a slow arrival eats the hold." />
          <LabSlider label="Starts fading at" value={params.fadeAt} min={1} max={PRICE_HOLD_SECONDS} step={0.1} onChange={set('fadeAt')} format={(v) => (v >= PRICE_HOLD_SECONDS ? 'never' : `${v}s`)}
            hint="When the card begins to fade away. Below 95% opaque it no longer counts as visible." />
          <LabSlider label="How solid" value={params.peak} min={0.6} max={1} step={0.01} onChange={set('peak')} format={(v) => `${Math.round(v * 100)}%`}
            hint="Its opacity once it's in. A see-through card never counts, however still it is." />
          <LabChoice label="Counts as still within" options={[{ value: 2, label: '2px (default)' }, { value: 4, label: '4px' }, { value: 8, label: '8px' }]} value={params.within} onChange={set('within')}
            hint="A scene can loosen the rule for something that's meant to breathe, with within: in its expect line." />
        </LabControls>
      </div>
    </>
  );
}
