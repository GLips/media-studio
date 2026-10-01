// paint-motion-frame.ts: a scene's motion (a tree of nodes, and plays of clips on them through writers' clocks)
// checked once, then evaluated as a pure function of `t` into each group's frame state (plan 1, phase 3's contract).
//
// Per node: its boil wobble (rest space), its own deform (pins, flutter, then sway), each ancestor's nearest first, then the
// placements, its own then its ancestors'. Every number a warp is built from is rounded to the steps its key is
// written in, so equal keys are equal maps, and two frames inside one hold share a key.
//
// Negative space: no paint is compiled here. A live node gets its posed map, its pins' moves and a key, and its caller
// re-places.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINT_BOIL_WOBBLE, paintBoilDisplacementMap } from './paint-boil-displacement.ts';
import { paintChannelConflicts, paintStrokeBoilEpoch, type PaintChannelWriter } from './paint-channels.ts';
import { PAINT_ANIMATION_FPS, paintClockStepProblem, paintClockTimeAt, type PaintClock, type PaintClockStep } from './paint-clock.ts';
import type { StampGroupFrameState, StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import {
  paintBreatheScaleAt, paintFlutterMap, paintFlutterSpreadAt, paintIdPhase, paintMotionClipDuration, paintMotionClipPins, paintMotionClipProblem,
  paintPlaceClipAt, paintPoseClipAt, paintSwayAngleAt, paintSwayMap, type PaintFlutterClip, type PaintMotionClip, type PaintSwayClip,
} from './paint-motion-clips.ts';
import {
  compilePaintPin, paintPinPlacement, paintPinProblem, paintPinShifts, paintPinWarp, paintPlacementIsRest, paintPlacementKey,
  paintWarpWorstFold, type CompiledPaintPin, type PaintPinRig,
} from './paint-pins.ts';

/**
 * How a node's marks live: `stuck` (its layer carried; the default), `live` (re-placed from its posed geometry every
 * evaluated frame) or boiling every `every` animation frames once its reveal ends: wobbled as a layer warp
 * (`amount` px at `scale` px; PAINT_BOIL_WOBBLE when left out), or with `reseed`, its marks' randomness re-rolled.
 */
export type PaintMarks = 'stuck' | 'live' | { readonly boil: { readonly every: number; readonly amount?: number; readonly scale?: number; readonly reseed?: true } };

/** The clock steps a node may carry: holds and freezes, which its writers, its reveal and every node under it read through. */
export type PaintNodeClockStep = Extract<PaintClockStep, { kind: 'hold' | 'freeze' }>;

/**
 * A group as motion sees it. `box`: its painted layer's extent in rest px, where folds are checked. `pivot`: what its
 * placement turns about (the painting's origin when left out). `revealEnd`: the scene second its reveal finishes,
 * from which it boils (0 when left out).
 */
export type PaintMotionNode<P extends string = string> = {
  readonly id: string;
  readonly parent?: string;
  readonly box: StampBox;
  readonly pivot?: StampPoint;
  readonly pins?: PaintPinRig<P>;
  readonly marks?: PaintMarks;
  readonly clock?: readonly PaintNodeClockStep[];
  readonly revealEnd?: number;
};

/** A clip played on a node through `clock`, writing until `until` scene seconds if given; `origin` names it in errors. */
export type PaintMotionPlay = { readonly target: string; readonly clip: PaintMotionClip<string>; readonly clock: PaintClock; readonly until?: number; readonly origin: string };

/** A play on `target`, its clip's pins checked against the target's at compile. */
export function paintMotionPlay<P extends string>(target: PaintMotionNode<P>, clip: PaintMotionClip<NoInfer<P>>, timing: { clock: PaintClock; until?: number; origin: string }): PaintMotionPlay {
  return { target: target.id, clip, ...timing };
}

/**
 * A live node's pose this frame: the map its caller carries the rest geometry through to re-place it, its own pins'
 * moves (those at rest left out), and its key. A caller posing a figure reads `pins` (the sac's scale) and poses the
 * figure by it, since a figure posed anew isn't its rest shape carried through a map.
 */
export type PaintLivePose = { readonly map: StampWarpMap; readonly pins: ReadonlyMap<string, StampGroupPlacement>; readonly key: string };

/** One frame: each group's state by id, and each live node's pose. */
export type PaintMotionFrame = { readonly state: StampPaintFrameState; readonly live: ReadonlyMap<string, PaintLivePose> };

type CompiledPlay = PaintMotionPlay & { start: number; end: number };
type CompiledNode = Omit<PaintMotionNode, 'pins'> & { chain: readonly string[]; partClock: PaintClock; pins: ReadonlyMap<string, CompiledPaintPin> };

/** A scene's motion, checked and ready to evaluate. */
export type PaintMotion = {
  readonly nodes: ReadonlyMap<string, CompiledNode>;
  /** Writers by lane (one node's pin, its sway, its placement), each sorted by start. */
  readonly lanes: ReadonlyMap<string, readonly CompiledPlay[]>;
  readonly animationFps: number;
};

const pinLane = (id: string, pin: string) => `${id}#pin:${pin}`;
const swayLane = (id: string) => `${id}#sway`;
const flutterLane = (id: string) => `${id}#flutter`;
const placeLane = (id: string) => `${id}#place`;

/** When a play starts writing, in scene seconds: its clock's first `at` (0 without one), and when it stops. */
function playInterval(play: PaintMotionPlay): { start: number; end: number } {
  const at = play.clock.findIndex((step) => step.kind === 'at'), atStep = play.clock[at];
  const start = atStep?.kind === 'at' ? atStep.start : 0;
  if (play.until !== undefined) return { start, end: play.until };
  const after = at < 0 ? play.clock : play.clock.slice(at + 1);
  if (after.some((step) => step.kind === 'loop')) return { start, end: Infinity };
  const rate = after.reduce((r, step) => (step.kind === 'rate' ? r * step.rate : r), 1);
  return { start, end: start + paintMotionClipDuration(play.clip) / rate };
}

function compileNodes(nodes: readonly PaintMotionNode[], problems: string[]): Map<string, CompiledNode> {
  const byId = new Map<string, PaintMotionNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) problems.push(`${node.id} is declared twice`);
    byId.set(node.id, node);
  }
  const compiled = new Map<string, CompiledNode>();
  for (const node of byId.values()) {
    const chain = [node.id];
    for (let up = node.parent; up !== undefined; up = byId.get(up)?.parent) {
      if (!byId.has(up)) { problems.push(`${node.id}'s parent ${up} isn't a node`); break; }
      if (chain.includes(up)) { problems.push(`${[...chain, up].join(' → ')} is a cycle`); break; }
      chain.push(up);
    }
    const partClock = chain.toReversed().flatMap((id) => byId.get(id)?.clock ?? []);
    for (const step of node.clock ?? []) {
      const problem = paintClockStepProblem(step);
      if (problem) problems.push(`${node.id}: ${problem}`);
    }
    const pins = new Map<string, CompiledPaintPin>();
    for (const [name, pin] of Object.entries(node.pins ?? {})) {
      const problem = paintPinProblem(pin);
      if (problem) problems.push(`${node.id}'s pin '${name}': ${problem}`);
      else pins.set(name, compilePaintPin(pin));
    }
    compiled.set(node.id, { ...node, chain, partClock, pins });
  }
  return compiled;
}

/** The lanes a play writes: each pin it moves, or its node's sway, flutter or placement. */
function playLanes(play: PaintMotionPlay): string[] {
  if (play.clip.kind === 'sway') return [swayLane(play.target)];
  if (play.clip.kind === 'flutter') return [flutterLane(play.target)];
  if (play.clip.kind === 'place') return [placeLane(play.target)];
  return paintMotionClipPins(play.clip).map((pin) => pinLane(play.target, pin));
}

/**
 * `nodes` and `plays` checked and compiled. Problems: nodes that don't make a tree, pins that can't weigh paint, plays
 * on missing nodes or pins, clips and clocks that can't be evaluated, two writers on one lane at once
 * (paintChannelConflicts), and, over `foldCheck`'s scene seconds, any frame whose warp folds, naming the pin.
 */
export function buildPaintMotion(o: { nodes: readonly PaintMotionNode[]; plays: readonly PaintMotionPlay[]; animationFps?: number; foldCheck?: { from: number; to: number } }): { motion: PaintMotion; problems: string[] } {
  const problems: string[] = [];
  const nodes = compileNodes(o.nodes, problems);
  const lanes = new Map<string, CompiledPlay[]>();
  const writers: PaintChannelWriter[] = [];
  for (const play of o.plays) {
    const node = nodes.get(play.target);
    const clipProblem = paintMotionClipProblem(play.clip);
    const clockProblems = play.clock.map(paintClockStepProblem).filter((problem) => problem !== null);
    const missing = paintMotionClipPins(play.clip).filter((pin) => !node?.pins.has(pin));
    if (!node) problems.push(`${play.origin} plays on ${play.target}, which isn't a node`);
    else if (missing.length) problems.push(`${play.origin} moves pins ${missing.map((pin) => `'${pin}'`).join(', ')}, which ${play.target} doesn't have`);
    if (clipProblem) problems.push(`${play.origin}: ${clipProblem}`);
    problems.push(...clockProblems.map((problem) => `${play.origin}: ${problem}`));
    if (!node || missing.length || clipProblem || clockProblems.length) continue;
    const compiled = { ...play, ...playInterval(play) };
    for (const lane of playLanes(play)) {
      lanes.set(lane, [...(lanes.get(lane) ?? []), compiled].toSorted((a, b) => a.start - b.start));
      writers.push({ channel: play.clip.kind === 'place' ? 'place' : 'deform', target: lane, start: compiled.start, end: compiled.end, origin: play.origin });
    }
  }
  problems.push(...paintChannelConflicts(writers));
  const motion: PaintMotion = { nodes, lanes, animationFps: o.animationFps ?? PAINT_ANIMATION_FPS };
  if (o.foldCheck) problems.push(...paintMotionFolds(motion, o.foldCheck));
  return { motion, problems };
}

/** A node's time at scene time `t`: through its own and its ancestors' holds and freezes, outermost first. */
export const paintMotionNodeTimeAt = (motion: PaintMotion, id: string, t: number) => paintClockTimeAt(motion.nodes.get(id)?.partClock ?? [], t, motion.animationFps);

/** The writer on `lane` at node time `time`: the latest to have started, or before any has, the first. */
function activeWriter(motion: PaintMotion, lane: string, time: number): { play: CompiledPlay; local: number } | undefined {
  const plays = motion.lanes.get(lane);
  if (!plays) return undefined;
  const play = plays.findLast((p) => p.start <= time) ?? plays[0];
  return { play, local: paintClockTimeAt(play.clock, Math.min(time, play.end), motion.animationFps) };
}

/** Steps a sway's angle (radians) and a flutter's spread are rounded to, so equal keys are equal maps. */
const ANGLE_STEP = 1e-6, SPREAD_STEP = 1e-6;

/** One node's own deform at scene time `t`: its moved pins, then its flutter, then its sway; null when nothing moves. */
function nodeDeform(motion: PaintMotion, node: CompiledNode, t: number) {
  const time = paintClockTimeAt(node.partClock, t, motion.animationFps);
  const handles = [...node.pins].flatMap(([name, pin]) => {
    const writer = activeWriter(motion, pinLane(node.id, name), time);
    if (!writer) return [];
    const { clip } = writer.play;
    const move = clip.kind === 'breathe' ? { scale: paintBreatheScaleAt(clip, writer.local) } : clip.kind === 'poses' && paintPoseClipAt(clip, writer.local).get(name);
    const placement = paintPinPlacement(move || {});
    return paintPlacementIsRest(placement) ? [] : [{ name, pin, move: placement }];
  });
  const swayWriter = activeWriter(motion, swayLane(node.id), time);
  // SAFETY: only sway clips are filed in a sway lane (playLanes).
  const sway = swayWriter && { clip: swayWriter.play.clip as PaintSwayClip, angle: Math.round(paintSwayAngleAt(swayWriter.play.clip as PaintSwayClip, paintIdPhase(node.id), swayWriter.local) / ANGLE_STEP) };
  const flutterWriter = activeWriter(motion, flutterLane(node.id), time);
  // SAFETY: only flutter clips are filed in a flutter lane (playLanes).
  const flutter = flutterWriter && { clip: flutterWriter.play.clip as PaintFlutterClip, spread: Math.round(paintFlutterSpreadAt(flutterWriter.play.clip as PaintFlutterClip, paintIdPhase(node.id), flutterWriter.local) / SPREAD_STEP) };
  const closed = flutter && flutter.spread !== Math.round(1 / SPREAD_STEP) ? paintFlutterMap(flutter.clip, flutter.spread * SPREAD_STEP) : undefined;
  if (!handles.length && !sway?.angle && !closed) return null;
  const pinned = paintPinWarp(handles), bent = sway?.angle ? paintSwayMap(sway.clip, sway.angle * ANGLE_STEP) : undefined;
  const generators = [closed && { name: 'flutter', map: closed }, bent && { name: 'sway', map: bent }].filter((g) => !!g);
  const parts = [...handles.map(({ name, move }) => `${name}=${paintPlacementKey(move)}`), ...(closed && flutter ? [`flutter=${flutter.spread}`] : []), ...(bent && sway ? [`sway=${sway.angle}`] : [])];
  return {
    map: (rest: StampPoint) => generators.reduce((point, { map }) => map(point), pinned(rest)),
    key: `${node.id}{${parts.join(';')}}`,
    pins: new Map(handles.map(({ name, move }) => [name, move])),
    blame: (at: StampPoint) => [
      ...paintPinShifts(handles, at).map(({ name, shift }) => ({ name: `${node.id}'s pin '${name}'`, shift })),
      ...generators.map(({ name, map }) => ({ name: `${node.id}'s ${name}`, shift: Math.hypot(map(at).x - at.x, map(at).y - at.y) })),
    ],
  };
}

/** The node's deforms composed, own first then each ancestor's nearest first, with its key; null when none moves. */
function chainDeform(motion: PaintMotion, node: CompiledNode, t: number) {
  const levels = node.chain.flatMap((id) => {
    const level = nodeDeform(motion, motion.nodes.get(id)!, t);
    return level ? [level] : [];
  });
  if (!levels.length) return null;
  return {
    map: (rest: StampPoint) => levels.reduce((point, level) => level.map(point), rest),
    key: levels.map((level) => level.key).join('<'),
    blame: (at: StampPoint) => levels.flatMap((level) => level.blame(at)),
  };
}

/** A similarity p ↦ m·p + k, m a complex number (scale and turn): placements compose as these. */
type Similarity = { ma: number; mb: number; kx: number; ky: number };
function similarityOf({ x, y, rotation, scale }: StampGroupPlacement, c: StampPoint): Similarity {
  const ma = scale * Math.cos(rotation), mb = scale * Math.sin(rotation);
  return { ma, mb, kx: c.x + x - (ma * c.x - mb * c.y), ky: c.y + y - (mb * c.x + ma * c.y) };
}
const afterSimilarity = (outer: Similarity, inner: Similarity): Similarity => ({
  ma: outer.ma * inner.ma - outer.mb * inner.mb, mb: outer.mb * inner.ma + outer.ma * inner.mb,
  kx: outer.ma * inner.kx - outer.mb * inner.ky + outer.kx, ky: outer.mb * inner.kx + outer.ma * inner.ky + outer.ky,
});

/** The node's placement: its own then its ancestors', as one placement about its pivot; undefined when none plays. */
function chainPlacement(motion: PaintMotion, node: CompiledNode, t: number): StampGroupPlacement | undefined {
  const placed = node.chain.flatMap((id) => {
    const at = motion.nodes.get(id)!;
    const writer = activeWriter(motion, placeLane(id), paintClockTimeAt(at.partClock, t, motion.animationFps));
    // SAFETY: only place clips are filed in a place lane (playLanes).
    return writer ? [{ placement: paintPlaceClipAt(writer.play.clip as Extract<PaintMotionClip<string>, { kind: 'place' }>, writer.local), pivot: at.pivot ?? { x: 0, y: 0 } }] : [];
  });
  if (!placed.length) return undefined;
  // One placement about the node's own pivot is handed on as played, free of a round trip's rounding.
  if (placed.length === 1 && motion.lanes.has(placeLane(node.id))) return placed[0].placement;
  const whole = placed.reduce<Similarity>((inner, { placement, pivot }) => afterSimilarity(similarityOf(placement, pivot), inner), { ma: 1, mb: 0, kx: 0, ky: 0 });
  const c = node.pivot ?? { x: 0, y: 0 };
  return { x: whole.ma * c.x - whole.mb * c.y + whole.kx - c.x, y: whole.mb * c.x + whole.ma * c.y + whole.ky - c.y, rotation: Math.atan2(whole.mb, whole.ma), scale: Math.hypot(whole.ma, whole.mb) };
}

/** The node's boil epoch at `t`: 0 unless it boils and its reveal has ended (paintStrokeBoilEpoch, on its own time). */
function nodeEpoch(motion: PaintMotion, node: CompiledNode, t: number): number {
  if (typeof node.marks !== 'object') return 0;
  return paintStrokeBoilEpoch(paintClockTimeAt(node.partClock, t, motion.animationFps), node.revealEnd ?? 0, node.marks.boil.every, motion.animationFps);
}

/** A node's frame: its state, and its live pose if it's live. */
function nodeFrame(motion: PaintMotion, node: CompiledNode, t: number): { state: StampGroupFrameState; live?: PaintLivePose } {
  const deform = chainDeform(motion, node, t), placement = chainPlacement(motion, node, t), epoch = nodeEpoch(motion, node, t);
  const boil = typeof node.marks === 'object' ? node.marks.boil : undefined;
  const wobble = boil && !boil.reseed && epoch > 0 ? { map: paintBoilDisplacementMap(node.id, epoch, { amount: boil.amount ?? PAINT_BOIL_WOBBLE.amount, scale: boil.scale ?? PAINT_BOIL_WOBBLE.scale }), key: `~wobble${epoch}` } : undefined;
  const warp = deform && wobble ? { map: (rest: StampPoint) => deform.map(wobble.map(rest)), key: `${wobble.key}|${deform.key}` } : (deform ?? wobble);
  const state: StampGroupFrameState = {
    // A placement at rest is left out: a group handed one is re-laid every frame, though it lies as painted.
    ...(placement && !paintPlacementIsRest(placement) && { placement, ...(node.pivot && { pivot: node.pivot }) }),
    ...(boil?.reseed && epoch > 0 && { epoch }),
    ...(warp && node.marks !== 'live' && { warp: { map: warp.map, key: warp.key } }),
  };
  if (node.marks !== 'live') return { state };
  const pins = nodeDeform(motion, node, t)?.pins ?? new Map<string, StampGroupPlacement>();
  return { state, live: warp ? { map: warp.map, pins, key: warp.key } : { map: (rest) => rest, pins, key: 'rest' } };
}

/** Every group's state at scene time `t`, and every live node's pose: a pure function of the motion and `t`. */
export function paintMotionFrameAt(motion: PaintMotion, t: number): PaintMotionFrame {
  const state = new Map<string, StampGroupFrameState>(), live = new Map<string, PaintLivePose>();
  for (const node of motion.nodes.values()) {
    const frame = nodeFrame(motion, node, t);
    if (Object.keys(frame.state).length) state.set(node.id, frame.state);
    if (frame.live) live.set(node.id, frame.live);
  }
  return { state, live };
}

/**
 * Every node whose deform folds its box at some animation frame from `from` to `to` scene seconds, once each, naming
 * the frame, the point and what moves paint most there. Frames sharing a key are checked once.
 */
export function paintMotionFolds(motion: PaintMotion, { from, to }: { from: number; to: number }): string[] {
  const fps = motion.animationFps, found: string[] = [];
  for (const node of motion.nodes.values()) {
    const checked = new Set<string>();
    for (let frame = Math.ceil(from * fps - 1e-6); frame / fps <= to; frame++) {
      const t = frame / fps, deform = chainDeform(motion, node, t);
      if (!deform || checked.has(deform.key)) continue;
      checked.add(deform.key);
      const { at, det } = paintWarpWorstFold(deform.map, node.box);
      if (det > 0) continue;
      const most = deform.blame(at).reduce((a, b) => (b.shift > a.shift ? b : a));
      found.push(`${node.id}: at ${t.toFixed(3)}s its warp folds near (${at.x.toFixed(0)}, ${at.y.toFixed(0)}), area ×${det.toFixed(2)}; ${most.name} moves paint there most (${most.shift.toFixed(1)} px)`);
      break;
    }
  }
  return found;
}
