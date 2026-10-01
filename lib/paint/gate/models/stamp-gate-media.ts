// stamp-gate-media.ts: the GPU gate's media case (media/mixed). One painting's groups paint in three media: a dark
// watercolour wash, a light gouache wash glazed over part of it, and a crayon stroke apart. Each group, where no other
// group's paint reaches, must draw exactly as it does painted alone in a painting of its own medium; and where the
// gouache lies over the watercolour, it must cover it, as a body colour's scattering film does over a dark.

import { PAINT_MEDIA, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampPigmentMixing } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_MEDIA_IDS = ['media/mixed'] as const;

const SIZE = { width: 240, height: 160 };
const PAPER: StampPaintPaper = { color: '#f6f1e6', grain: { image: { style: 'gate', pack: 'gate', file: 'grain.png' }, scale: 0.15, depth: 0.5 } };
const mixingIn = (medium: PaintMedium): StampPigmentMixing => ({ kind: 'pigment', medium, pigments: W });
const mixture = (strength: number, ...parts: { pigment: PaintPigmentAppearance; amount: number }[]): PaintMaterial => ({ kind: 'mixture', parts, strength });

/** The painting's groups, in painting order, each with the medium it paints in. */
export const STAMP_GATE_MEDIA_GROUPS = ['wash', 'body', 'wax'] as const;
export type StampGateMediaGroup = (typeof STAMP_GATE_MEDIA_GROUPS)[number];
const GROUP_MEDIA = { wash: 'watercolour', body: 'gouache', wax: 'crayon' } as const satisfies Record<StampGateMediaGroup, keyof typeof PAINT_MEDIA>;

/** Where the gouache lies over the watercolour, read clear of either wash's edge. */
export const STAMP_GATE_MEDIA_OVERLAP = { x0: 100, x1: 122, y0: 45, y1: 115 };
/** A strip of bare paper, the white the overlap's lightness is read against. */
const PAPER_STRIP = { x0: 10, x1: 230, y0: 148, y1: 156 };

/**
 * What the gouache over the watercolour must show, as the share of the way from the wash alone's lightness to the
 * gouache alone's: at least `covers`; and painted in watercolour instead, a glaze, at most `glazes`, so the check bites.
 */
export const STAMP_GATE_MEDIA_COVER = { covers: 0.85, glazes: 0.3 };

/** Pixels each group's comparison must hold, painted, where no other group reaches: so it can't pass on bare paper. */
const LEAST_COMPARED = 400;

/**
 * The painting with `groups`, in watercolour unless `alone` paints its one group in that group's medium as the
 * painting's. Together, the gouache and crayon groups name their media; `bodyIn` paints the gouache group's paint in
 * another (watercolour, the control a glaze gives).
 */
export function stampGateMediaPainting(groups: readonly StampGateMediaGroup[], { alone = false, bodyIn = 'gouache' }: { alone?: boolean; bodyIn?: keyof typeof PAINT_MEDIA } = {}): StampGatePainting {
  const round = stampGateBrush('Round', { flow: 0.5 });
  const own = (group: StampGateMediaGroup, medium: keyof typeof PAINT_MEDIA = GROUP_MEDIA[group]) => (alone ? {} : { mixing: mixingIn(PAINT_MEDIA[medium]) });
  const medium = alone && groups.length === 1 ? PAINT_MEDIA[GROUP_MEDIA[groups[0]]] : PAINT_MEDIA.watercolour;
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: PAPER, mixing: mixingIn(medium) }, (p) => {
    if (groups.includes('wash')) {
      p.group('wash', { composite: 'glaze', opacity: 1 }, (g) => {
        g.passage('dark', {}, (w) => w.fill('dark', {
          brush: round, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 20, 130, 20, 130, 140, 10, 140),
          well: { paint: mixture(1, { pigment: W.ultramarine, amount: 1 }, { pigment: W.burntUmber, amount: 1 }) },
        }));
        g.passage('line', { wetHistory: false }, (pass) => pass.stroke('line', { brush: round, size: 10, well: { paint: mixture(1, { pigment: W.burntSienna, amount: 1 }) }, path: [{ x: 20, y: 130 }, { x: 80, y: 30 }] }));
      });
    }
    if (groups.includes('body')) {
      p.group('body', { composite: 'glaze', opacity: 1, ...own('body', bodyIn) }, (g) => {
        g.passage('light', {}, (w) => w.fill('light', {
          brush: round, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(90, 30, 170, 30, 170, 130, 90, 130),
          well: { paint: mixture(0.3, { pigment: W.yellowOchre, amount: 1 }) },
        }));
        g.passage('dab', { wetHistory: false }, (pass) => pass.stroke('dab', { brush: round, size: 12, well: { paint: mixture(0.4, { pigment: W.cerulean, amount: 1 }) }, path: [{ x: 140, y: 50 }, { x: 160, y: 110 }] }));
      });
    }
    if (groups.includes('wax')) {
      p.group('wax', { composite: 'glaze', opacity: 1, ...own('wax') }, (g) => g.passage('stick', {}, (pass) => pass.stroke('stick', {
        brush: round, size: 16, well: { paint: mixture(0.8, { pigment: W.burntSienna, amount: 1 }) }, path: [{ x: 200, y: 30 }, { x: 215, y: 130 }],
      })));
    }
  }));
  return { painting, ...SIZE, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

type Rgba = ArrayLike<number>;
type Box = { x0: number; x1: number; y0: number; y1: number };

const samePixel = (a: Rgba, b: Rgba, i: number) => a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2];
const linear = (v: number) => (v <= 10.31475 ? v / 3294.6 : ((v / 255 + 0.055) / 1.055) ** 2.4);
/** Mean relative luminance over `box`. */
function luminance(rgba: Rgba, { x0, x1, y0, y1 }: Box): number {
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * SIZE.width + x) * 4;
    sum += 0.2126 * linear(rgba[i]) + 0.7152 * linear(rgba[i + 1]) + 0.0722 * linear(rgba[i + 2]);
  }
  return sum / ((x1 - x0) * (y1 - y0));
}
/** L* of luminance `Y` against the paper's. */
const lightness = (Y: number, white: number) => {
  const t = Y / white;
  return 116 * (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116) - 16;
};

/**
 * How far round a group's paint to keep clear of it: a film too thin to show over the paper still shows over another
 * group's dark, so where a group's frame is bare paper isn't quite where it laid nothing.
 */
const REACH_PAD = 4;

/** 1 at each pixel within REACH_PAD of one where `frame` isn't `bare` paper. */
function reachOf(frame: Rgba, bare: Rgba): Uint8Array {
  const { width, height } = SIZE, reached = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (samePixel(frame, bare, (y * width + x) * 4)) continue;
    for (let v = Math.max(0, y - REACH_PAD); v <= Math.min(height - 1, y + REACH_PAD); v++) {
      for (let u = Math.max(0, x - REACH_PAD); u <= Math.min(width - 1, x + REACH_PAD); u++) reached[v * width + u] = 1;
    }
  }
  return reached;
}

/**
 * Whether `together` is each group's alone frame wherever no other group's alone frame reaches (reachOf; max 0, over
 * at least LEAST_COMPARED painted pixels each); and whether, over STAMP_GATE_MEDIA_OVERLAP, the gouache covers
 * the wash as STAMP_GATE_MEDIA_COVER says, where the same paint in watercolour (`glazed`) glazes it.
 */
export function checkStampGateMedia({ together, alone, bare, glazed }: {
  together: Rgba; alone: Readonly<Record<StampGateMediaGroup, Rgba>>; bare: Rgba; glazed: Rgba;
}): StampGateWashCheck[] {
  const names = STAMP_GATE_MEDIA_GROUPS;
  const reach = new Map(names.map((name) => [name, reachOf(alone[name], bare)]));
  const rows = names.map((name) => {
    let compared = 0, painted = 0, max = 0;
    for (let i = 0; i < together.length; i += 4) {
      if (names.some((other) => other !== name && reach.get(other)![i / 4])) continue;
      compared++;
      if (!samePixel(alone[name], bare, i)) painted++;
      for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(together[i + c] - alone[name][i + c]));
    }
    return { name, compared, painted, max };
  });
  const apart = rows.filter(({ max, painted }) => max > 0 || painted < LEAST_COMPARED);
  const white = luminance(bare, PAPER_STRIP), L = (rgba: Rgba) => lightness(luminance(rgba, STAMP_GATE_MEDIA_OVERLAP), white);
  const under = L(alone.wash), over = L(alone.body), share = (rgba: Rgba) => (L(rgba) - under) / (over - under);
  const covers = share(together), glazes = share(glazed);
  const { covers: least, glazes: most } = STAMP_GATE_MEDIA_COVER;
  return [{
    id: 'media/mixed: each group draws as painted alone in its own medium, where no other reaches', passed: !apart.length,
    detail: rows.map(({ name, compared, painted, max }) => `${name} (${GROUP_MEDIA[name]}): max ${max} over ${compared} px, ${painted} painted (under ${LEAST_COMPARED} fails)`).join('; '),
  }, {
    id: 'media/mixed: gouache glazed over a dark watercolour wash covers it', passed: covers >= least && glazes <= most,
    detail: `overlap L* ${L(together).toFixed(1)}, the wash alone ${under.toFixed(1)}, the gouache alone ${over.toFixed(1)}: covers ${covers.toFixed(2)} of the way (under ${least} fails); the same paint in watercolour ${glazes.toFixed(2)} (over ${most} fails)`,
  }];
}
