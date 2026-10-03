// stamp-sheet-program.ts: a sheet's one physical history as the wash solver runs it: every application painted on
// one paper, over one wet field, each layer's paint kept in its own film. A document compiles to it
// (lib/paint/document); the solver schedules each entry forward against the field (stamp-sheet-schedule.ts).
//
// Posing moves an entry's marks before a solve, by the groups between its layer and the sheet's owner: a still
// translation each, so a posed entry is its deposit moved, its anchored clips and reserves left on the paper.
//
// Negative space: names (keys) appear only in messages; ordinals and seeds are what a solve reads.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { stampFrozenMarks, type FrozenStampMarks } from '#lib/paint/brush/models/stamp-placement.ts';
import type { CompiledStampArea } from './stamp-area.ts';
import type { CompiledStampBoundary } from './stamp-area-boundaries.ts';
import type { CompiledStampBrushedMask } from './stamp-brushed-mask.ts';
import type { StampSeededPaintField } from './stamp-paint-field.ts';
import type { CompiledStampAction, CompiledStampPaintAction } from './stamp-paint-action.ts';
import type { CompiledStampDeposit, CompiledStampMask, StampMixedPainting, StampMixedPass } from './stamp-paint-recipe-compile.ts';
import type { StampPigmentMixing } from './stamp-pigment-paint.ts';
import type { StampPaintPaper } from './stamp-paint-recipe-types.ts';
import type { StampPoint } from './stamp-region.ts';

/** What an entry waits for over its core before it lands (StampSheetEntry's `on`). */
export type StampSheetWetness = 'wet' | 'damp' | 'dry';

/** One layer's film: the medium its paint lands by, the pigments it mixes (its group's mixing), its name. */
export type StampSheetFilm = { medium: PaintMedium; mixing: StampPigmentMixing; name: string };

/**
 * Clean water laid evenly at a wash's start over `area`, `water` 0..1 by place, held off where `held` masks it; the
 * masks of `held` that stay on the paper when its layer is posed, `anchored`.
 */
export type StampSheetPrewet = { area: CompiledStampArea; water: StampSeededPaintField<number>; held: CompiledStampMask | null; anchored: ReadonlySet<CompiledStampMask> };

/**
 * A wash: its film (an index into `films`), its name, its prewet (null for none), its rim's strength 0..2, the earlier
 * wash of its film whose paint clips it (an index into `washes`, null for none), and whether it touches water at all.
 */
export type StampSheetWash = { film: number; name: string; prewet: StampSheetPrewet | null; rim: number; clipTo: number | null; wetHistory: boolean };

/**
 * What an entry leaves on the paper when posed: which of its deposit's `within` areas (by index), and which masks of
 * its fluid (by object), stay where the paper is.
 */
export type StampSheetAnchors = { within: ReadonlySet<number>; masks: ReadonlySet<CompiledStampMask> };

/**
 * One application in its sheet's order: its deposit planned at rest; the medium its paint lands by (its film's, spread
 * held to its own cap); what it waits for; the group ordinals posing it, outermost first; and `datum`, the canonical
 * text of all it reads besides its posed marks (ENGINE 4.2).
 */
export type StampSheetEntry = {
  wash: number; name: string; deposit: CompiledStampDeposit; medium: PaintMedium; on: StampSheetWetness | null; bloom: boolean;
  chain: readonly number[]; anchors: StampSheetAnchors; datum: string;
};

/**
 * A sheet program, unclocked: the document's size, the sheet's paper and the medium its water dries by, its films
 * back to front, washes and entries in order, and `head`, the canonical text of its incoming state (K₀).
 */
export type StampSheetProgram = {
  width: number; height: number; paper: StampPaintPaper; water: PaintMedium;
  films: readonly StampSheetFilm[]; washes: readonly StampSheetWash[]; entries: readonly StampSheetEntry[]; head: string;
};

/**
 * The painting `program`'s films mix as, a group per film, a pass per wash, holding `deposits` (an entry's each, in
 * order, posed as a solve lays them): the compositor is keyed by deposit object, so it's made for the posed ones.
 */
export function stampSheetMixedPainting(program: StampSheetProgram, deposits: readonly CompiledStampDeposit[]): StampMixedPainting {
  const passes = program.washes.map((wash, w) => {
    const laid: CompiledStampDeposit[] = [];
    return { film: wash.film, id: `film${wash.film}/wash${w}`, wet: wash.wetHistory, deposits: laid };
  });
  program.entries.forEach((entry, k) => passes[entry.wash].deposits.push(deposits[k]));
  return {
    paper: program.paper, mixing: { kind: 'pigment', medium: program.water, pigments: {} },
    groups: program.films.map((film, f) => ({
      id: `film${f}`, mixing: film.mixing, paper: 'ground',
      passes: passes.filter((pass) => pass.film === f).map(({ id, wet, deposits: laid }): StampMixedPass => (wet
        ? { id, kind: 'wash', knockout: false, deposits: laid }
        : { id, kind: 'dry', deposits: laid.filter(stampPaintingDeposit) })),
    })),
  };
}

/** Whether `deposit` lays paint: a direct wash's every one does, as the compiler refuses its lifts. */
const stampPaintingDeposit = (deposit: CompiledStampDeposit): deposit is CompiledStampDeposit<CompiledStampPaintAction> => deposit.action.kind === 'paint';

/** A still translation of a group, document px. */
export type StampSheetPose = { x: number; y: number };

/** Poses by group ordinal; a group left out stands at rest. */
export type StampSheetPoses = ReadonlyMap<number, StampSheetPose>;

/** How far `chain`'s poses move an entry: each group's translation, summed. */
export function stampSheetChainOffset(chain: readonly number[], poses: StampSheetPoses): StampSheetPose {
  let x = 0, y = 0;
  for (const group of chain) {
    const pose = poses.get(group);
    if (pose) {
      x += pose.x;
      y += pose.y;
    }
  }
  return { x, y };
}

const movedPoint = <P extends StampPoint>(point: P, { x, y }: StampSheetPose): P => ({ ...point, x: point.x + x, y: point.y + y });

const movedStamps = (stamps: FrozenStampMarks, by: StampSheetPose) => stampFrozenMarks(stamps.map((stamp) => movedPoint(stamp, by)));

const movedBoundary = (boundary: CompiledStampBoundary, by: StampSheetPose): CompiledStampBoundary => ({ ...boundary, path: boundary.path.map((point) => movedPoint(point, by)) });

/** `area` moved by `by`: its outline, its rings and its treated stretches. */
export function stampAreaMoved(area: CompiledStampArea, by: StampSheetPose): CompiledStampArea {
  const rings = area.rings?.map((ring) => ring.map((point) => movedPoint(point, by)));
  return {
    ...area, polygon: rings?.[0] ?? area.polygon.map((point) => movedPoint(point, by)), ...(rings && { rings }),
    ...(area.boundaries && { boundaries: area.boundaries.map((boundary) => movedBoundary(boundary, by)) }),
  };
}

/** A field's geometry moved by `by`; a noise field, texture rather than place, stays. */
function movedField<T>(field: StampSeededPaintField<T>, by: StampSheetPose): StampSeededPaintField<T> {
  if (field.kind === 'linear') return { ...field, from: movedPoint(field.from, by), to: movedPoint(field.to, by) };
  if (field.kind === 'radial') return { ...field, center: movedPoint(field.center, by) };
  return field;
}

/** `action` moved by `by`: a paint's material field, which a linear or radial one lays by place. */
const movedAction = (action: CompiledStampAction, by: StampSheetPose): CompiledStampAction => (action.kind === 'paint' ? { ...action, material: movedField(action.material, by) } : action);

const movedBrushed = (brushed: CompiledStampBrushedMask, by: StampSheetPose): CompiledStampBrushedMask => ({
  ...brushed, id: `${brushed.id}|moved${by.x},${by.y}`,
  marks: brushed.marks.map((mark) => ({ ...mark, stamps: movedStamps(mark.stamps, by), dualStamps: movedStamps(mark.dualStamps, by) })),
});

/**
 * `mask`'s chain moved by `by`, each op but those in `anchored`, shared ops moved once through `moved`: a state of the
 * fluid is one object, which the solver works out once.
 */
function movedMask(mask: CompiledStampMask | null, by: StampSheetPose, anchored: ReadonlySet<CompiledStampMask>, moved: Map<CompiledStampMask, CompiledStampMask>): CompiledStampMask | null {
  if (!mask) return null;
  const known = moved.get(mask);
  if (known) return known;
  const under = movedMask(mask.under, by, anchored, moved), still = anchored.has(mask);
  const id = still ? mask.id : `${mask.id}|moved${by.x},${by.y}`;
  let next: CompiledStampMask;
  if (mask.kind === 'mask') next = { ...mask, id, under, area: still ? mask.area : stampAreaMoved(mask.area, by) };
  else if (mask.kind === 'brushed') next = { ...mask, id, under, brushed: still ? mask.brushed : movedBrushed(mask.brushed, by) };
  else next = { ...mask, id, under, area: mask.area && !still ? stampAreaMoved(mask.area, by) : mask.area };
  moved.set(mask, next);
  return next;
}

/**
 * `entry`'s deposit posed by `by`: its stamps, its paint's field, a flood's barrier, scale and load, its `within` areas
 * and its fluid's ops moved, all but `anchors`. At rest (0, 0) it's the deposit itself. `moved` shares posed fluid between entries.
 */
export function stampSheetDepositPosed(entry: Pick<StampSheetEntry, 'deposit' | 'anchors'>, by: StampSheetPose, moved: Map<CompiledStampMask, CompiledStampMask>): CompiledStampDeposit {
  const { deposit, anchors } = entry;
  if (by.x === 0 && by.y === 0) return deposit;
  const common = {
    ...deposit,
    stamps: movedStamps(deposit.stamps, by), dualStamps: movedStamps(deposit.dualStamps, by), action: movedAction(deposit.action, by),
    mask: movedMask(deposit.mask, by, anchors.masks, moved),
    ...(deposit.within && { within: deposit.within.map((area, k) => (anchors.within.has(k) ? area : stampAreaMoved(area, by))) }),
  };
  if (deposit.kind !== 'flood') return common;
  const { flood } = deposit;
  return {
    ...common, kind: 'flood',
    flood: { ...flood, barrier: stampAreaMoved(flood.barrier, by), scale: { ...flood.scale, x0: flood.scale.x0 + by.x, y0: flood.scale.y0 + by.y }, load: movedField(flood.load, by) },
  };
}

/** `prewet` posed by `by`, its held fluid's ops moved but those anchored. */
export function stampSheetPrewetPosed(prewet: StampSheetPrewet, by: StampSheetPose, moved: Map<CompiledStampMask, CompiledStampMask>): StampSheetPrewet {
  if (by.x === 0 && by.y === 0) return prewet;
  return { ...prewet, area: stampAreaMoved(prewet.area, by), water: movedField(prewet.water, by), held: movedMask(prewet.held, by, prewet.anchored, moved) };
}
