// stamp-gate-three-lighting.ts: the gate's lit three.js shot (shot/shadow). Two stands before a flat wall, each a
// tilted floor with a red-capped post on it, lit from high on the front right. The right stand asks for soft shadows
// and mirrors its post in its floor; its twin on the left, on the same renderer, asks for neither. The camera pans
// and the posts slide as two frames draw with the shutter open, through the lens's motion layer. The page builds the
// scenes from these numbers.
//
// A post hides the floor behind it, shifted away from the camera's side: the shadow falls back and left, and the
// checks read the floor left of it, clear of the post and its reflection.

import { Matrix4, Vector3 } from 'three';
import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import { paintCameraPlay, paintCameraPoseAt } from '#lib/paint/animation/models/paint-camera.ts';
import { paintCameraShotAt, paintCameraWorld, paintPlaneWorldPoint } from '#lib/paint/animation/models/paint-camera-world.ts';
import { srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedShotProps, ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { shotCameraProject } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_LIGHTING_ID = 'shot/shadow';
export const STAMP_GATE_LIGHTING_IDS = [STAMP_GATE_LIGHTING_ID] as const;
export type StampGateLightingId = (typeof STAMP_GATE_LIGHTING_IDS)[number];

/** The shot's frame, its field of view, how far right the camera pans over its second (px), and the wall's depth. */
const STAMP_GATE_LIGHTING_VIEW = { frame: { width: 384, height: 216 }, fov: 30, pan: 36, wallDepth: 3 } as const;
/** The scene seconds drawn: the camera at rest, then panned. */
export const STAMP_GATE_LIGHTING_FRAMES = [0, 1] as const;
/** Seconds the shutter stays open about each frame's time, so each frame records its motion. */
const STAMP_GATE_LIGHTING_SHUTTER = 1 / 48;
/** The wall's colour, linear light. */
const STAMP_GATE_LIGHTING_WALL = [0.16, 0.19, 0.24] as const;

/**
 * A stand, world units (a px at depth 1) in its own space: y up off its floor, z toward the camera before it tilts.
 * Its floor, square and centred on the origin, tilts toward the camera about x; colours are linear.
 */
export const STAMP_GATE_STAND = {
  depth: 1,
  /** Degrees. */
  tilt: 25,
  floor: 110,
  /** The foot at (x, z) at 0 s, sliding `slide` along x each second; body and cap `width` square. */
  post: { x: 20, z: -12, width: 12, body: 34, cap: 10, slide: 8 },
  /** The sun, `distance` from the floor's centre along `toward`: its strength, shadow box, map and bias. */
  light: { toward: [0.5, 1.3, 1], distance: 220, strength: 2.6, box: 90, mapSize: 1024, bias: -0.0004 },
  sky: { strength: 1.1, sky: 0xdde6f0, ground: 0x6a6258 },
  /** Degrees: the sun's angular radius. */
  softness: 6,
  /** How strongly the floor reflects, and the mip level blurring it. */
  mirror: { strength: 0.5, level: 1.5 },
  colours: { floor: [0.36, 0.34, 0.31], post: [0.42, 0.44, 0.47], cap: [0.75, 0.05, 0.04] },
  roughness: { floor: 0.9, post: 0.7, cap: 0.6 },
} as const;

export const STAMP_GATE_STAND_IDS = ['shadowed', 'twin'] as const;
export type StampGateStandId = (typeof STAMP_GATE_STAND_IDS)[number];
/** Where each stand's floor centre lies in the frame at rest, px: the shadowed one right, its twin left. */
const STAMP_GATE_STAND_AT: Readonly<Record<StampGateStandId, { x: number; y: number }>> = { shadowed: { x: 280, y: 150 }, twin: { x: 112, y: 150 } };

const stage = () => stampStage(STAMP_GATE_LIGHTING_VIEW.frame, 2 + 2 * Math.ceil(STAMP_GATE_LIGHTING_VIEW.pan / 2));
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Stand `which`'s space into the world: its floor's centre placed on its plane, tilted toward the camera. */
export function stampGateStandMatrix(which: StampGateStandId): Matrix4 {
  const world = paintCameraWorld(stage(), STAMP_GATE_LIGHTING_VIEW), centre = paintPlaneWorldPoint(world, STAMP_GATE_STAND_AT[which], STAMP_GATE_STAND.depth);
  return new Matrix4().makeTranslation(centre.x, centre.y, centre.z).multiply(new Matrix4().makeRotationX(rad(STAMP_GATE_STAND.tilt)));
}

/** Where a stand's post's foot stands at scene second `at`, in the stand's space. */
export const stampGateStandPostAt = (at: number) => new Vector3(STAMP_GATE_STAND.post.x + STAMP_GATE_STAND.post.slide * at, 0, STAMP_GATE_STAND.post.z);

/** From the floor toward the light, in the stand's space, unit length. */
export const stampGateStandLightToward = () => new Vector3(...STAMP_GATE_STAND.light.toward).normalize();

/** The wall: a flat colour over the whole stage. */
function stampGateLightingWall(): StampPictureRgba {
  const { width: w, height: h } = stage(), rgba = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([...STAMP_GATE_LIGHTING_WALL, 1], i * 4);
  return { box: { x: 0, y: 0, w, h }, rgba };
}

/** The shot's camera: panning right over its second. */
const stampGateLightingCamera = (): PaintedShotProps['camera'] => ({
  stage: stage(), fov: STAMP_GATE_LIGHTING_VIEW.fov, lens: { bloom: 0, shutter: STAMP_GATE_LIGHTING_SHUTTER },
  plays: [paintCameraPlay({ kind: 'move', keys: [{ at: 0 }, { at: 1, pan: { x: STAMP_GATE_LIGHTING_VIEW.pan, y: 0 } }] }, { clock: { at: 0 }, origin: 'pan' })],
});

/** The shot, each stand's scene built by `build`. */
export function stampGateLightingShot(build: Readonly<Record<StampGateStandId, ThreeSource['build']>>): PaintedShotProps {
  return {
    camera: stampGateLightingCamera(),
    planes: [
      { id: 'wall', depth: STAMP_GATE_LIGHTING_VIEW.wallDepth, source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: () => Promise.resolve(stampGateLightingWall()) } },
      ...STAMP_GATE_STAND_IDS.map((id) => ({ id, depth: STAMP_GATE_STAND.depth, source: { kind: 'three', build: build[id] } as const })),
    ],
  };
}

/** The baseline's frame: the shot's frames side by side. */
export const stampGateLightingFrame = () => ({ width: STAMP_GATE_LIGHTING_VIEW.frame.width * STAMP_GATE_LIGHTING_FRAMES.length, height: STAMP_GATE_LIGHTING_VIEW.frame.height });

/** What the baseline is drawn from, as text. */
export const stampGateLightingInputs = (id: StampGateLightingId) => stampCanonicalJson({
  id, view: STAMP_GATE_LIGHTING_VIEW, frames: STAMP_GATE_LIGHTING_FRAMES, shutter: STAMP_GATE_LIGHTING_SHUTTER, wall: STAMP_GATE_LIGHTING_WALL, stand: STAMP_GATE_STAND,
  at: STAMP_GATE_STAND_AT,
});

/** Where a point of stand `which`'s space lands in the frame at scene second `at`, px. */
function stampGateStandProjected(which: StampGateStandId, at: number, point: Vector3): { x: number; y: number } {
  const { stage: shotStage, fov, ...camera } = stampGateLightingCamera(), built = buildPaintCamera({ stage: shotStage, fov, ...camera, planes: [] });
  if (!built.ok) throw new Error(`stamp gate: ${STAMP_GATE_LIGHTING_ID}'s camera: ${built.problems.join('; ')}`);
  const seen = shotCameraProject(paintCameraShotAt(paintCameraWorld(shotStage, { fov }), paintCameraPoseAt(built.camera, paintMoment(at))), point.clone().applyMatrix4(stampGateStandMatrix(which)));
  if (!seen) throw new Error(`stamp gate: ${STAMP_GATE_LIGHTING_ID}'s ${which} stand lies behind the camera`);
  return seen;
}

/** A frame's linear luminance at `at` (frame px), bilinear between pixel centres. Refuses a point off the frame: the case misplaced it. */
function stampGateLuminanceAt(rgba: Uint8ClampedArray, { x, y }: { x: number; y: number }): number {
  const { width, height } = STAMP_GATE_LIGHTING_VIEW.frame, x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  if (!(x0 >= 0 && y0 >= 0 && x0 + 1 < width && y0 + 1 < height)) throw new Error(`stamp gate: ${STAMP_GATE_LIGHTING_ID} reads (${x.toFixed(1)}, ${y.toFixed(1)}), off its ${width} × ${height} frame`);
  const at = (i: number, j: number) => {
    const p = (j * width + i) * 4;
    return 0.2126 * srgbToLinear(rgba[p] / 255) + 0.7152 * srgbToLinear(rgba[p + 1] / 255) + 0.0722 * srgbToLinear(rgba[p + 2] / 255);
  };
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

const text = (v: number) => v.toFixed(3);

/** How far along the shadow from the post's foot each profile crosses it, world units: beside the foot, and under the cap's shadow. */
const STAMP_GATE_PROFILE_AT = { contact: 10, cast: 36 } as const;
/** How far a profile runs from the shadow's middle out past its left edge, and its step, world units. */
const STAMP_GATE_PROFILE = { length: 22, step: 0.5 } as const;

/**
 * Luminance across stand `which`'s shadow at scene second `at`, `along` world units down it from the foot: from `from`
 * left of its middle out past its left edge (the side away from what the post hides), on the floor.
 */
function stampGateShadowProfile(rgba: Uint8ClampedArray, which: StampGateStandId, at: number, along: number, from = 0): number[] {
  const toward = stampGateStandLightToward(), down = new Vector3(-toward.x, 0, -toward.z).normalize(), left = new Vector3(down.z, 0, -down.x);
  const middle = stampGateStandPostAt(at).addScaledVector(down, along);
  return Array.from({ length: (STAMP_GATE_PROFILE.length - from) / STAMP_GATE_PROFILE.step + 1 }, (_, i) =>
    stampGateLuminanceAt(rgba, stampGateStandProjected(which, at, middle.clone().addScaledVector(left, from + i * STAMP_GATE_PROFILE.step))));
}

/** A profile's shadow, its lit floor (its last 2 world units) and its edge's width (from a quarter to three quarters lit), world units. */
function stampGateShadowEdge(profile: readonly number[]): { shadow: number; lit: number; width: number } {
  const tail = Math.round(2 / STAMP_GATE_PROFILE.step), lit = profile.slice(-tail).reduce((sum, v) => sum + v, 0) / tail, shadow = Math.min(...profile);
  const high = profile.findIndex((v) => v >= shadow + 0.75 * (lit - shadow)), low = profile.slice(0, high).findLastIndex((v) => v <= shadow + 0.25 * (lit - shadow));
  return { shadow, lit, width: high < 0 ? Infinity : (high - low) * STAMP_GATE_PROFILE.step };
}

/** How dark beside the foot the shadow must be, of the lit floor beside it. */
const STAMP_GATE_CONTACT_MOST = 0.5;
/** How much wider the cast edge is than the contact's, at the least: a penumbra grows with the gap behind its blocker. */
const STAMP_GATE_CAST_WIDER = 2;
/**
 * How lit the twin's floor must stay where its shadow would fall, of its lit floor: none is cast. Read from `from` left
 * of the shadow's middle: the twin stands left of the camera, so its post hides the floor right of there as it pans.
 */
const STAMP_GATE_TWIN = { least: 0.95, from: 4 } as const;
/** How near the cap's reflection's middle lies to the reflected cap seen through the frame's camera, px; and the window searched. */
const STAMP_GATE_REFLECTION = { within: 3, window: 12 } as const;

/** The middle of the red standing out of the floor round `near`, frame px, weighted by how far red stands out; null for none. */
function stampGateRedMiddle(rgba: Uint8ClampedArray, near: { x: number; y: number }): { x: number; y: number; weight: number } | null {
  const { width, height } = STAMP_GATE_LIGHTING_VIEW.frame, r = STAMP_GATE_REFLECTION.window;
  let weight = 0, x = 0, y = 0;
  for (let j = Math.max(0, Math.floor(near.y - r)); j < Math.min(height, Math.ceil(near.y + r)); j++) {
    for (let i = Math.max(0, Math.floor(near.x - r)); i < Math.min(width, Math.ceil(near.x + r)); i++) {
      const p = (j * width + i) * 4, [red, green, blue] = [rgba[p], rgba[p + 1], rgba[p + 2]].map((v) => srgbToLinear(v / 255));
      const out = Math.max(0, red - (green + blue) / 2 - 0.02);
      weight += out;
      x += out * (i + 0.5);
      y += out * (j + 0.5);
    }
  }
  return weight > 0.5 ? { x: x / weight, y: y / weight, weight } : null;
}

/**
 * The shot's checks, given each frame (RGBA bytes, STAMP_GATE_LIGHTING_FRAMES in turn): in each, the shadowed stand's
 * shadow dark beside the post's foot and its edge sharp there, softening down the shadow; the twin unshadowed where
 * its shadow would fall; and the cap's reflection where the frame's camera sees the cap mirrored, as it pans.
 */
export function checkStampGateLighting(frames: readonly Uint8ClampedArray[]): StampGateWashCheck[] {
  return frames.flatMap((rgba, f) => {
    const at = STAMP_GATE_LIGHTING_FRAMES[f], id = `${STAMP_GATE_LIGHTING_ID} at ${at} s`;
    const contact = stampGateShadowEdge(stampGateShadowProfile(rgba, 'shadowed', at, STAMP_GATE_PROFILE_AT.contact));
    const cast = stampGateShadowEdge(stampGateShadowProfile(rgba, 'shadowed', at, STAMP_GATE_PROFILE_AT.cast));
    const twin = stampGateShadowEdge(stampGateShadowProfile(rgba, 'twin', at, STAMP_GATE_PROFILE_AT.cast, STAMP_GATE_TWIN.from));
    // The cap's front face is what shows of it, mirrored: its middle.
    const { body, cap, width } = STAMP_GATE_STAND.post, mirrored = stampGateStandPostAt(at).add(new Vector3(0, -(body + cap / 2), width / 2));
    const expected = stampGateStandProjected('shadowed', at, mirrored), red = stampGateRedMiddle(rgba, expected);
    const off = red ? Math.hypot(red.x - expected.x, red.y - expected.y) : Infinity;
    return [
      {
        id: `${id}: contact`, passed: contact.shadow <= STAMP_GATE_CONTACT_MOST * contact.lit,
        detail: `${STAMP_GATE_PROFILE_AT.contact} down the shadow from the foot, its darkest ${text(contact.shadow)} beside lit floor ${text(contact.lit)} (at most ${STAMP_GATE_CONTACT_MOST} of it wanted)`,
      },
      {
        id: `${id}: soft cast`, passed: cast.shadow <= STAMP_GATE_CONTACT_MOST * cast.lit && cast.width >= STAMP_GATE_CAST_WIDER * contact.width,
        detail: `its edge ${contact.width} wide ${STAMP_GATE_PROFILE_AT.contact} from the foot, ${cast.width} at ${STAMP_GATE_PROFILE_AT.cast} (${STAMP_GATE_CAST_WIDER}× at least wanted), its darkest there ${text(cast.shadow)} of lit ${text(cast.lit)}`,
      },
      {
        id: `${id}: unshadowed twin`, passed: twin.shadow >= STAMP_GATE_TWIN.least * twin.lit,
        detail: `the twin, asking for no shadows on the same renderer, its floor at least ${text(twin.shadow)} where a shadow would fall, lit ${text(twin.lit)} beside it (${STAMP_GATE_TWIN.least} of it wanted)`,
      },
      {
        id: `${id}: reflection follows the camera`, passed: off <= STAMP_GATE_REFLECTION.within,
        detail: red
          ? `the cap's reflection's middle (${red.x.toFixed(1)}, ${red.y.toFixed(1)}) px, ${off.toFixed(1)} from the mirrored cap's (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)}) (within ${STAMP_GATE_REFLECTION.within} wanted)`
          : `no red reflection within ${STAMP_GATE_REFLECTION.window} px of the mirrored cap's (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)})`,
      },
    ];
  });
}
