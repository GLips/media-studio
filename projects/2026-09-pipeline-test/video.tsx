// The pipeline test: not a product video. Every scene leans on a different part of the studio (painting, a long pan
// with motion blur, word-anchored rings, state changes under a cursor, a split with a native menu and a dialog, ink on
// a capture, a phone, cued glass-card points, a music bed), so a regression anywhere shows up in one render.

import type { Pts } from 'p5';
import {
  Capture, CaptureMotion, CaptureStates, ConfirmDialog, CursorPath, EndCard, GlassCard, Highlight, NativeMenu, Phone,
  SplitCompare, Text, Wash, camAt, camFit, camTop, centerOf, defineScene, defineVideo, offscreen, on, phoneView,
  screenRect, motionCurves, seg, splitLeftRect, splitRightRect, union, useVideoFormat, view, type CursorKey, type Rect,
} from '#studio';
import { PAL, Watercolor, type WatercolorKit } from '#paint/watercolor.tsx';
import { voice } from './audio/manifest.ts';
import { captures as C } from './captures/index.ts';
import { music } from './music/index.ts';

const INK = '#1c365e';
const RED = '#b3261e';
const WIPE = 0.6;
const PAGE = C.page;
const BUY_BOX = union(PAGE.rects.price, PAGE.rects.swatches[0], PAGE.rects.stock, PAGE.rects.stepper, PAGE.rects.note);

function paintLamp(w: WatercolorKit, dur: number) {
  const { t } = w;
  w.paper();
  w.boilSeed('wall');
  w.paint(w.rectPts(-40, -40, 2000, 760, 20), { fill: PAL.sky, fillOp: 90, bleed: 0.2, tex: 0.5, ink: null });
  w.boilSeed('desk');
  w.paint(w.rectPts(-40, 760, 2000, 400, 12), { fill: PAL.clay, fillOp: 140, bleed: 0.1, tex: 0.6, ink: PAL.ink, sw: 0.6 });
  // The lamp comes on as the line starts: light is added with glow, never painted.
  w.glow(1180, 560, 360 * seg(t, 0.4, 1.6, motionCurves.cubic.entrance), '#FFC766', 0.9);
  w.boilSeed('arm');
  w.paint(w.ribbon([[900, 760], [980, 480], [1120, 360]], 16, 12), { wash: INK, ink: PAL.ink, sw: 0.8 });
  w.boilSeed('shade');
  w.paint([[1060, 330], [1250, 300], [1290, 470], [1080, 470]], { wash: PAL.ochre, ink: PAL.ink, sw: 1.2, curv: 0.3 });
  w.boilSeed('base');
  w.paint(w.ellPts(900, 770, 150, 26, 24, 2), { wash: INK, ink: PAL.ink, sw: 0.9 });
  w.brushWipe(seg(t, dur - WIPE / 2, dur) * 0.5);
}

const opening = defineScene({
  id: 'opening', note: 'A painted desk lamp switches on, then a brush wipe takes us onto the real page.',
  lines: ['intro'], lead: 0.6, tail: 0.8,
  render: (s) => (
    <>
      <Watercolor t={s.t} paint={(w) => paintLamp(w, s.dur)} />
      <Text text="Pipeline test" x={140} y={180} size={96} color={INK} k={on(s.t, 0.3, 0.9)} />
    </>
  ),
});

const SPEC_ROW = PAGE.rects.rows[3];

const pan = defineScene({
  id: 'pan', note: 'Motion-blurred travel down the tall page to the specs, then a push in on one row.',
  lines: ['pan'], lead: 0.4, tail: 0.8, cut: true,
  render: (s) => {
    const frame = useVideoFormat();
    const line = s.line('pan');
    const top = camTop(PAGE, frame), specs = camFit(PAGE, PAGE.rects.specs, frame, { pad: 60 }), row = camFit(PAGE, SPEC_ROW, frame, { pad: 220 });
    const travel = [line.word('travels').start, line.word('specifications').start] as const;
    const cam = camAt(s.t, [[travel[1], specs], [line.word('pushes').start, specs], [line.word('row').start, row]]);
    const v = view(PAGE, cam, frame);
    return (
      <>
        {s.t < travel[1]
          ? <CaptureMotion view={view(PAGE, top, frame)} from={top} to={specs} k={seg(s.t, ...travel)} />
          : <Capture view={v} />}
        <Highlight rect={screenRect(v, SPEC_ROW)} k={on(s.t, line.word('row').start - 0.7, 0.6)} name="row" />
        {s.t < WIPE / 2 && <Watercolor t={s.t} on="clear" paint={(w) => w.brushWipe(0.5 + seg(s.t, 0, WIPE / 2) * 0.5)} />}
      </>
    );
  },
  expect: (s) => [{ see: 'row', during: s.line('pan').word('row') }],
});

const price = defineScene({
  id: 'price', note: 'Push in on the price, ringed as it is said.',
  lines: ['price'], lead: 0.5, tail: 0.7,
  render: (s) => {
    const frame = useVideoFormat();
    const said = s.line('price').word('twelve ninety nine');
    const v = view(PAGE, camAt(s.t, [[0, camFit(PAGE, BUY_BOX, frame, { pad: 120 })], [said.start - 0.2, camFit(PAGE, PAGE.rects.price, frame, { pad: 160 })]]), frame);
    return (
      <>
        <Capture view={v} />
        <Highlight rect={screenRect(v, PAGE.rects.price)} k={on(s.t, said.start - 0.7, 0.6)} name="price" />
      </>
    );
  },
  expect: (s) => [{ see: 'price', during: s.line('price').word('twelve ninety nine') }],
});

const stock = defineScene({
  id: 'stock', note: 'The cursor picks cobalt (out of stock), then sage, then clicks plus three times until shipping is free.',
  lines: ['stock-a', 'stock-b'], lead: 0.5, tail: 1.0,
  render: (s) => {
    const frame = useVideoFormat();
    const a = s.line('stock-a'), b = s.line('stock-b');
    const v = view(PAGE, camFit(PAGE, BUY_BOX, frame, { pad: 80 }), frame);
    const { swatches, plus } = PAGE.rects;
    const cobalt = a.word('cobalt').start, sage = b.word('sage').start, three = b.word('three').start;
    const clicks = [three, three + 0.4, three + 0.8];
    const keys: CursorKey[] = [
      [0, offscreen(v, centerOf(swatches[2]))],
      [cobalt - 0.1, centerOf(swatches[2]), { click: true }],
      [sage - 0.1, centerOf(swatches[1]), { click: true }],
      ...clicks.map((at) => [at, centerOf(plus), { click: true }] as const),
    ];
    return (
      <>
        <CaptureStates view={v} t={s.t} states={[[PAGE, 0], [C.cobalt, cobalt], [C.sage, sage], [C['sage-q2'], clicks[0]], [C['sage-q3'], clicks[1]], [C['sage-q4'], clicks[2]]]} fade={0.15} />
        <Highlight rect={screenRect(v, PAGE.rects.stock)} k={on(s.t, a.word('out of stock').start - 0.7, 0.6) * (1 - seg(s.t, sage - 0.3, sage))} name="oos" color={RED} />
        <Highlight rect={screenRect(v, PAGE.rects.note)} k={on(s.t, b.word('free').start - 0.7, 0.6)} name="free" />
        <CursorPath view={v} t={s.t} keys={keys} />
      </>
    );
  },
  expect: (s) => [
    { see: 'oos', during: s.line('stock-a').word('out of stock') },
    { see: 'free', during: s.line('stock-b').word('free') },
  ],
});

const split = defineScene({
  id: 'split', note: 'Cobalt and sage side by side; each ring is clipped to its panel, while the bulb menu and the clear dialog float over both.',
  lines: ['split'], lead: 0.6, tail: 1.2,
  render: (s) => {
    const frame = useVideoFormat();
    const line = s.line('split');
    const left = view(C.cobalt, camFit(C.cobalt, union(C.cobalt.rects.swatches[0], C.cobalt.rects.stock), frame, { pad: 60 }, splitLeftRect(frame)), frame, splitLeftRect(frame));
    const rightShot = C['sage-q3'];
    const right = view(rightShot, camFit(rightShot, union(rightShot.rects.select, rightShot.rects.note, rightShot.rects.clear), frame, { pad: 60 }, splitRightRect(frame)), frame, splitRightRect(frame));
    const menu = line.word('menu').start, dialog = line.word('dialog').start;
    const menuK = on(s.t, menu - 0.2, 0.3) * (1 - seg(s.t, dialog - 0.6, dialog - 0.4));
    return (
      <SplitCompare
        k={on(s.t, 0)}
        left={{ view: left, label: 'Cobalt', over: <Highlight rect={screenRect(left, C.cobalt.rects.stock)} k={on(s.t, line.word('each').start - 0.2)} name="left-ring" color={RED} /> }}
        right={{ view: right, label: 'Sage × 3', over: <Highlight rect={screenRect(right, rightShot.rects.note)} k={on(s.t, line.word('panel').start - 0.8, 0.6)} name="right-ring" /> }}
      >
        <NativeMenu k={menuK} from={screenRect(right, rightShot.rects.select)} items={PAGE.data.bulbs} scroll={seg(s.t, menu + 0.3, dialog - 0.7)} />
        <ConfirmDialog k={on(s.t, dialog - 0.3, 0.3)} origin="Lumen" message="Clear your colour, bulb and quantity?" />
      </SplitCompare>
    );
  },
  expect: (s) => [{ see: 'right-ring', during: s.line('split').word('own panel') }],
});

/** An ink loop drawn by hand around a rect, overshooting where it closes. `k` 0..1 draws it on. */
function paintInkRing(w: WatercolorKit, r: Rect, k: number) {
  if (k <= 0) return;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2 + 40, ry = r.h / 2 + 30;
  const loop: Pts = Array.from({ length: 30 }, (_, i) => {
    const a = -2.4 + (i / 29) * (Math.PI * 2 + 0.5), grow = 1 + 0.08 * (i / 29);
    return [cx + Math.cos(a) * rx * grow, cy + Math.sin(a) * ry * grow] as const;
  });
  w.boilSeed('ring');
  w.inkLine(loop.slice(0, Math.max(2, Math.round(loop.length * k))), 1.6, RED, 'ink', 0.6);
}

const ink = defineScene({
  id: 'ink', note: 'A hand-drawn ink loop circles the price on the real page as it is named.',
  lines: ['ink'], lead: 0.5, tail: 0.9,
  render: (s) => {
    const frame = useVideoFormat();
    const v = view(PAGE, camFit(PAGE, PAGE.rects.now, frame, { pad: 300, maxZoom: 1.4 }), frame);
    const named = s.line('ink').word('price').start;
    return (
      <>
        <Capture view={v} />
        <Watercolor t={s.t} on="page" paint={(w) => paintInkRing(w, screenRect(v, PAGE.rects.now), seg(s.t, named - 0.4, named + 0.3))} />
      </>
    );
  },
});

const phone = defineScene({
  id: 'phone', note: 'The page on a phone scrolls to the specs; the sticky bar stays pinned and is ringed.',
  lines: ['phone'], lead: 0.5, tail: 0.9,
  render: (s) => {
    const frame = useVideoFormat();
    const line = s.line('phone');
    const top = phoneView(C['phone-top'], frame, { cy: 420, height: 760 }), specs = { ...top, shot: C['phone-specs'] };
    const scrolled = seg(s.t, line.word('price').start - 0.6, line.word('price').start - 0.1);
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: '#eef1f5' }} />
        <Phone view={top} />
        <Phone view={specs} alpha={scrolled} />
        <Highlight rect={screenRect(specs, C['phone-specs'].rects.bar)} k={on(s.t, line.word('pinned').start - 0.7, 0.6)} name="bar" radius={8} pad={4} />
      </>
    );
  },
  expect: (s) => [{ see: 'bar', during: s.line('phone').word('pinned to the bottom') }],
});

const numbers = defineScene({
  id: 'numbers', note: 'The page blurs behind a glass card whose two points arrive with their words.',
  lines: ['numbers'], lead: 0.6, tail: 1.2,
  render: (s) => {
    const frame = useVideoFormat();
    const line = s.line('numbers');
    const blur = seg(s.t, 0, 0.8);
    return (
      <>
        <Capture view={view(C['sage-q4'], camFit(C['sage-q4'], BUY_BOX, frame, { pad: 80 }), frame)} blur={30 * blur} />
        <Wash color="22, 40, 70" from={0.6 * blur} to={0.36 * blur} x0={0} />
        <GlassCard k={seg(s.t, 0.2, 1.0, motionCurves.cubic.entrance)} eyebrow="FOUR LAMPS" accent={RED} ink={INK}
          points={[{ text: '4 × $1,299', k: on(s.t, line.word('four').start - 0.3, 0.6) }, { text: '= $5,196', k: on(s.t, line.word('five').start - 0.3, 0.6) }]} />
      </>
    );
  },
});

const outro = defineScene({
  id: 'outro', lines: ['outro'], lead: 0.4, tail: 2.2,
  render: (s) => <EndCard k={seg(s.t, 0, 0.6)} title="Pipeline test" bg={INK} />,
});

export default defineVideo({
  title: 'Pipeline test', voice, music: { track: music.bed },
  scenes: [opening, pan, price, stock, split, ink, phone, numbers, outro],
});
