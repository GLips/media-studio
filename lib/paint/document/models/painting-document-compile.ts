// painting-document-compile.ts: an evaluation's root sheet as the program the wash solver runs (stamp-sheet-program.ts):
// a film per layer on the sheet with its slots, its washes and its applications in the sheet's order, each deposit
// planned at rest, with the canonical text of what each entry reads (ENGINE 4.2: its document data and its compiled
// marks) and of the sheet's head, from which a solve chains its state keys. Keys name things in messages only:
// deposits are named by ordinals and seeded by their tips. Posing comes after (painting-pose.ts).
//
// Negative space: unclocked only, and only the root's sheet, the solver's limits so far. A clocked wash or a layer on
// its own sheet is refused by name, not painted wrong.

import { PAINT_MEDIA, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMixturePigment } from '#lib/paint/materials/models/paint-pigment.ts';
import { stampBrushedMasksUnder } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import type { CompiledStampDeposit } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampSheetEntry, StampSheetFilm, StampSheetPrewet, StampSheetProgram, StampSheetWash } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '#lib/paint/painting/models/stamp-sheet-refusal.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { compilePaintingArea } from './painting-area-compile.ts';
import { compilePaintingDeposit, compilePaintingFluid, paintingMixPigments, type PaintingBrushOf } from './painting-deposit-compile.ts';
import type { AnyApplication, Prewet, Wash } from './painting-document.ts';
import { paintingEntryReads, paintingSheetHead } from './painting-entry-reads.ts';
import { PAINTING_REST_POSE } from './painting-pose.ts';
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
 * What an entry's key reads of what it compiled to: its stamps and dual stamps, and the marks of its fluid's brushed
 * masks and (at its wash's first entry) its prewet's. A document's one callable, a hand's curve, is in them.
 */
const paintingEntryMarks = (deposit: CompiledStampDeposit, prewet: StampSheetPrewet | null) => ({
  stamps: deposit.stamps, dualStamps: deposit.dualStamps,
  brushed: stampBrushedMasksUnder([deposit.mask, prewet?.held]).map(({ marks }) => marks.map(({ stamps, dualStamps }) => ({ stamps, dualStamps }))),
});

/**
 * `evaluation`'s root sheet as its program, at rest, brushes resolved by `brushOf`. Refuses what the solver can't
 * paint so far: a clocked wash, a layer on its own sheet, a lift in a direct wash.
 */
export function compilePaintingRootSheet(evaluation: PaintingEvaluation, brushOf: PaintingBrushOf): StampSheetProgram {
  const { document: paintingDocument, tree } = evaluation;
  const [order, ...others] = paintingSheetOrders(tree);
  const elsewhere = others.find(({ entries }) => entries.length > 0);
  if (elsewhere) throw new StampSheetRefusal(`painting: ${evaluation.source} paints on ${paintingSheetName(elsewhere.sheet)}, and the solver paints only the root's sheet so far`);
  const clocked = order.entries.find(({ orderTime }) => orderTime !== null);
  if (clocked) {
    const wash = tree.layers[order.layers[clocked.layer].layer].node.washes[clocked.wash];
    throw new StampSheetRefusal(`painting: ${evaluation.source}'s wash ${wash.key} is clocked, and the solver paints unclocked washes so far`);
  }
  const reads = paintingEntryReads(tree, order);
  const sheetWashes = paintingSheetWashes(tree, order);
  const washIndex = new Map(sheetWashes.map(({ layer, wash }, w) => [`${layer}/${wash}`, w]));
  const films = order.layers.map(({ layer, medium, slots }): StampSheetFilm => {
    const place = tree.layers[layer], pigments: Record<string, PaintMixturePigment> = {};
    for (const wash of place.node.washes) {
      const applications: readonly AnyApplication[] = wash.applications;
      for (const { charge } of applications) if (charge.kind === 'paint') for (const pigment of paintingMixPigments(charge.mix)) pigments[pigment.id] = pigment;
    }
    return { medium: PAINT_MEDIA[medium], mixing: { kind: 'pigment', medium: PAINT_MEDIA[medium], pigments }, slots, name: place.node.key };
  });
  const washes = sheetWashes.map(({ layer, wash, place, node }): StampSheetWash => {
    // A checked document clips only to an earlier wash with applications, so it's on this sheet.
    const wet = node.wetHistory !== false, clipTo = node.clipTo === undefined ? null : washIndex.get(`${layer}/${place.node.washes.findIndex(({ key }) => key === node.clipTo)}`)!;
    const prewet = wet && node.prewet ? compilePaintingPrewet(node.prewet, `${layer}/${wash}/prewet`, node.key, brushOf) : null;
    return { film: layer, name: node.key, prewet, rim: wet ? node.rim ?? 1 : 0, clipTo, wetHistory: wet };
  });
  const entries = order.entries.map((entry, k): StampSheetEntry => {
    const wash: Wash = tree.layers[order.layers[entry.layer].layer].node.washes[entry.wash];
    const application: AnyApplication = wash.applications[entry.application];
    const w = washIndex.get(`${entry.layer}/${entry.wash}`)!, owner = paintingApplicationOwner(wash, application, entry.application);
    const { deposit, anchors } = compilePaintingDeposit(application, owner, { id: `${entry.layer}/${entry.wash}/${entry.application}`, wet: washes[w].wetHistory, brushOf });
    const { medium } = films[entry.layer], { charge } = application, firstOfWash = order.entries.findIndex((other) => other.layer === entry.layer && other.wash === entry.wash) === k;
    const capped = charge.kind === 'paint' && charge.maxSpreadPx !== undefined ? paintingCappedMedium(medium, charge.maxSpreadPx, application.diameterPx) : medium;
    const marks = paintingEntryMarks(deposit, firstOfWash ? washes[w].prewet : null);
    return {
      wash: w, name: owner, deposit, medium: capped, on: 'on' in application ? application.on ?? null : null, bloom: 'effect' in application && application.effect === 'bloom',
      chain: entry.chain, anchors, datum: stampCanonicalJson({ reads: reads[k].datum, marks }), pose: PAINTING_REST_POSE,
    };
  });
  return {
    name: `${evaluation.source}, ${paintingSheetName(order.sheet)}`, width: paintingDocument.widthPx, height: paintingDocument.heightPx, paper: order.sheet.paper, water: PAINT_MEDIA[order.sheet.water],
    films, washes, entries, head: stampCanonicalJson(paintingSheetHead(paintingDocument, order)),
  };
}
