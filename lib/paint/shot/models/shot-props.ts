// shot-props.ts: what a scene composes painting evaluations with: a shot of planes under the paint camera, each
// plane's entry saying everything about it (its visibility, its node and plays, and its occurrences' own, rigs among
// them), masks, instances and painted textures. Camera, clocks, motion, placements, rig declarations, picture and
// three sources are the engine's, imported; everything declared here is the painting path's own.
// docs/painting-authoring.md's Composition section is the author's page for it.

import type { PaintShotCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import type { PaintNodeClock } from '#lib/paint/animation/models/paint-clock.ts';
import type { PaintBoilMarks, PaintMotionNode, PaintMotionPlay } from '#lib/paint/animation/models/paint-motion-compile.ts';
import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import type { PaintMoment, StampGroupGlow, StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPictureAt, StampPlaneExtent } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { PaintRigCutDeclaration } from '#lib/paint/rig/models/paint-rig-cuts.ts';
import type { PaintRigPartMove } from '#lib/paint/rig/models/paint-rig-pose.ts';
import type { PaintedThreeSource } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import type { PaintedSource } from './shot-selection.ts';

/** The engine's picture plane source: a picture handed in at each moment, held within `extent`. */
export type PictureSource = { readonly kind: 'picture'; readonly extent: StampPlaneExtent; readonly pictureAt: StampPictureAt };

/**
 * The three layers' three.js scene, drawn each frame through the camera, built with the shot's world and its painted
 * textures. It may draw offscreen passes before its scene, and is posed at the shot's moment.
 */
export type ThreeSource = { readonly kind: 'three'; readonly build: PaintedThreeSource['build'] };

// ---- planes --------------------------------------------------------------------------------------------------------

/**
 * A drawable's name, as a mask reads it and the shot's compiled maps key it: a plane's id, or `<plane id>/<layer or
 * group key>` for one occurrence on it (shotOccurrenceKey). The same layer on two planes is two occurrences. Boil
 * wobble and sway phase follow it.
 */
export type OccurrenceKey = string;

/**
 * A presentation mask, painted planes only: it cuts the plane's paint and the own-sheet paper it shapes, never the
 * ground; it re-solves nothing. `alphaOf`: a plane's or painted occurrence's coverage as laid, partial alpha too,
 * read where the camera shows it this frame, parallax included. Paint shown over time is a layer's or group's `reveal`.
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
 * Where a whole painted plane lies, document px to plane px (left out, they're one): a lay, or a value of the plane's
 * moment, sampled at the shot's moments for where its paint can reach. A pin or cover lays it on the frame through
 * the camera, checked where it lies once laid.
 */
export type PlaneLay = PresentationValue<StampGroupLay> | ScreenPin | CoverFrame;

type PlaneCommon = {
  readonly id: string;
  /**
   * Holds the moment the plane's presentation and motion read (its lay, masks, instances, visibility, and every
   * motion node on it, its own included): `{ hold: 2 }` moves on twos. The camera still moves; a source reads `sourceClock`.
   */
  readonly clock?: PaintNodeClock;
  /**
   * The PaintedShotCanvas it draws in. When the shot has any, every plane names one; several may share one. The back
   * draws in the first, and every plane of a later canvas is nearer than every plane of an earlier one.
   */
  readonly canvas?: string;
  /** 0..1, multiplying the whole plane's composite; the opaque back takes none. */
  readonly visibility?: PresentationValue<number>;
};

/**
 * A plane. `sourceClock` holds the moment its `source` reads: a callback's (prefix, properties, dissolve weights), a
 * picture's `pictureAt`, a three scene's `poseAt`. `{ hold: 6 }` repaints on sixes while `clock` runs on. Both start
 * from the frame's moment.
 */
export type PlaneProps = PlaneCommon & ShotNodeFields & {
  readonly kind?: undefined;
  readonly lay?: PlaneLay;
  /**
   * Distance from the camera at rest, above 0, larger farther; 1 is the depth a pan is measured at. A value in time,
   * read at the plane's moment, moves it, drawn in depth order each frame, nearer than the back (which keeps one
   * depth) and within its canvas's place. A three plane's holds still.
   */
  readonly depth: PresentationValue<number>;
  readonly masks?: readonly PlaneMask[];
  readonly source: PresentationValue<PaintedSource> | PictureSource | ThreeSource;
  readonly sourceClock?: PaintNodeClock;
  /** Plays on the plane's own node, which its node fields (`pivot`, `pins`, `marks`, `glow`) write: it moves the whole plane. */
  readonly plays?: readonly ShotNodePlay[];
  /** What each layer or group the plane shows does, by its key. */
  readonly occurrences?: Readonly<Record<NodeKey, OccurrenceProps>>;
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

/** A part's pose: its move in its parent's frame about its pivot (a root's, the group node's pivot), and the `cel` it shows. */
export type RigPartPose = PaintRigPartMove & { readonly cel?: NodeKey };

/**
 * A group occurrence cut into parts by its layers, as its entry's `rig`: each layer under the group lies in exactly
 * one part's cels. Parts draw by `z`, document order breaking ties; skin joints bend across cels. `pose` names parts
 * by id; those left out rest. Read at the group node's held moment (its own hold, else its plane's).
 */
export type OccurrenceRig = {
  readonly parts: readonly RigPart[];
  readonly pose: PresentationValue<Readonly<Record<string, RigPartPose>>>;
};

// ---- motion nodes --------------------------------------------------------------------------------------------------

/**
 * The animation feature's motion node, compiled from an entry: its id the drawable's name, its parent implied (its
 * enclosing group's occurrence, else its plane). A group's node moves all it holds with one phase, seed and map.
 * Marks stay put or boil; to lay them anew per pose, pose it on a sheet it doesn't own.
 */
export type OccurrenceMotionNode = Omit<PaintMotionNode, 'parent' | 'marks' | 'glow'> & {
  readonly marks?: 'stuck' | { readonly boil: PaintBoilMarks };
  /** Its light, read at its held moment, shared by what it holds that says none (`'none'`: no glow). */
  readonly glow?: PresentationValue<StampGroupGlow> | 'none';
};

/** A node's fields as a plane's entry writes them, beside its own: a plane's node is held by the plane's `clock`. */
export type ShotNodeFields = Omit<OccurrenceMotionNode, 'id' | 'clock'>;

/** A play on the node of the entry it's written in: a plane's, or an occurrence's. `origin` names it in errors. */
export type ShotNodePlay = Omit<PaintMotionPlay, 'target'>;

/**
 * What one layer or group a painted plane shows does, as the plane's `occurrences` says it by the node's key: its
 * visibility, 0..1; a group's rig; and its node's fields and plays. A node field or a play gives it a node; with
 * none, it moves as its nearest enclosing node does.
 */
export type OccurrenceProps = Omit<OccurrenceMotionNode, 'id'> & {
  readonly visibility?: PresentationValue<number>;
  readonly rig?: OccurrenceRig;
  readonly plays?: readonly ShotNodePlay[];
};

// ---- the shot ------------------------------------------------------------------------------------------------------

/** A painting drawn into a texture a three source samples by `id`, `widthPx` × `heightPx`, timed by the shot's moment. */
export type PaintedTexture = { readonly id: string; readonly source: PresentationValue<PaintedSource>; readonly widthPx: number; readonly heightPx: number };

/**
 * A shot: the paint camera (its stage frame is the canvas's pixels) and its planes in any order, each saying all it
 * and its occurrences do. `span`: the scene seconds its frames show (sceneSecondsOf(clock).span), where every value is
 * sampled for checks and warnings. `warm`: the render frames in `from..to`, their films solved before the first shows.
 */
export type PaintedShotProps = {
  readonly camera: PaintShotCamera;
  readonly span: SceneShownSpan;
  readonly planes: readonly (PlaneProps | InstancedPlaneProps)[];
  readonly paintedTextures?: readonly PaintedTexture[];
  readonly warm?: { readonly from: number; readonly to: number };
};
