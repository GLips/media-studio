// A test of painted layers: a full watercolour opening, a brush wipe into a real capture, and a hand-drawn ink ring
// around the price, anchored to its word.

import type { Pts } from 'p5';
import { Capture, EndCard, camFit, defineScene, defineVideo, screenRect, seg, view, type Rect } from '../../lib/studio/api.ts';
import { PAL, Watercolor, hash, type WatercolorKit } from '../../lib/paint/watercolor.tsx';
import { voice } from './audio/manifest.ts';
import { captures as C } from './captures/index.ts';

const WIPE = 0.6;

function paintLandscape(w: WatercolorKit, dur: number) {
  const { t } = w;
  w.paper();
  w.boilSeed('sky');
  w.paint(w.rectPts(-40, -40, 2000, 700, 20), { fill: PAL.sky, fillOp: 120, bleed: 0.25, tex: 0.5, ink: null });
  const sunY = 300 - 40 * seg(t, 0, dur);
  w.glow(1380, sunY, 220, '#FFC766', 0.9);
  w.boilSeed('sun');
  w.paint(w.ellPts(1380, sunY, 90, 90, 30, 3), { wash: PAL.ochre, ink: PAL.clayDk, sw: 1.2 });
  for (let i = 0; i < 3; i++) {
    w.boilSeed(`hill${i}`);
    w.paint(w.ellPts(300 + i * 650, 1000 + i * 110, 900, 380, 36, 6), {
      fill: [PAL.sap, PAL.teal, PAL.indigo][i], fillOp: 150, bleed: 0.15, tex: 0.6, ink: PAL.ink, sw: 0.8,
    });
  }
  // A path that draws itself on, as a line of ink, with a ribbon at its head.
  const path = w.through(Array.from({ length: 14 }, (_, i) => [180 + i * 115, 520 + Math.sin(i * 0.9) * 90 + hash(i) * 30] as const));
  const drawn = path.slice(0, Math.max(2, Math.round(path.length * seg(t, 0.8, 3.2))));
  w.boilSeed('path');
  w.inkLine(drawn, 1.4, PAL.ink, 'ink');
  const [hx, hy] = drawn[drawn.length - 1];
  w.boilSeed('ribbon');
  w.paint(w.ribbon([[hx - 160, hy + 40], [hx - 70, hy - 10], [hx, hy]], 4, 26), { wash: PAL.rose, ink: PAL.ink, sw: 0.7 });
  w.brushWipe(seg(t, dur - WIPE / 2, dur) * 0.5);
}

const painted = defineScene({
  id: 'painted', note: 'A full watercolour painting: paper, sky, a rising sun with real glow, hills, and an ink line drawing itself on.',
  lines: ['intro'], lead: 0.6, tail: 1.2,
  render: (s) => <Watercolor t={s.t} paint={(w) => paintLandscape(w, s.dur)} />,
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
  w.inkLine(loop.slice(0, Math.max(2, Math.round(loop.length * k))), 1.6, '#b82b2b', 'ink', 0.6);
}

const ring = defineScene({
  id: 'ring', note: 'The painted wipe clears onto the real product page, and an ink ring circles the price as the voice says it.',
  lines: ['ring'], lead: 0.5, tail: 1.2, cut: true,
  render: (s) => {
    const shot = C.home, v = view(shot, camFit(shot, shot.rects.price, { pad: 300, maxZoom: 1.4 }));
    const price = s.line('ring').word('price').start;
    return (
      <>
        <Capture view={v} />
        <Watercolor t={s.t} on="page" paint={(w) => paintInkRing(w, screenRect(v, shot.rects.price), seg(s.t, price - 0.4, price + 0.3))} />
        {s.t < WIPE / 2 && <Watercolor t={s.t} on="clear" paint={(w) => w.brushWipe(0.5 + seg(s.t, 0, WIPE / 2) * 0.5)} />}
      </>
    );
  },
});

const outro = defineScene({
  id: 'outro', lines: ['outro'], lead: 0.4, tail: 2.4,
  render: (s) => <EndCard k={seg(s.t, 0, 0.6)} title="Painted" bg="#1c365e" />,
});

export default defineVideo({ title: 'Painted', voice, scenes: [painted, ring, outro] });
