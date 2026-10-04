// shot-motion.ts: a shot's motion nodes compiled over its occurrences (ENGINE 6.1). A node attaches to an occurrence
// or a painted plane; its parent is implied: the nearest enclosing group occurrence that has a node, else its plane's
// node. A group's node moves all it holds with one phase, seed and map, its pins, sway, flutter and boil included.
// The lanes, clocks and channel law are the animation feature's (paint-motion-compile.ts), read per level.
//
// A writer beside the plays: a plane laid by a callback places its plane node ('place') for all time, so a place play
// on that node clashes. A rigged group's node takes no pins, sway or flutter: its rig deforms all it holds.

import type { PaintBoilWobble } from '#lib/paint/animation/models/paint-boil-displacement.ts';
import { paintChannelConflicts, type PaintChannelWriter } from '#lib/paint/animation/models/paint-channels.ts';
import { paintNodeClockProblem, paintNodeClockSteps, paintPlayClockProblem, sceneSeconds, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import { paintIdPhase, paintMotionClipProblem } from '#lib/paint/animation/models/paint-motion-clips.ts';
import {
  compilePaintBoil, filePaintLevelPlay, paintGlowProblem, paintInheritedGlow, paintLevelLanes, paintLevelLanesSorted, type CompiledPaintLevel, type PaintLevelLanes,
} from '#lib/paint/animation/models/paint-motion-compile.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { StampGroupGlow } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { OccurrenceKey, OccurrenceMotionNode, PaintedShotProps } from './shot-props.ts';
import type { ShotOccurrence } from './shot-occurrences.ts';

/**
 * A plane as motion reads it: its id and its clock's steps (paintNodeClockSteps, checked as it loads); `kind`, whether
 * it paints (only a painted plane's node may bend or boil, a picture plane's only places, and an instanced plane takes
 * none); whether a callback lays it; and, painted, its occurrences.
 */
export type ShotMotionPlane = {
  readonly id: string; readonly kind: 'painted' | 'picture' | 'three' | 'instanced'; readonly clock: readonly PaintSceneStep[]; readonly movingLay: boolean;
  readonly occurrences: readonly ShotOccurrence[];
};

/** How a node's marks live: stuck, its rest space wobbled every `every` frames, or its marks re-rolled (ENGINE 4.6). */
export type CompiledShotMarks =
  | { readonly kind: 'stuck' }
  | { readonly kind: 'wobble'; readonly every: number; readonly wobble: PaintBoilWobble }
  | { readonly kind: 'reseed'; readonly every: number };

/**
 * A node compiled: its own level (id, pivot, phase and lanes), the plane it lies on, its implied `parent` (a node's
 * id; null under none), its `clock` (its plane's, its ancestors' and its own, outermost first), its marks and the glow
 * it gives, its own or its nearest ancestor's.
 */
export type CompiledShotNode = CompiledPaintLevel & {
  readonly plane: string;
  readonly parent: string | null;
  readonly clock: readonly PaintSceneStep[];
  readonly marks: CompiledShotMarks;
  readonly glow: StampGroupGlow | null;
};

/**
 * A shot's motion: its nodes by id, each plane's own clock steps (what its presentation reads), each occurrence's
 * nearest node (itself, else its nearest enclosing group's, else its plane's; none left out), and the animation fps.
 */
export type CompiledShotMotion = {
  readonly nodes: ReadonlyMap<string, CompiledShotNode>;
  readonly planeClocks: ReadonlyMap<string, readonly PaintSceneStep[]>;
  readonly nearest: ReadonlyMap<OccurrenceKey, string>;
  readonly animationFps: number;
};

const motionError = (owner: string, message: string) => paintingProblem('error', owner, 'motion', message);

function compileShotMarks(node: OccurrenceMotionNode, problems: PaintingProblem[]): CompiledShotMarks {
  const marks = node.marks ?? 'stuck';
  if (marks === 'stuck') return { kind: 'stuck' };
  const boil = compilePaintBoil(marks.boil);
  problems.push(...boil.problems.map((problem) => motionError(node.id, problem)));
  return boil.marks;
}

/** Where each name a node may take lies: its plane and its enclosing group occurrences, outermost first. */
type ShotNodeSite = { readonly plane: ShotMotionPlane; readonly groups: readonly OccurrenceKey[] };

function shotNodeSites(planes: readonly ShotMotionPlane[]): Map<string, ShotNodeSite> {
  const sites = new Map<string, ShotNodeSite>();
  for (const plane of planes) {
    sites.set(plane.id, { plane, groups: [] });
    for (const occurrence of plane.occurrences) sites.set(occurrence.key, { plane, groups: occurrence.groups });
  }
  return sites;
}

/** Why `node` can't move what it names, or null: by what it is, and what a rig or a picture plane leaves it. */
function shotNodeSiteProblem(node: OccurrenceMotionNode, site: ShotNodeSite, rigged: ReadonlySet<OccurrenceKey>): string | null {
  const riggedAbove = site.groups.find((group) => rigged.has(group));
  if (riggedAbove) return `lies in ${riggedAbove}, which is rigged: its rig's parts pose all it holds, so nothing in it takes a node`;
  if (rigged.has(node.id) && Object.keys(node.pins ?? {}).length) return 'is rigged: it takes no pins, sway or flutter';
  if (node.id !== site.plane.id || site.plane.kind === 'painted') return null;
  if (site.plane.kind === 'three') return 'is a three plane, drawn through the camera: no node moves it';
  if (site.plane.kind === 'instanced') return 'is an instanced plane: its items take no nodes; each lies where its instances lay it';
  const bends = Object.keys(node.pins ?? {}).length > 0 || (node.marks !== undefined && node.marks !== 'stuck');
  return bends ? 'is a picture plane: its node places it, and pins and boil bend only paint' : null;
}

/**
 * `motion` checked and compiled over `planes`' occurrences: nodes on names of the shot, one each, none under a rigged
 * group and none bending a picture plane or a rigged group; plays on nodes, their clips and clocks sound; no two
 * writers clashing, a moving lay among them. `rigged`: the shot's rigged group occurrences.
 */
export function compileShotMotion(
  planes: readonly ShotMotionPlane[], motion: PaintedShotProps['motion'], rigged: ReadonlySet<OccurrenceKey>, animationFps: number,
): { readonly motion: CompiledShotMotion; readonly problems: readonly PaintingProblem[] } {
  const problems: PaintingProblem[] = [], sites = shotNodeSites(planes), written = new Map<string, OccurrenceMotionNode>();
  for (const node of motion?.nodes ?? []) {
    const site = sites.get(node.id);
    if (written.has(node.id)) problems.push(motionError(node.id, 'has two nodes; a plane or occurrence takes one'));
    else if (!site) problems.push(motionError(node.id, 'names no painted plane or occurrence of this shot'));
    else {
      const problem = shotNodeSiteProblem(node, site, rigged);
      if (problem) problems.push(motionError(node.id, problem));
      else written.set(node.id, node);
    }
    const clockProblem = node.clock && paintNodeClockProblem(node.clock);
    if (clockProblem) problems.push(motionError(node.id, clockProblem));
    const glowProblem = node.glow && node.glow !== 'none' && paintGlowProblem(node.glow);
    if (glowProblem) problems.push(motionError(node.id, glowProblem));
  }
  const planeClocks = new Map(planes.map(({ id, clock }) => [id, clock]));
  // A node's line, nearest first: itself, the enclosing groups that have nodes, then its plane's node.
  const lineOf = (id: string): string[] => {
    const site = sites.get(id)!;
    return [id, ...site.groups.toReversed(), site.plane.id].filter((name, i) => (i === 0 ? true : written.has(name) && name !== id));
  };
  const lanes = new Map<string, PaintLevelLanes>(), compiled = new Map<string, Omit<CompiledShotNode, keyof PaintLevelLanes>>();
  for (const node of written.values()) {
    const line = lineOf(node.id), site = sites.get(node.id)!;
    const lineProblems: string[] = [];
    lanes.set(node.id, paintLevelLanes(node.id, node.pins, lineProblems));
    problems.push(...lineProblems.map((message) => motionError(node.id, message)));
    compiled.set(node.id, {
      id: node.id, plane: site.plane.id, parent: line[1] ?? null, pivot: node.pivot ?? { x: 0, y: 0 }, phase: paintIdPhase(node.id),
      clock: [...site.plane.clock, ...line.toReversed().flatMap((id) => paintNodeClockSteps(written.get(id)?.clock))],
      marks: compileShotMarks(node, problems), glow: paintInheritedGlow(line, (id) => written.get(id)?.glow),
    });
  }
  const writers: PaintChannelWriter[] = [];
  for (const plane of planes) {
    if (plane.movingLay) writers.push({ channel: 'place', target: plane.id, start: sceneSeconds(0), end: sceneSeconds(Infinity), origin: `${plane.id}'s lay callback` });
  }
  for (const play of motion?.plays ?? []) {
    const node = compiled.get(play.target), problem = paintMotionClipProblem(play.clip) ?? paintPlayClockProblem(play.clock);
    if (problem) problems.push(motionError(play.origin, problem));
    else if (!node) problems.push(motionError(play.origin, `plays on ${play.target}, which has no node`));
    else if (sites.get(node.id)!.plane.kind === 'picture' && play.clip.kind !== 'place') problems.push(motionError(play.origin, `bends picture plane ${node.id}, whose node only places it`));
    else if (rigged.has(node.id) && play.clip.kind !== 'place') problems.push(motionError(play.origin, `${node.id} is rigged: it takes no pins, sway or flutter`));
    else {
      const playProblems: string[] = [];
      filePaintLevelPlay(node.id, lanes.get(node.id)!, node.clock, play, writers, playProblems);
      problems.push(...playProblems.map((message) => motionError(play.origin, message)));
    }
  }
  problems.push(...paintChannelConflicts(writers).map((message) => paintingProblem('error', 'motion', '', message)));
  const nodes = new Map([...compiled].map(([id, node]): [string, CompiledShotNode] => [id, { ...node, ...paintLevelLanesSorted(lanes.get(id)!) }]));
  const nearest = new Map(planes.flatMap((plane) => plane.occurrences.flatMap(({ key, groups }) => {
    const found = [key, ...groups.toReversed(), plane.id].find((name) => nodes.has(name));
    return found ? [[key, found] as const] : [];
  })));
  return { motion: { nodes, planeClocks, nearest, animationFps }, problems };
}
