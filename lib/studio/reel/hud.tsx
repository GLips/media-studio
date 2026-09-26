// hud.tsx: a reel's chrome, after the reference reel's HUD: corner brackets, a title and a readout across the top,
// and a timecode, beat squares, a progress rule and the section label along the bottom. It boots on its first frame
// (the brackets grow from their corners and every text decodes), then keeps time: the squares step on the beats, the
// rule fills, and each section's label decodes in on its downbeat. Nothing in it moves.
//
// It samples no pixels. Each part takes light or dark inks as the scene reads it (`readAt`), from its own layout over
// the part's whole box, as the reference's HUD reads its scene, not auto-contrast. Where the ground under a part is
// busy type, or grounds wanting different inks, which no tone reads across, the scene puts a plate of a ground's colour
// behind the part. `reelHudGrounds` and `reelHudReadGrounds` do the reading for a scene that can name its grounds.

import { MONO_FONT } from '#models/type/faces.ts';
import { clamp, motionCurves, powerOutEase } from '#models/motion/motion.ts';
import { useVideoFormat } from '../composition/video-format.ts';
import { pieceMotionAttrs } from '../probe/motion-tag.ts';
import {
  bracketPath, defaultReadout, hudInks, hudInkSet, hudPlates, LIGHT_READ, REEL_HUD_BOOT_DECODE, REEL_HUD_PALETTE, REEL_HUD_SWAP_DECODE,
  reelHudDecode, reelHudLayout, reelHudLitSquare, reelHudPlateMix, reelHudTimecode, reelHudToneWeights, REFERENCE_SECTIONS, REFERENCE_SPB,
  sectionLabel, type ReelHudCell, type ReelHudLayoutProps, type ReelHudPalette, type ReelHudRead, type ReelHudSlot,
} from '#models/reel/hud.ts';
import type { Rect } from '#models/camera/camera.ts';

export type ReelHudProps = ReelHudLayoutProps & {
  /** Seconds since the HUD boots; nothing draws before 0. */
  t: number;
  /** Seconds the progress rule takes to fill. Ref 15 (8 bars at 128 BPM). */
  duration?: number;
  /**
   * How each slot's part reads at `t`, judged over `box`, the part's box (`reelHudBoxes`): a tone right at one point
   * of a part can vanish over the rest of it. A plate goes where no tone reads, with the tone that reads on the plate
   * (`reelHudToneOver`). Asked 4 times across the first half of this frame: the inks mix by share, and a plate fades
   * in by the share asking for it. Light inks, no plate, if absent.
   */
  readAt?: (slot: ReelHudSlot, t: number, box: Rect) => ReelHudRead;
  /** How much of what's under a plate it hides: 0.75 knocks busy type back to a trace that inks read over. */
  plateOpacity?: number;
  palette?: ReelHudPalette;
  weight?: number;
  /** Seconds: the boot decode, a section's decode, the brackets growing, the rule's track fading in. */
  bootDecode?: number;
  swapDecode?: number;
  bracketDraw?: number;
  trackFade?: number;
  seed?: string | number;
  motion?: string | false;
};

/**
 * The HUD over a reel, above its content and transitions and under the frame post (LensFringe, FilmGrain). Tones,
 * alphas and timings default to the reference's; its alphas are raised (primary text 92% where the reference's is
 * 68%) so the HUD reads at 1080p.
 */
export function ReelHud({
  t, beatOf = (s) => s / REFERENCE_SPB, beatsPerBar = 4, duration = 15, title = 'CLAUDE', subtitle = 'MOTION REEL 2026',
  readout, sections = REFERENCE_SECTIONS, readAt = () => LIGHT_READ, plateOpacity = 0.75, palette = REEL_HUD_PALETTE,
  size = 20, weight = 600, bootDecode = 0.5, swapDecode = 0.3, bracketDraw = 0.25, trackFade = 0.23, seed = 'hud', motion,
}: ReelHudProps) {
  const format = useVideoFormat(), { fps, width, height } = format;
  if (t < 0) return null;
  const text = { readout: readout ?? defaultReadout(beatOf, format), title, subtitle };
  const sectionIndex = sections.findLastIndex((s) => s.at <= t + 1e-6);
  const section = sectionIndex < 0 ? null : sections[sectionIndex];
  const label = section && sectionLabel(sectionIndex, section.title);
  const g = reelHudLayout({ size, ...text, label, beatsPerBar, frame: format });
  const inks = hudInks(palette);
  // The tone and the plate are read from the same samples: each is asked of the scene once.
  const reads = new Map<string, ReelHudRead>();
  const read = (slot: ReelHudSlot, at: number) => {
    const key = `${slot} ${at}`;
    if (!reads.has(key)) reads.set(key, readAt(slot, at, g.boxes[slot]));
    return reads.get(key)!;
  };
  const tone = (slot: ReelHudSlot) => hudInkSet(inks, reelHudToneWeights((at) => read(slot, at).tone, t, fps));
  const tones = { tl: tone('tl'), tr: tone('tr'), timecode: tone('timecode'), beats: tone('beats'), progress: tone('progress'), section: tone('section') };
  const plates = hudPlates(g, (slot) => reelHudPlateMix((at) => read(slot, at).plate, t, fps), plateOpacity);

  const boot = (s: string, key: string) => reelHudDecode(s, t, { duration: bootDecode, schedule: REEL_HUD_BOOT_DECODE, seed: `${seed}:${key}`, fps });
  // A section already current at boot decodes with the rest; a later one swaps in, faster.
  const labelCells = section && label && (section.at <= 0
    ? boot(label, `section${sectionIndex}`)
    : reelHudDecode(label, t - section.at, { duration: swapDecode, schedule: REEL_HUD_SWAP_DECODE, seed: `${seed}:section${sectionIndex}`, fps }));

  const arm = g.stroke + (g.arm - g.stroke) * motionCurves.cubic.entrance(t / bracketDraw);
  const lit = reelHudLitSquare(beatOf(t), beatsPerBar);
  const progress = clamp(t / duration);
  const trackIn = powerOutEase(2)(t / trackFade);

  return (
    <svg
      width={width} height={height}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: MONO_FONT, fontSize: size, fontWeight: weight, fontFeatureSettings: '"zero"' }}
      {...pieceMotionAttrs(motion, 'hud', { kind: 'reel-hud', values: { progress, beat: lit, section: sectionIndex, plates: plates.length } })}
    >
      {plates.map((p) => <rect key={`${p.x} ${p.y}`} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.color} fillOpacity={p.opacity} />)}
      <path d={bracketPath(g.inset, g.inset, 1, 1, arm, g.stroke)} fill={tones.tl.bracket} />
      <path d={bracketPath(width - g.inset, g.inset, -1, 1, arm, g.stroke)} fill={tones.tr.bracket} />
      <path d={bracketPath(g.inset, height - g.inset, 1, -1, arm, g.stroke)} fill={tones.timecode.bracket} />
      <path d={bracketPath(width - g.inset, height - g.inset, -1, -1, arm, g.stroke)} fill={tones.section.bracket} />

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
