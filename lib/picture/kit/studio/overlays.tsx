// overlays.tsx: what a scene draws over its captures, in screen coordinates: cursors, highlights, spotlights, tags,
// text, frosted glass and washes. Each takes its progress (`k`, 0..1) as a prop and holds no state.
//
// Each piece's doc says whether `k` is raw or eased. A piece that eases `k` itself wants raw progress,
// `seg(…, motionCurves.linear)`: an eased `k`, from `on()` or a curve token, eases twice and lands harder.
//
// Highlights and tags carry data-framing, which the framing check (probe.tsx) measures: a highlight marks what the
// voice is describing, so one under a tag or the caption, or off the frame, is a shot nobody can follow. Each piece
// also tags itself for the motion tracks (motion-tag.ts), with its progress and, where it knows it, its camera.

import { useId, type CSSProperties, type ReactNode } from 'react';
import type { StaggerMembership } from '#lib/picture/motion/models/motion-tracks.ts';
import { assertKeysInOrder, inflate, pagePoint, screenPoint, viewOfScreenRect, type Point, type Rect, type View } from '#lib/picture/camera/models/camera.ts';
import { FONT, fullFrameRect, type FrameSize } from '#lib/picture/frame/models/frame.ts';
import { clamp, lerp, motionCurves, seg } from '#lib/picture/motion/models/motion.ts';
import { pieceMotionAttrs } from '#lib/output/look/studio/motion-tag.ts';
import { SFX, Sfx } from '#lib/timing/sound/studio/sfx.tsx';
import { sceneTimeOf, takeMouseAt, type TakeFit } from '#lib/footage/capture/studio/take.ts';
import { useVideoFormat } from '#lib/picture/composition/studio/video-format.ts';

const INK = '#1c365e';
/** An SVG layer over the whole frame. */
const frameFill = ({ width, height }: FrameSize): CSSProperties => ({ position: 'absolute', left: 0, top: 0, width, height, overflow: 'visible', pointerEvents: 'none' });

/** An SVG rounded-rect path, for shapes a plain <rect> can't make (cut-outs). */
const roundRectPath = ({ x, y, w, h }: Rect, r: number) =>
  `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} ` +
  `H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

/**
 * Draws its children in screen coordinates, clipped to `box`, the way a panel clips its capture. Overlays aimed
 * through a panel's view go inside, so the framing check sees a ring cut off by the panel's edge. It's a group in the
 * motion tracks, so what's drawn in it is tracked under it: named `motion`, or `picked` (`panel` by default), the name a
 * kit piece built on it gives it.
 */
export function ClipToBox({ box, motion, picked = 'panel', children }: { box: Rect; motion?: string | false; picked?: string; children: ReactNode }) {
  const { width, height } = useVideoFormat();
  return (
    <div {...pieceMotionAttrs(motion, picked, { kind: 'panel' })}
      style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: -box.x, top: -box.y, width, height }}>{children}</div>
    </div>
  );
}

// ---------- cursor ----------

/** A pointer at a screen point. `press` 0..1 squeezes it for a click. `through` is the view it moves over, if any. */
export function Cursor({ at, press = 0, alpha = 1, through, motion }: { at: Point; press?: number; alpha?: number; through?: View; motion?: string | false }) {
  const frame = useVideoFormat();
  const s = 1.55 * (1 - 0.12 * press);
  return (
    <svg style={{ ...frameFill(frame), opacity: alpha }} width={frame.width} height={frame.height}>
      <g transform={`translate(${at.x} ${at.y}) scale(${s})`} {...pieceMotionAttrs(motion, 'cursor', { kind: 'cursor', values: { press }, through })}>
        <path d="M0 0 L0 22 L5.5 17 L9.5 26 L13 24.5 L9 16 L16 16 Z" fill="#111" style={{ filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.35))' }} />
        <path d="M0 0 L0 22 L5.5 17 L9.5 26 L13 24.5 L9 16 L16 16 Z" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * An expanding ring where a click landed; `k` 0..1 over its life, raw (it eases its own growth). The click point itself
 * is a subject for the framing check while the ring is fresh, so a click under the caption or outside its panel fails.
 * `through` is the view it was clicked on, if any; `n`, which click of a path it is, tells overlapping ripples apart.
 */
export function ClickRipple({ at, k, color = INK, through, n, motion }: { at: Point; k: number; color?: string; through?: View; n?: number; motion?: string | false }) {
  const frame = useVideoFormat();
  if (k <= 0 || k >= 1) return null;
  return (
    <svg style={{ ...frameFill(frame), opacity: (1 - k) * 0.55 }} width={frame.width} height={frame.height}>
      <circle cx={at.x} cy={at.y} r={10 + 44 * motionCurves.cubic.entrance(k)} fill="none" stroke={color} strokeWidth={4} {...pieceMotionAttrs(motion, n === undefined ? 'click' : `click-${n}`, { kind: 'click', values: { ripple: k }, through })} />
      <rect data-framing="subject" data-name="click" data-strength={1 - k} x={at.x - 12} y={at.y - 12} width={24} height={24} fill="none" />
    </svg>
  );
}

/** A waypoint: at `time`, the cursor is at page point `at` of the view's capture; `click` presses there. */
export type CursorKey = readonly [time: number, at: Point, opts?: { click?: boolean }];

const CLICK_PRESS = 0.12;
const RIPPLE_LIFE = 0.6;

// A slight arc reads as a hand moving a mouse rather than a robot sliding one.
const lerpPoint = (a: Point, b: Point, k: number): Point => {
  const arc = Math.sin(Math.PI * k) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - arc };
};

/** Where the cursor is at `t` along its waypoints, in page space. Exported for motion checks. */
export function cursorAt(t: number, keys: readonly CursorKey[]): Point {
  assertKeysInOrder('cursor', keys);
  let p = keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t >= keys[i][0]) p = keys[i][1];
    else return lerpPoint(keys[i - 1][1], keys[i][1], seg(t, keys[i - 1][0], keys[i][0]));
  }
  return p;
}

/** A cursor moving through page-space waypoints over a view, pressing, rippling and sounding where it clicks. */
export function CursorPath({ view, t, keys, alpha = 1 }: { view: View; t: number; keys: readonly CursorKey[]; alpha?: number }) {
  if (alpha <= 0) return null;
  const clicks = keys.filter(([, , opts]) => opts?.click);
  const press = Math.max(0, ...clicks.map(([kt]) => 1 - Math.abs(t - kt) / CLICK_PRESS));
  return (
    <>
      {clicks.map(([kt], i) => <Sfx key={i} sound={SFX.click} id={i} at={kt} t={t} event="click" />)}
      {clicks.map(([kt, p], i) => <ClickRipple key={i} at={screenPoint(view, p)} k={(t - kt) / RIPPLE_LIFE} n={i + 1} through={view} />)}
      <Cursor at={screenPoint(view, cursorAt(t, keys))} press={clamp(press)} alpha={alpha} through={view} />
    </>
  );
}

/**
 * A take's own cursor, clicks and typed keys, replayed in scene time through its fit, over a view of the take. The
 * take logged where the mouse went, so this is where it went, fitted to the voice with the footage.
 */
export function TakeCursor({ view, t, fit, alpha = 1 }: { view: View; t: number; fit: TakeFit; alpha?: number }) {
  // The log's waypoints, plus a key at every pin: without those the cursor would glide on through a hold, or keep one
  // speed across a pin that changes the video's.
  const events: [number, Point, boolean][] = [
    ...fit.take.mouse.map(([time, x, y, click]): [number, Point, boolean] => [sceneTimeOf(fit, time), { x, y }, click === 1]),
    ...fit.pins.map(([scene, time]): [number, Point, boolean] => [scene, takeMouseAt(fit.take, time), false]),
  ].sort((a, b) => a[0] - b[0]);
  const keys: [number, Point, { click?: boolean }][] = [];
  for (const [at, p, click] of events) {
    const last = keys[keys.length - 1];
    // A click lands where the glide ended, and a hold maps several take moments to one scene time: one key each.
    if (last && at <= last[0] + 1e-3) keys[keys.length - 1] = [last[0], p, { click: last[2].click || click }];
    else keys.push([at, p, { click }]);
  }
  return (
    <>
      {fit.take.keys.map((time, i) => <Sfx key={i} sound={SFX.key} id={i} at={sceneTimeOf(fit, time)} t={t} volume={0.7} event="key" />)}
      <CursorPath view={view} t={t} keys={keys} alpha={alpha} />
    </>
  );
}

/** A page point just below the view's box, down and right of `toward`: where a cursor enters from off screen. */
export function offscreen(view: View, toward: Point): Point {
  const p = screenPoint(view, toward), b = view.box;
  return pagePoint(view, { x: p.x + (b.x + b.w - p.x) * 0.4, y: b.y + b.h + 60 });
}

// ---------- emphasis ----------

/**
 * A glowing ring around a screen rect that draws itself on (`k` 0..1, raw: it eases the draw) and fades with `alpha`.
 * `name` is what a scene's `expect` refers to it by, and its track's name unless `motion` gives another. The rect comes
 * from a view (`screenRect`) or a live element (`useScreenRect`); null draws nothing. Say `through` when the rect isn't
 * straight from `screenRect`: its view, or `screen` for one in screen coordinates that no camera moves. `pad` gives way
 * at the frame's edge, or `box`'s (a panel's view box), so a subject flush with it is ringed just inside; the rect
 * itself never shrinks, so one off the frame still fails the framing check.
 */
export function Highlight({ rect, k, color = INK, pad = 10, radius = 12, alpha = 1, name, box, through, motion }: {
  rect: Rect | null;
  name?: string;
  through?: View | 'screen';
  motion?: string | false;
  box?: Rect;
  k: number;
  color?: string;
  pad?: number;
  radius?: number;
  alpha?: number;
}) {
  const frame = fullFrameRect(useVideoFormat());
  if (!rect || k <= 0 || alpha <= 0) return null;
  const r = padWithin(rect, pad, box ?? frame);
  const perimeter = 2 * (r.w + r.h);
  return (
    <svg
      data-framing="subject"
      data-name={name}
      data-strength={Math.min(k, alpha)}
      {...pieceMotionAttrs(motion ?? name, 'highlight', { kind: 'highlight', values: { draw: k }, through: throughOf(rect, through) })}
      style={{ position: 'absolute', left: r.x, top: r.y, overflow: 'visible', opacity: alpha, pointerEvents: 'none' }}
      width={r.w}
      height={r.h}
    >
      <rect
        width={r.w}
        height={r.h}
        rx={radius}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={`${perimeter * motionCurves.cubic.entrance(k)} ${perimeter}`}
        style={{ filter: `drop-shadow(0 0 18px ${color})` }}
      />
    </svg>
  );
}

/** `rect` grown by `pad`, except where that would cross `box`'s edge: there the padding stops at it. */
function padWithin(rect: Rect, pad: number, box: Rect): Rect {
  const grown = inflate(rect, pad);
  const x0 = Math.max(grown.x, Math.min(rect.x, box.x)), y0 = Math.max(grown.y, Math.min(rect.y, box.y));
  const x1 = Math.min(grown.x + grown.w, Math.max(rect.x + rect.w, box.x + box.w));
  const y1 = Math.min(grown.y + grown.h, Math.max(rect.y + rect.h, box.y + box.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The camera a screen rect moves with: the one it says, else the view `screenRect` aimed it through. A rect from
 * anywhere else (useScreenRect, arithmetic on a screen rect) may be moving with a camera, so that's unknown.
 */
const throughOf = (rect: Rect, through: View | 'screen' | undefined) => (through === 'screen' ? undefined : through ?? viewOfScreenRect(rect) ?? 'unknown');

/** Dims everything but a screen rect by `k`, eased; null draws nothing. `through` is as Highlight's. */
export function Spotlight({ rect, k, pad = 16, radius = 14, dim = 0.45, through, motion }: {
  rect: Rect | null;
  k: number;
  pad?: number;
  radius?: number;
  dim?: number;
  through?: View | 'screen';
  motion?: string | false;
}) {
  const frame = useVideoFormat();
  if (!rect || k <= 0) return null;
  const hole = inflate(rect, pad);
  return (
    <svg style={frameFill(frame)} width={frame.width} height={frame.height}>
      <path d={`M0,0 H${frame.width} V${frame.height} H0 Z ${roundRectPath(hole, radius)}`} fillRule="evenodd" fill={`rgba(12, 22, 38, ${dim * k})`} />
      {/* The dimmed area is the whole frame, so the track is the hole it leaves. */}
      <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} fill="none"
        {...pieceMotionAttrs(motion, 'spotlight', { kind: 'spotlight', values: { dim: dim * k }, through: throughOf(rect, through) })} />
    </svg>
  );
}

// ---------- labels and text ----------

/** A small pill label, e.g. "Today" / "With sale-only view", its top-left at (x, y). `k` is raw: it eases its rise. */
export function Tag({ text, x, y, k, bg = INK, fg = '#fff', size = 30, motion }: { text: string; x: number; y: number; k: number; bg?: string; fg?: string; size?: number; motion?: string | false }) {
  if (k <= 0) return null;
  const h = size * 1.9;
  return (
    <div
      data-framing="tag"
      data-strength={k}
      {...pieceMotionAttrs(motion, text, { kind: 'tag', values: { k } })}
      style={{
        position: 'absolute',
        left: x,
        top: y + (1 - motionCurves.cubic.entrance(k)) * 16,
        height: h,
        padding: `0 ${size * 0.65}px`,
        borderRadius: h / 2,
        background: bg,
        color: fg,
        font: `600 ${size}px/${h + 2}px ${FONT}`,
        whiteSpace: 'nowrap',
        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        opacity: clamp(k),
      }}
    >
      {text}
    </div>
  );
}

/**
 * One line of text with a fade-and-rise entrance (`k` 0..1, raw: it eases the rise). `(x, y)` is the start of its
 * baseline, or its middle or end with `align`, so type sits on a grid the way a designer sets it.
 */
export function Text({ text, x, y, size = 64, weight = 700, color = '#fff', k = 1, align = 'left', spacing = -0.01, stagger, motion }: {
  text: string;
  x: number;
  y: number;
  size?: number;
  weight?: number;
  color?: string;
  k?: number;
  align?: 'left' | 'center' | 'right';
  spacing?: number;
  /** Its place among lines brought in one after another, for the motion tracks. */
  stagger?: StaggerMembership;
  motion?: string | false;
}) {
  const frame = useVideoFormat();
  if (k <= 0) return null;
  return (
    <svg style={{ ...frameFill(frame), opacity: clamp(k) }} width={frame.width} height={frame.height}>
      <text
        {...pieceMotionAttrs(motion, text, { kind: 'text', values: { k }, stagger })}
        x={x}
        y={y + (1 - motionCurves.cubic.entrance(k)) * size * 0.35}
        fill={color}
        textAnchor={align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end'}
        style={{ font: `${weight} ${size}px ${FONT}`, letterSpacing: `${spacing * size}px`, whiteSpace: 'pre' }}
      >
        {text}
      </text>
    </svg>
  );
}

// ---------- surfaces ----------

/** Frosted glass over whatever the scene has drawn beneath it, inside a rounded rect. */
export function Glass({ rect, radius = 28, blur = 30, tint = 'rgba(255,255,255,0.55)', alpha = 1, motion }: { rect: Rect; radius?: number; blur?: number; tint?: string; alpha?: number; motion?: string | false }) {
  if (alpha <= 0) return null;
  return (
    <div
      {...pieceMotionAttrs(motion, 'glass', { kind: 'glass' })}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: radius,
        backdropFilter: `blur(${blur}px)`,
        background: tint,
        boxShadow: '0 20px 60px rgba(10, 20, 40, 0.25), inset 0 0 0 1.5px rgba(255,255,255,0.8)',
        opacity: alpha,
      }}
    />
  );
}

/** A gradient wash across the frame from (x0, y0) to (x1, y1), for text over footage. `color` is "r, g, b". */
export function Wash({ color, from, to, x0 = 0, y0 = 0, x1, y1 = 0 }: { color: string; from: number; to: number; x0?: number; y0?: number; x1?: number; y1?: number }) {
  const id = useId();
  const frame = useVideoFormat();
  return (
    <svg style={frameFill(frame)} width={frame.width} height={frame.height}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x0} y1={y0} x2={x1 ?? frame.width} y2={y1}>
          <stop offset={0} stopColor={`rgb(${color})`} stopOpacity={from} />
          <stop offset={1} stopColor={`rgb(${color})`} stopOpacity={to} />
        </linearGradient>
      </defs>
      <rect width={frame.width} height={frame.height} fill={`url(#${id})`} />
    </svg>
  );
}
