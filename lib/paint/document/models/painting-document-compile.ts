// painting-document-compile.ts: a selection of an evaluation's layers as the programs the wash solver runs
// (stamp-sheet-program.ts), one per sheet they lie on (ENGINE 4.1): a film per selected layer with its slots, washes
// and applications in the sheet's order, each deposit planned at rest, with the canonical text of what each entry
// reads (ENGINE 4.2) and of the sheet's head, from which a solve chains its state keys; and the steps compositing them
// (ENGINE 5.4). Keys name things in messages only: deposits are named by ordinals and seeded by their tips. Posing
// comes after (painting-pose.ts).
//
// Negative space: unclocked only, the solver's limit so far. A clocked wash is refused by name, not painted wrong.
import { PAINT_MEDIA, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMixturePigment } from '#lib/paint/materials/models/paint-pigment.ts';
import { stampBrushedMasksUnder } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import type { CompiledStampDeposit } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampSheetCompositeStep, StampSheetEntry, StampSheetFilm, StampSheetPrewet, StampSheetProgram, StampSheetWash } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '#lib/paint/painting/models/stamp-sheet-refusal.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { compilePaintingArea } from './painting-area-compile.ts';
import { compilePaintingDeposit, compilePaintingFluid, paintingMixPigments, type PaintingBrushOf } from './painting-deposit-compile.ts';
import type { AnyApplication, NodeKey, Prewet, Wash } from './painting-document.ts';
import { paintingEntryReads, paintingSheetHead } from './painting-entry-reads.ts';
import { PAINTING_REST_POSE } from './painting-pose.ts';
import { paintingApplicationOwner } from './painting-problem.ts';
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
 * `order`, a sheet's order in `evaluation`, as its program at rest, brushes resolved by `brushOf`. Refuses what the
 * solver can't paint so far: a clocked wash, a lift in a direct wash.
 */
function compilePaintingSheet(evaluation: PaintingEvaluation, order: PaintingSheetOrder, brushOf: PaintingBrushOf): StampSheetProgram {
  const { document: paintingDocument, tree } = evaluation;
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

/**
 * One sheet a selection paints: its record, the layers on it the selection holds (ordinals in `PaintingTree.layers`,
 * back to front, film f being the f-th), and its program at rest.
 */
export type PaintingSheetCompiled = { readonly sheet: PaintingSheet; readonly layers: readonly number[]; readonly program: StampSheetProgram };

/**
 * What a selection paints: the root's sheet first, its paper the ground whether or not the selection holds a layer on
 * it, then each own sheet it holds a layer of, in document order; and its composite's steps.
 */
export type PaintingSelectionCompiled = { readonly sheets: readonly PaintingSheetCompiled[]; readonly steps: readonly StampSheetCompositeStep[] };

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
 * Compiled selections by evaluation, the brushes resolving them and the layers selected: one program a sheet while its
 * evaluation lives, so the poses kept per program (painting-pose.ts) are met again.
 */
const compiledSelections = new WeakMap<PaintingEvaluation, WeakMap<PaintingBrushOf, Map<string, PaintingSelectionCompiled>>>();

/**
 * The layers of `evaluation` that `keys` select (all when left out), each sheet they lie on compiled to its program
 * at rest, brushes by `brushOf`. An own sheet's card comes where its owner does, before anything under it, a nested
 * sheet's inside its parent's run; each film where its layer does. Memoised per selection.
 */
export function compilePaintingSelection(evaluation: PaintingEvaluation, brushOf: PaintingBrushOf, keys?: readonly NodeKey[]): PaintingSelectionCompiled {
  const selected = paintingSelectedLayers(evaluation.tree, keys), key = [...selected].toSorted((a, b) => a - b).join(',');
  let byBrushes = compiledSelections.get(evaluation);
  if (!byBrushes) compiledSelections.set(evaluation, (byBrushes = new WeakMap<PaintingBrushOf, Map<string, PaintingSelectionCompiled>>()));
  let bySelection = byBrushes.get(brushOf);
  if (!bySelection) byBrushes.set(brushOf, (bySelection = new Map<string, PaintingSelectionCompiled>()));
  const known = bySelection.get(key);
  if (known) return known;
  const compiled = compileSelectedLayers(evaluation, brushOf, selected);
  bySelection.set(key, compiled);
  return compiled;
}

function compileSelectedLayers(evaluation: PaintingEvaluation, brushOf: PaintingBrushOf, selected: ReadonlySet<number>): PaintingSelectionCompiled {
  const { tree } = evaluation;
  const sheets = paintingSheetOrders(tree, selected).flatMap((order, s): PaintingSheetCompiled[] => (s > 0 && order.layers.length === 0
    ? []
    : [{ sheet: order.sheet, layers: order.layers.map(({ layer }) => layer), program: compilePaintingSheet(evaluation, order, brushOf) }]));
  const steps = tree.nodes.flatMap((place): StampSheetCompositeStep[] => {
    const sheet = sheets.findIndex((compiled) => compiled.sheet === place.sheet);
    if (sheet < 0) return [];
    const placed: StampSheetCompositeStep[] = place.sheet.owner === place.node.key ? [{ kind: 'card', sheet }] : [];
    const film = place.kind === 'layer' ? sheets[sheet].layers.indexOf(tree.layers.indexOf(place)) : -1;
    if (film >= 0) placed.push({ kind: 'film', sheet, film });
    return placed;
  });
  return { sheets, steps };
}
