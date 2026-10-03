// narrow-fills.ts: the narrow-fill sheet (vid-119): shapes a landscape paints as fills that are narrow somewhere (a
// pine's tiers and trunk, a sliver, a shadow face tapering to its spur), each flooded at several diameters by a wet
// brush on dry paper, so a person can judge whether a narrow fill reads as a wash of its brush, as a wide one does.
// The last column is the same shape cut to its outline (a fill of its padded box within it), a crisp reference. The
// sheet (engine/narrow-fill-sheet.ts) paints it.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintPaper, StampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import { stampPolygonBox, type StampPoint, type StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampPigmentMixing } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import type { StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';

/** A cell of the sheet, in pixels: one shape at one diameter. */
export const NARROW_FILL_CELL = { width: 200, height: 290 };
/** The diameters each shape is flooded at, px: a small brush in a big shape's tiers up to one wider than the shape. */
export const NARROW_FILL_DIAMETERS = [8, 14, 24, 40, 64] as const;
/** The reference column's diameter: a fill of the shape's padded box cut to its outline. */
const CUT_DIAMETER = 40;

/** A wet style as the sheet's page is handed it: the brushes it floods with by name, paper and paint, and its packs' URLs. */
export type NarrowFillSheetMedium = { brushes: Readonly<Record<string, StampBrush>>; paper: StampPaintPaper; mixing: StampPigmentMixing; packUrls: StampPaintPackUrls };

/** One brush's sheet painted, as a PNG data URL, or why it couldn't be. */
export type NarrowFillPainted = { brush: string } & ({ png: string } | { refused: string });

/** A wobble in -1..1 from `seed`, the same each time. */
const wobble = (seed: number) => Math.sin(seed * 12.9898 + 78.233) * 0.5 + Math.sin(seed * 4.1414) * 0.5;

/** A pine of drooping tiers, `h` tall and `w` wide on `base` at `x`, as the fresh landscape draws its pines. */
function pine(x: number, base: number, h: number, w: number, seed: number): StampPoint[] {
  const tiers = Math.max(5, Math.round(h / 22)), left: StampPoint[] = [{ x, y: base - h }], right: StampPoint[] = [];
  for (let i = 1; i <= tiers; i++) {
    const u = i / tiers, y = base - h + h * u * 0.92, reach = (w / 2) * u ** 0.85;
    const jitter = (k: number) => 1 + 0.35 * wobble(seed + i * 1.7 + k);
    left.push({ x: x - reach * jitter(0), y: y + 4 }, { x: x - reach * 0.35, y: y - 2 });
    right.push({ x: x + reach * jitter(5), y: y + 3 }, { x: x + reach * 0.35, y: y - 3 });
  }
  return [...left, { x: x - 3, y: base + 6 }, { x: x + 3, y: base + 6 }, ...right.toReversed()];
}

/** A curved sliver from (x, y0) down to y1, `thick` px across at its middle and coming to a point at each end. */
function sliver(x: number, y0: number, y1: number, thick: number): StampPoint[] {
  const steps = 24, side = (sign: number) => Array.from({ length: steps + 1 }, (_, k) => {
    const u = k / steps, y = y0 + (y1 - y0) * u, bend = 26 * Math.sin(Math.PI * u);
    return { x: x + bend + sign * (thick / 2) * Math.sin(Math.PI * u) ** 0.7, y };
  });
  return [...side(-1), ...side(1).toReversed().slice(1, -1)];
}

/** A shadow face: wide under a ridge, narrowing down a spur to a point, its far side broken by gullies. */
function shadowFace(x: number, y0: number, y1: number, wide: number): StampPoint[] {
  const steps = 14, h = y1 - y0;
  const spur = Array.from({ length: steps + 1 }, (_, k) => ({ x: x + wide / 2 - 6 * Math.sin(k * 0.9), y: y0 + (h * k) / steps }));
  const far = Array.from({ length: steps + 1 }, (_, k) => {
    const u = k / steps;
    return { x: x + wide / 2 - wide * (1 - u) ** 1.3 + 8 * wobble(k * 3.1) * (1 - u), y: y0 + h * u + 10 * (1 - u) };
  });
  return [...spur, ...far.toReversed().slice(1)];
}

/** A row of the sheet: a shape, its name as shown, and its outline in a cell whose top left is (0, 0). */
export type NarrowFillSheetRow = { id: string; title: string; outline: readonly StampPoint[] };

const { width: W, height: H } = NARROW_FILL_CELL;
export const NARROW_FILL_SHAPES: readonly NarrowFillSheetRow[] = [
  { id: 'pine', title: 'A pine, 80 px wide at its foot', outline: pine(W / 2, H - 24, 240, 80, 3) },
  { id: 'far-pine', title: 'A far pine, 34 px wide', outline: pine(W / 2, H - 70, 150, 34, 11) },
  { id: 'sliver', title: 'A sliver, 14 px at its widest', outline: sliver(W / 2 - 14, 20, H - 20, 14) },
  { id: 'shadow-face', title: 'A shadow face tapering to its spur', outline: shadowFace(W / 2 - 10, 20, H - 20, 110) },
];

/** The sheet's columns: each diameter flooded, then the shape cut to its outline. */
export const NARROW_FILL_COLUMNS = [...NARROW_FILL_DIAMETERS.map((d) => `flood, d ${d}`), `cut to outline, d ${CUT_DIAMETER}`] as const;

/** The pines' dark green, as the fresh landscape mixes it. */
function narrowFillMixture(mixing: StampPigmentMixing): PaintMaterial {
  const amounts = { phthaloBlue: 0.4, burntSienna: 0.45, hansaYellow: 0.15, phthaloGreen: 0.1 };
  const parts = Object.entries(amounts).map(([id, amount]) => {
    const pigment = mixing.pigments[id];
    if (!pigment) throw new Error(`narrow fills: the style has no pigment ${id}`);
    return { pigment, amount };
  });
  return { kind: 'mixture', parts, strength: 1 };
}

const shifted = (outline: readonly StampPoint[], dx: number, dy: number) => outline.map(({ x, y }) => ({ x: x + dx, y: y + dy }));
const polygon = (points: readonly StampPoint[]): StampRegion => ({ kind: 'polygon', points });

/**
 * The sheet's painting for `brush`: a row a shape, a column a diameter, each its own wash on dry paper (so it lands as
 * the landscape's do), and the last column cut to its outline.
 */
export function narrowFillRecipe(brush: StampBrush, paper: StampPaintPaper, mixing: StampPigmentMixing): StampPaintRecipe {
  const material = narrowFillMixture(mixing);
  return stampPaintRecipe({ paper, mixing }, (paint) => NARROW_FILL_SHAPES.forEach(({ id, outline }, row) => NARROW_FILL_COLUMNS.forEach((_, column) => {
    const placed = shifted(outline, column * W, row * H), cut = column === NARROW_FILL_DIAMETERS.length;
    const diameter = cut ? CUT_DIAMETER : NARROW_FILL_DIAMETERS[column];
    const box = stampPolygonBox(placed, diameter / 2 + 4);
    const region = cut ? polygon([{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }]) : polygon(placed);
    paint.group(`${id}-${column}`, { composite: 'glaze', opacity: 1 }, (group) => group.passage('wash', cut ? { within: { region: polygon(placed) } } : {}, (wash) => {
      wash.fill('fill', { brush, size: diameter, region, well: { paint: material }, application: { kind: 'flood' } });
    }));
  })));
}
