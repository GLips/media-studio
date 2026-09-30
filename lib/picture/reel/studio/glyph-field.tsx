// glyph-field.tsx: the reference reel's generative grid (sections 03 and 07's closing implosion): a lattice of
// glyphs morphing between dot, plus, X, diamond and square as waves cross it. Every glyph is one drawing,
// two perpendicular rounded bars (length L, width w, corner r, turned θ, one fill), so the reference's in-betweens
// (squircle, quatrefoil, notched octagon) come from lerping four numbers. Waves carry keyframe clips out from a point,
// along a straight front or on delays of your own; a filter shrinks cells away and packs the survivors; the field
// punches on beats and can implode into a point. One canvas draws it, so hundreds of cells cost one DOM node. The
// numbers come from models/glyph-field-frame.ts; this file paints them.

import { useId, useLayoutEffect, useRef } from 'react';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import type { Point } from '#lib/picture/camera/models/camera.ts';
import { clamp } from '#lib/picture/motion/models/motion.ts';
import { GLYPH_FIELD_COLORS } from '../models/glyph-field.ts';
import { glyphFieldFrame, parseGlyphColor, type GlyphDraw, type GlyphFieldFrame, type GlyphFieldProps, type GlyphSample } from '../models/glyph-field-frame.ts';
import { useVideoFormat } from '#lib/picture/composition/studio/video-format.ts';
import { pieceMotionAttrs, unmeasuredAttrs } from '#lib/output/look/studio/motion-tag.ts';

/** One frame of the reference reel (60 fps): the unit its timings were measured in. */
const REF_F = 1 / 60;
const RAD = Math.PI / 180;

function traceGlyph(ctx: CanvasRenderingContext2D, g: GlyphDraw, s: GlyphSample) {
  const L = g.L * s.unit, w = g.w * s.unit;
  if (!(L > 0 && w > 0)) return;
  const r = clamp(g.r * s.unit, 0, Math.min(L, w) / 2);
  const a = s.theta * RAD, cos = Math.cos(a), sin = Math.sin(a);
  // The path takes the transform as each shape is added, so both bars share the glyph's turn.
  ctx.setTransform(cos, sin, -sin, cos, s.x, s.y);
  ctx.roundRect(-L / 2, -w / 2, L, w, r);
  ctx.roundRect(-w / 2, -L / 2, w, L, r);
}

function paintGlyphFrame(ctx: CanvasRenderingContext2D, frame: GlyphFieldFrame, { width, height }: FrameSize) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  for (const g of [...frame.cells, ...(frame.marker ? [frame.marker] : [])]) {
    ctx.fillStyle = g.fill;
    // A smear's samples add ('lighter'), each at its share of the glyph (see SMEAR_GAIN). Each is its own path, or
    // the overlaps would merge into one fill.
    ctx.globalCompositeOperation = g.samples.length > 1 ? 'lighter' : 'source-over';
    ctx.globalAlpha = g.alpha;
    for (const s of g.samples) {
      ctx.beginPath();
      traceGlyph(ctx, g, s);
      ctx.fill();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/**
 * The glyph grid: a lattice of dots, pluses, X's, diamonds and squares that waves morph, recolour and pulse, a filter
 * thins and packs, the beat punches and an implosion collapses. Defaults are the reference's: 19 × 11 cream dots at
 * 100 px pitch, centred, on a transparent canvas the size of the frame (put a ground under it).
 */
export function GlyphField<D = null>(props: GlyphFieldProps<D>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const format = useVideoFormat(), { width, height } = format;
  const frame = glyphFieldFrame(props, format);
  useLayoutEffect(() => {
    paintGlyphFrame(canvas.current!.getContext('2d')!, frame, format);
  });
  const { box, values } = frame;
  return (
    <>
      <canvas ref={canvas} width={width} height={height} {...unmeasuredAttrs('glyph field cells')} style={{ position: 'absolute', left: 0, top: 0, width, height }} />
      <div {...pieceMotionAttrs(props.motion, 'glyph-field', { kind: 'glyph-field', values })} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, pointerEvents: 'none' }} />
    </>
  );
}

// ---------- flash and shock ring ----------

/**
 * A full-frame flash that peaks at `at` and decays with time constant `tau`, a touch dimmer at the corners (`falloff`).
 * The reference: neutral white at 57 % over black, 13 % dimmer in the corners, τ 2.3 frames at 60 fps, so at 30 fps its
 * frames read 1, 0.42, 0.18, 0.07. Put it over everything, HUD included.
 */
export function FieldFlash({ t, at = 0, peak = 0.57, tau = 2.3 * REF_F, falloff = 0.13, color = '#ffffff', motion }: {
  t: number;
  at?: number;
  peak?: number;
  tau?: number;
  falloff?: number;
  color?: string;
  motion?: string | false;
}) {
  const k = t < at ? 0 : peak * Math.exp(-(t - at) / tau);
  if (k < 0.003) return null;
  const [r, g, b] = parseGlyphColor(color);
  return (
    <div {...pieceMotionAttrs(motion, 'field-flash', { kind: 'field-flash', values: { k } })}
      style={{ position: 'absolute', inset: 0, opacity: k, pointerEvents: 'none', background: `radial-gradient(farthest-corner at 50% 50%, rgb(${r} ${g} ${b}) 0%, rgb(${r} ${g} ${b} / ${1 - falloff}) 100%)` }} />
  );
}

/**
 * A ring flung out from `origin` at `at`, `speed` px/s, its `stroke` px band fading from `opacity` by e every `tau` s.
 * The reference's: 2575 px/s, 22 px (2 % of frame height), 0.45, 0.068 s. At 30 fps it jumps 86 px a frame, so a trail
 * fades back over a `shutter` of travel; the band stays crisp.
 */
export function ShockRing({ t, at = 0, origin: givenOrigin, speed = 2575, stroke = 22, opacity = 0.45, tau = 0.0675, color = GLYPH_FIELD_COLORS.cream, shutter = 0.5, motion }: {
  t: number;
  at?: number;
  origin?: Point;
  speed?: number;
  stroke?: number;
  opacity?: number;
  tau?: number;
  color?: string;
  shutter?: number;
  motion?: string | false;
}) {
  const id = `shock-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { fps, width, height } = useVideoFormat(), origin = givenOrigin ?? { x: width / 2, y: height / 2 };
  const u = t - at;
  const alpha = u < 0 ? 0 : opacity * Math.exp(-u / tau);
  if (alpha < 0.004) return null;
  const head = speed * u, outer = head + stroke / 2, band = Math.max(0, head - stroke / 2);
  const inner = Math.max(0, band - Math.min(head, (speed * shutter) / fps));
  const [r, g, b] = parseGlyphColor(color);
  const stop = (radius: number, a: number) => <stop offset={clamp(radius / outer)} stopColor={`rgb(${r} ${g} ${b})`} stopOpacity={a} />;
  const trail = band - inner > 0.5;
  return (
    <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {trail && (
        <defs>
          <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={origin.x} cy={origin.y} r={outer}>
            {stop(inner, 0)}
            {stop(band, alpha * 0.4)}
            {stop(band, alpha)}
            {stop(outer, alpha)}
          </radialGradient>
        </defs>
      )}
      <circle {...pieceMotionAttrs(motion, 'shock-ring', { kind: 'shock-ring', values: { radius: head, alpha } })}
        cx={origin.x} cy={origin.y} r={(inner + outer) / 2} fill="none" strokeWidth={outer - inner}
        stroke={trail ? `url(#${id})` : `rgb(${r} ${g} ${b} / ${alpha})`} />
    </svg>
  );
}
