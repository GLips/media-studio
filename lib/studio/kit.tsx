// kit.tsx: shots that recur across videos, built from the primitives. Each takes its colours and words as props, so
// a project brings its own brand, and each is a pure function of its clock. Text-bearing shots keep clear of
// CAPTION_SAFE_TOP, where burned-in captions sit. Each tags what moves in it for the motion tracks (motion-tag.ts).

import { evolvePath } from '@remotion/paths';
import { Fragment, useId, type ReactNode } from 'react';
import { camFit, camTop, camWhole, centerOf, lerpCam, view, type Rect, type Shot, type View } from './camera.ts';
import { Capture, CaptureMotion } from './capture.tsx';
import { DISPLAY_FONT } from './fonts.ts';
import { CAPTION_FREE, CAPTION_SAFE_TOP, FONT, FPS, FULL_FRAME, H, W } from './frame.ts';
import { clamp, lerp, motionCurves, motionDurations, seg, stagger, staggerFinish } from './motion.ts';
import { motionAttrs, pieceMotionAttrs } from './motion-tag.ts';
import { odometerSinceLanding, odometerWheels, type OdometerMode, type OdometerWheel } from './odometer-wheels.ts';
import { ClipToBox, CursorPath, Glass, Tag, Text, Wash } from './overlays.tsx';
import type { SceneClock } from './timeline.ts';

export type { OdometerMode } from './odometer-wheels.ts';

// ---------- split: before and after, side by side ----------

// The labels live in their own strip above the panels, so a label can never cover the page it names.
export const SPLIT_LABEL_STRIP = 92;
export const SPLIT_LEFT: Rect = { x: 0, y: SPLIT_LABEL_STRIP, w: W / 2 - 2, h: H - SPLIT_LABEL_STRIP };
export const SPLIT_RIGHT: Rect = { x: W / 2 + 2, y: SPLIT_LABEL_STRIP, w: W / 2 - 2, h: H - SPLIT_LABEL_STRIP };

/** `over` is what's drawn on this panel (captures, rings, its cursor), clipped to it. */
export type SplitSide = { view: View; label?: string; labelBg?: string; alpha?: number; over?: ReactNode };

/**
 * Before and after, side by side. Build each side's view in SPLIT_LEFT / SPLIT_RIGHT (camFit takes the box), and aim
 * each side's `over` through the same view. `k` brings the labels in, raw (Tag eases it); `children` draw over both
 * panels, unclipped.
 */
export function SplitCompare({ left, right, k = 1, children }: { left: SplitSide; right: SplitSide; k?: number; children?: ReactNode }) {
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: SPLIT_LABEL_STRIP, background: '#eef1f5' }} />
      <div style={{ position: 'absolute', left: W / 2 - 2, top: 0, width: 4, height: H, background: '#d5d9e0' }} />
      <div style={{ position: 'absolute', left: 0, top: SPLIT_LABEL_STRIP - 2, width: W, height: 2, background: '#d5d9e0' }} />
      {[left, right].map((side, i) => (
        <ClipToBox key={i} box={side.view.box} picked={i === 0 ? 'left' : 'right'}>
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
  const inK = (at: number) => seg(s.t, at, at + 0.7, motionCurves.cubic.entrance);
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
      <div {...motionAttrs({ name: 'accent-bar', kind: 'bar', implicit: true, values: { k: inK(1.0) } })} style={{ position: 'absolute', left: 120, top: barY, width: 150 * inK(1.0), height: 8, background: accent }} />
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
 * A frosted card with an eyebrow and a few big lines that stagger in. `k` 0..1 drives the entrance, raw: the card eases
 * its own rise. A point can be `{ text, k }` to come in on its own cue instead, e.g.
 * `seg(s.t, s.line('why-b').start - 0.3, s.line('why-b').start + 0.3, motionCurves.linear)` as the voice reaches it.
 */
export function GlassCard({ k, eyebrow, points, accent, ink, rect = { x: (W - 1120) / 2, y: 270, w: 1120, h: 540 }, motion }: {
  k: number;
  /** Its group's name in the motion tracks, `card` by default: its glass and lines are tracked under it. */
  motion?: string | false;
  eyebrow: string;
  points: readonly (string | { text: string; k: number })[];
  accent: string;
  ink: string;
  rect?: Rect;
}) {
  if (k <= 0) return null;
  const y0 = rect.y + (1 - motionCurves.cubic.entrance(k)) * 40;
  return (
    // The group is the card's own box, so its track is the card's rise; its contents are laid out in frame pixels.
    <div {...pieceMotionAttrs(motion, 'card', { kind: 'card', values: { k } })} style={{ position: 'absolute', left: rect.x, top: y0, width: rect.w, height: rect.h }}>
      <div style={{ position: 'absolute', left: -rect.x, top: -y0, width: W, height: H }}>
        <Glass rect={{ ...rect, y: y0 }} alpha={clamp(k * 1.4)} tint="rgba(255,255,255,0.78)" blur={24} />
        <Text text={eyebrow} x={rect.x + 88} y={y0 + 126} size={28} weight={700} color={accent} k={k} spacing={0.1} />
        {points.map((p, i) => (
          <Text key={i} text={typeof p === 'string' ? p : p.text} x={rect.x + 88} y={y0 + 250 + i * 104} size={60} weight={700} color={ink}
            k={typeof p === 'string' ? clamp((k - 0.15 * (i + 1)) / 0.6) : Math.min(k, p.k)} spacing={-0.015}
            stagger={{ group: 'points', index: i, count: points.length }} />
        ))}
      </div>
    </div>
  );
}

/**
 * A full-frame card naming the section that follows, e.g. "3 / 6 · Finding a color". It holds for `hold` seconds of
 * scene time, then slides up to uncover the scene drawn beneath it. Start the scene's first line during the hold, so
 * the voice carries straight on and the card costs no time.
 */
export function SectionCard({ t, number, of, title, bg, accent, hold = 1.3 }: { t: number; number: number; of: number; title: string; bg: string; accent: string; hold?: number }) {
  const out = seg(t, hold, hold + 0.55, motionCurves.cubic.standard);
  if (out >= 1) return null;
  return (
    <div {...motionAttrs({ name: 'section-card', kind: 'section-card', implicit: true, values: { out } })} style={{ position: 'absolute', inset: 0, transform: `translateY(${-out * H}px)` }}>
      <div style={{ position: 'absolute', inset: 0, background: bg }} />
      <Text text={`${number} / ${of}`} x={160} y={H / 2 - 70} size={34} weight={700} color={accent} k={seg(t, 0, 0.5, motionCurves.cubic.entrance)} spacing={0.08} />
      <Text text={title} x={154} y={H / 2 + 50} size={112} weight={800} k={seg(t, 0.1, 0.6, motionCurves.cubic.entrance)} spacing={-0.025} />
      <div {...motionAttrs({ name: 'accent-bar', kind: 'bar', implicit: true, values: { k: seg(t, 0.3, 0.8, motionCurves.cubic.entrance) } })}
        style={{ position: 'absolute', left: 160, top: H / 2 + 100, width: 150 * seg(t, 0.3, 0.8, motionCurves.cubic.entrance), height: 8, background: accent }} />
    </div>
  );
}

/**
 * The browser's own confirm() box, which a screenshot can't catch because it isn't part of the page. `anchor` is the
 * screen point its top centre drops from (a real one sits under the address bar). `k` 0..1 brings it in, raw: it eases
 * its drop.
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
        {...motionAttrs({ name: 'dialog', kind: 'dialog', implicit: true, values: { k } })}
        style={{
          position: 'absolute',
          left: anchor.x - w / 2,
          top: anchor.y + (1 - motionCurves.cubic.entrance(k)) * -20,
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
 * lib/capture.ts) in a plain list dropped from screen rect `from`. `k` opens it, raw: it eases its height. `scroll`
 * 0..1 runs the list from top to bottom, as given.
 */
export function NativeMenu({ k, from, items, scroll = 0, rowH = 34, bottom = CAPTION_FREE.h }: { k: number; from: Rect; items: readonly string[]; scroll?: number; rowH?: number; bottom?: number }) {
  if (k <= 0) return null;
  const y = from.y + from.h + 4;
  const h = Math.min(bottom - y, items.length * rowH + 12);
  const offset = scroll * Math.max(0, items.length * rowH + 12 - h);
  return (
    <div
      {...motionAttrs({ name: 'menu', kind: 'menu', implicit: true, values: { k, scroll } })}
      style={{
        position: 'absolute',
        left: from.x,
        top: y,
        width: from.w,
        height: h * motionCurves.cubic.entrance(k),
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

/** A solid card with one centred line, faded in by `k`, eased (its title eases its rise on top): the last frame. */
export function EndCard({ k, title, bg }: { k: number; title: string; bg: string }) {
  if (k <= 0) return null;
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: bg, opacity: k }} />
      <Text text={title} x={W / 2} y={H / 2 + 30} size={96} weight={800} align="center" k={k} spacing={-0.025} />
    </>
  );
}

// ---------- builds: words, numbers and strokes that come on ----------

/**
 * How a WordReveal staggers: `each` seconds between one word's start and the next (40–80 ms reads as one gesture),
 * `max` capping first start to last, and each word's own fade and rise taking `duration`.
 */
export type WordRevealTiming = { each?: number; max?: number; duration?: number };

const WORD_REVEAL_TIMING = { each: 0.06, duration: motionDurations.enter.small };

/** The words, each split into the pieces that come in one by one: itself, or its letters. */
const wordRevealUnits = (text: string, letters: boolean) =>
  text.split(/\s+/).filter(Boolean).map((word) => (letters ? Array.from(word) : [word]));

/** Seconds after a WordReveal's `t` 0 that its last word has fully come in: to lead a word with it, or hold after it. */
export function wordRevealFinish(text: string, { letters = false, timing }: { letters?: boolean; timing?: WordRevealTiming } = {}) {
  const { each, max, duration } = { ...WORD_REVEAL_TIMING, ...timing };
  return staggerFinish(wordRevealUnits(text, letters).flat().length, { each, max, duration });
}

/**
 * Words that come in one after another, each rising `rise` px as it fades in, easing out. `t` is seconds since the
 * first word starts, raw: it staggers and eases each word itself. `letters` staggers letters, for one short display
 * word only. The words wrap in a box `width` wide, top-left at (x, y), laid out whole from its first frame, so nothing
 * shifts as they arrive.
 */
export function WordReveal({ t, text, x, y, width, size = 64, weight = 700, color = '#fff', align = 'left', spacing = -0.01, lineHeight = 1.15, rise = 12, letters = false, timing, motion }: {
  t: number;
  text: string;
  x: number;
  y: number;
  width: number;
  size?: number;
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  spacing?: number;
  lineHeight?: number;
  rise?: number;
  letters?: boolean;
  timing?: WordRevealTiming;
  /** Its group's name in the motion tracks, its words by default. `false` tracks neither it nor its words. */
  motion?: string | false;
}) {
  if (t <= 0) return null;
  const words = wordRevealUnits(text, letters);
  const n = words.flat().length;
  const { each, max, duration } = { ...WORD_REVEAL_TIMING, ...timing };
  const firsts = words.map((_, w) => words.slice(0, w).flat().length);
  return (
    <div
      {...pieceMotionAttrs(motion, text, { kind: 'word-reveal', values: { k: clamp(t / wordRevealFinish(text, { letters, timing })) } })}
      style={{ position: 'absolute', left: x, top: y, width, textAlign: align, color, font: `${weight} ${size}px/${lineHeight} ${FONT}`, letterSpacing: `${spacing * size}px` }}
    >
      {words.map((units, w) => (
        <Fragment key={w}>
          {w > 0 && ' '}
          <span style={{ whiteSpace: 'nowrap' }}>
            {units.map((unit, u) => {
              const index = firsts[w] + u;
              const p = clamp((t - stagger(index, n, { each, max })) / duration);
              const e = motionCurves.cubic.entrance(p);
              const tag = motion === false ? {} : pieceMotionAttrs(undefined, `${index} ${unit}`, { kind: letters ? 'letter' : 'word', values: { k: p }, stagger: { group: 'words', index, count: n } });
              return <span key={u} {...tag} style={{ display: 'inline-block', opacity: e, transform: `translateY(${(1 - e) * rise}px)` }}>{unit}</span>;
            })}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

// Archivo, in em. CSS centres its 0.878 ascent + 0.21 descent in a 1 em row, putting the baseline 0.834 down; its
// lining digits run from 0.012 below the baseline to 0.698 above, so a 0.009 nudge down centres them on the row,
// 0.355 either side of its middle.
const BASELINE_EM = 0.834;
const DIGIT_NUDGE_EM = 0.009;
/**
 * An Odometer's digits in em of its `size`: their top over the baseline, and their height (Archivo's lining digits
 * reach 0.012 under it). A count whose digits stand 300 px tall takes `size` 300 / ODOMETER_DIGIT_EM.height.
 */
export const ODOMETER_DIGIT_EM = { top: 0.698, height: 0.71 } as const;
// The window reaches this far either side of the row's middle (a landed digit and a hair), plus the fade, so a fade of
// any length misses a landed digit. A neighbour one row off starts at 0.645, where the default fade has reached nothing.
const DIGIT_HALF_EM = 0.365;
// A group separator's width in digit widths (Archivo's comma is 300 units to a digit's 576), so it follows the axes.
const SEPARATOR_CH = 0.52;
// A box smear `travel` rows long spreads like a Gaussian of σ = travel / √12. Past σ of a row a turning wheel is
// already an even haze, so more would only cost render time.
const SMEAR_SIGMA_PER_ROW = 1 / Math.sqrt(12);
const SMEAR_SIGMA_MAX_ROWS = 1;

export type OdometerProps = {
  /** Seconds on the piece's clock: the time `value` is read at. */
  t: number;
  /**
   * The number shown at any time on `t`'s clock, on any curve: `(t) => lerp(2, 1.6, seg(t, 1, 1.7,
   * motionCurves.expo.entrance))`. It's also read frames either side, for the smear and cells, and across a roll.
   * Non-negative; land it on whole units of its last place.
   */
  value: (t: number) => number;
  /** The baseline's left end, centre or right end, by `align`. */
  x: number;
  y: number;
  /** Font size in px. Digits stand 0.71 of it (ODOMETER_DIGIT_EM): 430 makes them 300 px, 28% of frame height. */
  size?: number;
  align?: 'left' | 'center' | 'right';
  color?: string;
  /** Archivo's weight (100–900) and width (`stretch`, 62–125 %): both continuous, so either can move with the value. */
  weight?: number;
  stretch?: number;
  /** Em between characters. Digits sit in fixed cells whatever it is, so nothing shifts as they change. */
  tracking?: number;
  decimals?: number;
  /** Thousands separators. */
  group?: boolean;
  /** Characters either side that stay still while the wheels roll: `$`, `%`, `×`. */
  prefix?: string;
  suffix?: string;
  /**
   * `mechanical` (default): the ones blur past, the tens click over. `direct`: each wheel rolls straight to its new
   * digit, the calm walkthrough roll (a mechanical 0 → 1,299 is a haze). `slot`: `spin` extra turns, locking left to
   * right `lockStagger` seconds apart. Direct and slot lock crisply on `motionCurves.cubic.entrance`; on expo's long
   * tail the wheels creep in.
   */
  mode?: OdometerMode;
  spin?: number;
  lockStagger?: number;
  /**
   * A moving wheel's smear, as a share of its travel over the last frame. 1 (default) smears all of it, so no step
   * between frames goes unseen; 0 turns it off.
   */
  blur?: number;
  /**
   * How far past a landed digit's top and bottom the window fades out, in em, so digits roll in and out of the dark.
   * 0.28 (default, and the most before a landed digit's neighbours show) is soft; the reference's 8–12 px feather on
   * 300 px digits is 0.03; 0 is a hard slot.
   */
  fade?: number;
  /** Scale added at the peak of a punch as the value lands: 0.06 is the reference's 1.00 → 1.06 → 1.00. 0: no punch. */
  punch?: number;
  /** The punch's length; the reference's is 8–10 frames. */
  punchFrames?: number;
  alpha?: number;
  /** Its name in the motion tracks, `count` by default. Its track reports `value`, so a scene can `expect` it to hold. */
  motion?: string | false;
};

/**
 * A number as digit wheels rolling in a window, each digit smeared along its travel and pin-sharp once landed. Drive
 * `value` with any curve: a walkthrough's total rolls 1.2–2.5 s in `direct` mode; a reel's price rolls 18–24 frames
 * (`motionCurves.expo.entrance`) and punches 1.06 on the downbeat it lands on. Keep bounce off the value: it's data.
 */
export function Odometer({
  t, value, x, y, size = 160, align = 'left', color = '#fff', weight = 800, stretch = 100, tracking = -0.02, decimals = 0, group = true,
  prefix = '', suffix = '', mode = 'mechanical', spin = 2, lockStagger = 2 / FPS, blur = 1, fade = 0.28, punch = 0, punchFrames = 9,
  alpha = 1, motion,
}: OdometerProps) {
  const id = `odometer-${useId().replace(/[^\w-]/g, '')}`;
  if (alpha <= 0) return null;
  const wheels = odometerWheels(value, t, { decimals, mode, spin: Math.round(spin), lockStagger });
  const landed = punch ? odometerSinceLanding(value, t, punchFrames / FPS, decimals) : null;
  const scale = landed === null ? 1 : 1 + punch * punchEnvelope((landed * FPS) / punchFrames);
  const nudge = DIGIT_NUDGE_EM * size;
  const still = (key: string, text: string, presence = 1) => <OdometerStill key={key} text={text} presence={presence} size={size} tracking={tracking} nudge={nudge} />;

  const cells: ReactNode[] = [];
  if (prefix) cells.push(still('prefix', prefix));
  for (let place = wheels.length - 1; place >= 0; place--) {
    const wheel = wheels[place];
    if (wheel.presence < 0.001) continue;
    cells.push(<OdometerWheelCell key={place} wheel={wheel} filterId={`${id}-${place}`} size={size} tracking={tracking} nudge={nudge} blur={blur} fade={fade} />);
    const aboveOnes = place - decimals;
    if (group && aboveOnes > 0 && aboveOnes % 3 === 0) cells.push(still(`group-${place}`, ',', wheel.presence));
    if (place === decimals && decimals > 0) cells.push(still('point', '.'));
  }
  if (suffix) cells.push(still('suffix', suffix));

  return (
    <div
      {...pieceMotionAttrs(motion, 'count', { kind: 'odometer', values: { value: value(t) } })}
      style={{
        position: 'absolute',
        left: x,
        top: y - (BASELINE_EM + DIGIT_NUDGE_EM) * size,
        display: 'flex',
        height: size,
        transform: `translateX(${align === 'left' ? 0 : align === 'center' ? -50 : -100}%) scale(${scale})`,
        opacity: alpha,
        color,
        fontFamily: DISPLAY_FONT,
        fontSize: size,
        lineHeight: `${size}px`,
        fontWeight: weight,
        fontStretch: `${stretch}%`,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'pre',
      }}
    >
      {cells}
    </div>
  );
}

/** 0 → 1 → 0 across a punch: up in its first quarter, easing out, then settling back over the rest. */
const punchEnvelope = (p: number) => (p < 0.25 ? 1 - (1 - p / 0.25) ** 2 : 1 - motionCurves.dissolve((p - 0.25) / 0.75));

/**
 * One wheel: a strip of digit rows one em apart behind a window, in a cell a fixed digit width. It sits at the middle
 * of its last frame's travel, blurred vertically along it, so a step within a frame shows as a smear.
 */
function OdometerWheelCell({ wheel, filterId, size, tracking, nudge, blur, fade }: {
  wheel: OdometerWheel;
  filterId: string;
  size: number;
  tracking: number;
  nudge: number;
  blur: number;
  fade: number;
}) {
  const mid = (wheel.at + wheel.was) / 2;
  const sigmaRows = Math.min(SMEAR_SIGMA_MAX_ROWS, blur * SMEAR_SIGMA_PER_ROW * Math.abs(wheel.at - wheel.was));
  const sigma = sigmaRows * size;
  // Under a third of a pixel the blur can't be seen: leaving it off keeps a landed digit pin-sharp.
  const blurred = sigma >= 0.3;
  // A landed digit's height plus `fade` above and below it, centred on the row; shorter than the row for a hard slot.
  const windowEm = 2 * (DIGIT_HALF_EM + fade);
  const overhang = ((windowEm - 1) / 2) * size;
  // Every row whose digit or smear can reach into the window.
  const reach = windowEm / 2 + 0.5 + 3 * sigmaRows;
  const first = Math.floor(mid - reach), last = Math.ceil(mid + reach);
  const [lo, hi] = wheel.digitRows;
  const rows: ReactNode[] = [];
  for (let row = first; row <= last; row++) rows.push(<div key={row} style={{ height: size }}>{row >= lo && row <= hi ? ((row % 10) + 10) % 10 : ''}</div>);
  return (
    <div style={{ position: 'relative', flex: 'none', width: `calc(${wheel.presence} * (1ch + ${tracking}em))`, height: size }}>
      <div
        style={{
          position: 'absolute',
          top: -overhang,
          left: '50%',
          width: '1.4ch',
          height: windowEm * size,
          transform: `translateX(-50%) scaleX(${wheel.presence})`,
          // Squeezed thin, a spinning wheel's haze would read as a bright rule; a place fades as it grows in.
          opacity: wheel.presence,
          maskImage: odometerWindowMask(fade / windowEm),
        }}
      >
        {blurred && (
          <svg width={0} height={0} style={{ position: 'absolute' }}>
            <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={`0 ${sigma}`} />
            </filter>
          </svg>
        )}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            textAlign: 'center',
            transform: `translateY(${(first - mid) * size + overhang + nudge}px)`,
            willChange: 'transform',
            filter: blurred ? `url(#${filterId})` : undefined,
          }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}

/**
 * Opaque in the middle, fading to nothing over `share` of the window at each end. The fade eases in (alpha = s², s
 * running 0 → 1 from the edge inward), so the sliver of a digit leaving on a slow landing is already faint.
 */
function odometerWindowMask(share: number): string {
  const ramp = [0, 0.25, 0.5, 0.75, 1];
  const top = ramp.map((s) => `rgba(0,0,0,${s * s}) ${s * share * 100}%`);
  const bottom = ramp.map((s) => `rgba(0,0,0,${s * s}) ${100 - s * share * 100}%`).reverse();
  return `linear-gradient(${[...top, ...bottom].join(', ')})`;
}

/**
 * A character that doesn't roll (`$`, `.`, `,`) on the digits' baseline. A separator comes and goes with the place
 * before it, squeezing to nothing rather than popping.
 */
function OdometerStill({ text, presence, size, tracking, nudge }: { text: string; presence: number; size: number; tracking: number; nudge: number }) {
  return (
    <div
      style={{
        flex: 'none',
        height: size,
        letterSpacing: `${tracking}em`,
        transform: `translateY(${nudge}px)${presence < 1 ? ` scaleX(${presence})` : ''}`,
        transformOrigin: '0 50%',
        marginRight: presence < 1 ? `calc(${presence - 1} * ${SEPARATOR_CH}ch)` : undefined,
        opacity: presence,
      }}
    >
      {text}
    </div>
  );
}

/**
 * A stroke that draws itself on along SVG path `d`, from its start. `k` 0..1 is raw: it eases the draw. `d` is in
 * `box`'s own pixels (the whole frame by default), or in `viewBox`'s units when given, to draw an icon's `0 0 24 24`
 * path into `box`; `width` is frame pixels either way. Draw-on only: a morph between paths is built directly.
 */
export function DrawPath({ d, k, color = '#fff', width = 6, box = FULL_FRAME, viewBox, alpha = 1, motion }: {
  d: string;
  k: number;
  color?: string;
  width?: number;
  box?: Rect;
  viewBox?: string;
  alpha?: number;
  /** Its name in the motion tracks, `path` by default. Its track reports `draw`, the raw `k`. */
  motion?: string | false;
}) {
  if (k <= 0 || alpha <= 0) return null;
  // Drawn whole at `k` 1 without dashes: evolvePath's length can fall short of the browser's, leaving the tip undrawn.
  const [, , vw, vh] = viewBox ? viewBox.trim().split(/[\s,]+/).map(Number) : [0, 0, box.w, box.h];
  // The stroke is in viewBox units. vector-effect="non-scaling-stroke" would keep it in frame pixels, but would also
  // move the dashes that draw it out of the path's own length.
  const scale = Math.min(box.w / vw, box.h / vh);
  return (
    <svg style={{ position: 'absolute', left: box.x, top: box.y, overflow: 'visible', opacity: alpha, pointerEvents: 'none' }} width={box.w} height={box.h} viewBox={viewBox ?? `0 0 ${vw} ${vh}`}>
      <path
        {...pieceMotionAttrs(motion, 'path', { kind: 'path', values: { draw: k } })}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={width / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(k < 1 && evolvePath(motionCurves.cubic.entrance(k), d))}
      />
    </svg>
  );
}
