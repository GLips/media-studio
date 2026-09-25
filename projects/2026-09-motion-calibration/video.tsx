// Motion calibration: not a product video. Deliberately good and bad motion whose tracks are known in advance, so
// lib/engine/render/motion-calibration.test.ts can check the measurements (and later the graph) against them. Nothing here needs a
// capture or a voice: the page is a drawn grid, and no scene has lines.
//
// Each scene says what its tracks must show. Change a scene and that test with it.

import { useRef, type CSSProperties } from 'react';
import {
  Capture, CursorPath, DrawPath, H, Highlight, Odometer, Text, W, WordReveal, camAt, camTop, clamp, defineScene, defineVideo, lerp,
  motionCurves, motionAttrs, on, screenRect, seg, useMotionTag, view, type Rect, type Shot,
} from '../../lib/studio/api.ts';

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
 * Good next to bad: `eased` travels 1000px with motionCurves.cubic.standard in 1s and holds; `linear` travels the same 1000px at one
 * speed, stops dead, and jitters ±3px while it "holds". Velocity: a bell against a flat plateau with a cliff at each end.
 * Both are declared to hold for 1s after arriving: `eased` does, and `linear`'s jitter fails the check on purpose.
 */
const glide = defineScene({
  id: 'glide', min: 3,
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
 * A push in on the grid's centre, where zoom rises 1 → 2.4 with no pan: the camera's cx and cy hold, and the ring on
 * the centre square keeps its screen centre (no centre velocity) while it grows on screen. In page space its centre
 * never moves; its size shrinks a little, since the ring's padding is screen pixels. The cursor crosses the page
 * meanwhile: its own (page) motion is only its path, the camera's push excluded.
 */
const push = defineScene({
  id: 'push', min: 3,
  render: (s) => {
    const wide = { cx: GRID.w / 2, cy: GRID.h / 2, zoom: 1 };
    const v = view(GRID, camAt(s.t, [[0.5, wide], [2, { ...wide, zoom: 2.4 }]]));
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
const rise = defineScene({
  id: 'rise', min: 2,
  render: (s) => {
    const v = view(GRID, camTop(GRID));
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
const counter = defineScene({
  id: 'counter', min: 2.5,
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
 * Ownership. `stage` is drawn at 2× and holds still; `dot` inside it moves 100 of the stage's own pixels, so 200 on
 * screen: its local x moves 100, its screen x 200. `tilted` is turned 20°, so its `pin` is attribution unknown, and so
 * is `turned`'s `pin`, under an SVG group turned inside it. `chip` is tagged by ref and selector, as an element a host
 * component renders itself would be.
 */
const nested = defineScene({
  id: 'nested', min: 2.5,
  render: (s) => <Nested t={s.t} />,
});

function Nested({ t }: { t: number }) {
  const host = useRef<HTMLDivElement>(null);
  useMotionTag(host, 'chip', '.chip');
  const k = seg(t, 0.3, 1.3);
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: '#eef1f6' }} />
      <div data-motion="stage" style={{ position: 'absolute', left: 100, top: 100, width: 400, height: 200, transform: 'scale(2)', transformOrigin: '0 0', background: '#dfe6f1' }}>
        <div data-motion="dot" style={{ position: 'absolute', left: 20 + 100 * k, top: 80, width: 40, height: 40, borderRadius: 20, background: INK }} />
      </div>
      <div data-motion="tilted" style={{ position: 'absolute', left: 1200, top: 150, width: 400, height: 300, transform: 'rotate(20deg)', background: '#f1dfdf' }}>
        <div data-motion="pin" style={{ position: 'absolute', left: 40 + 200 * k, top: 120, width: 40, height: 40, background: '#b82b2b' }} />
      </div>
      <svg style={{ position: 'absolute', left: 0, top: 0 }} width={W} height={H}>
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
const blink = defineScene({
  id: 'blink', min: 2,
  render: (s) => (
    <>
      <div style={{ position: 'absolute', inset: 0, background: '#eef1f6' }} />
      {(s.t < 0.8 || s.t >= 1.1) && <div data-motion="blink" style={{ ...card(INK), left: 880, top: 300 + 100 * clamp(s.t / 2) }} />}
    </>
  ),
});

const after = defineScene({
  id: 'after', min: 2,
  render: (s) => <Text text="Same words" x={W / 2} y={H / 2 - 100 * seg(s.t, 0, 1.5)} align="center" color={INK} k={on(s.t, -0.3, 0.6)} />,
});

const end = defineScene({
  id: 'end', min: 1.5, cut: true,
  render: (s) => <Text text="Same words" x={W / 2} y={lerp(H / 2, H / 2 + 120, seg(s.t, 0.2, 1.2))} align="center" color={INK} />,
});

/**
 * The kit's builds, cut in hard so no crossfade breaks their tracks. `headline`'s words start 2 frames apart (60 ms on
 * the frame grid), each rising 12px in place, never sideways; a check draws on under it; `total` rolls to 1,299,
 * easing out, lands exactly, and is declared to hold.
 */
const kit = defineScene({
  id: 'kit', min: 4, cut: true,
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

export default defineVideo({ title: 'Motion calibration', voice: {}, scenes: [glide, push, rise, counter, nested, blink, after, end, kit] });
