// watercolor.tsx: a hand-painted look, with p5.brush washes, watercolour fills, hatching and tapered ink lines on
// paper. Ported from ClaudeAnimationBase's core.js (MIT); .claude/skills/video-canvas/references/watercolor.md is the
// guide to using it.
//
// The line work "boils": its jitter is re-seeded BOIL times a second, so each drawing holds for two frames and
// wobbles like hand-drawn animation. Call boilSeed(key) before each separate element. A moving element uses a
// different amount of randomness each frame, and without its own seed it would shift the stream for everything
// drawn after it, making still things jitter.

import type { P5, P5Graphics, Pts } from 'p5';
import * as brush from 'p5.brush';
import { P5Canvas, type P5Style } from './P5Canvas.tsx';
import { H, W } from '../studio/frame.ts';
import { clamp, ease, easeOut, lerp } from '../studio/motion.ts';

/** Drawings per second. At 30 fps each holds for two frames: animation "on twos". */
export const BOIL = 15;
const TAU = Math.PI * 2;

export const PAL = {
  paper: '#F3EBDC', ink: '#2B2233', clay: '#D97757', clayDk: '#A84D33', clayLt: '#F2A283',
  night: '#1F2550', indigo: '#2F3C7A', rose: '#E27A92', ochre: '#E8AA38', sap: '#6E9F58',
  teal: '#3A9C98', violet: '#7B5CA8', cream: '#FFF5E2', sky: '#8EC3E6',
} as const;

/** A stable value in [0, 1) for `i`: star positions, tuft heights, anything that mustn't boil. */
export const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Built once per tab, in setup.
// Paper and glow are p5 buffers because p5's WebGL image() won't take a plain canvas; grain is composited in 2D.
type Textures = { paper: P5Graphics; grain: HTMLCanvasElement; glow: P5Graphics };
let textures: Textures | null = null;

function lcg(seed: number) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function makePaper(p: P5): P5Graphics {
  const g0 = p.createGraphics(W, H);
  g0.pixelDensity(1);
  const c = g0.drawingContext, rnd = lcg(11);
  c.fillStyle = PAL.paper;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H, r = 120 + rnd() * 380, g = c.createRadialGradient(x, y, 0, x, y, r), a = 0.045 * rnd();
    g.addColorStop(0, `rgba(160,125,80,${a})`);
    g.addColorStop(1, 'rgba(160,125,80,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  c.lineWidth = 1;
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W, y = rnd() * H, l = 6 + rnd() * 26, a = rnd() * TAU;
    c.strokeStyle = `rgba(110,88,60,${0.035 + rnd() * 0.06})`;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  return g0;
}

/** Grain and a warm vignette, multiplied over the frame so the pigment sits in the paper. */
function makeGrain(): HTMLCanvasElement {
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const c = cv.getContext('2d')!, rnd = lcg(5), id = c.createImageData(W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 255 - (rnd() < 0.55 ? rnd() * rnd() * 34 : 0);
    d[i] = v; d[i + 1] = v - 1; d[i + 2] = v - 3; d[i + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  const g = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(120,95,70,.35)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  return cv;
}

function makeGlow(p: P5): P5Graphics {
  const g0 = p.createGraphics(256, 256);
  g0.pixelDensity(1);
  const c = g0.drawingContext, g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [s, a] of [[0, 1], [0.18, 0.8], [0.45, 0.32], [0.75, 0.08], [1, 0]]) g.addColorStop(s, `rgba(255,255,255,${a})`);
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  return g0;
}

export const WATERCOLOR: P5Style = {
  name: 'watercolor',
  attach: (p) => brush.instance(p),
  setup: (p) => {
    brush.scaleBrushes(5);
    brush.add('ink', { type: 'default', weight: 5, scatter: 0.25, sharpness: 0.8, grain: 40, opacity: 235, spacing: 0.2, pressure: [1.15, 0.75], rotate: 'natural', noise: 0.15 });
    brush.add('inkfine', { type: 'default', weight: 2.6, scatter: 0.15, sharpness: 0.85, grain: 40, opacity: 230, spacing: 0.2, pressure: [1.1, 0.8], rotate: 'natural', noise: 0.1 });
    brush.add('dry', { type: 'default', weight: 14, scatter: 3, sharpness: 0.3, grain: 6, opacity: 90, spacing: 0.6, pressure: [1, 0.6], rotate: 'natural', noise: 0.4 });
    textures = { paper: makePaper(p), grain: makeGrain(), glow: makeGlow(p) };
  },
};

function multiplyGrain(out: CanvasRenderingContext2D) {
  out.save();
  out.globalCompositeOperation = 'multiply';
  out.drawImage(textures!.grain, 0, 0);
  out.restore();
}

export type PaintOptions = {
  /** Flat colour, for anything solid. */
  wash?: string;
  washOp?: number;
  /** Watercolour fill with bleeding edges, for skies, hills and shading. */
  fill?: string;
  fillOp?: number;
  bleed?: number;
  tex?: number;
  border?: number;
  hatch?: { d: number; a: number; o?: { rand?: number; gradient?: number }; b?: string; c?: string; w?: number };
  /** Outline colour; null for none. Defaults to PAL.ink. */
  ink?: string | null;
  sw?: number;
  br?: string;
  /** 0..1: smooth the outline through the points. */
  curv?: number;
};

/** The watercolour kit, bound to one frame: `t` is the scene's time. */
export function watercolorKit(p: P5, t: number) {
  const boilN = Math.floor(t * BOIL + 1e-6);

  /** Restarts the jitter stream from a key that's the same every frame. Call before each separate element. */
  const boilSeed = (key: string | number) => {
    let h = 2166136261;
    for (const ch of `${key}|${boilN}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    // p5.brush is meant to follow p5's randomSeed, but in instance mode its fills don't, so seed both.
    p.randomSeed(h >>> 0);
    brush.seed(h >>> 0);
  };
  const jit = (a: number) => (p.random() * 2 - 1) * a;

  const rectPts = (x: number, y: number, w: number, h: number, j = 0): Pts => [
    [x + jit(j), y + jit(j)], [x + w / 2 + jit(j), y + jit(j) * 0.5], [x + w + jit(j), y + jit(j)], [x + w + jit(j) * 0.5, y + h / 2],
    [x + w + jit(j), y + h + jit(j)], [x + w / 2 + jit(j), y + h + jit(j) * 0.5], [x + jit(j), y + h + jit(j)], [x + jit(j) * 0.5, y + h / 2],
  ];
  const ellPts = (cx: number, cy: number, rx: number, ry: number, n = 28, j = 0, rot = 0): Pts =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i / n) * TAU;
      return [cx + Math.cos(a) * rx + jit(j), cy + Math.sin(a) * ry + jit(j)] as const;
    });

  /** One painted shape: optional wash, watercolour fill and hatch, then one continuous tapered outline. */
  function paint(pts: Pts, o: PaintOptions = {}) {
    if (o.wash || o.fill || o.hatch) {
      if (o.wash) brush.wash(o.wash, o.washOp ?? 255); else brush.noWash();
      if (o.fill) {
        brush.fill(o.fill, o.fillOp ?? 170);
        brush.fillBleed(o.bleed ?? 0.1);
        brush.fillTexture(o.tex ?? 0.4, o.border ?? 0.35);
      } else brush.noFill();
      if (o.hatch) {
        brush.hatch(o.hatch.d, o.hatch.a, o.hatch.o ?? { rand: 0.15 });
        brush.hatchStyle(o.hatch.b ?? 'HB', o.hatch.c ?? PAL.ink, o.hatch.w ?? 1);
      } else brush.noHatch();
      brush.noStroke();
      if (o.curv) {
        brush.beginShape(o.curv);
        for (const [x, y] of pts) brush.vertex(x, y);
        brush.endShape(true);
      } else brush.polygon(pts);
    }
    if (o.ink !== null) {
      brush.noWash();
      brush.noFill();
      brush.noHatch();
      brush.set(o.br ?? 'ink', o.ink ?? PAL.ink, o.sw ?? 1);
      brush.beginShape(o.curv ?? 0);
      for (const [x, y] of pts) brush.vertex(x, y);
      brush.endShape(true);
    }
  }

  /** An open ink line through the points. Brushes: 'ink', 'inkfine', 'dry', or p5.brush's ('2B', 'HB', 'charcoal', …). */
  function inkLine(pts: Pts, sw = 1, color: string = PAL.ink, br = 'ink', curv = 0.5) {
    brush.noFill();
    brush.noWash();
    brush.noHatch();
    brush.set(br, color, sw);
    brush.spline(pts, curv);
  }

  // p5.brush defers its paint into a mask layer; a tiny off-screen fill forces it down, so what was painted before
  // really lands under whatever p5 draws next (a glow, the paper).
  function flushBrush() {
    p.push();
    p.resetMatrix();
    p.translate(-W / 2, -H / 2);
    brush.noStroke(); brush.noHatch(); brush.noWash();
    brush.fill('#000000', 1); brush.fillBleed(0); brush.fillTexture(0, 0);
    brush.polygon([[-50, -50], [-40, -50], [-40, -40]]);
    brush.noFill();
    p.pop();
  }

  /**
   * Light, added rather than painted. p5.brush mixes colour like pigment, so yellow painted over blue turns green;
   * this is the one mark that isn't paint. It barely shows on light grounds, as real light wouldn't.
   */
  function glow(x: number, y: number, r: number, color = '#FFC766', a = 1) {
    if (a <= 0 || r < 1) return;
    flushBrush();
    const n = parseInt(color.slice(1), 16), rr = r * (1 + jit(0.03));
    p.push();
    p.blendMode(p.ADD);
    p.tint((n >> 16) & 255, (n >> 8) & 255, n & 255, 150 * clamp(a));
    p.image(textures!.glow, x - rr, y - rr, 2 * rr, 2 * rr);
    p.noTint();
    p.blendMode(p.BLEND);
    p.pop();
  }

  /** The paper, as the first thing a full-frame painting lays down. Overlay layers skip it and stay clear. */
  function paper() {
    p.image(textures!.paper, 0, 0);
  }

  /** A smooth curve through the points (Catmull-Rom), `n` samples per span. */
  function through(P: Pts, n = 6): Pts {
    if (P.length < 3) return P.slice();
    const out: (readonly [number, number])[] = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (let k = 0; k < n; k++) {
        const u = k / n, u2 = u * u, u3 = u2 * u;
        const at = (d: 0 | 1) => 0.5 * (2 * p1[d] + (p2[d] - p0[d]) * u + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * u2 + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * u3);
        out.push([at(0), at(1)]);
      }
    }
    out.push(P[P.length - 1]);
    return out;
  }

  /** A tapered ribbon along a path, as one outline: tails, trails, vines. One shape, one outline. */
  function ribbon(P: Pts, w0: number, w1 = w0): Pts {
    const C = through(P), n = C.length, L: [number, number][] = [], R: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = C[Math.max(0, i - 1)], b = C[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      const w = lerp(w0, w1, i / Math.max(1, n - 1)) / 2;
      L.push([C[i][0] - (dy / d) * w, C[i][1] + (dx / d) * w]);
      R.push([C[i][0] + (dy / d) * w, C[i][1] - (dx / d) * w]);
    }
    return [...L, ...R.reverse()];
  }

  /**
   * Fat paint strokes sweep across to cover the frame (`k` 0 → 0.5), then drag off (0.5 → 1). Cut under full cover:
   * the outgoing scene calls it for 0 → 0.5 over its last beat, the incoming one for 0.5 → 1 over its first.
   */
  function brushWipe(k: number, [c1, c2]: readonly [string, string] = [PAL.clayDk, PAL.clay]) {
    if (k <= 0 || k >= 1) return;
    const n = 5, bh = (H + 420) / n + 40;
    p.push();
    p.translate(W / 2, H / 2);
    p.rotate(-0.1);
    p.translate(-W / 2, -H / 2);
    for (let i = 0; i < n; i++) {
      boilSeed(`wipe${i}`);
      const y0 = -230 + (i * (H + 420)) / n, d = [0, 0.14, 0.06, 0.18, 0.1][i];
      const q = k < 0.5 ? easeOut(clamp((k * 2 - d) / (1 - d))) : ease(clamp(((k - 0.5) * 2 - d) / (1 - d)));
      const x0 = k < 0.5 ? -300 : lerp(-300, W + 400, q), x1 = k < 0.5 ? lerp(-300, W + 400, q) : W + 400;
      if (x1 - x0 < 30) continue;
      const pts: [number, number][] = [], rag = (j: number) => 40 + 50 * hash(i * 31 + j) + jit(12);
      for (let j = 0; j <= 8; j++) pts.push([lerp(x0, x1, j / 8), y0 + Math.sin(j * 0.9 + i) * 14 + jit(5)]);
      for (let j = 1; j < 9; j++) pts.push([x1 + rag(j) - 40, y0 + (bh * j) / 9]);
      for (let j = 8; j >= 0; j--) pts.push([lerp(x0, x1, j / 8), y0 + bh + Math.sin(j * 0.8 + i * 2) * 14 + jit(5)]);
      if (k >= 0.5) for (let j = 8; j > 0; j--) pts.push([x0 - rag(j + 20) + 40, y0 + (bh * j) / 9]);
      paint(pts, {
        wash: i % 2 ? c1 : c2, washOp: 255, fill: i % 2 ? c2 : c1, fillOp: 70, bleed: 0.05, tex: 0.8, border: 0.6, ink: null,
        hatch: { d: 44, a: 0, o: { rand: 0.6, gradient: 0.5 }, b: 'charcoal', c: i % 2 ? c2 : PAL.cream, w: 0.8 },
      });
    }
    p.pop();
  }

  p.noiseSeed(77);
  brush.noiseSeed(77);
  boilSeed('frame');
  return { p, t, boilSeed, jit, rectPts, ellPts, paint, inkLine, glow, paper, through, ribbon, brushWipe, flushBrush };
}

export type WatercolorKit = ReturnType<typeof watercolorKit>;

/**
 * A watercolour layer over the whole frame. `t` is the scene's time; `paint` gets the kit for that moment.
 *
 * - `on="paper"` (the default): a painting. Start it with `w.paper()`; it's opaque, with grain.
 * - `on="page"`: ink and paint on whatever is beneath, like marking up a printout. It paints on white and multiplies,
 *   because p5.brush mixes pigment with what it lands on, and thin strokes on a transparent layer come out broken.
 *   Multiplied paint can't cover: darker content beneath shows through.
 * - `on="clear"`: a transparent layer for solid washes that must cover (a brush wipe over a capture). Flat washes
 *   survive it; thin lines don't.
 */
export function Watercolor({ t, paint, on = 'paper', alpha }: {
  t: number;
  paint: (w: WatercolorKit) => void;
  on?: 'paper' | 'page' | 'clear';
  alpha?: number;
}) {
  return (
    <P5Canvas
      style={WATERCOLOR}
      alpha={alpha}
      multiply={on === 'page'}
      finish={on === 'paper' ? multiplyGrain : undefined}
      paint={(p) => {
        if (on === 'page') p.background(255);
        const kit = watercolorKit(p, t);
        paint(kit);
        // Without this, strokes still deferred at the end of the draw land in the next frame this tab paints.
        kit.flushBrush();
      }}
    />
  );
}
