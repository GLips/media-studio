// painting-pose.ts: a sheet program posed before it's solved (ENGINE 5.3). Each entry's marks, planned at rest, are
// mapped by its chain's map (its nodes' maps, each in its parent's frame, outermost first). A stamp goes where the map
// puts it, scaled and turned, keeping where it was placed (its noise's seed); an area maps as its outline. Fields
// aren't mapped: a posed deposit, area and prewet carry the map back to rest (StampRestMap), where the solver reads
// fields, ragged noise and a flood's local scale. Anchored clips, reserves and resists stay. An entry's `pose`, its
// map's canonical text, is in its state key.
//
// Negative space: similarities only. Pins and skin map marks by meshes, which come with the shot's rigs.
import { stampFrozenMarks, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import {
  PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityApply, paintSimilarityInverse, paintSimilarityScale, type PaintSimilarity,
} from '#lib/paint/animation/models/paint-similarity.ts';
import type { CompiledStampArea } from '#lib/paint/painting/models/stamp-area.ts';
import type { CompiledStampBoundary } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import type { CompiledStampBrushedMask } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { CompiledStampDeposit, CompiledStampMask } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampEdge, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampRestMap } from '#lib/paint/painting/models/stamp-rest-map.ts';
import type { StampSheetEntry, StampSheetPrewet, StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';

/** Each node's map by its ordinal in `PaintingTree.nodes`, in its parent's frame; a node left out stands at rest. */
export type PaintingPoses = ReadonlyMap<number, PaintSimilarity>;

/** The canonical text of `map`, as an entry's `pose` holds it. */
export const paintingPoseText = (map: PaintSimilarity) => stampCanonicalJson(map);

/** An entry's `pose` at rest. */
export const PAINTING_REST_POSE = paintingPoseText(PAINT_SIMILARITY_IDENTITY);

/** The map `chain` (node ordinals, outermost first) poses its marks by. */
export const paintingChainMap = (chain: readonly number[], poses: PaintingPoses): PaintSimilarity =>
  chain.reduce((map, node) => paintSimilarityAfter(map, poses.get(node) ?? PAINT_SIMILARITY_IDENTITY), PAINT_SIMILARITY_IDENTITY);

/** A pose's map, as the marks it moves read it: the map, how it scales and turns, and its words back to rest. */
type PaintingMap = { readonly map: PaintSimilarity; readonly scale: number; readonly turn: number; readonly rest: StampRestMap; readonly tag: string };

function paintingMapOf(map: PaintSimilarity, text: string): PaintingMap {
  const back = paintSimilarityInverse(map);
  return { map, scale: paintSimilarityScale(map), turn: Math.atan2(map.mb, map.ma), rest: [back.ma, back.mb, back.kx, back.ky], tag: `posed${text}` };
}

const mappedPoint = <P extends StampPoint>(point: P, { map }: PaintingMap): P => ({ ...point, ...paintSimilarityApply(map, point) });

/** A stamp where the map puts it, scaled and turned with it, its rest point where it was placed. */
const mappedStamps = (stamps: FrozenStampMarks, by: PaintingMap) => stampFrozenMarks(stamps.map((stamp) => ({
  ...mappedPoint(stamp, by), tint: stamp.tint, diameter: stamp.diameter * by.scale, rotation: stamp.rotation + by.turn, grainTurn: stamp.grainTurn + by.turn,
  rest: stamp.rest ?? Object.freeze({ x: stamp.x, y: stamp.y }),
})));

const mappedBoundary = (boundary: CompiledStampBoundary, by: PaintingMap): CompiledStampBoundary =>
  ({ ...boundary, path: boundary.path.map((point) => mappedPoint(point, by)), reach: boundary.reach * by.scale });

/** `edge`'s widths scaled; its ragged noise keeps its scale, read at rest. */
const mappedEdge = ({ soft, ragged }: StampEdge, { scale }: PaintingMap): StampEdge =>
  ({ ...(soft !== undefined && { soft: soft * scale }), ...(ragged && { ragged: { amount: ragged.amount * scale, scale: ragged.scale } }) });

/** `area` mapped: its outline, rings and treated stretches, its widths scaled, its ragged noise read back at rest. */
function mappedArea(area: CompiledStampArea, by: PaintingMap): CompiledStampArea {
  const rings = area.rings?.map((ring) => ring.map((point) => mappedPoint(point, by)));
  return {
    ...area, polygon: rings?.[0] ?? area.polygon.map((point) => mappedPoint(point, by)), ...(rings && { rings }),
    ...(area.edge && { edge: mappedEdge(area.edge, by) }), ...(area.inset !== undefined && { inset: area.inset * by.scale }),
    ...(area.boundaries && { boundaries: area.boundaries.map((boundary) => mappedBoundary(boundary, by)) }), rest: by.rest,
  };
}

const mappedBrushed = (brushed: CompiledStampBrushedMask, by: PaintingMap): CompiledStampBrushedMask => ({
  ...brushed, id: `${brushed.id}|${by.tag}`,
  marks: brushed.marks.map((mark) => ({ ...mark, diameter: mark.diameter * by.scale, stamps: mappedStamps(mark.stamps, by), dualStamps: mappedStamps(mark.dualStamps, by) })),
});

/**
 * A fluid's ops mapped by `by`, each once (`mapped` keeps them), those in `anchored` staying: a state of the fluid is
 * one object, which the solver works out once, so entries posed alike share what's mapped.
 */
function fluidMapper(by: PaintingMap, anchored: ReadonlySet<CompiledStampMask>, mapped: Map<CompiledStampMask, CompiledStampMask>) {
  const map = (mask: CompiledStampMask | null): CompiledStampMask | null => {
    if (!mask) return null;
    const known = mapped.get(mask);
    if (known) return known;
    const under = map(mask.under), still = anchored.has(mask), id = still ? mask.id : `${mask.id}|${by.tag}`;
    let next: CompiledStampMask;
    if (mask.kind === 'mask') next = { ...mask, id, under, area: still ? mask.area : mappedArea(mask.area, by) };
    else if (mask.kind === 'brushed') next = { ...mask, id, under, brushed: still ? mask.brushed : mappedBrushed(mask.brushed, by) };
    else next = { ...mask, id, under, area: mask.area && !still ? mappedArea(mask.area, by) : mask.area };
    mapped.set(mask, next);
    return next;
  };
  return map;
}

/**
 * `entry`'s deposit mapped by `by`: its stamps, size, areas and fluid, all but its anchors, and a flood's barrier;
 * its fields and a flood's scale read back at rest.
 */
function mappedDeposit(entry: StampSheetEntry, by: PaintingMap, mapFluid: (mask: CompiledStampMask | null) => CompiledStampMask | null): CompiledStampDeposit {
  const { deposit, anchors } = entry;
  const common = {
    ...deposit, diameter: deposit.diameter * by.scale, rest: by.rest,
    stamps: mappedStamps(deposit.stamps, by), dualStamps: mappedStamps(deposit.dualStamps, by), mask: mapFluid(deposit.mask),
    ...(deposit.within && { within: deposit.within.map((area, k) => (anchors.within.has(k) ? area : mappedArea(area, by))) }),
  };
  if (deposit.kind !== 'flood') return common;
  return { ...common, kind: 'flood', flood: { ...deposit.flood, barrier: mappedArea(deposit.flood.barrier, by) } };
}

/** `prewet` mapped by `by`, its held fluid's ops mapped but those anchored, its water read back at rest. */
const mappedPrewet = (prewet: StampSheetPrewet, by: PaintingMap, mapFluid: (mask: CompiledStampMask | null) => CompiledStampMask | null): StampSheetPrewet =>
  ({ ...prewet, area: mappedArea(prewet.area, by), held: mapFluid(prewet.held), rest: by.rest });

/** How many poses of one program are kept, the oldest forgotten first: as many as a shot's frames tend to revisit. */
export const PAINTING_POSES_KEPT = 64;
const posesKept = new WeakMap<StampSheetProgram, Map<string, StampSheetProgram>>();

/**
 * `program` with each entry posed by its chain's map in `poses`, each wash's prewet by its first entry's. Kept by its
 * maps (PAINTING_POSES_KEPT a program): a pose met again is the one made before, counted into `costs` as a pose hit.
 */
export function paintingSheetPosed(program: StampSheetProgram, poses: PaintingPoses, costs?: StampPaintCostTally): StampSheetProgram {
  const maps = program.entries.map((entry) => paintingChainMap(entry.chain, poses)), texts = maps.map(paintingPoseText);
  if (texts.every((text) => text === PAINTING_REST_POSE)) return program;
  let kept = posesKept.get(program);
  if (!kept) posesKept.set(program, (kept = new Map<string, StampSheetProgram>()));
  const key = texts.join('\n'), known = kept.get(key);
  costs?.count(known ? 'pose hits' : 'poses made');
  if (known) return known;
  const posed = paintingSheetPosedBy(program, maps, texts);
  kept.set(key, posed);
  if (kept.size > PAINTING_POSES_KEPT) kept.delete(kept.keys().next().value!);
  return posed;
}

/** `program` with entry k posed by `maps[k]`, whose canonical text is `texts[k]`. */
function paintingSheetPosedBy(program: StampSheetProgram, maps: readonly PaintSimilarity[], texts: readonly string[]): StampSheetProgram {
  const mappedFluid = new Map<string, Map<CompiledStampMask, CompiledStampMask>>();
  const mapperFor = (by: PaintingMap, anchored: ReadonlySet<CompiledStampMask>) => {
    if (!mappedFluid.has(by.tag)) mappedFluid.set(by.tag, new Map());
    return fluidMapper(by, anchored, mappedFluid.get(by.tag)!);
  };
  const posed = program.entries.map((entry, k) => {
    const pose = texts[k];
    if (pose === PAINTING_REST_POSE) return { entry: { ...entry, pose }, by: null };
    const by = paintingMapOf(maps[k], pose);
    return { entry: { ...entry, deposit: mappedDeposit(entry, by, mapperFor(by, entry.anchors.masks)), pose }, by };
  });
  const washes = program.washes.map((wash, w) => {
    const by = posed.find(({ entry }) => entry.wash === w)?.by;
    return wash.prewet && by ? { ...wash, prewet: mappedPrewet(wash.prewet, by, mapperFor(by, wash.prewet.anchored)) } : wash;
  });
  return { ...program, washes, entries: posed.map(({ entry }) => entry) };
}
