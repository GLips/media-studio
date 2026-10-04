// shot-props.ts: what a scene composes painting evaluations with: a shot of planes under the paint camera, motion
// over occurrences, rigs, masks, instances and painted textures. Camera, clocks, motion, placements, rig declarations,
// picture and three sources are the engine's, imported; everything declared here is the painting path's own.
// docs/painting-authoring.md's Composition section is the author's page for it.

import type { PaintCameraOptions } from '#lib/paint/animation/models/paint-camera-build.ts';
import type { PaintNodeClock } from '#lib/paint/animation/models/paint-clock.ts';
import type { PaintBoilMarks, PaintMotionNode, PaintMotionPlay } from '#lib/paint/animation/models/paint-motion-compile.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import type { PaintMoment, StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPictureAt, StampPlaneExtent } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintRigCutDeclaration } from '#lib/paint/rig/models/paint-rig-cuts.ts';
import type { PaintedThreeSource } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import type { PaintedSource } from './shot-selection.ts';

/** The engine's picture plane source: a picture handed in at each moment, held within `extent`. */
export type PictureSource = { readonly kind: 'picture'; readonly extent: StampPlaneExtent; readonly pictureAt: StampPictureAt };

/**
 * The three layers' three.js scene, drawn each frame through the camera, built with the shot's world and its painted
 * textures. It may draw offscreen passes before its scene, and is posed at the shot's moment.
 */
export type ThreeSource = { readonly kind: 'three'; readonly build: PaintedThreeSource['build'] };

// ---- planes --------------------------------------------------------------------------------------------------------

/** A constant, or read per exposure at its moment: `at` the scene second seen, `frame` the frame shown. */
export type PresentationValue<T> = T | ((moment: PaintMoment) => T);

/** `value` at `moment`: a constant as it is, a callback called. */
export function shotPresentationAt<T>(value: PresentationValue<T>, moment: PaintMoment): T {
  // SAFETY: every T a shot presents (a source, a number, a rig's pose) is data, so a function is only ever the callback.
  return typeof value === 'function' ? (value as (moment: PaintMoment) => T)(moment) : value;
}

/**
 * A drawable's name for motion, visibility, rigs and masks: a plane's id, or `<plane id>/<layer or group key>` for
 * one occurrence on it (shotOccurrenceKey). The same layer on two planes is two occurrences. Boil wobble and sway
 * phase follow it.
 */
export type OccurrenceKey = string;

/**
 * A presentation mask, painted planes only: it cuts the plane's paint and the own-sheet paper it shapes, never the
 * ground; it re-solves nothing. `alphaOf`: a plane's or painted occurrence's coverage as laid, partial alpha too. Paint
 * shown over time along a path is the document's to say: a layer's or group's `reveal`.
 */
export type PlaneMask = { readonly kind: 'alphaOf'; readonly drawable: OccurrenceKey; readonly invert?: boolean };

/**
 * A document point held on the centre of the element inside the PaintedShot whose `data-pin` is `element`. A name,
 * not a ref, so a pinned shot stays plain data: a module constant.
 */
export type PinPoint = { readonly sourcePx: StampPoint; readonly element: string };

/**
 * Lays the plane so its document points sit on HTML elements' centres, measured in frame px as each frame draws (and
 * again when one resizes), once laid out, as the camera stands at scene second `at` (0). One point moves the plane
 * only; two set a similarity: move, uniform scale and turn. A frame whose element isn't mounted fails.
 */
export type ScreenPin = { readonly kind: 'pin'; readonly points: readonly [PinPoint] | readonly [PinPoint, PinPoint]; readonly at?: number };

/**
 * Centres `box` (document px) where the frame's centre lies and scales it about its centre, unturned, until it covers
 * the frame as the camera stands at scene second `at` (0). A rolled camera grows the box to hold its turned frame.
 */
export type CoverFrame = { readonly kind: 'cover'; readonly box: StampBox; readonly at?: number };

/**
 * Where a whole plane lies, in frame px. Left out, document px are frame px. A callback may state `reach`, the stage
 * box its paint stays within; without one the camera checks the plane as reaching everywhere. A pin or cover lays a
 * painted plane on the frame through the camera, checked where it lies once laid.
 */
export type PlaneLay =
  | { readonly lay?: StampGroupLay; readonly reach?: never }
  | { readonly lay: (moment: PaintMoment) => StampGroupLay; readonly reach?: StampBox }
  | { readonly lay: ScreenPin | CoverFrame; readonly reach?: never };

type PlaneCommon = {
  readonly id: string;
  /**
   * Holds the moment the plane's presentation and motion read (its lay, masks, instances, visibility, and every
   * motion node on it): `{ hold: 2 }` moves on twos. The camera still moves; a source reads `sourceClock`.
   */
  readonly clock?: PaintNodeClock;
  /**
   * The PaintedShotCanvas it draws in. When the shot has any, every plane names one; several may share one. The back
   * draws in the first, and every plane of a later canvas is nearer than every plane of an earlier one.
   */
  readonly canvas?: string;
};

/**
 * A plane. `depth`: distance from the camera at rest, above 0, larger farther; 1 is the depth a pan is measured at.
 * `sourceClock` holds the moment its `source` reads: a callback's (prefix, properties, dissolve weights), a picture's
 * `pictureAt`, a three scene's `poseAt`. `{ hold: 6 }` repaints on sixes while `clock` runs on. Both start from the
 * frame's moment.
 */
export type PlaneProps = PlaneCommon & PlaneLay & {
  readonly kind?: undefined;
  readonly depth: number;
  readonly masks?: readonly PlaneMask[];
  readonly source: PresentationValue<PaintedSource> | PictureSource | ThreeSource;
  readonly sourceClock?: PaintNodeClock;
};

/**
 * One item of an instanced plane: its variant laid as a plane at `depth` (`lay` from the variant's document px, clear
 * outside its paint). `key` is one lifetime: an item keyed alike at the shutter's open and close blurs along its move;
 * a recycled item takes a new key. An item isn't an occurrence and takes no motion nodes.
 */
export type PlaneInstance = { readonly key: string; readonly variant: string; readonly depth: number; readonly lay: StampGroupLay; readonly visibility?: number };

/**
 * Items sharing finished variants, depth-sorted with every drawable (ties: planes, then item order) between `depths`,
 * nearer than the back. `instances` is read at each frame's moment and shutter ends, by the plane's `clock`. A variant
 * lies whole, centred on the stage, which must hold its items' blur; items lie anywhere through the lens. Its visibility fades all.
 */
export type InstancedPlaneProps = PlaneCommon & {
  readonly kind: 'instanced';
  readonly depths: { readonly near: number; readonly far: number };
  readonly variants: Readonly<Record<string, PaintedSource>>;
  readonly instances: (moment: PaintMoment) => readonly PlaneInstance[];
};

// ---- rigs ----------------------------------------------------------------------------------------------------------

/**
 * A part: the rig's cut declaration (`id`, draw order `z`, and below a root its parent, joint, rest `pivot` and skin
 * `blend` px) and its cels, layers or groups under the rigged group, each painted whole at rest. The first shows at
 * rest; the others only when a pose names them.
 */
export type RigPart = PaintRigCutDeclaration & { readonly cels: readonly NodeKey[] };

/**
 * A part's pose, in its parent's frame: a move (`x`, `y` document px) and a turn (`rotation` radians) about its pivot
 * (a root's, the group node's pivot), a `bend` (radians) curling it along pivot to farthest paint at rest, and the
 * `cel` it shows.
 */
export type RigPartPose = {
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly bend?: number;
  readonly cel?: NodeKey;
};

/**
 * A group occurrence cut into parts by its layers: each layer under the group lies in exactly one part's cels. Parts
 * draw by `z`, document order breaking ties; skin joints bend across cels. `pose` names parts by id; those left out
 * rest. Read at the group node's held moment (its own hold, else its plane's).
 */
export type OccurrenceRig = {
  readonly parts: readonly RigPart[];
  readonly pose: PresentationValue<Readonly<Record<string, RigPartPose>>>;
};

// ---- the shot ------------------------------------------------------------------------------------------------------

/**
 * The animation feature's motion node for an occurrence or plane, its parent implied: its enclosing group's
 * occurrence, else its plane. A group's node takes pins, sway, flutter and boil with one phase, seed and map for all
 * it holds. Marks stay put or boil; to lay them anew per pose, pose it on a sheet it doesn't own.
 */
export type OccurrenceMotionNode = Omit<PaintMotionNode, 'parent' | 'marks'> & { readonly marks?: 'stuck' | { readonly boil: PaintBoilMarks } };

/** A painting drawn into a texture a three source samples by `id`, `widthPx` × `heightPx`, timed by the shot's moment. */
export type PaintedTexture = { readonly id: string; readonly source: PresentationValue<PaintedSource>; readonly widthPx: number; readonly heightPx: number };

/**
 * A shot: the paint camera (its stage frame is the canvas's pixels), planes in any order, motion over occurrences (node
 * ids are OccurrenceKeys), visibility 0..1 (shot-visibility.ts) and rigs by occurrence. `warm`: the render frames in
 * `from..to`, their films solved before the first shows.
 */
export type PaintedShotProps = {
  readonly camera: Omit<PaintCameraOptions, 'planes'>;
  readonly planes: readonly (PlaneProps | InstancedPlaneProps)[];
  readonly motion?: { readonly nodes: readonly OccurrenceMotionNode[]; readonly plays: readonly PaintMotionPlay[] };
  readonly visibility?: Readonly<Record<OccurrenceKey, PresentationValue<number>>>;
  readonly rigs?: Readonly<Record<OccurrenceKey, OccurrenceRig>>;
  readonly paintedTextures?: readonly PaintedTexture[];
  readonly warm?: { readonly from: number; readonly to: number };
};
