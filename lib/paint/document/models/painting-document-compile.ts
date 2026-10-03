// painting-document-compile.ts: an evaluation's root sheet as the program the wash solver runs (stamp-sheet-program.ts):
// a film per layer on the sheet, its washes and its applications in the sheet's order, each deposit planned at rest,
// with the canonical text of what each entry reads (ENGINE 4.2) and of the sheet's head, from which a solve chains
// its state keys. Keys name things in messages only: deposits are named by ordinals and seeded by their tips.
//
// Negative space: unclocked only, and only the root's sheet. A clocked wash or a layer on its own sheet is refused
// by name, not painted wrong.

import { PAINT_MEDIA, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import type { StampSheetEntry, StampSheetFilm, StampSheetPrewet, StampSheetProgram, StampSheetWash } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { compilePaintingArea } from './painting-area-compile.ts';
import { compilePaintingDeposit, compilePaintingFluid, paintingMixAppearances, type PaintingBrushOf } from './painting-deposit-compile.ts';
import type { AnyApplication, Prewet, Wash } from './painting-document.ts';
import { paintingEntryReads, paintingSheetHead } from './painting-evaluation-diff.ts';
import { paintingApplicationOwner } from './painting-problem.ts';
import { paintingSheetOrders, paintingSheetWashes } from './painting-sheet-program.ts';
import type { PaintingEvaluation } from './painting-source.ts';
import { paintingSheetName } from './painting-tree.ts';

/** `medium` with its paint's spread held to `maxSpreadPx` at `diameter`: the medium one application lands by. */
const paintingCappedMedium = (medium: PaintMedium, maxSpreadPx: number, diameter: number): PaintMedium =>
  ({ ...medium, wetting: { ...medium.wetting, spread: Math.min(medium.wetting.spread, maxSpreadPx / diameter) } });

/** A prewet as its wash lays it at its start: its area, water and reserves. */
function compilePaintingPrewet(prewet: Prewet, id: string, owner: string, brushOf: PaintingBrushOf): StampSheetPrewet {
  const { mask, anchored } = compilePaintingFluid(id, prewet.reserves ?? [], [], brushOf);
  const water = prewet.water ?? 1;
  return { area: compilePaintingArea({ region: prewet.region }, `${owner}.prewet`), water: typeof water === 'number' ? { kind: 'constant', value: water } : water, held: mask, anchored };
}

/**
 * `evaluation`'s root sheet as its program, brushes resolved by `brushOf`. Throws on a clocked wash or a layer on its
 * own sheet, on a lift in a direct wash or a region resist, and on what compileDeposit refuses.
 */
export function compilePaintingRootSheet(evaluation: PaintingEvaluation, brushOf: PaintingBrushOf): StampSheetProgram {
  const { document: paintingDocument, tree } = evaluation;
  const [order, ...others] = paintingSheetOrders(tree);
  const elsewhere = others.find(({ entries }) => entries.length > 0);
  if (elsewhere) throw new Error(`painting: ${evaluation.source} paints on ${paintingSheetName(elsewhere.sheet)}, and the solver paints only the root's sheet so far`);
  const clocked = order.entries.find(({ orderTime }) => orderTime !== null);
  if (clocked) {
    const wash = tree.layers[order.layers[clocked.layer].layer].node.washes[clocked.wash];
    throw new Error(`painting: ${evaluation.source}'s wash ${wash.key} is clocked, and the solver paints unclocked washes so far`);
  }
  const reads = paintingEntryReads(tree, order);
  const sheetWashes = paintingSheetWashes(tree, order);
  const washIndex = new Map(sheetWashes.map(({ layer, wash }, w) => [`${layer}/${wash}`, w]));
  const films = order.layers.map(({ layer, medium }): StampSheetFilm => {
    const place = tree.layers[layer], pigments: Record<string, PaintPigmentAppearance> = {};
    for (const wash of place.node.washes) {
      const applications: readonly AnyApplication[] = wash.applications;
      for (const { charge } of applications) if (charge.kind === 'paint') for (const appearance of paintingMixAppearances(charge.mix)) pigments[appearance.id] = appearance;
    }
    return { medium: PAINT_MEDIA[medium], mixing: { kind: 'pigment', medium: PAINT_MEDIA[medium], pigments }, name: place.node.key };
  });
  const washes = sheetWashes.map(({ layer, wash, place, node }): StampSheetWash => {
    const wet = node.wetHistory !== false, clipTo = node.clipTo === undefined ? null : washIndex.get(`${layer}/${place.node.washes.findIndex(({ key }) => key === node.clipTo)}`);
    if (clipTo === undefined) throw new Error(`painting: ${node.key} is clipped to ${node.clipTo}, which paints nothing on this sheet`);
    const prewet = wet && node.prewet ? compilePaintingPrewet(node.prewet, `${layer}/${wash}/prewet`, node.key, brushOf) : null;
    return { film: layer, name: node.key, prewet, rim: wet ? node.rim ?? 1 : 0, clipTo, wetHistory: wet };
  });
  const entries = order.entries.map((entry, k): StampSheetEntry => {
    const wash: Wash = tree.layers[order.layers[entry.layer].layer].node.washes[entry.wash];
    const application: AnyApplication = wash.applications[entry.application];
    const w = washIndex.get(`${entry.layer}/${entry.wash}`)!, owner = paintingApplicationOwner(wash, application, entry.application);
    const { deposit, anchors } = compilePaintingDeposit(application, owner, { id: `${entry.layer}/${entry.wash}/${entry.application}`, wet: washes[w].wetHistory, brushOf });
    const { medium } = films[entry.layer], { charge } = application;
    const capped = charge.kind === 'paint' && charge.maxSpreadPx !== undefined ? paintingCappedMedium(medium, charge.maxSpreadPx, application.diameterPx) : medium;
    return {
      wash: w, name: owner, deposit, medium: capped, on: 'on' in application ? application.on ?? null : null, bloom: 'effect' in application && application.effect === 'bloom',
      chain: entry.chain, anchors, datum: stampCanonicalJson(reads[k].datum),
    };
  });
  return {
    width: paintingDocument.widthPx, height: paintingDocument.heightPx, paper: order.sheet.paper, water: PAINT_MEDIA[order.sheet.water],
    films, washes, entries, head: stampCanonicalJson(paintingSheetHead(paintingDocument, order)),
  };
}
