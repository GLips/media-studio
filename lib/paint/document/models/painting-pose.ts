// painting-pose.ts: a sheet program posed before it's solved (ENGINE 5.3). Each entry's marks, planned at rest, are
// mapped by its chain's map (its nodes' maps, outermost first). A stamp goes where the map puts it, scaled and turned
// there, keeping its noise's seed; an area maps as its outline, densified under a warp. Fields aren't mapped: a posed
// deposit, area and prewet carry a similarity back to rest (StampRestMap), the best fit under a warp, where the solver
// reads fields and noise. Anchored clips, reserves and resists stay. An entry's pose text is in its state key.
import { stampFrozenMarks, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { paintWarpChainKey, paintWarpChainMap, type PaintDeform } from '#lib/paint/animation/models/paint-deform.ts';
import {
  PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityApply, paintSimilarityInverse, paintSimilarityOf, paintSimilarityScale, type PaintSimilarity,
} from '#lib/paint/animation/models/paint-similarity.ts';
import type { CompiledStampArea } from '#lib/paint/painting/models/stamp-area.ts';
import type { CompiledStampBoundary } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import type { CompiledStampBrushedMask } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import { STAMP_KEPT_BYTES } from '#lib/paint/painting/models/stamp-deposit-placement.ts';
import { createKeptByBytes, type StampKeptHeld } from '#lib/paint/painting/models/stamp-kept-memo.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { CompiledStampDeposit, CompiledStampMask } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampBox, StampEdge, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampRestMap, StampSheetPlace } from '#lib/paint/painting/models/stamp-rest-map.ts';
import type { StampSheetEntry, StampSheetPrewet, StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { NodeKey } from './painting-document.ts';
import type { PaintingTree } from './painting-tree.ts';

/**
 * A node's map in its parent's frame: a similarity, or a warp (pins, sway, flutter, a rig's part or skin) whose
 * canonical `text` names every number it's built from, so equal texts are equal maps.
 */
export type PaintingNodePose = { readonly kind: 'similarity'; readonly map: PaintSimilarity } | { readonly kind: 'warp'; readonly map: StampWarpMap; readonly text: string };

/** Each posed node's map by its key; a node left out stands at rest. */
export type PaintingPoses = ReadonlyMap<NodeKey, PaintingNodePose>;

export const paintingSimilarityPose = (map: PaintSimilarity): PaintingNodePose => ({ kind: 'similarity', map });

const REST_POSE = paintingSimilarityPose(PAINT_SIMILARITY_IDENTITY);

/** An entry's `pose` at rest: the canonical text of the identity, as an entry's `pose` holds its map's. */
export const PAINTING_REST_POSE = stampCanonicalJson(PAINT_SIMILARITY_IDENTITY);

/** `pose`'s canonical text: a similarity's words as JSON, a warp's own. */
export const paintingPoseText = (pose: PaintingNodePose) => (pose.kind === 'similarity' ? stampCanonicalJson(pose.map) : pose.text);

/** `pose` as a map of points. */
export const paintingPoseMap = (pose: PaintingNodePose): StampWarpMap => (pose.kind === 'warp' ? pose.map : (point) => paintSimilarityApply(pose.map, point));

/**
 * `steps` (innermost first) as one pose: a similarity while every step places, else a warp named by its chain's key
 * after `text`, which says whose steps they are where two owners' chains could key alike.
 */
export function paintingDeformsPose(steps: readonly PaintDeform[], text = ''): PaintingNodePose {
  let similarity = PAINT_SIMILARITY_IDENTITY;
  for (const step of steps) {
    if (step.kind !== 'place') return { kind: 'warp', map: paintWarpChainMap(steps), text: `${text}${paintWarpChainKey(steps)}` };
    similarity = paintSimilarityAfter(paintSimilarityOf(step.placement, step.pivot), similarity);
  }
  return paintingSimilarityPose(similarity);
}

/** `outer` after `inner`, one pose: a similarity while both are; a pose at rest leaves the other as it is. */
export function paintingPoseAfter(outer: PaintingNodePose, inner: PaintingNodePose): PaintingNodePose {
  if (outer.kind === 'similarity' && inner.kind === 'similarity') return paintingSimilarityPose(paintSimilarityAfter(outer.map, inner.map));
  if (paintingPoseText(outer) === PAINTING_REST_POSE) return inner;
  if (paintingPoseText(inner) === PAINTING_REST_POSE) return outer;
  const o = paintingPoseMap(outer), i = paintingPoseMap(inner);
  return { kind: 'warp', map: (rest) => o(i(rest)), text: `${paintingPoseText(outer)}∘${paintingPoseText(inner)}` };
}

/** The pose `chain` (ordinals in `tree.nodes`, outermost first) poses by under `poses`. */
export const paintingChainPose = (tree: PaintingTree, chain: readonly number[], poses: PaintingPoses): PaintingNodePose =>
  chain.reduce((pose, node) => paintingPoseAfter(pose, poses.get(tree.nodes[node].node.key) ?? REST_POSE), REST_POSE);

const wordsOf = ({ ma, mb, kx, ky }: PaintSimilarity) => [ma, mb, kx, ky] as const;

/** `map` as a pass reads a placed sheet's: its words, and its inverse's, back to where the sheet was painted. */
export const paintingSheetPlace = (map: PaintSimilarity): StampSheetPlace => ({ laid: wordsOf(map), rest: wordsOf(paintSimilarityInverse(map)) });

/**
 * The similarity taking `points` nearest, in least squares, to where `map` puts them; the identity for none. A
 * warp's stand-in where one similarity must do: a deposit's way back to rest.
 */
export function paintingFitSimilarity(points: readonly StampPoint[], map: StampWarpMap): PaintSimilarity {
  if (!points.length) return PAINT_SIMILARITY_IDENTITY;
  const posed = points.map(map), n = points.length;
  const rx = points.reduce((sum, p) => sum + p.x, 0) / n, ry = points.reduce((sum, p) => sum + p.y, 0) / n;
  const px = posed.reduce((sum, p) => sum + p.x, 0) / n, py = posed.reduce((sum, p) => sum + p.y, 0) / n;
  let a = 0, b = 0, spread = 0;
  points.forEach((p, k) => {
    const ux = p.x - rx, uy = p.y - ry, vx = posed[k].x - px, vy = posed[k].y - py;
    a += ux * vx + uy * vy;
    b += ux * vy - uy * vx;
    spread += ux * ux + uy * uy;
  });
  // Points all at one place only move: nothing says how they turn or scale.
  const ma = spread > 0 ? a / spread : 1, mb = spread > 0 ? b / spread : 0;
  return { ma, mb, kx: px - (ma * rx - mb * ry), ky: py - (mb * rx + ma * ry) };
}

/** Points a side of the grid a warp's stand-in similarity is fit over: the box's corners, edge midpoints and centre among them. */
const POSE_FIT_GRID = 5;

/**
 * The similarity standing for `pose` over `box` (rest px): itself, or under a warp the best fit (paintingFitSimilarity)
 * over a grid across the box, with how far the warp strays from it there, px. A shot's lattice and a reveal read a
 * bent film alike through it.
 */
export function paintingPoseFitOver(pose: PaintingNodePose, { x0, y0, x1, y1 }: StampBox): { readonly fit: PaintSimilarity; readonly stray: number } {
  if (pose.kind === 'similarity') return { fit: pose.map, stray: 0 };
  const points: StampPoint[] = [], last = POSE_FIT_GRID - 1;
  for (let j = 0; j <= last; j++) for (let i = 0; i <= last; i++) points.push({ x: x0 + ((x1 - x0) * i) / last, y: y0 + ((y1 - y0) * j) / last });
  const fit = paintingFitSimilarity(points, pose.map);
  const stray = Math.max(...points.map((point) => {
    const bent = pose.map(point), fitted = paintSimilarityApply(fit, point);
    return Math.hypot(bent.x - fitted.x, bent.y - fitted.y);
  }));
  return { fit, stray };
}

/** How far apart a warp's outline points are before it maps them, px: a curve bends between them by little more. */
const WARP_DENSIFY = 2;

/** `ring` with points added so none is more than WARP_DENSIFY px from the next, open (`closed` false) or closed. */
function densified(ring: readonly StampPoint[], closed: boolean): StampPoint[] {
  const out: StampPoint[] = [], last = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < last; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / WARP_DENSIFY));
    for (let k = 0; k < steps; k++) out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
  }
  if (!closed && ring.length) out.push(ring[ring.length - 1]);
  return out;
}

/**
 * A pose's map as the marks it moves read it: each point mapped, the map's local scale (√|det J|) and turn at a
 * point, the similarity it fits over some points (a deposit's, an area's), an outline made ready to map, and a tag.
 */
type PaintingMap = {
  readonly point: (point: StampPoint) => StampPoint;
  readonly local: (point: StampPoint) => { readonly scale: number; readonly turn: number };
  readonly fit: (points: readonly StampPoint[]) => PaintSimilarity;
  readonly outline: (ring: readonly StampPoint[], closed: boolean) => readonly StampPoint[];
  readonly tag: string;
};

function paintingMapOf(pose: PaintingNodePose, text: string): PaintingMap {
  const tag = `posed${text}`;
  if (pose.kind === 'similarity') {
    const { map } = pose, local = { scale: paintSimilarityScale(map), turn: Math.atan2(map.mb, map.ma) };
    return { point: (point) => paintSimilarityApply(map, point), local: () => local, fit: () => map, outline: (ring) => ring, tag };
  }
  const { map } = pose;
  return {
    point: map,
    // J by central differences half a pixel each way: its polar decomposition's turn, and √|det J| its scale.
    local: ({ x, y }) => {
      const r = map({ x: x + 0.5, y }), l = map({ x: x - 0.5, y }), d = map({ x, y: y + 0.5 }), u = map({ x, y: y - 0.5 });
      const a = r.x - l.x, c = r.y - l.y, b = d.x - u.x, e = d.y - u.y;
      return { scale: Math.sqrt(Math.abs(a * e - b * c)), turn: Math.atan2(c - b, a + e) };
    },
    fit: (points) => paintingFitSimilarity(points, map),
    outline: densified,
    tag,
  };
}

/** What an element's own similarity under `by`, fit over `points`, gives it: a scale for widths, and its way back to rest. */
function fitOf(by: PaintingMap, points: readonly StampPoint[]): { readonly scale: number; readonly rest: StampRestMap } {
  const map = by.fit(points);
  return { scale: paintSimilarityScale(map), rest: wordsOf(paintSimilarityInverse(map)) };
}

/** A stamp where the map puts it, scaled and turned as the map is there, its rest point where it was placed. */
const mappedStamps = (stamps: FrozenStampMarks, by: PaintingMap) => stampFrozenMarks(stamps.map((stamp) => {
  const { scale, turn } = by.local(stamp);
  return {
    ...stamp, ...by.point(stamp), tint: stamp.tint, diameter: stamp.diameter * scale, rotation: stamp.rotation + turn, grainTurn: stamp.grainTurn + turn,
    rest: stamp.rest ?? Object.freeze({ x: stamp.x, y: stamp.y }),
  };
}));

const mappedOutline = (ring: readonly StampPoint[], by: PaintingMap, closed: boolean) => by.outline(ring, closed).map((point) => by.point(point));

const mappedBoundary = (boundary: CompiledStampBoundary, by: PaintingMap, scale: number): CompiledStampBoundary =>
  ({ ...boundary, path: mappedOutline(boundary.path, by, false), reach: boundary.reach * scale });

/** `edge`'s widths scaled; its ragged noise keeps its scale, read at rest. */
const mappedEdge = ({ soft, ragged }: StampEdge, scale: number): StampEdge =>
  ({ ...(soft !== undefined && { soft: soft * scale }), ...(ragged && { ragged: { amount: ragged.amount * scale, scale: ragged.scale } }) });

/** `area` mapped: its outline, rings and treated stretches, its widths scaled, its ragged noise read back at rest. */
function mappedArea(area: CompiledStampArea, by: PaintingMap): CompiledStampArea {
  const { scale, rest } = fitOf(by, area.rings?.flat() ?? area.polygon);
  const rings = area.rings?.map((ring) => mappedOutline(ring, by, true));
  return {
    ...area, polygon: rings?.[0] ?? mappedOutline(area.polygon, by, true), ...(rings && { rings }),
    ...(area.edge && { edge: mappedEdge(area.edge, scale) }), ...(area.inset !== undefined && { inset: area.inset * scale }),
    ...(area.boundaries && { boundaries: area.boundaries.map((boundary) => mappedBoundary(boundary, by, scale)) }), rest,
  };
}

const mappedBrushed = (brushed: CompiledStampBrushedMask, by: PaintingMap): CompiledStampBrushedMask => ({
  ...brushed, id: `${brushed.id}|${by.tag}`,
  marks: brushed.marks.map((mark) => ({ ...mark, diameter: mark.diameter * fitOf(by, mark.stamps).scale, stamps: mappedStamps(mark.stamps, by), dualStamps: mappedStamps(mark.dualStamps, by) })),
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
  const barrier = deposit.kind === 'flood' ? deposit.flood.barrier.rings?.flat() ?? deposit.flood.barrier.polygon : [];
  const { scale, rest } = fitOf(by, [...deposit.stamps, ...barrier]);
  const common = {
    ...deposit, diameter: deposit.diameter * scale, rest,
    stamps: mappedStamps(deposit.stamps, by), dualStamps: mappedStamps(deposit.dualStamps, by), mask: mapFluid(deposit.mask),
    ...(deposit.within && { within: deposit.within.map((area, k) => (anchors.within.has(k) ? area : mappedArea(area, by))) }),
  };
  if (deposit.kind !== 'flood') return common;
  return { ...common, kind: 'flood', flood: { ...deposit.flood, barrier: mappedArea(deposit.flood.barrier, by) } };
}

/** `prewet` mapped by `by`, its held fluid's ops mapped but those anchored, its water read back at rest. */
function mappedPrewet(prewet: StampSheetPrewet, by: PaintingMap, mapFluid: (mask: CompiledStampMask | null) => CompiledStampMask | null): StampSheetPrewet {
  const area = mappedArea(prewet.area, by);
  return { ...prewet, area, held: mapFluid(prewet.held), rest: area.rest };
}

/**
 * The most bytes the kept poses hold, roughly, the least recently asked for given up first: a few frames of a rigged
 * shot. Bytes, not poses a program: one pose of a rigged heron's sheets is tens of MB, so a count outgrows a page.
 */
export const PAINTING_POSES_KEPT_BYTES = 256 * 2 ** 20;

const programIds = new WeakMap<StampSheetProgram, number>();
let programsSeen = 0;
/** Kept poses by program and maps' texts. */
const posesKept = createKeptByBytes<string, StampSheetProgram>(PAINTING_POSES_KEPT_BYTES);

/** What the poses kept hold now: how many, and their bytes, roughly. */
export const paintingPosesKept = (): StampKeptHeld => posesKept.held();

/** What `posed` holds that its program doesn't, in bytes, roughly: its posed entries' stamps. */
const posedBytes = (program: StampSheetProgram, posed: StampSheetProgram) => STAMP_KEPT_BYTES * posed.entries.reduce((sum, { deposit }, k) =>
  (deposit === program.entries[k].deposit ? sum : sum + deposit.stamps.length + deposit.dualStamps.length), 0);

/**
 * `program` (compiled from `tree`) with each entry posed by its chain's map in `poses`, each wash's prewet by its first
 * entry's. Kept by the program object and its maps' texts, as many as PAINTING_POSES_KEPT_BYTES holds, a pose met
 * again counted as a pose hit: met again only through one compile (compilePaintingSelection's memo).
 */
export function paintingSheetPosed(tree: PaintingTree, program: StampSheetProgram, poses: PaintingPoses, costs?: StampPaintCostTally): StampSheetProgram {
  const chained = program.entries.map((entry) => paintingChainPose(tree, entry.chain, poses)), texts = chained.map(paintingPoseText);
  if (texts.every((text) => text === PAINTING_REST_POSE)) return program;
  let id = programIds.get(program);
  if (id === undefined) programIds.set(program, (id = programsSeen++));
  const key = `${id}\n${texts.join('\n')}`, known = posesKept.get(key);
  costs?.count(known ? 'pose hits' : 'poses made');
  if (known) return known;
  const posed = paintingSheetPosedBy(program, chained, texts);
  posesKept.set(key, posed, posedBytes(program, posed) + 2 * key.length);
  return posed;
}

/** `program` with entry k posed by `chained[k]`, whose canonical text is `texts[k]`. */
function paintingSheetPosedBy(program: StampSheetProgram, chained: readonly PaintingNodePose[], texts: readonly string[]): StampSheetProgram {
  const mappedFluid = new Map<string, Map<CompiledStampMask, CompiledStampMask>>(), maps = new Map<string, PaintingMap>();
  const mapperFor = (by: PaintingMap, anchored: ReadonlySet<CompiledStampMask>) => {
    if (!mappedFluid.has(by.tag)) mappedFluid.set(by.tag, new Map());
    return fluidMapper(by, anchored, mappedFluid.get(by.tag)!);
  };
  const posed = program.entries.map((entry, k) => {
    const pose = texts[k];
    if (pose === PAINTING_REST_POSE) return { entry: { ...entry, pose }, by: null };
    let by = maps.get(pose);
    if (!by) maps.set(pose, (by = paintingMapOf(chained[k], pose)));
    return { entry: { ...entry, deposit: mappedDeposit(entry, by, mapperFor(by, entry.anchors.masks)), pose }, by };
  });
  const washes = program.washes.map((wash, w) => {
    const by = posed.find(({ entry }) => entry.wash === w)?.by;
    return wash.prewet && by ? { ...wash, prewet: mappedPrewet(wash.prewet, by, mapperFor(by, wash.prewet.anchored)) } : wash;
  });
  return { ...program, washes, entries: posed.map(({ entry }) => entry) };
}
