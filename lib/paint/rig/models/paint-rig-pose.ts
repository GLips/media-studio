// paint-rig-pose.ts: a rig's pose, purely, and what a pose callback reads off the rig: where the posed rig puts a
// point on a part, the turns that bring a two-bone chain's tip to a target, and a pose for the rig drawn mirrored.
// Each part moves in its parent's frame about its pivot, a root about the group node's, as the shot poses it
// (shot-rigs.ts), so a point found here is where the shot draws it.
//
// Negative space: no point is carried through a bend. A bend curls a part along its farthest paint at rest, which only
// the shot sees once the paint is solved.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintRigCutDeclaration } from './paint-rig-cuts.ts';

/**
 * A part's move in its parent's frame: `x`, `y` document px and a turn `rotation` (radians) about its pivot, and a
 * `bend` (radians) curling it from its pivot along its farthest paint at rest.
 */
export type PaintRigPartMove = { readonly x?: number; readonly y?: number; readonly rotation?: number; readonly bend?: number };

/** A pose's moves by part id; a part left out rests. */
export type PaintRigMoves = Readonly<Record<string, PaintRigPartMove>>;

/** A rig's joints: its parts' declarations, and `pivot`, the group node's, which its roots turn about. */
export type PaintRigSkeleton = { readonly parts: readonly PaintRigCutDeclaration[]; readonly pivot: StampPoint };

/** An angle in (−π, π]. */
const wrapped = (angle: number) => angle - 2 * Math.PI * Math.ceil((angle - Math.PI) / (2 * Math.PI));

function partOf({ parts }: PaintRigSkeleton, id: string): PaintRigCutDeclaration {
  const part = parts.find((each) => each.id === id);
  if (!part) throw new Error(`paint rig: no part ${id}; its parts are ${parts.map((each) => each.id).join(', ')}`);
  return part;
}

/** Where `part` turns: its declared pivot, a root's the group node's. */
const pivotOf = (skeleton: PaintRigSkeleton, part: PaintRigCutDeclaration) => (part.parent === null ? skeleton.pivot : part.pivot);

/** `id`'s line, itself first, then each parent up to its root, each with its move in `pose`; refuses a bend on it. */
function movedLine(skeleton: PaintRigSkeleton, pose: PaintRigMoves, id: string, asked: string) {
  const line: { readonly part: PaintRigCutDeclaration; readonly move: PaintRigPartMove }[] = [];
  for (let part: PaintRigCutDeclaration | null = partOf(skeleton, id); part; part = part.parent === null ? null : partOf(skeleton, part.parent)) {
    if (line.some((level) => level.part === part)) throw new Error(`paint rig: ${line.map((level) => level.part.id).join(' → ')} → ${part.id} is a cycle`);
    const move = pose[part.id] ?? {};
    if (move.bend) throw new Error(`paint rig: ${asked} is carried through ${part.id}'s bend, which curls along that part's farthest paint, and only the shot sees paint`);
    line.push({ part, move });
  }
  return line;
}

/** `p` moved by `move` about `pivot`: turned, then shifted. */
function moved(p: StampPoint, pivot: StampPoint, { x = 0, y = 0, rotation = 0 }: PaintRigPartMove): StampPoint {
  const c = Math.cos(rotation), s = Math.sin(rotation), dx = p.x - pivot.x, dy = p.y - pivot.y;
  return { x: pivot.x + c * dx - s * dy + x, y: pivot.y + s * dx + c * dy + y };
}

/**
 * Where `pose` puts `point`, a rest point (document px) on part `part`: moved by the part and each of its parents in
 * turn, in its group's frame. The shot's skin moves a part's paint by exactly this past half its skin joint's blend,
 * and only paint within that band of a joint bends between the two parts' moves (paint-rig-skin.ts).
 */
export function paintRigPosedPoint(skeleton: PaintRigSkeleton, pose: PaintRigMoves, part: string, point: StampPoint): StampPoint {
  return movedLine(skeleton, pose, part, `${part}'s point`).reduce((at, { part: level, move }) => moved(at, pivotOf(skeleton, level), move), point);
}

/** `part`'s turn from rest in its group's frame: its own and every parent's. */
const turnOf = (skeleton: PaintRigSkeleton, pose: PaintRigMoves, part: string) =>
  movedLine(skeleton, pose, part, `${part}'s turn`).reduce((turn, { move }) => turn + (move.rotation ?? 0), 0);

/** Which way round its middle joint lies from the line from the chain's root to its target, as the picture shows it (y down). */
export type PaintRigBendSide = 'clockwise' | 'counterclockwise';

/**
 * A two-bone reach: `chain`, a part and its child, by id; `tip`, the rest point on the child that reaches (an ankle, a
 * hand), document px; `target`, where it's to go in the group's frame; `bend`, the side the joint between them takes.
 */
export type PaintRigReachAsk = {
  readonly chain: readonly [string, string];
  readonly tip: StampPoint;
  readonly target: StampPoint;
  readonly bend: PaintRigBendSide;
};

/**
 * A reach solved: `upper` and `lower`, the chain's turns in their parents' frames (each part's pose `rotation`);
 * `turn`, the lower part's turn from rest in the group's frame (a part hanging level from it turns by its negative);
 * where the joint between them and the tip land, document px. A target past the chain's reach leaves the tip short.
 */
export type PaintRigReach = { readonly upper: number; readonly lower: number; readonly turn: number; readonly joint: StampPoint; readonly tip: StampPoint };

/**
 * The turns that bring `tip` to `target`, the chain's root riding its parent as `pose` puts it, each bone as long as
 * its part's pivots set it (a move on the lower part shifts the joint). A target at or past full reach straightens the
 * chain onto its line; one inside its least reach folds it.
 */
export function paintRigTwoBoneReach(skeleton: PaintRigSkeleton, pose: PaintRigMoves, { chain: [upperId, lowerId], tip, target, bend }: PaintRigReachAsk): PaintRigReach {
  const upper = partOf(skeleton, upperId), lower = partOf(skeleton, lowerId);
  if (lower.parent !== upperId) throw new Error(`paint rig: a two-bone chain is a part and its child, and ${lowerId} hangs from ${lower.parent ?? 'nothing'}, not ${upperId}`);
  const upperMove = pose[upperId] ?? {}, lowerMove = pose[lowerId] ?? {};
  if (upperMove.bend || lowerMove.bend) throw new Error(`paint rig: ${upperId} → ${lowerId} reaches straight bones, and its pose bends one`);
  const upperPivot = pivotOf(skeleton, upper), lowerPivot = pivotOf(skeleton, lower);
  const shifted = { x: upperPivot.x + (upperMove.x ?? 0), y: upperPivot.y + (upperMove.y ?? 0) };
  const root = upper.parent === null ? shifted : paintRigPosedPoint(skeleton, pose, upper.parent, shifted);
  const parentTurn = upper.parent === null ? 0 : turnOf(skeleton, pose, upper.parent);
  // Each bone at rest in its own part's frame: the upper's to the joint where the lower's move sets it, the lower's to the tip.
  const a = { x: lowerPivot.x + (lowerMove.x ?? 0) - upperPivot.x, y: lowerPivot.y + (lowerMove.y ?? 0) - upperPivot.y };
  const b = { x: tip.x - lowerPivot.x, y: tip.y - lowerPivot.y };
  const upperLength = Math.hypot(a.x, a.y), lowerLength = Math.hypot(b.x, b.y);
  const toTarget = Math.atan2(target.y - root.y, target.x - root.x), d = Math.max(1e-9, Math.hypot(target.x - root.x, target.y - root.y));
  // The angle at the root between the target's line and the upper bone, by the law of cosines; clamped, it is 0 once
  // the target is out of reach, so the chain straightens onto the line rather than failing.
  const opening = Math.acos(Math.min(1, Math.max(-1, (upperLength ** 2 + d * d - lowerLength ** 2) / (2 * upperLength * d))));
  const upperDirection = toTarget + (bend === 'clockwise' ? opening : -opening);
  const joint = { x: root.x + upperLength * Math.cos(upperDirection), y: root.y + upperLength * Math.sin(upperDirection) };
  const lowerDirection = Math.atan2(target.y - joint.y, target.x - joint.x), restUpper = Math.atan2(a.y, a.x), restLower = Math.atan2(b.y, b.x);
  return {
    upper: wrapped(upperDirection - parentTurn - restUpper),
    lower: wrapped(lowerDirection - upperDirection - (restLower - restUpper)),
    turn: wrapped(lowerDirection - restLower),
    joint,
    tip: { x: joint.x + lowerLength * Math.cos(lowerDirection), y: joint.y + lowerLength * Math.sin(lowerDirection) },
  };
}

/**
 * `pose` for the rig drawn mirrored: `'y'` flips top for bottom (a reflection in level water), `'x'` left for right.
 * Turns and bends reverse, each move flips on that axis, and a part's cel is kept. The mirrored rig is a rig of its
 * own, its pivots and group pivot mirrored as its paint is.
 */
export function paintRigMirroredPose<P extends PaintRigPartMove>(pose: Readonly<Record<string, P>>, flipped: 'x' | 'y'): Record<string, P> {
  const mirrored = (move: P): P => ({
    ...move,
    ...(flipped === 'x' && move.x !== undefined && { x: -move.x }),
    ...(flipped === 'y' && move.y !== undefined && { y: -move.y }),
    ...(move.rotation !== undefined && { rotation: -move.rotation }),
    ...(move.bend !== undefined && { bend: -move.bend }),
  });
  return Object.fromEntries(Object.entries(pose).map(([id, move]) => [id, mirrored(move)]));
}
