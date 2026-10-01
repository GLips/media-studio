// wet-passages.ts: the reference passages, six small watercolour situations painted with a wash's ops as a painter
// would (a wash, its paper wetted first, water, soften, bloom, lift, wait), so a person can judge wet paint by eye in
// each medium (vid-117). Each is a recipe on a cell of its own, in a style's brushes and pigments; the passage sheet
// (engine/wet-passage-sheet.ts) paints every passage in every medium.
//
// Negative space: no effect is asked for by name. A soft edge is water along an edge, a lifted cloud a tissue dabbed
// into a wet sky; what the engine makes of them is what's judged.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintRecipe, type StampPaintPaper, type StampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampPigmentMixing } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import type { StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';

/** A passage's cell, in pixels. */
export const WET_PASSAGE_CELL = { width: 360, height: 260 };

/**
 * The brushes a medium paints its passages with, by what a painter reaches for: `fill` lays a wash, `drop` drops colour
 * into it, `water` is a clean damp brush, `lift` a thirsty one.
 */
export type WetPassageBrushes = { fill: StampBrush; drop: StampBrush; water: StampBrush; lift: StampBrush };

/** What a passage paints with: its brushes and its style's pigments, by id. */
export type WetPassageKit = { brushes: WetPassageBrushes; pigments: StampPigmentMixing['pigments'] };

/** A medium's passages as the sheet's page is handed them: its style's brushes by role, paper and paint, and its packs' URLs. */
export type WetPassageSheetMedium = { brushes: WetPassageBrushes; paper: StampPaintPaper; mixing: StampPigmentMixing; packUrls: StampPaintPackUrls };

/** A passage painted, as a PNG data URL, or why it couldn't be. */
export type WetPassagePainted = { passage: string } & ({ png: string } | { refused: string });

/** A passage: its ID, how it's described to the person judging it, and its recipe in a kit. */
export type WetPassage = { id: string; title: string; shows: string; lookFor: string; recipe: (kit: WetPassageKit) => StampPaintRecipe };

/** A mixture of the kit's pigments by id, each by how much a full load holds; their sum is its strength. */
export function wetPassageMixture(kit: WetPassageKit, amounts: Readonly<Record<string, number>>): PaintMaterial {
  const parts = Object.entries(amounts).map(([id, amount]) => {
    const pigment = kit.pigments[id];
    if (!pigment) throw new Error(`wet passages: the style has no pigment ${id}`);
    return { pigment, amount };
  });
  return { kind: 'mixture', parts, strength: Math.min(1, parts.reduce((sum, { amount }) => sum + amount, 0)) };
}

const { width: W, height: H } = WET_PASSAGE_CELL;
const rect = (x0: number, y0: number, x1: number, y1: number): StampRegion => ({ kind: 'polygon', points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
const PAGE = rect(16, 16, W - 16, H - 16);
/** A wavering stroke across the cell at `y`, its pressure swelling in the middle. */
const across = (y: number, x0 = 24, x1 = W - 24, wave = 6) => Array.from({ length: 7 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 6, y: y + wave * Math.sin(i * 1.3), pressure: 0.5 + 0.5 * Math.sin((i / 6) * Math.PI) }));
const flood = { application: { kind: 'flood' } } as const;

/** The paper wetted, a pale graded sky laid in, stronger blue dropped in at the top, a warm glow at the horizon, grey under two clouds. */
function wetInWetSky(kit: WetPassageKit): StampPaintRecipe {
  const { fill, drop } = kit.brushes;
  return stampPaintRecipe((paint) => paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.wash('sky', { preparation: { region: PAGE } }, (wash) => {
    wash.fill('sky', { brush: fill, diameter: 90, ...flood, region: PAGE, material: wetPassageMixture(kit, { cerulean: 0.3 }), load: { kind: 'linear', from: { x: 0, y: 20, value: 1 }, to: { x: 0, y: H - 20, value: 0.25 } } });
    wash.stroke('overhead', { brush: drop, diameter: 70, material: wetPassageMixture(kit, { ultramarine: 0.4 }), path: across(40) });
    wash.stroke('glow', { brush: drop, diameter: 60, material: wetPassageMixture(kit, { quinacridoneRose: 0.12, hansaYellow: 0.04 }), path: across(H - 50) });
    for (const [k, x] of [110, 250].entries()) {
      wash.stroke(`cloud-${k}`, { brush: drop, diameter: 36, material: wetPassageMixture(kit, { ultramarine: 0.2, quinacridoneRose: 0.06, burntSienna: 0.05 }), path: across(130 + k * 30, x - 60, x + 60, 3) });
    }
  })));
}

/** A hill on dry paper, its left side left as the brush laid it, a damp brush run along its right shoulder. */
function softenedEdge(kit: WetPassageKit): StampPaintRecipe {
  const { fill, water } = kit.brushes;
  const hill: StampRegion = { kind: 'polygon', points: [{ x: 30, y: 230 }, { x: 60, y: 120 }, { x: 150, y: 60 }, { x: 240, y: 90 }, { x: 330, y: 170 }, { x: 330, y: 230 }] };
  return stampPaintRecipe((paint) => paint.group('hill', { composite: 'glaze', opacity: 1 }, (group) => group.wash('hill', {}, (wash) => {
    wash.fill('hill', { brush: fill, diameter: 60, ...flood, region: hill, material: wetPassageMixture(kit, { ultramarine: 0.3, burntSienna: 0.2 }) });
    wash.soften('shoulder', { brush: water, diameter: 30, path: [{ x: 150, y: 60 }, { x: 240, y: 90 }, { x: 330, y: 170 }] });
  })));
}

/**
 * A blue shape laid and let dry, then a rose one across it: where they overlap, both edges stay sharp. The rose is a
 * group of its own, as a glaze is: within one group, paint landing on dried paint mixes with it (the dry law).
 */
function hardEdge(kit: WetPassageKit): StampPaintRecipe {
  const { fill, drop } = kit.brushes;
  return stampPaintRecipe((paint) => {
    paint.group('blue', { composite: 'glaze', opacity: 1 }, (group) => group.wash('blue', {}, (wash) => {
      wash.fill('blue', { brush: fill, diameter: 50, ...flood, region: rect(30, 30, 210, 200), material: wetPassageMixture(kit, { cerulean: 0.35 }) });
    }));
    paint.group('rose', { composite: 'glaze', opacity: 1 }, (group) => group.wash('rose', {}, (wash) => {
      wash.fill('rose', { brush: fill, diameter: 50, ...flood, region: { kind: 'ellipse', x: 230, y: 150, radiusX: 100, radiusY: 70 }, material: wetPassageMixture(kit, { quinacridoneRose: 0.3 }) });
      wash.stroke('line', { brush: drop, diameter: 14, material: wetPassageMixture(kit, { burntSienna: 0.5 }), path: [{ x: 40, y: 235 }, { x: 320, y: 225 }] });
    }));
  });
}

/**
 * The same seven overlapping strokes of one mixture: on the left each dries before the next goes on (a group of its own,
 * glazed), on the right all within one wash.
 */
function mergedStrokes(kit: WetPassageKit): StampPaintRecipe {
  const { fill } = kit.brushes;
  const material = wetPassageMixture(kit, { ultramarine: 0.25, burntSienna: 0.1 });
  // Rows closer than any of the brushes' marks are wide, so each overlaps the last.
  const rows = (x0: number, x1: number) => Array.from({ length: 7 }, (_, k) => across(55 + k * 24, x0, x1, 3));
  return stampPaintRecipe((paint) => {
    rows(20, W / 2 - 20).forEach((path, k) => paint.group(`dry-${k}`, { composite: 'glaze', opacity: 1 }, (group) => group.pass('dry', {}, (pass) => {
      pass.stroke('row', { brush: fill, diameter: 64, material, path });
    })));
    paint.group('wet', { composite: 'glaze', opacity: 1 }, (group) => group.wash('wet', {}, (wash) => rows(W / 2 + 20, W - 20).forEach((path, k) => {
      wash.stroke(`row-${k}`, { brush: fill, diameter: 64, material, path });
    })));
  });
}

/** One wash graded in its pigment, ultramarine overhead turning to burnt sienna below, on wetted paper. */
function gradedWash(kit: WetPassageKit): StampPaintRecipe {
  const { fill } = kit.brushes;
  return stampPaintRecipe((paint) => paint.group('graded', { composite: 'glaze', opacity: 1 }, (group) => group.wash('graded', { preparation: { region: PAGE } }, (wash) => {
    wash.fill('graded', {
      brush: fill, diameter: 90, ...flood, region: PAGE,
      material: { kind: 'linear', from: { x: 0, y: 30, value: wetPassageMixture(kit, { ultramarine: 0.4 }) }, to: { x: 0, y: H - 30, value: wetPassageMixture(kit, { burntSienna: 0.35 }) } },
    });
  })));
}

/**
 * A wet blue sky, then a tissue pressed into it in the shape of a cloud and a thirsty brush drawn along its base,
 * lifting the paint back toward the paper.
 */
function liftedCloud(kit: WetPassageKit): StampPaintRecipe {
  const { fill, lift } = kit.brushes;
  const cloud: StampRegion = { kind: 'polygon', points: [[90, 160], [100, 125], [135, 110], [160, 80], [205, 78], [230, 100], [270, 102], [295, 130], [290, 160]].map(([x, y]) => ({ x, y })) };
  return stampPaintRecipe((paint) => paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.wash('sky', { preparation: { region: PAGE } }, (wash) => {
    wash.fill('sky', { brush: fill, diameter: 90, ...flood, region: PAGE, material: wetPassageMixture(kit, { ultramarine: 0.35, cerulean: 0.1 }) });
    wash.lift('cloud', { kind: 'fill', brush: lift, diameter: 50, ...flood, region: cloud, strength: 0.9 });
    wash.lift('base', { kind: 'stroke', brush: lift, diameter: 30, path: [{ x: 100, y: 165 }, { x: 290, y: 162 }], strength: 0.7 });
  })));
}

export const WET_PASSAGES: readonly WetPassage[] = [
  {
    id: 'wet-in-wet-sky', title: 'A wet-in-wet sky', recipe: wetInWetSky,
    shows: 'The paper is wetted with clean water first, then a pale blue sky goes on, fading toward the horizon. Stronger blue is dropped in at the top while it is still wet, a warm glow along the bottom, and grey under two clouds.',
    lookFor: 'The dropped colours should melt into the sky with no edge of their own, and still read stronger than it. Nothing should look like a stroke laid on top.',
  },
  {
    id: 'softened-edge', title: 'A softened edge', recipe: softenedEdge,
    shows: 'A hill painted on dry paper. Along its right shoulder a clean, damp brush is drawn while the paint is wet; its left side is left alone.',
    lookFor: 'The shoulder should melt into the paper; the left side should stay as the brush left it. Both sides of the one shape, side by side.',
  },
  {
    id: 'hard-edge', title: 'A hard edge on dry paper', recipe: hardEdge,
    shows: 'A blue shape, left to dry completely, then a rose shape laid across it, and a line of sienna along the bottom.',
    lookFor: 'Where the rose crosses the dry blue, both edges should stay crisp, and the overlap should read as one glaze through the other, not a blend.',
  },
  {
    id: 'merged-strokes', title: 'Merged strokes that don’t band', recipe: mergedStrokes,
    shows: 'The same seven overlapping strokes of one colour, twice: on the left each stroke dries before the next goes on; on the right they all go on wet, within one wash.',
    lookFor: 'On the left, a darker band where each stroke overlaps the last is expected. On the right the strokes should merge into one even wash with no bands.',
  },
  {
    id: 'graded-wash', title: 'A graded wash', recipe: gradedWash,
    shows: 'One wash on wetted paper whose colour changes as it comes down: blue overhead, turning to burnt sienna at the bottom.',
    lookFor: 'The colour should change smoothly, through the greys and violets the two pigments make together, never through a flat band or a muddy stripe.',
  },
  {
    id: 'lifted-cloud', title: 'A lifted cloud', recipe: liftedCloud,
    shows: 'A blue sky on wetted paper. A tissue is pressed into it in the shape of a cloud, and a clean, thirsty brush drawn along the cloud\u2019s base, taking paint back up.',
    lookFor: 'The cloud should come back close to the paper, soft-edged and a little uneven, with a faint stain left where the paint held on.',
  },
];
