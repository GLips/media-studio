// dry-passages.ts: the dry-media passages, small situations a coloured-pencil or crayon artist meets every day,
// painted as one would (layers of hatching, strokes wrapping a form, a last layer pressed hard), so a person can judge
// a dry medium by eye (vid-124). Each is a recipe on a cell of its own in a dry style's brushes and pigments; the
// dry passage sheet (engine/dry-passage-sheet.ts) paints them.
//
// Negative space: no effect is asked for by name. Tooth showing through layers is what the engine makes of layering.

import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { StampStrokePoint } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { stampPaintRecipe, type PaintMaterial, type StampPaintPaper, type StampPaintRecipe, type StampPassScope } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import type { StampRegion } from '#lib/picture/stamp-paint/models/stamp-region.ts';
import type { StampPigmentMixing } from '#lib/picture/stamp-paint/models/stamp-pigment-paint.ts';
import type { BrushFidelityPackUrls } from './brush-fidelity-pack-urls.ts';

/** A dry passage's cell, in pixels. */
export const DRY_PASSAGE_CELL = { width: 480, height: 300 };

/** The brushes a dry medium draws its passages with: `stick`, a hard point for hatching; `side`, a stick laid on its side. */
export type DryPassageBrushes = { stick: StampBrush; side: StampBrush };

/** What a passage draws with: its style's brushes by role and pigments by id. */
export type DryPassageKit = { brushes: DryPassageBrushes; pigments: StampPigmentMixing['pigments'] };

/** A dry style as the sheet's page is handed it: its brushes by role, paper and paint, and its packs' URLs. */
export type DryPassageSheetMedium = { brushes: DryPassageBrushes; paper: StampPaintPaper; mixing: StampPigmentMixing; packUrls: BrushFidelityPackUrls };

/** A passage drawn, as a PNG data URL, or why it couldn't be. */
export type DryPassagePainted = { passage: string } & ({ png: string } | { refused: string });

/** A passage: its ID, how it's described to the person judging it, and its recipe in a kit. */
export type DryPassage = { id: string; title: string; shows: string; lookFor: string; recipe: (kit: DryPassageKit) => StampPaintRecipe };

/** One pigment of the kit's at `amount` of a full load. */
function dryPassagePigment(kit: DryPassageKit, id: string, amount: number): PaintMaterial {
  const pigment = kit.pigments[id];
  if (!pigment) throw new Error(`dry passages: the style has no pigment ${id}`);
  return { kind: 'mixture', parts: [{ pigment, amount }], strength: amount };
}

const { width: W, height: H } = DRY_PASSAGE_CELL;
const rect = (x0: number, y0: number, x1: number, y1: number): StampRegion => ({ kind: 'polygon', points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
/** Close hatching, laid unevenly, as the crayon style draws an area (work/styles/crayon/crayon.md). */
const HATCH = { kind: 'strokes', pattern: 'hatch', spacing: 0.7, variation: 0.6 } as const;
/** Each layer's pigment, amount and direction: light to dark, each turned from the one under it. */
const LAYERS = [
  { pigment: 'yellowOchre', amount: 0.6, direction: -0.55 },
  { pigment: 'quinacridoneRose', amount: 0.35, direction: 0.45 },
  { pigment: 'ultramarine', amount: 0.45, direction: 1.15 },
  { pigment: 'burntSienna', amount: 0.5, direction: -1.05 },
  { pigment: 'burntUmber', amount: 0.5, direction: 0.1 },
] as const;

/** `count` layers of hatching over `region`: the same blue each time when `colours` is false, else LAYERS in turn. */
function hatchLayers(pass: StampPassScope, kit: DryPassageKit, id: string, region: StampRegion, count: number, colours: boolean) {
  for (let k = 0; k < count; k++) {
    const layer = colours ? LAYERS[k] : { pigment: 'ultramarine', amount: 0.3, direction: LAYERS[k].direction };
    pass.fill(`${id}-${k}`, { brush: kit.brushes.stick, diameter: 14, region, application: HATCH, direction: layer.direction, material: dryPassagePigment(kit, layer.pigment, layer.amount) });
  }
}

/** Five swatches, one to five layers of hatching: the same blue along the top, five colours light to dark along the bottom. */
function layeredTooth(kit: DryPassageKit): StampPaintRecipe {
  const swatch = (k: number, y0: number, y1: number) => rect(16 + k * 92, y0, 16 + k * 92 + 80, y1);
  return stampPaintRecipe((paint) => {
    for (let k = 0; k < 5; k++) {
      paint.group(`blue-${k}`, { composite: 'opaque' }, (group) => group.pass('layers', {}, (pass) => hatchLayers(pass, kit, 'blue', swatch(k, 16, 140), k + 1, false)));
      paint.group(`colours-${k}`, { composite: 'opaque' }, (group) => group.pass('layers', {}, (pass) => hatchLayers(pass, kit, 'colours', swatch(k, 160, 284), k + 1, true)));
    }
  });
}

/** A curve through `count + 1` points of `at(u)`, u from 0 to 1. */
const curve = (at: (u: number) => readonly [number, number], count = 24): StampStrokePoint[] => Array.from({ length: count + 1 }, (_, k) => {
  const [x, y] = at(k / count);
  return { x, y };
});

/**
 * Strokes that turn: a circle, an S-curve and arcs wrapped across a round form, as a crayon artist hatches along a
 * contour, in the stick and, along the bottom, the side of a stick.
 */
function curvedStrokes(kit: DryPassageKit): StampPaintRecipe {
  const { stick, side } = kit.brushes;
  const hand = { profile: 'taper', wobble: { pressure: 0.25, position: 0.06 } } as const;
  const blue = dryPassagePigment(kit, 'ultramarine', 0.5), red = dryPassagePigment(kit, 'cadmiumRed', 0.6);
  return stampPaintRecipe((paint) => paint.group('curves', { composite: 'opaque' }, (group) => group.pass('curves', {}, (pass) => {
    pass.stroke('circle', { brush: stick, diameter: 14, material: blue, hand, path: curve((u) => [90 + 62 * Math.cos(u * 2 * Math.PI * 0.95), 90 + 62 * Math.sin(u * 2 * Math.PI * 0.95)], 40) });
    pass.stroke('s-curve', { brush: stick, diameter: 14, material: blue, hand, path: curve((u) => [190 + 120 * u, 40 + 100 * u + 34 * Math.sin(u * 2 * Math.PI)]) });
    // Arcs across a round form, bowed as its cross-section is, as the crayon still life hatches its jug.
    for (let k = 0; k < 9; k++) {
      const y = 30 + k * 13, half = 62 * Math.sqrt(1 - ((y - 84) / 64) ** 2);
      pass.stroke(`arc-${k}`, { brush: stick, diameter: 12, material: red, hand, path: curve((u) => [400 + half * (2 * u - 1), y + 0.18 * half * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2))], 12) });
    }
    pass.stroke('side-arc', { brush: side, diameter: 26, material: blue, hand, path: curve((u) => [30 + 250 * u, 260 - 70 * Math.sin(u * Math.PI)]) });
    // Short, fine arcs down a form's shaded side, as the jug's core is hatched: each the far end of a bowed cross-section.
    for (let k = 0; k < 10; k++) {
      const y = 180 + k * 10;
      pass.stroke(`core-${k}`, { brush: stick, diameter: 7, material: blue, hand, path: curve((u) => [320 + 130 * (0.7 + 0.25 * u), y + 30 * Math.sqrt(Math.max(0, 1 - (2 * (0.7 + 0.25 * u) - 1) ** 2))], 6) });
    }
  })));
}

/**
 * Three layers of hatching across the cell (ochre, rose, blue), then over the right half the blue again, pressed
 * hard: what a coloured-pencil artist does last to burnish the wax into a smooth, saturated layer.
 */
function burnished(kit: DryPassageKit): StampPaintRecipe {
  return stampPaintRecipe((paint) => paint.group('swatch', { composite: 'opaque' }, (group) => group.pass('layers', {}, (pass) => {
    hatchLayers(pass, kit, 'layer', rect(16, 30, W - 16, H - 30), 3, true);
    pass.fill('pressed', {
      brush: kit.brushes.stick, diameter: 14, region: rect(W / 2, 30, W - 16, H - 30), direction: 0.2, material: dryPassagePigment(kit, 'ultramarine', 0.45),
      application: { ...HATCH, spacing: 0.5, hand: { profile: () => 1 } },
    });
  })));
}

/** The continuous fills side by side over three tall swatches, as vid-121's crayon lemon and wall used them: zigzag, back and forth. */
function fillTurns(kit: DryPassageKit): StampPaintRecipe {
  const swatch = (k: number) => rect(16 + k * 156, 20, 16 + k * 156 + 136, H - 20);
  const material = dryPassagePigment(kit, 'cadmiumRed', 0.55);
  return stampPaintRecipe((paint) => paint.group('fills', { composite: 'opaque' }, (group) => group.pass('fills', {}, (pass) => {
    pass.fill('zigzag', { brush: kit.brushes.stick, diameter: 16, region: swatch(0), application: { kind: 'strokes', pattern: 'zigzag', spacing: 0.8, variation: 0.4 }, direction: 0.5, material });
    pass.fill('back-and-forth', { brush: kit.brushes.stick, diameter: 16, region: swatch(1), application: { kind: 'strokes', pattern: 'backAndForth', spacing: 0.8, variation: 0.4 }, direction: 0.5, material });
  })));
}

export const DRY_PASSAGES: readonly DryPassage[] = [
  {
    id: 'fill-turns', title: 'Shading fills and their turns', recipe: fillTurns,
    shows: 'A crayon fill laid as one continuous stroke: on the left a zigzag, in the middle back and forth along each row.',
    lookFor: 'Where the stroke turns back, a hand eases off, so the turnarounds should be the lightest part, not a dark bead pressed in at each end of a row.',
  },
  {
    id: 'layered-tooth', title: 'Tooth through layers', recipe: layeredTooth,
    shows: 'Five swatches of close hatching with one to five layers, each layer turned from the one under it. Along the top every layer is the same blue; along the bottom the layers go ochre, rose, blue, sienna, umber.',
    lookFor: 'The paper’s tooth should speckle through for several layers, closing only slowly as the wax fills it. Layers of different colours should mix where they cross, not hide each other.',
  },
  {
    id: 'curved-strokes', title: 'Strokes that turn', recipe: curvedStrokes,
    shows: 'A circle, an S-curve and arcs across a round form, drawn with a hard stick; along the bottom an arc with a stick on its side and a wave.',
    lookFor: 'Each stroke should keep its width round the turn and read as one mark following the curve, not a chain of flat dashes held at one tilt.',
  },
  {
    id: 'burnished', title: 'Burnishing', recipe: burnished,
    shows: 'Three layers of hatching across the swatch (ochre, rose, blue). Over the right half the blue goes on again, pressed hard.',
    lookFor: 'The right half should be burnished: the wax pressed flat into the tooth, smooth and saturated, the paper no longer speckling through. The left half stays grainy.',
  },
];
