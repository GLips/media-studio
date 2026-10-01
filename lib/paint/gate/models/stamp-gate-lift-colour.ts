// stamp-gate-lift-colour.ts: the GPU gate's lifted tints, read as colour. In a medium lightened with white a lift
// thins the film toward the paper, white and pigment alike, so a stronger lift never reads darker, the strongest reads
// paler, and a tint grows no more intense nor turns further than thinning it would (vid-122). A dark at full strength
// is held only to paling: thinned, it shows its undertone, warmer and brighter, as a watercolour wash of it does.
// Tints are rows, lifts columns of rising strength over them, the first column left alone; a strip of bare paper below
// is the white each is measured against, so "paler" is nearer the paper.

import { PAINT_MEDIA, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { type StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCase, StampGateWashMedium } from './stamp-gate-washes.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

/** The media lightened with white, whose tints a lift should thin toward the paper. */
export type StampGateLiftColourMedium = Exclude<StampGateWashMedium, 'watercolour'>;

/** The lifts' strengths, column by column after the unlifted first. */
export const STAMP_GATE_LIFT_STRENGTHS = [0.3, 0.6, 0.9] as const;

/** What the lifted tints are held to, in L*a*b* against the paper. */
export const STAMP_GATE_LIFT_PALER = {
  /** How far below the paper's L* each tint must read, so a frame that failed to paint fails rather than passing. */
  painted: 5,
  /** How much darker than the lift before a stronger one may read, in L*: the frame's dither. */
  darker: 0.3,
  /** The least share of the way from the tint to the paper the strongest lift reads. */
  strongest: 0.08,
  /** How much more chroma than the tint a lift may show. */
  intenser: 1,
  /**
   * How many degrees of hue a lift may turn a tint holding at least `chroma`. Thinning these pigments as a watercolour
   * wash turns them 10–18° by a tenth left: the film's own undertone, not a stain's.
   */
  turn: 25,
  chroma: 5,
};

const SIZE = { width: 200, height: 140 };
const PAPER: StampPaintPaper = { color: '#f6f1e6' };
const ROUND = stampGateBrush('Round', { flow: 0.5 });

/** Tints lightened with white (two staining, one not) and a dark at full strength. */
const TINTS: readonly { pigment: PaintPigmentAppearance; strength: number }[] = [
  { pigment: W.ultramarine, strength: 0.4 }, { pigment: W.phthaloBlue, strength: 0.4 }, { pigment: W.quinacridoneRose, strength: 0.4 }, { pigment: W.burntUmber, strength: 1 },
];
const ROW = (r: number) => ({ y0: 8 + r * 28, y1: 30 + r * 28 });
const COLUMNS = [[10, 36], [60, 86], [110, 136], [160, 186]] as const;
const PAPER_STRIP = { x0: 20, x1: 180, y0: 124, y1: 136 };
/** How far in from a cell's edge it's read, clear of where a lift's edge or a neighbouring tint runs. */
const INSET = 5;

const tint = ({ pigment, strength }: (typeof TINTS)[number]): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment, amount: strength }], strength });

/**
 * The tints in `medium`, lifted while wet or, `dried`, once the wash has dried. Its paint doesn't flow: flow running
 * back into a lift evens the paper a wash left showing, which is the flow's to answer for, not the lift's.
 */
function stampGateLiftColourPainting(medium: StampGateLiftColourMedium, dried: boolean): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => p.group('tints', { composite: 'glaze', opacity: 1 }, (g) => g.wash('wash', {}, (wash) => {
    TINTS.forEach((t, r) => {
      const { y0, y1 } = ROW(r);
      wash.fill(`tint-${r}`, { brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(4, y0, 196, y0, 196, y1, 4, y1), material: tint(t), appliedAt: 0, drawnOver: 1 });
    });
    if (dried) wash.wait('dry');
    STAMP_GATE_LIFT_STRENGTHS.forEach((strength, k) => {
      const [x0, x1] = COLUMNS[k + 1];
      wash.lift(`lift-${k}`, { kind: 'stroke', brush: ROUND, diameter: 36, path: [{ x: (x0 + x1) / 2, y: 0 }, { x: (x0 + x1) / 2, y: 122 }], strength, appliedAt: 1, drawnOver: 1 });
    });
  }))));
  const still: PaintMedium = { ...PAINT_MEDIA[medium], wetting: { ...PAINT_MEDIA[medium].wetting, spread: 0 } };
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: still, pigments: W }, ...SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

const linear = (v: number) => (v <= 10.31475 ? v / 3294.6 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const xyz = ([r, g, b]: readonly number[]) => [0.4124 * r + 0.3576 * g + 0.1805 * b, 0.2126 * r + 0.7152 * g + 0.0722 * b, 0.0193 * r + 0.1192 * g + 0.9505 * b];
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** The mean linear RGB of `rgba` over a box. */
function meanLinear(rgba: ArrayLike<number>, width: number, { x0, x1, y0, y1 }: { x0: number; x1: number; y0: number; y1: number }): number[] {
  const sum = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) sum[c] += linear(rgba[(y * width + x) * 4 + c]);
  return sum.map((v) => v / ((x1 - x0) * (y1 - y0)));
}

/** The gate case painting the lifted tints and reading its frame, so the painting and its reading share one layout. */
export function stampGateLiftColourCase(id: string, mid: number, medium: StampGateLiftColourMedium, dried: boolean): StampGateWashCase {
  return { id, mid, property: 'frame', subject: stampGateLiftColourPainting(medium, dried), read: (rgba) => checkStampGateLiftColour(id, rgba) };
}

/** Whether every tint in `rgba` holds STAMP_GATE_LIFT_PALER lift by lift. */
function checkStampGateLiftColour(id: string, rgba: ArrayLike<number>): StampGateWashCheck {
  const { width } = SIZE;
  const white = xyz(meanLinear(rgba, width, PAPER_STRIP));
  const lch = (rgb: readonly number[]) => {
    const [x, y, z] = xyz(rgb).map((v, i) => labF(v / white[i]));
    const a = 500 * (x - y), b = 200 * (y - z);
    return { l: 116 * y - 16, c: Math.hypot(a, b), h: Math.atan2(b, a) * 180 / Math.PI };
  };
  const { painted, darker, strongest, intenser, turn, chroma } = STAMP_GATE_LIFT_PALER;
  const problems: string[] = [], rows: string[] = [];
  TINTS.forEach(({ pigment, strength }, r) => {
    const { y0, y1 } = ROW(r), name = `${pigment.id}@${strength}`;
    const [tinted, ...lifted] = COLUMNS.map(([x0, x1]) => lch(meanLinear(rgba, width, { x0: x0 + INSET, x1: x1 - INSET, y0: y0 + INSET, y1: y1 - INSET })));
    if (!(tinted.l < 100 - painted)) {
      problems.push(`${name} reads L* ${tinted.l.toFixed(1)} unlifted, not ${painted} below the paper: it didn't paint`);
      return;
    }
    const turns = lifted.map(({ c, h }) => (c >= chroma && tinted.c >= chroma ? Math.abs(((h - tinted.h + 540) % 360) - 180) : 0));
    lifted.forEach((cell, k) => {
      const at = `${name} lifted at ${STAMP_GATE_LIFT_STRENGTHS[k]}`, before = k ? lifted[k - 1] : tinted;
      if (cell.l < before.l - darker) problems.push(`${at} reads L* ${cell.l.toFixed(1)}, darker than ${before.l.toFixed(1)}`);
      if (strength >= 1) return;
      if (cell.c > tinted.c + intenser) problems.push(`${at} holds chroma ${cell.c.toFixed(1)}, more than the tint's ${tinted.c.toFixed(1)}`);
      if (turns[k] > turn) problems.push(`${at} turns its hue ${turns[k].toFixed(0)}° (past ${turn}° fails)`);
    });
    const moved = (lifted.at(-1)!.l - tinted.l) / (100 - tinted.l);
    if (moved < strongest) problems.push(`${name}'s strongest lift reads ${moved.toFixed(2)} of the way to the paper (under ${strongest} fails)`);
    rows.push(`${name} L* ${[tinted, ...lifted].map(({ l }) => l.toFixed(1)).join(' → ')} (${moved.toFixed(2)} to paper), C* ${[tinted, ...lifted].map(({ c }) => c.toFixed(1)).join(' → ')}, turns ${turns.map((t) => t.toFixed(0)).join('/')}°`);
  });
  return { id: `${id}: lifts read paler`, passed: !problems.length, detail: `${rows.join('; ')}${problems.length ? `. ${problems.join('; ')}` : ''}` };
}
