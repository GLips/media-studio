// hud.tsx: a reel's chrome, after the reference reel's HUD: corner brackets, a title and a readout across the top,
// and a timecode, beat squares, a progress rule and the section label along the bottom. It boots on its first frame
// (the brackets grow from their corners and every text decodes), then keeps time: the squares step on the beats, the
// rule fills, and each section's label decodes in on its downbeat. Nothing in it moves.
//
// It samples no pixels. Each part takes light or dark inks from `toneAt`, which the scene answers from its own layout
// (the ground under each slot anchor), as the reference's HUD reads its scene, not auto-contrast.

import { FPS, H, W } from '../frame.ts';
import { MONO_FONT } from '../fonts.ts';
import { clamp, motionCurves } from '../motion.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { scrambleAt } from './type.tsx';

/** The HUD's parts, each with its own tone. The brackets go with the slot nearest them (tl, tr, timecode, section). */
export type ReelHudSlot = 'tl' | 'tr' | 'timecode' | 'beats' | 'progress' | 'section';
export const REEL_HUD_SLOTS: readonly ReelHudSlot[] = ['tl', 'tr', 'timecode', 'beats', 'progress', 'section'];

/**
 * 'light' is paper inks for a dark ground, 'dark' ink inks for a light one. 'on-accent' is the light inks with a
 * paper lit square, for a ground in the accent colour, where an accent square would vanish.
 */
export type ReelHudTone = 'light' | 'dark' | 'on-accent';

/** A section label, shown as `NN — TITLE` from `at` (seconds since boot) until the next one: one a bar in the ref. */
export type ReelHudSection = { at: number; title: string };

export type ReelHudPalette = { ink: string; paper: string; accent: string };

/**
 * What the decode draws from: text, number and punctuation glyphs, and a few currency signs for texture. The
 * reference's ₵ is ¢ here: JetBrains Mono lacks ₵, and a fallback face's glyph would stand out mid-scramble.
 */
export const REEL_HUD_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+/<=>[]{}¥₿¢₽≠‡';

/**
 * When cell i of n shows and settles, as a share of the decode: it appears at `reveal`·i/n and locks from `lock` on,
 * one after another to the end. Measured on the reference: boot 0.7 / 0.35, a section swap 0.61 / 0.28.
 */
export type ReelHudDecodeSchedule = { reveal: number; lock: number };
export const REEL_HUD_BOOT_DECODE: ReelHudDecodeSchedule = { reveal: 0.7, lock: 0.35 };
export const REEL_HUD_SWAP_DECODE: ReelHudDecodeSchedule = { reveal: 0.61, lock: 0.28 };

export type ReelHudProps = {
  /** Seconds since the HUD boots; nothing draws before 0. */
  t: number;
  /**
   * The fractional beat at `t` (seconds since boot); square `floor(beat) mod beatsPerBar` is lit. Pass the video's own
   * clock, e.g. one that leads the tracker by the frame or two its hits do. Default 128 BPM from boot (the reference).
   */
  beatOf?: (t: number) => number;
  beatsPerBar?: number;
  /** Seconds the progress rule takes to fill. Ref 15 (8 bars at 128 BPM). */
  duration?: number;
  /** The timecode's frame rate: FF runs 00 to fps − 1. */
  fps?: number;
  title?: string;
  subtitle?: string;
  /** The top-right readout. Default `N BPM   fps FPS   1920×1080`, N from `beatOf`. */
  readout?: string;
  sections?: readonly ReelHudSection[];
  /** Each slot's tone at `t`. Sampled 4 times across the first half of this frame, and the inks mixed by share. */
  toneAt?: (slot: ReelHudSlot, t: number) => ReelHudTone;
  palette?: ReelHudPalette;
  /**
   * Text px; every length (insets, brackets, squares, rule) scales with it from the reference's 14. Default 20 (1.85%
   * of frame height), which reads at 960×540; the reference's 14 px (1.3%) doesn't.
   */
  size?: number;
  weight?: number;
  /** Seconds: the boot decode, a section's decode, the brackets growing, the rule's track fading in. */
  bootDecode?: number;
  swapDecode?: number;
  bracketDraw?: number;
  trackFade?: number;
  seed?: string | number;
  motion?: string | false;
};

const REFERENCE_SPB = 60 / 128;

const REFERENCE_SECTIONS: readonly ReelHudSection[] = [
  'SQUASH & STRETCH', 'KINETIC TYPE', 'GENERATIVE GRID', '3D / DEPTH', 'VARIABLE FONTS', 'PARTICLES ×12 000', 'EDIT / RHYTHM', 'HIRE ME',
].map((title, k) => ({ at: 4 * k * REFERENCE_SPB, title }));

/**
 * The HUD over a reel, above its content and transitions and under the frame post (LensFringe, FilmGrain). Tones,
 * alphas and timings default to the reference's; its alphas are raised (primary text 92% where the reference's is
 * 68%) so the HUD reads at 1080p.
 */
export function ReelHud({
  t, beatOf = (s) => s / REFERENCE_SPB, beatsPerBar = 4, duration = 15, fps = FPS, title = 'CLAUDE', subtitle = 'MOTION REEL 2026',
  readout, sections = REFERENCE_SECTIONS, toneAt = () => 'light', palette = { ink: '#0a0a0c', paper: '#e8e5df', accent: '#e34920' },
  size = 20, weight = 600, bootDecode = 0.5, swapDecode = 0.3, bracketDraw = 0.25, trackFade = 0.23, seed = 'hud', motion,
}: ReelHudProps) {
  if (t < 0) return null;
  const text = { readout: readout ?? defaultReadout(beatOf, fps), title, subtitle };
  const g = reelHudLayout({ size, ...text, sections });
  const inks = hudInks(palette);
  const tone = (slot: ReelHudSlot) => hudInkSet(inks, reelHudToneWeights(toneAt, slot, t, fps));
  const tones = { tl: tone('tl'), tr: tone('tr'), timecode: tone('timecode'), beats: tone('beats'), progress: tone('progress'), section: tone('section') };

  const boot = (s: string, key: string) => reelHudDecode(s, t, { duration: bootDecode, schedule: REEL_HUD_BOOT_DECODE, seed: `${seed}:${key}`, fps });
  const sectionIndex = sections.findLastIndex((s) => s.at <= t + 1e-6);
  const section = sectionIndex < 0 ? null : sections[sectionIndex];
  const label = section && sectionLabel(sectionIndex, section.title);
  // A section already current at boot decodes with the rest; a later one swaps in, faster.
  const labelCells = section && label && (section.at <= 0
    ? boot(label, `section${sectionIndex}`)
    : reelHudDecode(label, t - section.at, { duration: swapDecode, schedule: REEL_HUD_SWAP_DECODE, seed: `${seed}:section${sectionIndex}`, fps }));

  const arm = g.stroke + (g.arm - g.stroke) * motionCurves.cubic.entrance(t / bracketDraw);
  const lit = reelHudLitSquare(beatOf(t), beatsPerBar);
  const progress = clamp(t / duration);
  const trackIn = 1 - (1 - clamp(t / trackFade)) ** 2;

  return (
    <svg
      width={W} height={H}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: MONO_FONT, fontSize: size, fontWeight: weight, fontFeatureSettings: '"zero"' }}
      {...pieceMotionAttrs(motion, 'hud', { kind: 'reel-hud', values: { progress, beat: lit, section: sectionIndex } })}
    >
      <path d={bracketPath(g.inset, g.inset, 1, 1, arm, g.stroke)} fill={tones.tl.bracket} />
      <path d={bracketPath(W - g.inset, g.inset, -1, 1, arm, g.stroke)} fill={tones.tr.bracket} />
      <path d={bracketPath(g.inset, H - g.inset, 1, -1, arm, g.stroke)} fill={tones.timecode.bracket} />
      <path d={bracketPath(W - g.inset, H - g.inset, -1, -1, arm, g.stroke)} fill={tones.section.bracket} />

      <HudCells cells={boot(title, 'title')} x={g.titleX} advance={g.advance} y={g.topBaseline} fill={tones.tl.primary} />
      <HudCells cells={boot(subtitle, 'subtitle')} x={g.subtitleX} advance={g.advance} y={g.topBaseline} fill={tones.tl.secondary} />
      <HudCells cells={boot(text.readout, 'readout')} x={g.readoutX} advance={g.advance} y={g.topBaseline} fill={tones.tr.secondary} />
      <HudCells cells={boot(reelHudTimecode(t, fps), 'timecode')} x={g.timecodeX} advance={g.timecodeAdvance} y={g.bottomBaseline} fill={tones.timecode.primary} />
      {labelCells && <HudCells cells={labelCells} x={g.labelRight - (labelCells.length - 1) * g.advance - g.glyph} advance={g.advance} y={g.bottomBaseline} fill={tones.section.primary} />}

      {Array.from({ length: beatsPerBar }, (_, j) => {
        const x = g.squaresX + j * g.pitch, y = g.bottomY - g.square / 2;
        return j === lit
          ? <rect key={j} x={x} y={y} width={g.square} height={g.square} fill={tones.beats.lit} />
          : <rect key={j} x={x + g.squareStroke / 2} y={y + g.squareStroke / 2} width={g.square - g.squareStroke} height={g.square - g.squareStroke} fill="none" stroke={tones.beats.square} strokeWidth={g.squareStroke} />;
      })}
      <rect x={g.ruleX} y={g.bottomY - g.rule / 2} width={g.ruleW} height={g.rule} fill={tones.progress.track} opacity={trackIn} />
      <rect x={g.ruleX} y={g.bottomY - g.rule / 2} width={g.ruleW * progress} height={g.rule} fill={tones.progress.fill} />
    </svg>
  );
}

/** The point each slot's tone should be judged at (the middle of its part), for a scene answering `toneAt`. */
export function reelHudAnchors(props: Pick<ReelHudProps, 'size' | 'title' | 'subtitle' | 'readout' | 'sections'> & { beatOf?: ReelHudProps['beatOf']; fps?: number } = {}): Record<ReelHudSlot, { x: number; y: number }> {
  const { size = 20, title = 'CLAUDE', subtitle = 'MOTION REEL 2026', sections = REFERENCE_SECTIONS, beatOf = (s: number) => s / REFERENCE_SPB, fps = FPS } = props;
  const g = reelHudLayout({ size, title, subtitle, readout: props.readout ?? defaultReadout(beatOf, fps), sections });
  return g.anchors;
}

/** HH:MM:SS:FF of `t` seconds, FF counting frames 00 to fps − 1. */
export function reelHudTimecode(t: number, fps: number): string {
  // The epsilon keeps a frame's own time from rounding down to the frame before.
  const frame = Math.floor(Math.max(0, t) * fps + 1e-6);
  const s = Math.floor(frame / fps);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}:${two(frame % fps)}`;
}

/** The lit square for fractional beat `beat`: it steps on the first frame at or after each beat. Negative beats too. */
export const reelHudLitSquare = (beat: number, beatsPerBar: number) => ((Math.floor(beat + 1e-6) % beatsPerBar) + beatsPerBar) % beatsPerBar;

export type ReelHudCell = { char: string; state: 'hidden' | 'new' | 'scramble' | 'locked' };

/**
 * A decode `since` seconds after it starts, over `duration` whatever the text's length: cells appear left to right
 * (`new` on their first frame), show a glyph re-rolled every frame, and lock left to right onto `text`. Spaces stay
 * blank. The locking and the glyphs are type.tsx's `scrambleAt`; the reveal front ahead of it is the HUD's.
 */
export function reelHudDecode(text: string, since: number, { duration, schedule, seed, fps }: { duration: number; schedule: ReelHudDecodeSchedule; seed: string | number; fps: number }): ReelHudCell[] {
  const chars = [...text];
  const turns = Math.max(1, chars.filter((c) => c.trim()).length);
  // scrambleAt locks the k-th non-space character at delay + k·each: the schedule's lock front, spread over `duration`.
  const shown = scrambleAt(text, since, {
    seed, charset: REEL_HUD_GLYPHS, rate: fps, delay: (schedule.lock + (1 - schedule.lock) / turns) * duration, each: ((1 - schedule.lock) * duration) / turns,
  });
  return shown.map(({ char, locked }, i) => {
    if (locked || !chars[i].trim()) return { char: chars[i], state: 'locked' };
    const reveal = ((schedule.reveal * i) / chars.length) * duration;
    if (since < reveal - 1e-6) return { char: '', state: 'hidden' };
    return { char, state: since < reveal + 1 / fps - 1e-6 ? 'new' : 'scramble' };
  });
}

/**
 * The share of each tone across the first half of the frame at `t` (4 samples), which the slot's inks are mixed by.
 * A flip between frames softens over one frame, as the reference's sub-frame blend does; a tone that changes exactly
 * on a frame (a cut) flips on that frame, whether the scene rounds or floors `t` to frames.
 */
export function reelHudToneWeights(toneAt: (slot: ReelHudSlot, t: number) => ReelHudTone, slot: ReelHudSlot, t: number, fps: number, samples = 4): Record<ReelHudTone, number> {
  const weights: Record<ReelHudTone, number> = { light: 0, dark: 0, 'on-accent': 0 };
  for (let i = 0; i < samples; i++) weights[toneAt(slot, t + (i / samples) * (0.5 / fps))] += 1 / samples;
  return weights;
}

// ---------- layout ----------

// The reference's geometry at its 14 px text, in px of the 1920×1080 frame; `size` scales all of it.
const REF = {
  size: 14, inset: 43, arm: 25, stroke: 2, topY: 55, bottomUp: 53.5,
  textX: 84, subtitleGap: 24, timecodeX: 85, right: 84,
  squaresX: 264, square: 9, pitch: 15, squareStroke: 1, ruleX: 334, ruleRight: 465, rule: 2,
};
// Per em of `size`: a label's cell (JetBrains Mono's 0.6 em plus ≈0.1 em of tracking), the timecode's tighter one,
// the glyph's own advance, and its cap height.
const EM = { advance: 0.7, timecodeAdvance: 0.674, glyph: 0.6, cap: 0.73 };

function reelHudLayout({ size, title, subtitle, readout, sections }: { size: number; title: string; subtitle: string; readout: string; sections: readonly ReelHudSection[] }) {
  const k = size / REF.size;
  const whole = (v: number) => Math.max(1, Math.round(v * k));
  const inset = whole(REF.inset), arm = whole(REF.arm), stroke = whole(REF.stroke);
  const advance = EM.advance * size, timecodeAdvance = EM.timecodeAdvance * size, glyph = EM.glyph * size;
  const topY = REF.topY * k, bottomY = H - REF.bottomUp * k;
  const baseline = (y: number) => y + (EM.cap * size) / 2;
  const width = (s: string, adv = advance) => ([...s].length - 1) * adv + glyph;
  const right = W - REF.right * k;

  const titleX = REF.textX * k;
  const subtitleX = titleX + [...title].length * advance + REF.subtitleGap * k;
  const readoutX = right - width(readout);
  const timecodeX = REF.timecodeX * k;
  const square = whole(REF.square), pitch = Math.round(REF.pitch * k), squaresX = Math.round(REF.squaresX * k);
  const ruleX = Math.round(REF.ruleX * k), ruleW = Math.round(W - REF.ruleRight * k) - ruleX;
  const longest = Math.max(0, ...sections.map((s, i) => width(sectionLabel(i, s.title))));
  const mid = (a: number, b: number) => (a + b) / 2;

  return {
    inset, arm, stroke, advance, timecodeAdvance, glyph, topY, bottomY, topBaseline: baseline(topY), bottomBaseline: baseline(bottomY),
    titleX, subtitleX, readoutX, timecodeX, labelRight: right,
    square, pitch, squaresX, squareStroke: Math.round(REF.squareStroke * k * 2) / 2, ruleX, ruleW, rule: whole(REF.rule),
    anchors: {
      tl: { x: mid(titleX, subtitleX + width(subtitle)), y: topY },
      tr: { x: mid(readoutX, right), y: topY },
      timecode: { x: REF.timecodeX * k + width('00:00:00:00', timecodeAdvance) / 2, y: bottomY },
      beats: { x: squaresX + (3 * pitch + square) / 2, y: bottomY },
      progress: { x: ruleX + ruleW / 2, y: bottomY },
      section: { x: right - longest / 2, y: bottomY },
    } satisfies Record<ReelHudSlot, { x: number; y: number }>,
  };
}

const sectionLabel = (i: number, title: string) => `${String(i + 1).padStart(2, '0')} — ${title}`;

const defaultReadout = (beatOf: (t: number) => number, fps: number) => `${Math.round((60 * (beatOf(8) - beatOf(0))) / 8)} BPM   ${fps} FPS   1920×1080`;

/** An L from its outer corner (x, y), arms running `dx`, `dy` (±1), `arm` px long including the stroke. */
function bracketPath(x: number, y: number, dx: number, dy: number, arm: number, stroke: number) {
  return `M${x} ${y}H${x + dx * arm}V${y + dy * stroke}H${x + dx * stroke}V${y + dy * arm}H${x}Z`;
}

// ---------- drawing ----------

// A cell's brightness by state, from the reference: a new cell's first frame at half, a scrambling glyph at 87%.
const CELL_ALPHA = { new: 0.5, scramble: 0.87, locked: 1 } as const;

/** One text's cells, each at its own place so a scramble glyph never reflows the line: an svg text per state. */
function HudCells({ cells, x, advance, y, fill }: { cells: ReelHudCell[]; x: number; advance: number; y: number; fill: string }) {
  const runs = (['locked', 'scramble', 'new'] as const).map((state) => {
    const run = cells.flatMap((c, i) => (c.state === state && c.char.trim() ? [{ char: c.char, x: x + i * advance }] : []));
    return { state, chars: run.map((c) => c.char).join(''), xs: run.map((c) => c.x.toFixed(2)).join(' ') };
  });
  return (
    <>
      {runs.map((r) => r.chars && <text key={r.state} x={r.xs} y={y} fill={fill} fillOpacity={CELL_ALPHA[r.state]}>{r.chars}</text>)}
    </>
  );
}

// ---------- inks ----------

type HudInkRole = 'primary' | 'secondary' | 'bracket' | 'fill' | 'track' | 'square' | 'lit';
type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

// Alphas of the paper (light) or ink (dark) colour per role. The reference's, for 14 px: light 68 / 57 / 60 / 52 / 11 /
// 40 / 73%, dark 50 / 45 / 60 / 46 / 8 / 40 / 62%. Raised so 20 px text reads at 1080p and at half that.
const INK_ALPHA: Record<'light' | 'dark', Record<HudInkRole, number>> = {
  light: { primary: 0.92, secondary: 0.72, bracket: 0.8, fill: 0.8, track: 0.2, square: 0.55, lit: 1 },
  dark: { primary: 0.88, secondary: 0.66, bracket: 0.75, fill: 0.7, track: 0.14, square: 0.5, lit: 0.85 },
};

function hudInks(palette: ReelHudPalette): Record<ReelHudTone, Record<HudInkRole, Rgba>> {
  const [ink, paper, accent] = [palette.ink, palette.paper, palette.accent].map(hexRgb);
  const set = (base: 'light' | 'dark', colour: Rgb, lit: Rgb) => Object.fromEntries((Object.keys(INK_ALPHA.light) as HudInkRole[]).map((role) => {
    const [r, g, b] = role === 'lit' ? lit : colour;
    return [role, [r, g, b, INK_ALPHA[base][role]] as const];
  })) as Record<HudInkRole, Rgba>;
  return { light: set('light', paper, accent), dark: set('dark', ink, ink), 'on-accent': set('light', paper, paper) };
}

/** Each role's colour mixed across tones by `weights`, averaged as premultiplied colour so a half mix isn't muddy. */
function hudInkSet(inks: Record<ReelHudTone, Record<HudInkRole, Rgba>>, weights: Record<ReelHudTone, number>): Record<HudInkRole, string> {
  const out = {} as Record<HudInkRole, string>;
  for (const role of Object.keys(INK_ALPHA.light) as HudInkRole[]) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const tone of Object.keys(weights) as ReelHudTone[]) {
      const w = weights[tone], [cr, cg, cb, ca] = inks[tone][role];
      if (!w) continue;
      r += w * ca * cr; g += w * ca * cg; b += w * ca * cb; a += w * ca;
    }
    out[role] = a > 0 ? `rgba(${Math.round(r / a)}, ${Math.round(g / a)}, ${Math.round(b / a)}, ${a.toFixed(3)})` : 'transparent';
  }
  return out;
}

function hexRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`ReelHud: palette colours are #rgb or #rrggbb, not ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
