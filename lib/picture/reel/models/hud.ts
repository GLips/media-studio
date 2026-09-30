// hud.ts: a reel HUD's pure half: its slots, tones and palette, where each part sits (`reelHudBoxes`, read in plain
// Node for clearance), how a part reads over the grounds a scene names, the decode, timecode and beat square, and the
// inks and plates a frame mixes. Runs without a browser; reel/hud.tsx draws it.

import type { Point, Rect } from '#lib/picture/camera/models/camera.ts';
import type { FrameSize, VideoFormat } from '#lib/picture/frame/models/frame.ts';
import { MONO_ADVANCE_EM, MONO_CAP_EM } from '#lib/picture/type/models/faces.ts';
import { scrambleAt } from './type.ts';

/** The HUD's parts, each with its own tone. The brackets go with the slot nearest them (tl, tr, timecode, section). */
export type ReelHudSlot = 'tl' | 'tr' | 'timecode' | 'beats' | 'progress' | 'section';
export const REEL_HUD_SLOTS: readonly ReelHudSlot[] = ['tl', 'tr', 'timecode', 'beats', 'progress', 'section'];

/**
 * 'light' is paper inks for a dark ground, 'dark' ink inks for a light one. 'on-accent' is the light inks with a
 * paper lit square, for a ground in the accent colour, where an accent square would vanish.
 */
export type ReelHudTone = 'light' | 'dark' | 'on-accent';

/** How a part reads: its tone, and the colour of a plate behind it where no one tone reads over its ground. */
export type ReelHudRead = { tone: ReelHudTone; plate?: string };

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

/** The HUD's text and geometry, as a scene or a check that works out where its parts sit is given them. */
export type ReelHudLayoutProps = {
  /**
   * The fractional beat at `t` (seconds since boot); square `floor(beat) mod beatsPerBar` is lit. Pass the video's own
   * clock, e.g. one that leads the tracker by the frame or two its hits do. Default 128 BPM from boot (the reference).
   */
  beatOf?: (t: number) => number;
  beatsPerBar?: number;
  title?: string;
  subtitle?: string;
  /** The top-right readout. Default `N BPM   fps FPS   width×height`, N from `beatOf` and the rest the video's format. */
  readout?: string;
  sections?: readonly ReelHudSection[];
  /**
   * Text px; every length (insets, brackets, squares, rule) scales with it from the reference's 14. Default 20 (1.85%
   * of frame height), which reads at 960×540; the reference's 14 px (1.3%) doesn't.
   */
  size?: number;
};

export const REFERENCE_SPB = 60 / 128;
export const LIGHT_READ: ReelHudRead = { tone: 'light' };

export const REFERENCE_SECTIONS: readonly ReelHudSection[] = [
  'SQUASH & STRETCH', 'KINETIC TYPE', 'GENERATIVE GRID', '3D / DEPTH', 'VARIABLE FONTS', 'PARTICLES ×12 000', 'EDIT / RHYTHM', 'HIRE ME',
].map((title, k) => ({ at: 4 * k * REFERENCE_SPB, title }));

function reelHudLayoutFor(props: ReelHudLayoutProps, t: number, format: VideoFormat) {
  const { size = 20, title = 'CLAUDE', subtitle = 'MOTION REEL 2026', sections = REFERENCE_SECTIONS, beatOf = (s: number) => s / REFERENCE_SPB, beatsPerBar = 4 } = props;
  const i = sections.findLastIndex((s) => s.at <= t + 1e-6);
  const label = i < 0 ? null : sectionLabel(i, sections[i].title);
  return reelHudLayout({ size, title, subtitle, readout: props.readout ?? defaultReadout(beatOf, format), label, beatsPerBar, frame: format });
}

/**
 * Each part's box at `t` in px of a frame of `format`: its text, squares or rule, the height of a bracket's arm, and
 * from the bracket's outer corner on the corner slots. What `readAt` is asked about, and what a plate covers, with 0.4
 * em to spare. The section label's is the label current at `t`.
 */
export function reelHudBoxes(props: ReelHudLayoutProps, t: number, format: VideoFormat): Record<ReelHudSlot, Rect> {
  return reelHudLayoutFor(props, t, format).boxes;
}

/**
 * A part's box as points, edge to edge: 25 across, at its top, middle and foot. The edges count: the box's margin is
 * the ground its ink is read against, and a card's corner over one glyph or a bracket's arm loses it.
 */
export const reelHudBoxPoints = (box: Rect): Point[] =>
  [0, 0.5, 1].flatMap((v) => Array.from({ length: 25 }, (_, i) => ({ x: box.x + (i / 24) * box.w, y: box.y + v * box.h })));

/**
 * The grounds under a part's box and the share of it each covers, most first: `groundAt` names the ground under a
 * frame point, asked at `reelHudBoxPoints`. Pass one per shutter sample to judge a smear; their counts pool.
 */
export function reelHudGrounds<G extends string>(box: Rect, groundAt: ((p: Point) => G) | readonly ((p: Point) => G)[]): { ground: G; share: number }[] {
  const points = reelHudBoxPoints(box), samplers = typeof groundAt === 'function' ? [groundAt] : groundAt;
  const seen = new Map<G, number>();
  for (const at of samplers) {
    for (const p of points) {
      const ground = at(p);
      seen.set(ground, (seen.get(ground) ?? 0) + 1);
    }
  }
  const n = points.length * samplers.length;
  return [...seen].map(([ground, count]) => ({ ground, share: count / n })).toSorted((a, b) => b.share - a.share);
}

/**
 * A ground a part can sit on: its colour, the tone that reads on it where that isn't `reelHudToneOver`'s, and whether
 * it's `busy` with type or a page's UI, which no tone reads over.
 */
export type ReelHudGround = { color: string; tone?: ReelHudTone; busy?: boolean };

/**
 * How a part reads over `grounds` (`reelHudGrounds`): in the inks, paper (light) or ink (dark, from `inkFrom`), most
 * of its box wants, toned as the largest ground wanting them. It gets a plate of that ground's colour where that
 * ground is busy, or where grounds wanting the other inks cover over `mixed` of it, as no tone reads across both.
 */
export function reelHudReadGrounds<G extends string>(
  grounds: readonly { ground: G; share: number }[],
  looks: Record<G, ReelHudGround>,
  { mixed = 0.05, inkFrom = 0.5, palette = REEL_HUD_PALETTE }: { mixed?: number; inkFrom?: number; palette?: ReelHudPalette } = {},
): ReelHudRead {
  const toneOf = (g: G) => looks[g].tone ?? reelHudToneOver(looks[g].color, palette);
  const wantsInk = grounds.filter((g) => toneOf(g.ground) === 'dark');
  const inkShare = wantsInk.reduce((sum, g) => sum + g.share, 0);
  const inInk = inkShare >= inkFrom;
  const main = (inInk ? wantsInk : grounds.filter((g) => toneOf(g.ground) !== 'dark'))[0].ground;
  const tone = toneOf(main);
  return looks[main].busy || (inInk ? 1 - inkShare : inkShare) > mixed ? { tone, plate: looks[main].color } : { tone };
}

/** The HUD's palette by default: the reference's paper, ink and accent. */
export const REEL_HUD_PALETTE: ReelHudPalette = { ink: '#0a0a0c', paper: '#e8e5df', accent: '#e34920' };

/**
 * The tone whose inks read over a flat ground of `color`, such as a plate: dark inks from luma 114, midway between
 * where the reference's HUD turns dark (130) and light again (98); paper inks below, with a paper lit square on the
 * accent, where the accent's square would vanish.
 */
export function reelHudToneOver(color: string, palette: ReelHudPalette = REEL_HUD_PALETTE): ReelHudTone {
  const [r, g, b] = hexRgb(color), [ar, ag, ab] = hexRgb(palette.accent);
  if (0.2126 * r + 0.7152 * g + 0.0722 * b >= 114) return 'dark';
  return Math.hypot(r - ar, g - ag, b - ab) < 48 ? 'on-accent' : 'light';
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
 * blank. The locking and the glyphs are type.ts's `scrambleAt`; the reveal front ahead of it is the HUD's.
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

/** Where in the frame at `t` a part's tone and plate are judged: 4 times across its first half. */
const subframes = (t: number, fps: number, samples = 4) => Array.from({ length: samples }, (_, i) => t + (i / samples) * (0.5 / fps));

/**
 * The share of each tone across the first half of the frame at `t` (4 samples), which the slot's inks are mixed by.
 * A flip between frames softens over one frame, as the reference's sub-frame blend does; a tone that changes exactly
 * on a frame (a cut) flips on that frame, whether the scene rounds or floors `t` to frames.
 */
export function reelHudToneWeights(toneAt: (t: number) => ReelHudTone, t: number, fps: number): Record<ReelHudTone, number> {
  const weights: Record<ReelHudTone, number> = { light: 0, dark: 0, 'on-accent': 0 };
  const times = subframes(t, fps);
  for (const at of times) weights[toneAt(at)] += 1 / times.length;
  return weights;
}

/** A part's plate across the same samples: its colour, and the share of them it's there for, which fades it in. */
export function reelHudPlateMix(plateAt: (t: number) => string | undefined, t: number, fps: number): { color: string; share: number } | undefined {
  const times = subframes(t, fps);
  const seen = times.flatMap((at) => plateAt(at) ?? []);
  if (!seen.length) return undefined;
  const rgb = [0, 1, 2].map((c) => Math.round(seen.reduce((sum, s) => sum + hexRgb(s)[c], 0) / seen.length));
  return { color: `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`, share: seen.length / times.length };
}

// ---------- layout ----------

// The reference's geometry at its 14 px text, in px of its 1920×1080 frame, measured in from the frame's edges; `size`
// scales all of it.
const REF = {
  size: 14, inset: 43, arm: 25, stroke: 2, topY: 55, bottomUp: 53.5,
  textX: 84, subtitleGap: 24, timecodeX: 85, right: 84,
  squaresX: 264, square: 9, pitch: 15, squareStroke: 1, ruleX: 334, ruleRight: 465, rule: 2,
};
// Per em of `size`: a label's cell (JetBrains Mono's 0.6 em plus ≈0.1 em of tracking), the timecode's tighter one,
// the glyph's own advance, and its cap height.
const EM = { advance: 0.7, timecodeAdvance: 0.674, glyph: MONO_ADVANCE_EM, cap: MONO_CAP_EM };

type HudLayoutInput = {
  size: number; title: string; subtitle: string; readout: string; label: string | null; beatsPerBar: number; frame: FrameSize;
};

export function reelHudLayout({ size, title, subtitle, readout, label, beatsPerBar, frame }: HudLayoutInput) {
  const k = size / REF.size;
  const whole = (v: number) => Math.max(1, Math.round(v * k));
  const inset = whole(REF.inset), arm = whole(REF.arm), stroke = whole(REF.stroke);
  const advance = EM.advance * size, timecodeAdvance = EM.timecodeAdvance * size, glyph = EM.glyph * size;
  const topY = REF.topY * k, bottomY = frame.height - REF.bottomUp * k;
  const baseline = (y: number) => y + (EM.cap * size) / 2;
  const width = (s: string, adv = advance) => ([...s].length - 1) * adv + glyph;
  const right = frame.width - REF.right * k;

  const titleX = REF.textX * k;
  const subtitleX = titleX + [...title].length * advance + REF.subtitleGap * k;
  const readoutX = right - width(readout);
  const timecodeX = REF.timecodeX * k;
  const square = whole(REF.square), pitch = Math.round(REF.pitch * k), squaresX = Math.round(REF.squaresX * k);
  const ruleX = Math.round(REF.ruleX * k), ruleW = Math.round(frame.width - REF.ruleRight * k) - ruleX;
  // Each row is a bracket's arm tall, so a part's box holds its text with room around it and a plate lines up with the corners.
  const top = { y: inset, h: arm }, bottom = { y: frame.height - inset - arm, h: arm };
  const span = (x0: number, x1: number, row: { y: number; h: number }): Rect => ({ x: x0, y: row.y, w: x1 - x0, h: row.h });

  return {
    size, inset, arm, stroke, advance, timecodeAdvance, glyph, topY, bottomY, topBaseline: baseline(topY), bottomBaseline: baseline(bottomY),
    titleX, subtitleX, readoutX, timecodeX, labelRight: right,
    square, pitch, squaresX, squareStroke: Math.round(REF.squareStroke * k * 2) / 2, ruleX, ruleW, rule: whole(REF.rule),
    boxes: {
      tl: span(inset, subtitleX + width(subtitle), top),
      tr: span(readoutX, frame.width - inset, top),
      timecode: span(inset, timecodeX + width('00:00:00:00', timecodeAdvance), bottom),
      beats: span(squaresX, squaresX + (beatsPerBar - 1) * pitch + square, bottom),
      progress: span(ruleX, ruleX + ruleW, bottom),
      // Before the first section there's only the bracket.
      section: span(label ? right - width(label) : frame.width - inset - arm, frame.width - inset, bottom),
    } satisfies Record<ReelHudSlot, Rect>,
  };
}

type HudLayout = ReturnType<typeof reelHudLayout>;
type HudPlate = Rect & { color: string; opacity: number };

// A plate stands 0.4 em clear of its part all round, so a bracket's arms read against the plate, not its edge, and
// half an em past the part's open ends.
const PLATE_MARGIN_EM = 0.4, PLATE_PAD_EM = 0.5;
const PLATE_OPEN: Record<ReelHudSlot, readonly ('left' | 'right')[]> = {
  tl: ['right'], tr: ['left'], timecode: ['right'], beats: ['left', 'right'], progress: ['left', 'right'], section: ['left'],
};

/**
 * The plates behind the parts that have one, padded past their open ends. Plates of one colour less than an em apart
 * in a row join into one, so the squares and the rule beside them sit on a single run rather than two chips.
 */
export function hudPlates(g: HudLayout, mixAt: (slot: ReelHudSlot) => { color: string; share: number } | undefined, opacity: number): HudPlate[] {
  const margin = PLATE_MARGIN_EM * g.size, pad = PLATE_PAD_EM * g.size;
  const plates = REEL_HUD_SLOTS.flatMap((slot): HudPlate[] => {
    const mix = mixAt(slot);
    if (!mix) return [];
    const box = g.boxes[slot], open = PLATE_OPEN[slot];
    const left = box.x - (open.includes('left') ? pad : margin), right = box.x + box.w + (open.includes('right') ? pad : margin);
    return [{ x: left, y: box.y - margin, w: right - left, h: box.h + 2 * margin, color: mix.color, opacity: opacity * mix.share }];
  }).toSorted((a, b) => a.y - b.y || a.x - b.x);
  const joined: HudPlate[] = [];
  for (const p of plates) {
    const last = joined.at(-1);
    if (last && last.y === p.y && last.color === p.color && last.opacity === p.opacity && p.x - (last.x + last.w) < 2 * pad) {
      last.w = Math.max(last.w, p.x + p.w - last.x);
    } else joined.push({ ...p });
  }
  return joined;
}

export const sectionLabel = (i: number, title: string) => `${String(i + 1).padStart(2, '0')} — ${title}`;

export const defaultReadout = (beatOf: (t: number) => number, { fps, width, height }: VideoFormat) =>
  `${Math.round((60 * (beatOf(8) - beatOf(0))) / 8)} BPM   ${fps} FPS   ${width}×${height}`;

/** An L from its outer corner (x, y), arms running `dx`, `dy` (±1), `arm` px long including the stroke. */
export function bracketPath(x: number, y: number, dx: number, dy: number, arm: number, stroke: number) {
  return `M${x} ${y}H${x + dx * arm}V${y + dy * stroke}H${x + dx * stroke}V${y + dy * arm}H${x}Z`;
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

export function hudInks(palette: ReelHudPalette): Record<ReelHudTone, Record<HudInkRole, Rgba>> {
  const [ink, paper, accent] = [palette.ink, palette.paper, palette.accent].map(hexRgb);
  const set = (base: 'light' | 'dark', colour: Rgb, lit: Rgb) => Object.fromEntries((Object.keys(INK_ALPHA.light) as HudInkRole[]).map((role) => {
    const [r, g, b] = role === 'lit' ? lit : colour;
    return [role, [r, g, b, INK_ALPHA[base][role]] as const];
  })) as Record<HudInkRole, Rgba>;
  return { light: set('light', paper, accent), dark: set('dark', ink, ink), 'on-accent': set('light', paper, paper) };
}

/** Each role's colour mixed across tones by `weights`, averaged as premultiplied colour so a half mix isn't muddy. */
export function hudInkSet(inks: Record<ReelHudTone, Record<HudInkRole, Rgba>>, weights: Record<ReelHudTone, number>): Record<HudInkRole, string> {
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
