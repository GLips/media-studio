// Motion calibration: not a product video, and not a project here. Deliberately good and bad motion whose tracks are
// known in advance, which lib/output/render/engine/motion-calibration.test.ts copies into a project of a throwaway studio,
// renders, and checks the measurements (and the graph) against. Nothing here needs a capture or a voice: the page is a
// drawn grid, and no scene has lines.
//
// Each scene says what its tracks must show. Change a scene and that test with it.

import { useRef, type CSSProperties } from 'react';
import {
  Capture, CursorPath, DrawPath, Highlight, Odometer, Text, WordReveal, camAt, camTop, clamp, defineVideo, lerp,
  motionCurves, motionAttrs, on, sceneForTimelineClock, screenRect, seg, useMotionTag, useVideoFormat, view, type Rect, type Shot,
} from '#studio';
import { bindTimeline } from '#lib/timing/timeline/models/bind-timeline.ts';
import { defineTimeline, fixedSpan, type ResolvedSceneClock } from '#lib/timing/timeline/models/timeline.ts';

const INK = '#1c365e';

// A 1440×900 page of labelled squares, as a capture would be, so cameras have something to move over.
const GRID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="1440" height="900" fill="#f4f6fa"/>${Array.from({ length: 60 }, (_, i) => {
  const x = (i % 10) * 144 + 22, y = Math.floor(i / 10) * 150 + 25;
  return `<rect x="${x}" y="${y}" width="100" height="100" rx="12" fill="#c9d3e3"/><text x="${x + 50}" y="${y + 60}" font-size="28" text-anchor="middle" font-family="Helvetica" fill="#1c365e">${i}</text>`;
}).join('')}<rect x="670" y="400" width="100" height="100" rx="12" fill="#b82b2b"/></svg>`;
const GRID: Shot = { src: `data:image/svg+xml,${encodeURIComponent(GRID_SVG)}`, w: 1440, h: 900, scale: 2, rects: {} };
// The red square, dead centre of the page.
const CENTRE_SQUARE: Rect = { x: 670, y: 400, w: 100, h: 100 };

const card = (color: string): CSSProperties => ({ position: 'absolute', width: 160, height: 160, borderRadius: 24, background: color });

/**
 * Good next to bad: `eased` travels 1000px with motionCurves.cubic.standard in 1s and holds; `linear` travels it at one
 * speed, stops dead, and jitters ±3px while it "holds". Velocity: a bell against a flat plateau with a cliff at each end.
 * Both declare a 1s hold: `linear`'s jitter fails the check on purpose.
 */
const glide = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  expect: () => [
    { hold: 'eased', for: 1, during: { start: 1, end: 3 } },
    { hold: 'linear', for: 1, during: { start: 1, end: 3 } },
  ],
  render: (s) => {
    const eased = seg(s.t, 0.5, 1.5, motionCurves.cubic.standard), flat = seg(s.t, 0.5, 1.5, motionCurves.linear);
    const jitter = s.t > 1.5 ? 3 * Math.sin(s.t * 97) : 0;
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: '#eef1f6' }} />
        <div data-motion="eased" style={{ ...card(INK), left: 300 + 1000 * eased, top: 260 }} />
        <div data-motion="linear" style={{ ...card('#b82b2b'), left: 300 + 1000 * flat, top: 580 + jitter }} />
      </>
    );
  },
});

/**
 * A push in on the grid's centre, zoom 1 → 2.4 with no pan: the ring on the centre square keeps its screen centre
 * while it grows. In page space its centre never moves; its size shrinks a little, since the ring's padding is screen
 * pixels. The cursor's own (page) motion is only its path, the camera's push excluded.
 */
const push = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  render: (s) => {
    const frame = useVideoFormat();
    const wide = { cx: GRID.w / 2, cy: GRID.h / 2, zoom: 1 };
    const v = view(GRID, camAt(s.t, [[0.5, wide], [2, { ...wide, zoom: 2.4 }]]), frame);
    return (
      <>
        <Capture view={v} />
        <Highlight rect={screenRect(v, CENTRE_SQUARE)} k={on(s.t, 0.2, 0.5)} name="centre" />
        <CursorPath view={v} t={s.t} keys={[[0.5, { x: 560, y: 420 }], [2, { x: 760, y: 560 }]]} />
      </>
    );
  },
});

/**
 * A camera carried by its wrapper: the capture and a ring on the centre square rise 120px together into place, the
 * camera itself still. On screen the ring rises; on the page it never moves, since the rise isn't the camera's.
 */
const rise = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  render: (s) => {
    const frame = useVideoFormat();
    const v = view(GRID, camTop(GRID, frame), frame);
    return (
      <div style={{ position: 'absolute', inset: 0, transform: `translateY(${120 * (1 - seg(s.t, 0.3, 1.3, motionCurves.cubic.entrance))}px)` }}>
        <Capture view={v} />
        <Highlight rect={screenRect(v, CENTRE_SQUARE)} k={1} name="centre" />
      </div>
    );
  },
});

/**
 * Motion a box can't show: a counter counts 0 → 120 (its `value` channel) and a ring draws on (`draw`) while neither
 * box moves.
 */
const counter = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  render: (s) => {
    const value = Math.round(120 * seg(s.t, 0.3, 1.8));
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: '#eef1f6' }} />
        <div {...motionAttrs({ name: 'count', kind: 'counter', values: { value } })}
          style={{ position: 'absolute', left: 760, top: 380, width: 400, textAlign: 'center', font: `800 160px Helvetica`, color: INK, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        <Highlight rect={{ x: 740, y: 370, w: 440, h: 220 }} k={seg(s.t, 0.3, 1.8)} name="ring" through="screen" />
      </>
    );
  },
});

/**
 * Ownership. `stage` is drawn at 2× and holds still; `dot` inside it moves 100 of the stage's pixels, 200 on screen.
 * `tilted` is turned 20°, so its `pin` is attribution unknown, as is `turned`'s `pin`, under an SVG group turned
 * inside it. `chip` is tagged by ref and selector, as an element a host component renders itself would be.
 */
const nested = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  render: (s) => <Nested t={s.t} />,
});

function Nested({ t }: { t: number }) {
  const host = useRef<HTMLDivElement>(null);
  useMotionTag(host, 'chip', '.chip');
  const k = seg(t, 0.3, 1.3), { width, height } = useVideoFormat();
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: '#eef1f6' }} />
      <div data-motion="stage" style={{ position: 'absolute', left: 100, top: 100, width: 400, height: 200, transform: 'scale(2)', transformOrigin: '0 0', background: '#dfe6f1' }}>
        <div data-motion="dot" style={{ position: 'absolute', left: 20 + 100 * k, top: 80, width: 40, height: 40, borderRadius: 20, background: INK }} />
      </div>
      <div data-motion="tilted" style={{ position: 'absolute', left: 1200, top: 150, width: 400, height: 300, transform: 'rotate(20deg)', background: '#f1dfdf' }}>
        <div data-motion="pin" style={{ position: 'absolute', left: 40 + 200 * k, top: 120, width: 40, height: 40, background: '#b82b2b' }} />
      </div>
      <svg style={{ position: 'absolute', left: 0, top: 0 }} width={width} height={height}>
        <g data-motion="turned">
          <g transform="rotate(20 700 500)">
            <rect data-motion="pin" x={600 + 200 * k} y={480} width={40} height={40} fill="#b82b2b" />
          </g>
        </g>
      </svg>
      <div ref={host} style={{ position: 'absolute', left: 300, top: 700 }}>
        <span className="chip" style={{ position: 'absolute', left: 600 * k, top: 0, padding: '10px 24px', borderRadius: 30, background: INK, color: '#fff', font: '600 32px Helvetica', whiteSpace: 'nowrap' }}>chip</span>
      </div>
    </>
  );
}

/**
 * Identity. `blink` is gone for a stretch mid-scene and comes back, so its track breaks there; this scene crossfades
 * into `after`, so every track breaks where the fade starts; `after` ends in a hard cut to `end`. `end`'s title is
 * the same words as `after`'s, and stays two tracks, one per scene.
 */
const blink = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  render: (s) => (
    <>
      <div style={{ position: 'absolute', inset: 0, background: '#eef1f6' }} />
      {(s.t < 0.8 || s.t >= 1.1) && <div data-motion="blink" style={{ ...card(INK), left: 880, top: 300 + 100 * clamp(s.t / 2) }} />}
    </>
  ),
});

const after = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  render: (s) => {
    const { width, height } = useVideoFormat();
    return <Text text="Same words" x={width / 2} y={height / 2 - 100 * seg(s.t, 0, 1.5)} align="center" color={INK} k={on(s.t, -0.3, 0.6)} />;
  },
});

const end = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  render: (s) => {
    const { width, height } = useVideoFormat();
    return <Text text="Same words" x={width / 2} y={lerp(height / 2, height / 2 + 120, seg(s.t, 0.2, 1.2))} align="center" color={INK} />;
  },
});

/**
 * The kit's builds, cut in hard so no crossfade breaks their tracks. `headline`'s words start 2 frames apart (60 ms on
 * the frame grid), each rising 12px in place, never sideways; a check draws on under it; `total` rolls to 1,299,
 * easing out, lands exactly, and is declared to hold.
 */
const kit = (clock: ResolvedSceneClock) => sceneForTimelineClock(clock, {
  expect: () => [{ hold: 'total', for: 1, during: { start: 2.7, end: 4 } }],
  render: (s) => (
    <>
      <div style={{ position: 'absolute', inset: 0, background: INK }} />
      <WordReveal t={s.t - 0.2} text="Every price, one tap away" x={260} y={220} width={1400} size={96} weight={800} align="center" motion="headline" />
      <DrawPath d="M4 12.5l5 5L20 6.5" viewBox="0 0 24 24" box={{ x: 560, y: 480, w: 180, h: 180 }} k={seg(s.t, 1.1, 1.6, motionCurves.linear)} color="#7fd99a" width={16} motion="check" />
      <Odometer t={s.t} value={(t) => lerp(0, 1299, motionCurves.cubic.entrance(seg(t, 1.5, 2.7, motionCurves.linear)))} mode="direct" prefix="$" x={780} y={618} size={140} alpha={seg(s.t, 1.1, 1.5, motionCurves.dissolve)} motion="total" />
    </>
  ),
});

// Each scene dissolves into the next over half a second, but for the hard cuts into `end` and `kit`.
const fade = { crossfade: 0.5 };
const timeline = defineTimeline({
  scenes: {
    glide: fixedSpan(3), push: fixedSpan(3, fade), rise: fixedSpan(2, fade), counter: fixedSpan(2.5, fade), nested: fixedSpan(2.5, fade),
    blink: fixedSpan(2, fade), after: fixedSpan(2, fade), end: fixedSpan(1.5), kit: fixedSpan(4),
  },
});

export default defineVideo({
  title: 'Motion calibration', timeline, voice: {}, scenes: bindTimeline(timeline, { glide, push, rise, counter, nested, blink, after, end, kit }),
});
