// paint-motion-compile.ts: a scene's motion as written (a node per group that moves, plays of clips on them) checked
// and compiled over the painting it moves. What the painting already says is read from it, never restated: each
// group's painted box (where folds are checked: paintGroupPaintedBox). Each node's plays are filed in lanes typed by
// what they write: a lane per pin, its sway, its flutter, its placement.
//
// Boiling is per group: strokes that should boil apart go in groups of their own.

import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { StampGroupGlow, StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampPassDeposits, type CompiledStampGroup, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampDepositMeasuredSupport } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { PAINT_BOIL_WOBBLE, paintBoilWobbleProblem, type PaintBoilWobble } from './paint-boil-displacement.ts';
import { paintChannelConflicts, type PaintChannelWriter } from './paint-channels.ts';
import {
  compilePaintPlayClock, paintLaneByStart, paintNodeClockProblem, paintNodeClockSteps, paintPlayClockProblem, paintPlayInterval,
  type CompiledPaintPlay, type PaintLane, type PaintNodeClock, type PaintPlayClock, type PaintSceneStep,
} from './paint-clock.ts';
import {
  paintIdPhase, paintMotionClipLength, paintMotionClipPins, paintMotionClipProblem,
  type PaintFlutterClip, type PaintMotionClip, type PaintPinClip, type PaintPlaceClip, type PaintSwayClip,
} from './paint-motion-clips.ts';
import { compilePaintPin, paintPinProblem, type CompiledPaintPin, type PaintPinRig } from './paint-pins.ts';

/**
 * A live node's pose this frame: its own pins' moves (a pin at rest left out) and the key naming them. Its ancestors'
 * bends and placements reach its group as its warp and lay, never here.
 */
export type PaintLivePose<P extends string> = { readonly pins: Partial<Readonly<Record<P, StampGroupPlacement>>>; readonly key: string };

/**
 * What re-places a live node's group from its pose: the group compiled from its geometry posed so, with the written
 * group's id, passes and deposit ids (stampLiveGroupProblem). Motion keeps what it returns by the pose's key.
 */
export type PaintLivePoser<P extends string> = (pose: PaintLivePose<P>) => CompiledStampGroup;

/** A boil: every `every` animation frames on its node's time, wobbled as a layer warp, or with `reseed`, re-rolled. */
export type PaintBoilMarks = { readonly every: number; readonly amount?: number; readonly scale?: number; readonly reseed?: true };

/**
 * How a node's marks live: `stuck` (its layer carried; the default), `live` (re-placed by its poser at each pose of its
 * own pins) or boiling: its rest space wobbled (`amount` px at `scale` px; PAINT_BOIL_WOBBLE when left out), or with
 * `reseed`, its marks' randomness re-rolled, for a group compiled with a boil.
 */
export type PaintMarks<P extends string> = 'stuck' | { readonly live: PaintLivePoser<P> } | { readonly boil: PaintBoilMarks };

/**
 * A group as motion sees it: `id` is the group's. `parent` names the node it follows. `pivot`: what its placement
 * turns about (the painting's origin when left out). `clock`: its hold or freeze, inside its ancestors'.
 */
export type PaintMotionNode<P extends string = string> = {
  readonly id: string;
  readonly parent?: string;
  readonly pivot?: StampPoint;
  readonly pins?: PaintPinRig<P>;
  readonly marks?: PaintMarks<P>;
  readonly clock?: PaintNodeClock;
  /**
   * The light it gives off. Its descendants share it unless they say otherwise (`'none'`): a character glows as one,
   * and the threshold already picks which of its paint is bright enough.
   */
  readonly glow?: StampGroupGlow | 'none';
};

/** A clip played on a node through its clock; `origin` names it in errors. */
export type PaintMotionPlay = { readonly target: string; readonly clip: PaintMotionClip<string>; readonly clock: PaintPlayClock; readonly origin: string };

/** A play on `target`, its clip's pins checked against the target's as it's written. */
export function paintMotionPlay<P extends string>(target: PaintMotionNode<P>, clip: PaintMotionClip<NoInfer<P>>, timing: { readonly clock: PaintPlayClock; readonly origin: string }): PaintMotionPlay {
  return { target: target.id, clip, ...timing };
}

/** The most poses a live node keeps compiled, least recently drawn given up first. */
export const PAINT_LIVE_POSES_KEPT = 48;

export type CompiledPaintMarks =
  | { readonly kind: 'stuck' }
  | { readonly kind: 'live'; readonly poser: PaintLivePoser<string>; readonly kept: Map<string, CompiledStampGroup> }
  | { readonly kind: 'wobble'; readonly every: number; readonly wobble: PaintBoilWobble }
  | { readonly kind: 'reseed'; readonly every: number };

/**
 * A node checked and compiled. `levels`: its id, then each ancestor's, nearest first. `clock`: its ancestors' steps
 * and its own, outermost first. `glow`: its own or its nearest ancestor's, null for none.
 */
export type CompiledPaintNode = {
  readonly id: string;
  readonly glow: StampGroupGlow | null;
  readonly group: CompiledStampGroup;
  readonly levels: readonly string[];
  readonly pivot: StampPoint;
  readonly phase: number;
  readonly clock: readonly PaintSceneStep[];
  readonly marks: CompiledPaintMarks;
  readonly pins: ReadonlyMap<string, { readonly pin: CompiledPaintPin; readonly lane: PaintLane<PaintPinClip<string>> }>;
  readonly sway: PaintLane<PaintSwayClip>;
  readonly flutter: PaintLane<PaintFlutterClip>;
  readonly place: PaintLane<PaintPlaceClip>;
};

/**
 * A node's own motion, as one level of any chain reads it: its id, pivot and sway phase, and its lanes. A painting's
 * node is one; a shot's occurrence node (lib/paint/shot) is another, over no group.
 */
export type CompiledPaintLevel = Pick<CompiledPaintNode, 'id' | 'pivot' | 'phase' | 'pins' | 'sway' | 'flutter' | 'place'>;

/** A scene's motion, checked and ready to evaluate (paintMotionFrameAt). Its caches only remember. */
export type PaintMotion = {
  readonly nodes: ReadonlyMap<string, CompiledPaintNode>;
  readonly animationFps: number;
  /** The last frame asked for: a scene may render one frame's tree twice, and the same t hands back the same state. */
  readonly remembered: { last?: { readonly at: number; readonly frame: number; readonly state: StampPaintFrameState } };
};

/** How far past where its stamps can lay paint a group's paint may reach (bleeds, blooms), px. */
const PAINTED_BOX_PAD = 8;

/**
 * Where `group`'s paint lies, rest px: its deposits' support as their brushes' profiles measured it
 * (stampDepositMeasuredSupport, refusing a brush without one), padded; null when it has none.
 */
export function paintGroupPaintedBox(group: CompiledStampGroup): StampBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const deposit of group.passes.flatMap(stampPassDeposits)) {
    const box = stampDepositMeasuredSupport(deposit);
    if (!box) continue;
    x0 = Math.min(x0, box.x0); y0 = Math.min(y0, box.y0); x1 = Math.max(x1, box.x1); y1 = Math.max(y1, box.y1);
  }
  return x0 <= x1 ? { x0: x0 - PAINTED_BOX_PAD, y0: y0 - PAINTED_BOX_PAD, x1: x1 + PAINTED_BOX_PAD, y1: y1 + PAINTED_BOX_PAD } : null;
}

/** A boil's marks compiled: wobbled or re-seeded every `every` frames. */
export type CompiledPaintBoil = Extract<CompiledPaintMarks, { kind: 'wobble' | 'reseed' }>;

/**
 * `boil` compiled, its wobble's amount and scale PAINT_BOIL_WOBBLE's where left out, and what's wrong with it, in words
 * its node's id goes before: a painting's node and a shot's alike.
 */
export function compilePaintBoil(boil: PaintBoilMarks): { readonly marks: CompiledPaintBoil; readonly problems: readonly string[] } {
  const { every, reseed } = boil, problems: string[] = [];
  if (!(Number.isInteger(every) && every >= 1)) problems.push(`boils every ${every} frames, not a whole number from 1`);
  if (reseed) return { marks: { kind: 'reseed', every }, problems };
  const wobble = { amount: boil.amount ?? PAINT_BOIL_WOBBLE.amount, scale: boil.scale ?? PAINT_BOIL_WOBBLE.scale };
  const problem = paintBoilWobbleProblem(wobble);
  if (problem) problems.push(problem);
  return { marks: { kind: 'wobble', every, wobble }, problems };
}

function compileMarks(node: PaintMotionNode, group: CompiledStampGroup, problems: string[]): CompiledPaintMarks {
  const marks = node.marks ?? 'stuck';
  if (marks === 'stuck') return { kind: 'stuck' };
  if ('live' in marks) return { kind: 'live', poser: marks.live, kept: new Map() };
  const boil = compilePaintBoil(marks.boil);
  problems.push(...boil.problems.map((problem) => `${node.id}: ${problem}`));
  if (boil.marks.kind === 'reseed' && !group.boil) problems.push(`${node.id} re-seeds its marks, but its group is compiled without a boil to re-seed by; give the group a boil`);
  return boil.marks;
}

/** Why `glow` can't be drawn, or null. */
export const paintGlowProblem = ({ amount, threshold }: StampGroupGlow) =>
  amount >= 0 && Number.isFinite(amount) && threshold >= 0 && threshold <= 1 ? null : `its glow needs an amount of 0 or more and a threshold in 0..1, not ${amount} and ${threshold}`;

/** The glow `levels` give their first: the nearest whose `glowOf` says, `'none'` none. A painting's nodes and a shot's alike. */
export function paintInheritedGlow(levels: readonly string[], glowOf: (id: string) => StampGroupGlow | 'none' | undefined): StampGroupGlow | null {
  const glow = levels.map(glowOf).find((said) => said !== undefined);
  return glow && glow !== 'none' && !paintGlowProblem(glow) ? glow : null;
}

/** Each node's ancestors, nearest first, or the problem with its line. */
function nodeLevels(node: PaintMotionNode, byId: ReadonlyMap<string, PaintMotionNode>, problems: string[]): string[] {
  const levels = [node.id];
  for (let up = node.parent; up !== undefined; up = byId.get(up)?.parent) {
    if (!byId.has(up)) { problems.push(`${node.id}'s parent ${up} isn't a node`); break; }
    if (levels.includes(up)) { problems.push(`${[...levels, up].join(' → ')} is a cycle`); break; }
    levels.push(up);
  }
  return levels;
}

/** A level's lanes as its plays are filed into them, unsorted: a lane per pin, its sway, its flutter, its placement. */
export type PaintLevelLanes = {
  pins: Map<string, { pin: CompiledPaintPin; lane: CompiledPaintPlay<PaintPinClip<string>>[] }>;
  sway: CompiledPaintPlay<PaintSwayClip>[]; flutter: CompiledPaintPlay<PaintFlutterClip>[]; place: CompiledPaintPlay<PaintPlaceClip>[];
};

/** Empty lanes for node `id`'s `pins`, each pin checked into `problems`. */
export function paintLevelLanes(id: string, pins: PaintPinRig<string> | undefined, problems: string[]): PaintLevelLanes {
  const compiled = new Map<string, { pin: CompiledPaintPin; lane: CompiledPaintPlay<PaintPinClip<string>>[] }>();
  for (const [name, pin] of Object.entries(pins ?? {})) {
    const problem = paintPinProblem(pin);
    if (problem) problems.push(`${id}'s pin '${name}': ${problem}`);
    else compiled.set(name, { pin: compilePaintPin(pin), lane: [] });
  }
  return { pins: compiled, sway: [], flutter: [], place: [] };
}

/** `lanes` sorted by start, as a compiled level keeps them. */
export const paintLevelLanesSorted = (lanes: PaintLevelLanes): Pick<CompiledPaintLevel, 'pins' | 'sway' | 'flutter' | 'place'> => ({
  pins: new Map([...lanes.pins].map(([name, { pin, lane }]) => [name, { pin, lane: paintLaneByStart(lane) }])),
  sway: paintLaneByStart(lanes.sway), flutter: paintLaneByStart(lanes.flutter), place: paintLaneByStart(lanes.place),
});

type MutableNode = Omit<CompiledPaintNode, 'pins' | 'sway' | 'flutter' | 'place'> & PaintLevelLanes;

function compileNodes(painting: CompiledStampPaint, nodes: readonly PaintMotionNode[], problems: string[]): Map<string, MutableNode> {
  const groups = new Map(painting.groups.map((group) => [group.id, group]));
  const byId = new Map<string, PaintMotionNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) problems.push(`${node.id} is declared twice`);
    else if (!groups.has(node.id)) problems.push(`${node.id} isn't a group of the painting`);
    else byId.set(node.id, node);
  }
  const compiled = new Map<string, MutableNode>();
  for (const node of byId.values()) {
    const group = groups.get(node.id);
    if (!group) continue;
    const levels = nodeLevels(node, byId, problems);
    const clockProblem = node.clock && paintNodeClockProblem(node.clock);
    if (clockProblem) problems.push(`${node.id}: ${clockProblem}`);
    const glow = node.glow && node.glow !== 'none' && paintGlowProblem(node.glow);
    if (glow) problems.push(`${node.id}: ${glow}`);
    const lanes = paintLevelLanes(node.id, node.pins, problems);
    compiled.set(node.id, {
      id: node.id, glow: paintInheritedGlow(levels, (id) => byId.get(id)?.glow), group, levels, pivot: node.pivot ?? { x: 0, y: 0 }, phase: paintIdPhase(node.id),
      clock: levels.toReversed().flatMap((id) => paintNodeClockSteps(byId.get(id)?.clock)),
      marks: compileMarks(node, group, problems),
      ...lanes,
    });
  }
  return compiled;
}

/**
 * Files `play` in node `id`'s `lanes`, by what its clip writes, through the node's clock steps `nodeClock`, and names
 * each lane it writes as a channel writer.
 */
export function filePaintLevelPlay(id: string, lanes: PaintLevelLanes, nodeClock: readonly PaintSceneStep[], play: PaintMotionPlay, writers: PaintChannelWriter[], problems: string[]) {
  const clock = compilePaintPlayClock(play.clock, nodeClock);
  const interval = paintPlayInterval(clock, paintMotionClipLength(play.clip));
  const written = <C>(clip: C): CompiledPaintPlay<C> => ({ clip, clock, interval, origin: play.origin });
  const writer = (channel: PaintChannelWriter['channel'], target: string) => writers.push({ channel, target, ...interval, origin: play.origin });
  const { clip } = play;
  switch (clip.kind) {
    case 'poses':
    case 'breathe': {
      const pins = paintMotionClipPins(clip), missing = pins.filter((pin) => !lanes.pins.has(pin));
      if (missing.length) { problems.push(`${play.origin} moves pins ${missing.map((pin) => `'${pin}'`).join(', ')}, which ${id} doesn't have`); return; }
      for (const pin of pins) {
        lanes.pins.get(pin)!.lane.push(written(clip));
        writer('deform', `${id}'s pin '${pin}'`);
      }
      return;
    }
    case 'sway': lanes.sway.push(written(clip)); writer('deform', `${id}'s sway`); return;
    case 'flutter': lanes.flutter.push(written(clip)); writer('deform', `${id}'s flutter`); return;
    case 'place': lanes.place.push(written(clip)); writer('place', id); return;
    default: clip satisfies never;
  }
}

/** Files `play` in its node's lanes (filePaintLevelPlay), refusing to place a group its recipe already moves. */
function filePlay(node: MutableNode, play: PaintMotionPlay, writers: PaintChannelWriter[], problems: string[]) {
  if (play.clip.kind === 'place' && node.group.motion) { problems.push(`${play.origin} places ${node.id}, whose group already moves by its recipe's motion`); return; }
  filePaintLevelPlay(node.id, node, node.clock, play, writers, problems);
}

/**
 * `nodes` and `plays` checked and compiled over `painting`. Problems: a node that isn't one of its groups, nodes that
 * don't make a tree, pins that can't weigh paint, a boil that can fold or can't re-seed, plays on missing nodes or
 * pins, clips and clocks that can't be evaluated, and two writers on one lane at once.
 */
export function compilePaintMotion(painting: CompiledStampPaint, o: { nodes: readonly PaintMotionNode[]; plays?: readonly PaintMotionPlay[]; animationFps: number }, problems: string[]): PaintMotion {
  const nodes = compileNodes(painting, o.nodes, problems);
  const writers: PaintChannelWriter[] = [];
  for (const play of o.plays ?? []) {
    const node = nodes.get(play.target);
    const clipProblem = paintMotionClipProblem(play.clip), clockProblem = paintPlayClockProblem(play.clock);
    if (!node) problems.push(`${play.origin} plays on ${play.target}, which isn't a node`);
    if (clipProblem) problems.push(`${play.origin}: ${clipProblem}`);
    if (clockProblem) problems.push(`${play.origin}: ${clockProblem}`);
    if (node && !clipProblem && !clockProblem) filePlay(node, play, writers, problems);
  }
  problems.push(...paintChannelConflicts(writers));
  const sorted = new Map([...nodes].map(([id, node]): [string, CompiledPaintNode] => [id, { ...node, ...paintLevelLanesSorted(node) }]));
  return { nodes: sorted, animationFps: o.animationFps, remembered: {} };
}
