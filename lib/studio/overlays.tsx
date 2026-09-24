// overlays.tsx: what a scene draws over its captures, in screen coordinates: cursors, highlights, spotlights, tags,
// text, frosted glass and washes. Each takes its progress (`k`, 0..1) as a prop and holds no state.
//
// Highlights and tags carry data-framing, which the framing check (probe.tsx) measures: a highlight marks what the
// voice is describing, so one under a tag or the caption, or off the frame, is a shot nobody can follow.

import { useId, type CSSProperties, type ReactNode } from 'react';
import { assertKeysInOrder, inflate, pagePoint, screenPoint, type Point, type Rect, type View } from './camera.ts';
import { FONT, H, W } from './frame.ts';
import { clamp, easeOut, lerp, seg } from './motion.ts';

const INK = '#1c365e';
const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: W, height: H, overflow: 'visible', pointerEvents: 'none' };

/** An SVG rounded-rect path, for shapes a plain <rect> can't make (cut-outs). */
const roundRectPath = ({ x, y, w, h }: Rect, r: number) =>
  `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} ` +
  `H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

/**
 * Draws its children in screen coordinates, clipped to `box`, the way a panel clips its capture. Overlays aimed
 * through a panel's view go inside, so the framing check sees a ring cut off by the panel's edge.
 */
export function ClipToBox({ box, children }: { box: Rect; children: ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: -box.x, top: -box.y, width: W, height: H }}>{children}</div>
    </div>
  );
}

// ---------- cursor ----------

/** A pointer at a screen point. `press` 0..1 squeezes it for a click. */
export function Cursor({ at, press = 0, alpha = 1 }: { at: Point; press?: number; alpha?: number }) {
  const s = 1.55 * (1 - 0.12 * press);
  return (
    <svg style={{ ...fill, opacity: alpha }} width={W} height={H}>
      <g transform={`translate(${at.x} ${at.y}) scale(${s})`}>
        <path d="M0 0 L0 22 L5.5 17 L9.5 26 L13 24.5 L9 16 L16 16 Z" fill="#111" style={{ filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.35))' }} />
        <path d="M0 0 L0 22 L5.5 17 L9.5 26 L13 24.5 L9 16 L16 16 Z" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * An expanding ring where a click landed; `k` 0..1 over its life. The click point itself is a subject for the
 * framing check while the ring is fresh, so a click under the caption or outside its panel fails.
 */
export function ClickRipple({ at, k, color = INK }: { at: Point; k: number; color?: string }) {
  if (k <= 0 || k >= 1) return null;
  return (
    <svg style={{ ...fill, opacity: (1 - k) * 0.55 }} width={W} height={H}>
      <circle cx={at.x} cy={at.y} r={10 + 44 * easeOut(k)} fill="none" stroke={color} strokeWidth={4} />
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

/** A cursor moving through page-space waypoints over a view, pressing and rippling where it clicks. */
export function CursorPath({ view, t, keys, alpha = 1 }: { view: View; t: number; keys: readonly CursorKey[]; alpha?: number }) {
  if (alpha <= 0) return null;
  const clicks = keys.filter(([, , opts]) => opts?.click);
  const press = Math.max(0, ...clicks.map(([kt]) => 1 - Math.abs(t - kt) / CLICK_PRESS));
  return (
    <>
      {clicks.map(([kt, p], i) => <ClickRipple key={i} at={screenPoint(view, p)} k={(t - kt) / RIPPLE_LIFE} />)}
      <Cursor at={screenPoint(view, cursorAt(t, keys))} press={clamp(press)} alpha={alpha} />
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
 * A glowing ring around a screen rect that draws itself on (`k` 0..1) and fades with `alpha`. `name` is what a
 * scene's `expect` refers to it by.
 */
export function Highlight({ rect, k, color = INK, pad = 10, radius = 12, alpha = 1, name }: {
  rect: Rect;
  name?: string;
  k: number;
  color?: string;
  pad?: number;
  radius?: number;
  alpha?: number;
}) {
  if (k <= 0 || alpha <= 0) return null;
  const r = inflate(rect, pad);
  const perimeter = 2 * (r.w + r.h);
  return (
    <svg
      data-framing="subject"
      data-name={name}
      data-strength={Math.min(k, alpha)}
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
        strokeDasharray={`${perimeter * easeOut(k)} ${perimeter}`}
        style={{ filter: `drop-shadow(0 0 18px ${color})` }}
      />
    </svg>
  );
}

/** Dims everything but a screen rect, to pull the eye to it. */
export function Spotlight({ rect, k, pad = 16, radius = 14, dim = 0.45 }: { rect: Rect; k: number; pad?: number; radius?: number; dim?: number }) {
  if (k <= 0) return null;
  return (
    <svg style={fill} width={W} height={H}>
      <path d={`M0,0 H${W} V${H} H0 Z ${roundRectPath(inflate(rect, pad), radius)}`} fillRule="evenodd" fill={`rgba(12, 22, 38, ${dim * k})`} />
    </svg>
  );
}

// ---------- labels and text ----------

/** A small pill label, e.g. "Today" / "With sale-only view", its top-left at (x, y). */
export function Tag({ text, x, y, k, bg = INK, fg = '#fff', size = 30 }: { text: string; x: number; y: number; k: number; bg?: string; fg?: string; size?: number }) {
  if (k <= 0) return null;
  const h = size * 1.9;
  return (
    <div
      data-framing="tag"
      data-strength={k}
      style={{
        position: 'absolute',
        left: x,
        top: y + (1 - easeOut(k)) * 16,
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
 * One line of text with a fade-and-rise entrance (`k` 0..1). `(x, y)` is the start of its baseline, or its middle or
 * end with `align`, so type sits on a grid the way a designer sets it.
 */
export function Text({ text, x, y, size = 64, weight = 700, color = '#fff', k = 1, align = 'left', spacing = -0.01 }: {
  text: string;
  x: number;
  y: number;
  size?: number;
  weight?: number;
  color?: string;
  k?: number;
  align?: 'left' | 'center' | 'right';
  spacing?: number;
}) {
  if (k <= 0) return null;
  return (
    <svg style={{ ...fill, opacity: clamp(k) }} width={W} height={H}>
      <text
        x={x}
        y={y + (1 - easeOut(k)) * size * 0.35}
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
export function Glass({ rect, radius = 28, blur = 30, tint = 'rgba(255,255,255,0.55)', alpha = 1 }: { rect: Rect; radius?: number; blur?: number; tint?: string; alpha?: number }) {
  if (alpha <= 0) return null;
  return (
    <div
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
export function Wash({ color, from, to, x0 = 0, y0 = 0, x1 = W, y1 = 0 }: { color: string; from: number; to: number; x0?: number; y0?: number; x1?: number; y1?: number }) {
  const id = useId();
  return (
    <svg style={fill} width={W} height={H}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x0} y1={y0} x2={x1} y2={y1}>
          <stop offset={0} stopColor={`rgb(${color})`} stopOpacity={from} />
          <stop offset={1} stopColor={`rgb(${color})`} stopOpacity={to} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id})`} />
    </svg>
  );
}
