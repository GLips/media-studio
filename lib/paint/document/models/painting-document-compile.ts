// painting-document-compile.ts: a selection of an evaluation's layers as the programs the wash solver runs
// (stamp-sheet-program.ts), one per sheet they lie on (ENGINE 4.1): a film per selected layer, its washes and
// applications in the sheet's order with their order times, the sheet's clock, each deposit planned at rest, with the
// text of what each entry reads (ENGINE 4.2) and of the sheet's head, which a solve chains its keys from; and the
// steps compositing them (ENGINE 5.4). Keys name things in messages only: deposits are named by ordinals and seeded
// by their tips. Posing comes after (painting-pose.ts).

import { PAINT_MEDIA, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMixturePigment } from '#lib/paint/materials/models/paint-pigment.ts';
import { stampBrushedMasksUnder } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import { stampBoilSeed, type CompiledStampDeposit } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampSheetCompositeStep, StampSheetEntry, StampSheetFilm, StampSheetPrewet, StampSheetProgram, StampSheetWash } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { compilePaintingArea } from './painting-area-compile.ts';
import { compilePaintingDeposit, compilePaintingFluid, paintingMixPigments, type PaintingBrushOf } from './painting-deposit-compile.ts';
import type { AnyApplication, NodeKey, Prewet, Wash } from './painting-document.ts';
import { paintingEntryReads, paintingSheetHead } from './painting-entry-reads.ts';
import { PAINTING_REST_POSE } from './painting-pose.ts';
import { paintingApplicationOwner } from './painting-problem.ts';
import { paintingReseeded } from './painting-reseed.ts';
import { paintingSheetOrders, paintingSheetWashes, type PaintingSheetOrder } from './painting-sheet-program.ts';
import type { PaintingEvaluation } from './painting-source.ts';
import { paintingLayersUnder, paintingSheetName, type PaintingSheet, type PaintingTree } from './painting-tree.ts';

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
 * `order`, a sheet's order in `evaluation`, as its program at rest, brushes resolved by `brushOf`, each boiling layer
 * reseeded for its epoch in `epochs` (paintingLayerEpochs').
 */
function compilePaintingSheet(evaluation: PaintingEvaluation, order: PaintingSheetOrder, brushOf: PaintingBrushOf, epochs: ReadonlyMap<number, number>): StampSheetProgram {
  const { document: paintingDocument, tree } = evaluation;
  const epochOf = (sheetLayer: number) => epochs.get(order.layers[sheetLayer].layer) ?? 0;
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
    const epoch = epochOf(layer), id = stampBoilSeed(`${layer}/${wash}/prewet`, epoch);
    const prewet = wet && node.prewet ? compilePaintingPrewet(paintingReseeded(node.prewet, epoch), id, node.key, brushOf) : null;
    return { film: layer, name: node.key, prewet, rim: wet ? node.rim ?? 1 : 0, clipTo, wetHistory: wet, origin: node.clock?.origin ?? null };
  });
  const entries = order.entries.map((entry, k): StampSheetEntry => {
    const wash: Wash = tree.layers[order.layers[entry.layer].layer].node.washes[entry.wash], epoch = epochOf(entry.layer);
    const application: AnyApplication = paintingReseeded(wash.applications[entry.application], epoch);
    const w = washIndex.get(`${entry.layer}/${entry.wash}`)!, owner = paintingApplicationOwner(wash, application, entry.application);
    const id = stampBoilSeed(`${entry.layer}/${entry.wash}/${entry.application}`, epoch);
    const { deposit, anchors } = compilePaintingDeposit(application, owner, { id, wet: washes[w].wetHistory, brushOf });
    const { medium } = films[entry.layer], { charge } = application, firstOfWash = order.entries.findIndex((other) => other.layer === entry.layer && other.wash === entry.wash) === k;
    const capped = charge.kind === 'paint' && charge.maxSpreadPx !== undefined ? paintingCappedMedium(medium, charge.maxSpreadPx, application.diameterPx) : medium;
    const marks = paintingEntryMarks(deposit, firstOfWash ? washes[w].prewet : null);
    return {
      wash: w, name: owner, deposit, medium: capped, on: 'on' in application ? application.on ?? null : null, bloom: 'effect' in application && application.effect === 'bloom',
      chain: entry.chain, orderTime: entry.orderTime, at: application.at ?? null, anchors,
      datum: stampCanonicalJson({ reads: reads[k].datum, marks, boil: epoch || undefined }), pose: PAINTING_REST_POSE,
    };
  });
  return {
    name: `${evaluation.source}, ${paintingSheetName(order.sheet)}`, width: paintingDocument.widthPx, height: paintingDocument.heightPx, paper: order.sheet.paper, edge: order.sheet.edge, water: PAINT_MEDIA[order.sheet.water],
    clock: order.clock, wrap: paintingDocument.wrap ?? null, films, washes, entries, head: stampCanonicalJson(paintingSheetHead(paintingDocument, order)),
  };
}

/**
 * One sheet a selection paints: its record, the layers on it the selection holds (ordinals in `PaintingTree.layers`,
 * back to front, film f being the f-th), the nodes moving it whole (PaintingSheetOrder's `ownerChain`), and its
 * program at rest.
 */
export type PaintingSheetCompiled = {
  readonly sheet: PaintingSheet; readonly layers: readonly number[]; readonly ownerChain: readonly number[]; readonly program: StampSheetProgram;
};

/**
 * What a selection paints: the tree it was compiled from, which its chains' ordinals index; the root's sheet first,
 * its paper the ground whether or not the selection holds a layer on it, then each own sheet it holds a layer of, in
 * document order; and its composite's steps.
 */
export type PaintingSelectionCompiled = { readonly tree: PaintingTree; readonly sheets: readonly PaintingSheetCompiled[]; readonly steps: readonly StampSheetCompositeStep[] };

/** The node a composite step paints for: a card's sheet's owner, a film's layer. */
export function paintingStepNode({ tree, sheets }: PaintingSelectionCompiled, step: StampSheetCompositeStep): NodeKey {
  const { sheet, layers } = sheets[step.sheet];
  // A card is an own sheet's: the root's paper is the ground, laid apart, never a step.
  return step.kind === 'card' ? sheet.owner! : tree.layers[layers[step.film]].node.key;
}

/**
 * The composite steps (indices in `compiled.steps`) painting what `key` holds: films of the layers it is or holds, and
 * cards of sheets owned by it or by a node under it.
 */
export function paintingNodeSteps(compiled: PaintingSelectionCompiled, key: NodeKey): number[] {
  return compiled.steps.flatMap((step, index) => {
    const node = paintingStepNode(compiled, step);
    return node === key || compiled.tree.byKey.get(node)!.groups.includes(key) ? [index] : [];
  });
}

/**
 * What a selection's compile is told: `layers`, the layers and groups selected (all when left out); `reseed`, boil
 * epochs by the key of the layer or group boiling (ENGINE 4.6), the innermost naming a layer winning. A reseeded
 * layer's every seed is suffixed for its epoch and its entries keyed by it; one at 0 is as written.
 */
export type PaintingSelectionCompileOptions = { readonly layers?: readonly NodeKey[]; readonly reseed?: ReadonlyMap<NodeKey, number> };

/** Each layer `reseed` boils, by its ordinal in `tree.layers`, at its epoch (PaintingSelectionCompileOptions'); none at 0. */
export function paintingLayerEpochs(tree: PaintingTree, reseed?: ReadonlyMap<NodeKey, number>): ReadonlyMap<number, number> {
  if (!reseed?.size) return new Map();
  return new Map(tree.layers.flatMap(({ node, groups }, layer) => {
    const epoch = [node.key, ...groups.toReversed()].map((key) => reseed.get(key)).find((each) => each !== undefined) ?? 0;
    return epoch ? [[layer, epoch] as const] : [];
  }));
}

/**
 * The layers `keys` name (layers, and every layer under a group), as ordinals in `tree.layers`; every layer when
 * left out. Throws on a key naming no layer or group.
 */
export function paintingSelectedLayers(tree: PaintingTree, keys?: readonly NodeKey[]): ReadonlySet<number> {
  if (!keys) return new Set(tree.layers.keys());
  return new Set(keys.flatMap((key) => {
    const place = tree.byKey.get(key);
    if (!place) throw new Error(`painting: ${key} names no layer or group to paint`);
    return paintingLayersUnder(tree, place).map((layer) => tree.layers.indexOf(layer));
  }));
}

/**
 * Compiled selections by evaluation, the brushes resolving them, and the layers selected with their boil epochs: one
 * program a sheet while its evaluation lives, so the poses kept per program (painting-pose.ts) are met again.
 */
const compiledSelections = new WeakMap<PaintingEvaluation, WeakMap<PaintingBrushOf, Map<string, PaintingSelectionCompiled>>>();

/**
 * The selected layers of `evaluation`, each sheet they lie on compiled at rest. A film comes where its layer does in
 * document order; a card where its owner does, before every node under it, so a nested sheet lies on its parent's
 * card and a scene layer under the owner glazes over it. Memoised per `brushOf`, selection and epochs.
 */
export function compilePaintingSelection(evaluation: PaintingEvaluation, brushOf: PaintingBrushOf, { layers, reseed }: PaintingSelectionCompileOptions = {}): PaintingSelectionCompiled {
  const selected = paintingSelectedLayers(evaluation.tree, layers), epochs = paintingLayerEpochs(evaluation.tree, reseed);
  const key = `${[...selected].toSorted((a, b) => a - b).join(',')}|${[...epochs].map(([layer, epoch]) => `${layer}@${epoch}`).join(',')}`;
  let byBrushes = compiledSelections.get(evaluation);
  if (!byBrushes) compiledSelections.set(evaluation, (byBrushes = new WeakMap<PaintingBrushOf, Map<string, PaintingSelectionCompiled>>()));
  let bySelection = byBrushes.get(brushOf);
  if (!bySelection) byBrushes.set(brushOf, (bySelection = new Map<string, PaintingSelectionCompiled>()));
  const known = bySelection.get(key);
  if (known) return known;
  const compiled = compileSelectedLayers(evaluation, brushOf, selected, epochs);
  bySelection.set(key, compiled);
  return compiled;
}

function compileSelectedLayers(
  evaluation: PaintingEvaluation, brushOf: PaintingBrushOf, selected: ReadonlySet<number>, epochs: ReadonlyMap<number, number>,
): PaintingSelectionCompiled {
  const { tree } = evaluation;
  const sheets = paintingSheetOrders(tree, selected).flatMap((order, s): PaintingSheetCompiled[] => (s > 0 && order.layers.length === 0
    ? []
    : [{ sheet: order.sheet, layers: order.layers.map(({ layer }) => layer), ownerChain: order.ownerChain, program: compilePaintingSheet(evaluation, order, brushOf, epochs) }]));
  const steps = tree.nodes.flatMap((place): StampSheetCompositeStep[] => {
    const sheet = sheets.findIndex((compiled) => compiled.sheet === place.sheet);
    if (sheet < 0) return [];
    const placed: StampSheetCompositeStep[] = place.sheet.owner === place.node.key ? [{ kind: 'card', sheet }] : [];
    const film = place.kind === 'layer' ? sheets[sheet].layers.indexOf(tree.layers.indexOf(place)) : -1;
    if (film >= 0) placed.push({ kind: 'film', sheet, film });
    return placed;
  });
  return { tree, sheets, steps };
}
