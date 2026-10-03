// painting-pose.ts: a sheet program posed before it's solved (ENGINE 5.3). Each entry's marks are mapped by its
// chain's map: its groups' maps, each in its parent's frame, composed outermost first. Clips, reserves and resists
// anchored to the paper stay. Each posed entry carries its map's canonical text in `pose`, which its state key reads
// beside its datum: equal maps, equal keys.
//
// So far a map is a move of the deposit's geometry. The shot's slice replaces this with marks mapped by any
// similarity and fields read at rest coordinates. Negative space: a noise field and a ragged edge stay where the
// paper is, unmoved.

import { stampFrozenMarks, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { CompiledStampArea } from '#lib/paint/painting/models/stamp-area.ts';
import type { CompiledStampBoundary } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import type { CompiledStampBrushedMask } from '#lib/paint/painting/models/stamp-brushed-mask.ts';
import type { CompiledStampAction } from '#lib/paint/painting/models/stamp-paint-action.ts';
import type { StampSeededPaintField } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { CompiledStampDeposit, CompiledStampMask } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampSheetEntry, StampSheetPrewet, StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '#lib/paint/painting/models/stamp-sheet-refusal.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';

/** Each group's map by its ordinal, in its parent's frame; a group left out stands at rest. */
export type PaintingPoses = ReadonlyMap<number, PaintSimilarity>;

/** The canonical text of `map`, as an entry's `pose` holds it. */
export const paintingPoseText = (map: PaintSimilarity) => stampCanonicalJson(map);

/** An entry's `pose` at rest. */
export const PAINTING_REST_POSE = paintingPoseText(PAINT_SIMILARITY_IDENTITY);

/** The map `chain` (group ordinals, outermost first) poses its marks by. */
export const paintingChainMap = (chain: readonly number[], poses: PaintingPoses): PaintSimilarity =>
  chain.reduce((map, group) => paintSimilarityAfter(map, poses.get(group) ?? PAINT_SIMILARITY_IDENTITY), PAINT_SIMILARITY_IDENTITY);

/** A move, document px. */
type PaintingMove = { readonly x: number; readonly y: number };

const movedPoint = <P extends StampPoint>(point: P, { x, y }: PaintingMove): P => ({ ...point, x: point.x + x, y: point.y + y });

const movedStamps = (stamps: FrozenStampMarks, by: PaintingMove) => stampFrozenMarks(stamps.map((stamp) => movedPoint(stamp, by)));

const movedBoundary = (boundary: CompiledStampBoundary, by: PaintingMove): CompiledStampBoundary => ({ ...boundary, path: boundary.path.map((point) => movedPoint(point, by)) });

/** `area` moved by `by`: its outline, its rings and its treated stretches. */
function movedArea(area: CompiledStampArea, by: PaintingMove): CompiledStampArea {
  const rings = area.rings?.map((ring) => ring.map((point) => movedPoint(point, by)));
  return {
    ...area, polygon: rings?.[0] ?? area.polygon.map((point) => movedPoint(point, by)), ...(rings && { rings }),
    ...(area.boundaries && { boundaries: area.boundaries.map((boundary) => movedBoundary(boundary, by)) }),
  };
}

/** A field's geometry moved by `by`; a noise field, texture rather than place, stays. */
function movedField<T>(field: StampSeededPaintField<T>, by: PaintingMove): StampSeededPaintField<T> {
  if (field.kind === 'linear') return { ...field, from: movedPoint(field.from, by), to: movedPoint(field.to, by) };
  if (field.kind === 'radial') return { ...field, center: movedPoint(field.center, by) };
  return field;
}

/** `action` moved by `by`: a paint's material field, which a linear or radial one lays by place. */
const movedAction = (action: CompiledStampAction, by: PaintingMove): CompiledStampAction => (action.kind === 'paint' ? { ...action, material: movedField(action.material, by) } : action);

/** What a moved op's ID gains, so it's another op than the one at rest. */
const moveTag = ({ x, y }: PaintingMove) => `moved${x},${y}`;

const movedBrushed = (brushed: CompiledStampBrushedMask, by: PaintingMove): CompiledStampBrushedMask => ({
  ...brushed, id: `${brushed.id}|${moveTag(by)}`,
  marks: brushed.marks.map((mark) => ({ ...mark, stamps: movedStamps(mark.stamps, by), dualStamps: movedStamps(mark.dualStamps, by) })),
});

/**
 * A fluid's ops moved by `by`, each once (`moved` keeps them), those in `anchored` staying: a state of the fluid is one
 * object, which the solver works out once, so entries moved alike share what's moved.
 */
function fluidMover(by: PaintingMove, anchored: ReadonlySet<CompiledStampMask>, moved: Map<CompiledStampMask, CompiledStampMask>) {
  const move = (mask: CompiledStampMask | null): CompiledStampMask | null => {
    if (!mask) return null;
    const known = moved.get(mask);
    if (known) return known;
    const under = move(mask.under), still = anchored.has(mask), id = still ? mask.id : `${mask.id}|${moveTag(by)}`;
    let next: CompiledStampMask;
    if (mask.kind === 'mask') next = { ...mask, id, under, area: still ? mask.area : movedArea(mask.area, by) };
    else if (mask.kind === 'brushed') next = { ...mask, id, under, brushed: still ? mask.brushed : movedBrushed(mask.brushed, by) };
    else next = { ...mask, id, under, area: mask.area && !still ? movedArea(mask.area, by) : mask.area };
    moved.set(mask, next);
    return next;
  };
  return move;
}

/** `entry`'s deposit moved by `by`: its stamps, its paint's field, a flood's barrier, scale and load, its areas and fluid, all but its anchors. */
function movedDeposit(entry: StampSheetEntry, by: PaintingMove, moveFluid: (mask: CompiledStampMask | null) => CompiledStampMask | null): CompiledStampDeposit {
  const { deposit, anchors } = entry;
  const common = {
    ...deposit,
    stamps: movedStamps(deposit.stamps, by), dualStamps: movedStamps(deposit.dualStamps, by), action: movedAction(deposit.action, by), mask: moveFluid(deposit.mask),
    ...(deposit.within && { within: deposit.within.map((area, k) => (anchors.within.has(k) ? area : movedArea(area, by))) }),
  };
  if (deposit.kind !== 'flood') return common;
  const { flood } = deposit;
  return {
    ...common, kind: 'flood',
    flood: { ...flood, barrier: movedArea(flood.barrier, by), scale: { ...flood.scale, x0: flood.scale.x0 + by.x, y0: flood.scale.y0 + by.y }, load: movedField(flood.load, by) },
  };
}

/** `prewet` moved by `by`, its held fluid's ops moved but those anchored. */
const movedPrewet = (prewet: StampSheetPrewet, by: PaintingMove, moveFluid: (mask: CompiledStampMask | null) => CompiledStampMask | null): StampSheetPrewet =>
  ({ ...prewet, area: movedArea(prewet.area, by), water: movedField(prewet.water, by), held: moveFluid(prewet.held) });

/**
 * `program` with each entry posed by its chain's map in `poses`, and each wash's prewet by its first entry's. Refuses
 * a map that turns or scales: the solver poses by moves so far.
 */
export function paintingSheetPosed(program: StampSheetProgram, poses: PaintingPoses): StampSheetProgram {
  const movedFluid = new Map<string, Map<CompiledStampMask, CompiledStampMask>>();
  const moverFor = (by: PaintingMove, anchored: ReadonlySet<CompiledStampMask>) => {
    const tag = moveTag(by);
    if (!movedFluid.has(tag)) movedFluid.set(tag, new Map());
    return fluidMover(by, anchored, movedFluid.get(tag)!);
  };
  const posed = program.entries.map((entry) => {
    const map = paintingChainMap(entry.chain, poses);
    if (map.ma !== 1 || map.mb !== 0) throw new StampSheetRefusal(`painting: ${entry.name} is posed by a turn or a scale, and the solver poses by moves only so far`);
    const by = { x: map.kx, y: map.ky }, pose = paintingPoseText(map);
    if (by.x === 0 && by.y === 0) return { entry: { ...entry, pose }, by };
    return { entry: { ...entry, deposit: movedDeposit(entry, by, moverFor(by, entry.anchors.masks)), pose }, by };
  });
  const washes = program.washes.map((wash, w) => {
    const first = posed.find(({ entry }) => entry.wash === w);
    if (!wash.prewet || !first || (first.by.x === 0 && first.by.y === 0)) return wash;
    return { ...wash, prewet: movedPrewet(wash.prewet, first.by, moverFor(first.by, wash.prewet.anchored)) };
  });
  return { ...program, washes, entries: posed.map(({ entry }) => entry) };
}
