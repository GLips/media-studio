// kit.tsx: shots that recur across videos, built from the primitives. Each takes its colours and words as props, so
// a project brings its own brand, and each is a pure function of its clock. Text-bearing shots keep clear of
// CAPTION_SAFE_TOP, where burned-in captions sit.

import type { ReactNode } from 'react';
import { camFit, camTop, camWhole, centerOf, lerpCam, view, type Rect, type Shot, type View } from './camera.ts';
import { Capture, CaptureMotion } from './capture.tsx';
import { CAPTION_FREE, CAPTION_SAFE_TOP, FONT, H, W } from './frame.ts';
import { clamp, easeInOut, easeOut, seg } from './motion.ts';
import { ClipToBox, CursorPath, Glass, Tag, Text, Wash } from './overlays.tsx';
import type { SceneClock } from './timeline.ts';

// ---------- split: before and after, side by side ----------

// The labels live in their own strip above the panels, so a label can never cover the page it names.
export const SPLIT_LABEL_STRIP = 92;
export const SPLIT_LEFT: Rect = { x: 0, y: SPLIT_LABEL_STRIP, w: W / 2 - 2, h: H - SPLIT_LABEL_STRIP };
export const SPLIT_RIGHT: Rect = { x: W / 2 + 2, y: SPLIT_LABEL_STRIP, w: W / 2 - 2, h: H - SPLIT_LABEL_STRIP };

/** `over` is what's drawn on this panel (captures, rings, its cursor), clipped to it. */
export type SplitSide = { view: View; label?: string; labelBg?: string; alpha?: number; over?: ReactNode };

/**
 * Before and after, side by side. Build each side's view in SPLIT_LEFT / SPLIT_RIGHT (camFit takes the box), and aim
 * each side's `over` through the same view. `k` fades the labels in; `children` draw over both panels, unclipped.
 */
export function SplitCompare({ left, right, k = 1, children }: { left: SplitSide; right: SplitSide; k?: number; children?: ReactNode }) {
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: SPLIT_LABEL_STRIP, background: '#eef1f5' }} />
      <div style={{ position: 'absolute', left: W / 2 - 2, top: 0, width: 4, height: H, background: '#d5d9e0' }} />
      <div style={{ position: 'absolute', left: 0, top: SPLIT_LABEL_STRIP - 2, width: W, height: 2, background: '#d5d9e0' }} />
      {[left, right].map((side, i) => (
        <ClipToBox key={i} box={side.view.box}>
          <Capture view={side.view} alpha={side.alpha ?? 1} />
          {side.over}
        </ClipToBox>
      ))}
      {children}
      {[left, right].map((side, i) =>
        side.label ? <Tag key={i} text={side.label} x={side.view.box.x + 32} y={(SPLIT_LABEL_STRIP - 53) / 2} k={k} bg={side.labelBg} size={28} /> : null,
      )}
    </>
  );
}

// ---------- phone ----------

const BEZEL = 14;

/**
 * The view of a viewport capture (see `scrollY` in lib/capture.ts) on a phone screen centred at (cx, cy). `height`
 * is the whole device in frame pixels. Pass it to <Phone>, and aim highlights through it.
 */
export function phoneView(shot: Shot, { cx = W / 2, cy = H / 2 + 10, height = 980 }: { cx?: number; cy?: number; height?: number } = {}): View {
  const h = height - BEZEL * 2, w = h * (shot.w / shot.h);
  const box = { x: cx - w / 2, y: cy - h / 2, w, h };
  return view(shot, camWhole(shot, box), box);
}

/** A phone showing a phoneView. */
export function Phone({ view: v, alpha = 1 }: { view: View; alpha?: number }) {
  if (alpha <= 0) return null;
  const { box } = v;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: alpha }}>
      <div
        style={{
          position: 'absolute',
          left: box.x - BEZEL,
          top: box.y - BEZEL,
          width: box.w + BEZEL * 2,
          height: box.h + BEZEL * 2,
          borderRadius: 64,
          background: '#15171b',
          boxShadow: '0 24px 70px rgba(10, 20, 40, 0.35)',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(${box.y}px ${W - box.x - box.w}px ${H - box.y - box.h}px ${box.x}px round 50px)` }}>
        <Capture view={v} />
      </div>
    </div>
  );
}

// ---------- whole shots ----------

/**
 * An opening title over a capture scrolling top to bottom, with a directional motion smear masked into the
 * bottom-left behind the type: the product stays visible, and the title sits on motion instead of a flat card.
 * `wash` is an "r, g, b" string for the darkening gradient.
 */
export function MotionTitle({ s, shot, eyebrow, title, subtitle, accent, wash = '16, 30, 54' }: {
  s: SceneClock;
  shot: Shot;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  accent: string;
  wash?: string;
}) {
  const top = camTop(shot);
  const bottom = { ...top, cy: shot.h - top.cy };
  const k = s.t / (s.dur + 0.5);
  const cam = lerpCam(top, bottom, k);
  // The block hangs from the accent bar, which sits a clear gap above the caption band.
  const barY = CAPTION_SAFE_TOP - 120;
  const inK = (at: number) => seg(s.t, at, at + 0.7, easeOut);
  return (
    <>
      <Capture view={view(shot, cam)} />
      {/* The smear fades out toward the top right: this gradient is the canvas line from (0, H) to (0.75W, 0),
          restated on CSS's gradient line, which for 53.13° runs 2184px through the frame's centre. */}
      <div style={{ position: 'absolute', inset: 0, maskImage: 'linear-gradient(53.13deg, #000 0%, rgba(0,0,0,0.85) 37.09%, transparent 82.42%)' }}>
        <CaptureMotion view={view(shot, cam)} from={lerpCam(top, bottom, k - 0.05)} to={cam} k={1} shutter={1} samples={48} />
      </div>
      <Wash color={wash} from={0.9} to={0.3} x0={0} y0={H} x1={W * 0.95} y1={0} />
      {eyebrow && <Text text={eyebrow} x={120} y={barY - 230} size={26} weight={600} color="rgba(255,255,255,0.75)" k={inK(0.3)} spacing={0.12} />}
      <Text text={title} x={114} y={barY - 110} size={124} weight={800} k={inK(0.5)} spacing={-0.025} />
      {subtitle && <Text text={subtitle} x={120} y={barY - 35} size={42} weight={500} color="rgba(255,255,255,0.88)" k={inK(0.8)} />}
      <div style={{ position: 'absolute', left: 120, top: barY, width: 150 * inK(1.0), height: 8, background: accent }} />
    </>
  );
}

/**
 * A page that the cursor clicks, which then blurs out under a tinted wash: the backdrop for closing glass cards.
 * `frame` is the page rect the camera holds on, `target` the rect clicked, `from` the cursor's start offset from the
 * target, `push` a slow zoom over 18s so the backdrop never sits dead still. Pass a later `t` to resume mid-push.
 */
export function ClickToBlur({ t, shot, frame, target, clickAt = 1.3, from = { dx: -220, dy: 160 }, blur = 34, wash = '22, 40, 70', push = 1.08 }: {
  t: number;
  shot: Shot;
  frame: Rect;
  target: Rect;
  clickAt?: number;
  from?: { dx: number; dy: number };
  blur?: number;
  wash?: string;
  push?: number;
}) {
  const start = camFit(shot, frame, { pad: 80, maxZoom: 1.25 });
  const cam = lerpCam(start, { ...start, zoom: start.zoom * push }, seg(t, 0, 18));
  const v = view(shot, cam);
  const k = seg(t, clickAt + 0.3, clickAt + 1.4);
  const p = centerOf(target);
  return (
    <>
      <Capture view={v} blur={blur * k} />
      {t < clickAt + 0.6 && <CursorPath view={v} t={t} keys={[[0, { x: p.x + from.dx, y: p.y + from.dy }], [clickAt - 0.1, p], [clickAt, p, { click: true }]]} />}
      {/* Without the wash, a white glass card over a white page reads as a smudge rather than a pane. */}
      <Wash color={wash} from={0.62 * k} to={0.38 * k} />
    </>
  );
}

/**
 * A frosted card with an eyebrow and a few big lines that stagger in. `k` 0..1 drives the entrance. A point can be
 * `{ text, k }` to come in on its own cue instead, e.g. `on(s.t, s.line('why-b').start - 0.3)` as the voice reaches it.
 */
export function GlassCard({ k, eyebrow, points, accent, ink, rect = { x: (W - 1120) / 2, y: 270, w: 1120, h: 540 } }: {
  k: number;
  eyebrow: string;
  points: readonly (string | { text: string; k: number })[];
  accent: string;
  ink: string;
  rect?: Rect;
}) {
  if (k <= 0) return null;
  const y0 = rect.y + (1 - easeOut(k)) * 40;
  return (
    <>
      <Glass rect={{ ...rect, y: y0 }} alpha={clamp(k * 1.4)} tint="rgba(255,255,255,0.78)" blur={24} />
      <Text text={eyebrow} x={rect.x + 88} y={y0 + 126} size={28} weight={700} color={accent} k={k} spacing={0.1} />
      {points.map((p, i) => (
        <Text key={i} text={typeof p === 'string' ? p : p.text} x={rect.x + 88} y={y0 + 250 + i * 104} size={60} weight={700} color={ink}
          k={typeof p === 'string' ? clamp((k - 0.15 * (i + 1)) / 0.6) : Math.min(k, p.k)} spacing={-0.015} />
      ))}
    </>
  );
}

/**
 * A full-frame card naming the section that follows, e.g. "3 / 6 · Finding a color". It holds for `hold` seconds of
 * scene time, then slides up to uncover the scene drawn beneath it. Start the scene's first line during the hold, so
 * the voice carries straight on and the card costs no time.
 */
export function SectionCard({ t, number, of, title, bg, accent, hold = 1.3 }: { t: number; number: number; of: number; title: string; bg: string; accent: string; hold?: number }) {
  const out = seg(t, hold, hold + 0.55, easeInOut);
  if (out >= 1) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translateY(${-out * H}px)` }}>
      <div style={{ position: 'absolute', inset: 0, background: bg }} />
      <Text text={`${number} / ${of}`} x={160} y={H / 2 - 70} size={34} weight={700} color={accent} k={seg(t, 0, 0.5, easeOut)} spacing={0.08} />
      <Text text={title} x={154} y={H / 2 + 50} size={112} weight={800} k={seg(t, 0.1, 0.6, easeOut)} spacing={-0.025} />
      <div style={{ position: 'absolute', left: 160, top: H / 2 + 100, width: 150 * seg(t, 0.3, 0.8, easeOut), height: 8, background: accent }} />
    </div>
  );
}

/**
 * The browser's own confirm() box, which a screenshot can't catch because it isn't part of the page. `anchor` is the
 * screen point its top centre drops from (a real one sits under the address bar). `k` 0..1 brings it in.
 */
export function ConfirmDialog({ k, origin, message, anchor = { x: W / 2, y: 120 } }: { k: number; origin: string; message: string; anchor?: { x: number; y: number } }) {
  if (k <= 0) return null;
  const w = 640, pad = 34;
  const button = (primary: boolean) => ({
    height: 52,
    padding: '0 30px',
    borderRadius: 26,
    font: `600 24px/52px ${FONT}`,
    background: primary ? '#0b57d0' : '#fff',
    color: primary ? '#fff' : '#0b57d0',
    boxShadow: primary ? undefined : 'inset 0 0 0 2px #c4c7c5',
  });
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: clamp(k) }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)' }} />
      <div
        style={{
          position: 'absolute',
          left: anchor.x - w / 2,
          top: anchor.y + (1 - easeOut(k)) * -20,
          width: w,
          padding: pad,
          borderRadius: 16,
          background: '#fff',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          color: '#1f1f1f',
          fontFamily: FONT,
        }}
      >
        <div style={{ font: `600 28px/34px ${FONT}`, marginBottom: 16 }}>{origin} says</div>
        <div style={{ font: `400 26px/36px ${FONT}` }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, marginTop: 36 }}>
          <div style={button(false)}>Cancel</div>
          <div style={button(true)}>OK</div>
        </div>
      </div>
    </div>
  );
}

/**
 * A native <select> menu, open, which a screenshot can't catch: the page's own option names (see `data` in
 * lib/capture.ts) in a plain list dropped from screen rect `from`. `scroll` 0..1 runs the list from top to bottom.
 */
export function NativeMenu({ k, from, items, scroll = 0, rowH = 34, bottom = CAPTION_FREE.h }: { k: number; from: Rect; items: readonly string[]; scroll?: number; rowH?: number; bottom?: number }) {
  if (k <= 0) return null;
  const y = from.y + from.h + 4;
  const h = Math.min(bottom - y, items.length * rowH + 12);
  const offset = scroll * Math.max(0, items.length * rowH + 12 - h);
  return (
    <div
      style={{
        position: 'absolute',
        left: from.x,
        top: y,
        width: from.w,
        height: h * easeOut(k),
        overflow: 'hidden',
        borderRadius: 10,
        background: '#fbfbfb',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
        opacity: clamp(k),
        color: '#1f1f1f',
        font: `400 ${Math.round(rowH * 0.56)}px/${rowH}px ${FONT}`,
      }}
    >
      <div style={{ padding: '6px 18px', transform: `translateY(${-offset}px)`, whiteSpace: 'nowrap' }}>
        {items.map((item, i) => <div key={i} style={{ height: rowH }}>{item}</div>)}
      </div>
    </div>
  );
}

/** A solid card with one centred line, faded in by `k`: the last frame. */
export function EndCard({ k, title, bg }: { k: number; title: string; bg: string }) {
  if (k <= 0) return null;
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: bg, opacity: k }} />
      <Text text={title} x={W / 2} y={H / 2 + 30} size={96} weight={800} align="center" k={k} spacing={-0.025} />
    </>
  );
}
