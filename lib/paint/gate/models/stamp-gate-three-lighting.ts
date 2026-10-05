// stamp-gate-three-lighting.ts: the gate's lit three.js shot (shot/shadow). Two stands before a flat wall, each a
// tilted floor with a red-capped post, lit from high on the front right. The right stand asks for soft shadows and
// mirrors its post in its floor; its twin on the left asks for neither. The camera pans, focused on the stands, as the
// posts slide. Apart from the shot, the shadowed stand's source renders exposures off the aperture's middle. The page
// builds the scenes from these numbers.
//
// A post hides the floor behind it, shifted away from the camera's side: the shadow falls back and left, and the
// checks read the floor left of it, clear of the post and its reflection.

import { Matrix4, Vector3 } from 'three';
import { buildPaintCamera, type PaintCameraOptions } from '#lib/paint/animation/models/paint-camera-build.ts';
import { paintCameraPlay, type PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintCameraWorld, paintPlaneWorldPoint, type PaintCameraWorld } from '#lib/paint/animation/models/paint-camera-world.ts';
import { srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedShotProps, ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { paintedThreeShotCamera } from '#lib/paint/three-layers/models/painted-three-camera.ts';
import type { LensExposure } from '#lib/picture/lens/models/lens-exposures.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { shotCameraProject, type ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_LIGHTING_ID = 'shot/shadow';
export const STAMP_GATE_LIGHTING_IDS = [STAMP_GATE_LIGHTING_ID] as const;
export type StampGateLightingId = (typeof STAMP_GATE_LIGHTING_IDS)[number];

/** The shot's frame, its field of view, how far right the camera pans over its second (px), and the wall's depth. */
const STAMP_GATE_LIGHTING_VIEW = { frame: { width: 384, height: 216 }, fov: 30, pan: 36, wallDepth: 3 } as const;
/**
 * The lens, focused on the stands: its aperture (frame px of blur at infinity) wide enough that an exposure off the
 * aperture's middle shifts its lens several px, and a reference frame blurs the wall a little.
 */
const STAMP_GATE_LIGHTING_FOCUS = { focus: 1, aperture: 4 } as const;
/** The frames drawn, in turn: the camera at rest, then panned, each fast; then panned again as a reference frame. */
export const STAMP_GATE_LIGHTING_FRAMES: readonly { readonly at: number; readonly mode: LensMode }[] = [{ at: 0, mode: 'fast' }, { at: 1, mode: 'fast' }, { at: 1, mode: 'reference' }];
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
  /**
   * The sun, `distance` from the floor's centre along `toward`: its strength, shadow box (half its side), the depths
   * from the sun its shadow camera sees (fit round the post and the floor, as the soft filter's search reaches as far
   * as a blocker at `near` could shade), its map and bias.
   */
  light: { toward: [0.5, 1.3, 1], distance: 220, strength: 2.6, box: 90, near: 170, far: 280, mapSize: 1024, bias: -0.0004 },
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

/**
 * The shadowed stand's source rendered apart from the shot, at frame `t`: for each of `apertures` (standard
 * deviations, frame axes), an exposure at `before` s, then straight after it one at t from that point on the
 * aperture, read. Rendered in one animation frame, as a fast GPU renders a reference frame's exposures, each draws
 * its own moment.
 */
export const STAMP_GATE_LIGHTING_EXPOSED: { readonly t: number; readonly before: number; readonly apertures: readonly LensExposure['aperture'][] } = {
  t: 1, before: 0, apertures: [[2, 0], [-1.5, 1.5], [0, -2]],
};

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

/** The shot's camera, its shutter said, as building it apart from the shot needs: panning right over its second, focused on the stands. */
const stampGateLightingCamera = (): Omit<PaintCameraOptions, 'planes'> => ({
  stage: stage(), fov: STAMP_GATE_LIGHTING_VIEW.fov, lens: { bloom: 0, shutter: STAMP_GATE_LIGHTING_SHUTTER },
  plays: [
    paintCameraPlay({ kind: 'move', keys: [{ at: 0 }, { at: 1, pan: { x: STAMP_GATE_LIGHTING_VIEW.pan, y: 0 } }] }, { clock: { at: 0 }, origin: 'pan' }),
    paintCameraPlay({ kind: 'focus', keys: [{ at: 0, ...STAMP_GATE_LIGHTING_FOCUS }] }, { clock: { at: 0 }, origin: 'focus' }),
  ],
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

/**
 * The shot's camera built with the shadowed stand's three plane alone, what the source rendered apart is loaded on;
 * its world, and the margin that plane renders past the frame.
 */
export function stampGateLightingPaintCamera(): { readonly camera: PaintCamera; readonly world: PaintCameraWorld; readonly margin: number } {
  const { stage: shotStage, fov, ...camera } = stampGateLightingCamera();
  const built = buildPaintCamera({ stage: shotStage, fov, ...camera, planes: [{ id: 'shadowed', depth: STAMP_GATE_STAND.depth, kind: 'three' }] });
  if (!built.ok) throw new Error(`stamp gate: ${STAMP_GATE_LIGHTING_ID}'s camera: ${built.problems.join('; ')}`);
  const plane = built.camera.planes[0];
  return { camera: built.camera, world: paintCameraWorld(shotStage, { fov }), margin: plane.kind === 'three' ? plane.margin : 0 };
}

/** The baseline's frame: the shot's frames side by side. */
export const stampGateLightingFrame = () => ({ width: STAMP_GATE_LIGHTING_VIEW.frame.width * STAMP_GATE_LIGHTING_FRAMES.length, height: STAMP_GATE_LIGHTING_VIEW.frame.height });

/** What the baseline is drawn from, as text. */
export const stampGateLightingInputs = (id: StampGateLightingId) => stampCanonicalJson({
  id, view: STAMP_GATE_LIGHTING_VIEW, focus: STAMP_GATE_LIGHTING_FOCUS, frames: STAMP_GATE_LIGHTING_FRAMES, shutter: STAMP_GATE_LIGHTING_SHUTTER, wall: STAMP_GATE_LIGHTING_WALL,
  stand: STAMP_GATE_STAND, at: STAMP_GATE_STAND_AT,
});

/** A picture a check reads, `width` × `height` px: each pixel's linear colour. */
type StampGateLitPicture = { readonly width: number; readonly height: number; readonly rgb: (i: number, j: number) => readonly [number, number, number] };

/** A frame as drawn, RGBA bytes, encoded. */
const stampGateFramePicture = (rgba: Uint8ClampedArray): StampGateLitPicture => ({
  ...STAMP_GATE_LIGHTING_VIEW.frame,
  rgb: (i, j) => {
    const p = (j * STAMP_GATE_LIGHTING_VIEW.frame.width + i) * 4;
    return [srgbToLinear(rgba[p] / 255), srgbToLinear(rgba[p + 1] / 255), srgbToLinear(rgba[p + 2] / 255)];
  },
});

/** A source's render as read back: rgba floats, premultiplied linear, row by row. */
export type StampGateLitRender = { readonly width: number; readonly height: number; readonly values: Float32Array };

const stampGateRenderPicture = ({ width, height, values }: StampGateLitRender): StampGateLitPicture => ({
  width, height, rgb: (i, j) => [values[(j * width + i) * 4], values[(j * width + i) * 4 + 1], values[(j * width + i) * 4 + 2]],
});

/** A picture read through the camera that drew it: where a point of a stand's space lands in it, px. */
type StampGateLitSeen = { readonly picture: StampGateLitPicture; readonly project: (which: StampGateStandId, point: Vector3) => { x: number; y: number } };

/** `picture` as `shot` drew it. */
function stampGateLitSeen(picture: StampGateLitPicture, shot: ShotCamera): StampGateLitSeen {
  return {
    picture,
    project: (which, point) => {
      const seen = shotCameraProject(shot, point.clone().applyMatrix4(stampGateStandMatrix(which)));
      if (!seen) throw new Error(`stamp gate: ${STAMP_GATE_LIGHTING_ID}'s ${which} stand lies behind the camera`);
      return seen;
    },
  };
}

/** A picture's linear luminance at `at` (px), bilinear between pixel centres. Refuses a point off it: the case misplaced it. */
function stampGateLuminanceAt({ width, height, rgb }: StampGateLitPicture, { x, y }: { x: number; y: number }): number {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  if (!(x0 >= 0 && y0 >= 0 && x0 + 1 < width && y0 + 1 < height)) throw new Error(`stamp gate: ${STAMP_GATE_LIGHTING_ID} reads (${x.toFixed(1)}, ${y.toFixed(1)}), off its ${width} × ${height} picture`);
  const at = (i: number, j: number) => {
    const [r, g, b] = rgb(i, j);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

const text = (v: number) => v.toFixed(3);

/**
 * How far along the shadow from the post's foot each profile crosses it, world units: beside the foot; halfway down,
 * where the post's side casts a still narrow edge clear of the floor the post hides; and under the cap's shadow.
 */
const STAMP_GATE_PROFILE_AT = { contact: 10, placed: 18, cast: 36 } as const;
/** How far a profile runs from the shadow's middle out past its left edge, and its step, world units. */
const STAMP_GATE_PROFILE = { length: 22, step: 0.5 } as const;

/** Down the shadow, and left across it, in a stand's space, unit length. */
function stampGateShadowAxes(): { down: Vector3; left: Vector3 } {
  const toward = stampGateStandLightToward(), down = new Vector3(-toward.x, 0, -toward.z).normalize();
  return { down, left: new Vector3(down.z, 0, -down.x) };
}

/**
 * Luminance across stand `which`'s shadow at scene second `at`, `along` world units down it from the foot: from `from`
 * left of its middle out past its left edge (the side away from what the post hides), on the floor.
 */
function stampGateShadowProfile({ picture, project }: StampGateLitSeen, which: StampGateStandId, at: number, along: number, from = 0): number[] {
  const { down, left } = stampGateShadowAxes(), middle = stampGateStandPostAt(at).addScaledVector(down, along);
  return Array.from({ length: (STAMP_GATE_PROFILE.length - from) / STAMP_GATE_PROFILE.step + 1 }, (_, i) =>
    stampGateLuminanceAt(picture, project(which, middle.clone().addScaledVector(left, from + i * STAMP_GATE_PROFILE.step))));
}

/**
 * A profile's shadow, its lit floor (its last 2 world units), its edge's width (from a quarter to three quarters lit)
 * and where it crosses half lit, world units from the profile's start.
 */
function stampGateShadowEdge(profile: readonly number[]): { shadow: number; lit: number; width: number; half: number } {
  const tail = Math.round(2 / STAMP_GATE_PROFILE.step), lit = profile.slice(-tail).reduce((sum, v) => sum + v, 0) / tail, shadow = Math.min(...profile);
  const lifted = (share: number) => shadow + share * (lit - shadow), darkest = profile.indexOf(shadow);
  const high = profile.findIndex((v) => v >= lifted(0.75)), low = profile.slice(0, high).findLastIndex((v) => v <= lifted(0.25));
  const above = profile.findIndex((v, i) => i > darkest && v >= lifted(0.5));
  const half = above > 0 ? (above - 1 + (lifted(0.5) - profile[above - 1]) / (profile[above] - profile[above - 1])) * STAMP_GATE_PROFILE.step : Infinity;
  return { shadow, lit, width: high < 0 ? Infinity : (high - low) * STAMP_GATE_PROFILE.step, half };
}

/** How dark beside the foot the shadow must be, of the lit floor beside it. */
const STAMP_GATE_CONTACT_MOST = 0.5;
/** How far the shadow's half-lit edge may lie from the post's side's shadow, world units. */
const STAMP_GATE_EDGE_WITHIN = 1.5;
/** How much wider the cast edge is than the contact's, at the least: a penumbra grows with the gap behind its blocker. */
const STAMP_GATE_CAST_WIDER = 2;
/**
 * How near the cast edge's width is to a disc light's, as a share of it: the sun's angular radius sets the penumbra,
 * the map's texels and the frame's px widen it a little.
 */
const STAMP_GATE_CAST_NEAR = 0.3;
/**
 * How lit the twin's floor must stay where its shadow would fall, of its lit floor: none is cast. Read from `from` left
 * of the shadow's middle: the twin stands left of the camera, so its post hides the floor right of there as it pans.
 */
const STAMP_GATE_TWIN = { least: 0.95, from: 4 } as const;
/** How near the cap's reflection's middle lies to the reflected cap seen through the camera, px; and the window searched. */
const STAMP_GATE_REFLECTION = { within: 3, window: 12 } as const;

/** The post's corner whose upright edge casts its shadow's left edge, in the stand's space at the foot. */
function stampGateShadowCorner(): Vector3 {
  const { left } = stampGateShadowAxes(), half = STAMP_GATE_STAND.post.width / 2;
  return new Vector3(Math.sign(left.x) * half, 0, Math.sign(left.z) * half);
}

/** Where the post's left side casts its shadow's edge, world units left of the shadow's middle. */
const stampGateShadowSide = () => stampGateShadowCorner().dot(stampGateShadowAxes().left);

/**
 * The width a disc light's penumbra crosses from a quarter to three quarters lit across the shadow's left edge,
 * `along` world units down it: 0.808 of its radius, which is the gap from the corner's edge shading there to the
 * floor, along the light, times the tangent of the sun's angular radius.
 */
function stampGateDiscPenumbraWidth(along: number): number {
  const toward = stampGateStandLightToward(), height = ((along - stampGateShadowCorner().dot(stampGateShadowAxes().down)) * toward.y) / Math.hypot(toward.x, toward.z);
  return 0.808 * (height / toward.y) * Math.tan(rad(STAMP_GATE_STAND.softness));
}

/** The middle of the red standing out of the floor round `near`, px, weighted by how far red stands out; null for none. */
function stampGateRedMiddle({ width, height, rgb }: StampGateLitPicture, near: { x: number; y: number }): { x: number; y: number; weight: number } | null {
  const r = STAMP_GATE_REFLECTION.window;
  let weight = 0, x = 0, y = 0;
  for (let j = Math.max(0, Math.floor(near.y - r)); j < Math.min(height, Math.ceil(near.y + r)); j++) {
    for (let i = Math.max(0, Math.floor(near.x - r)); i < Math.min(width, Math.ceil(near.x + r)); i++) {
      const [red, green, blue] = rgb(i, j), out = Math.max(0, red - (green + blue) / 2 - 0.02);
      weight += out;
      x += out * (i + 0.5);
      y += out * (j + 0.5);
    }
  }
  return weight > 0.5 ? { x: x / weight, y: y / weight, weight } : null;
}

/**
 * The shadowed stand's shadow halfway down at scene second `at`: dark, its edge where the post's side casts it then.
 * A shadow cast from where the post stood a moment before lies a post's width off.
 */
function stampGateShadowPlacedCheck(id: string, seen: StampGateLitSeen, at: number): StampGateWashCheck {
  const placed = stampGateShadowEdge(stampGateShadowProfile(seen, 'shadowed', at, STAMP_GATE_PROFILE_AT.placed)), side = stampGateShadowSide();
  return {
    id: `${id}: shadow where the post stands`, passed: placed.shadow <= STAMP_GATE_CONTACT_MOST * placed.lit && Math.abs(placed.half - side) <= STAMP_GATE_EDGE_WITHIN,
    detail: `${STAMP_GATE_PROFILE_AT.placed} down the shadow from the foot, its darkest ${text(placed.shadow)} of lit ${text(placed.lit)} (at most ${STAMP_GATE_CONTACT_MOST} of it wanted), its edge half lit ${placed.half.toFixed(2)} from its middle, the post at ${at} s casting it at ${side.toFixed(2)} (within ${STAMP_GATE_EDGE_WITHIN} wanted)`,
  };
}

/** The cap's reflection in the shadowed stand's floor at scene second `at`: where the camera sees the cap mirrored. */
function stampGateReflectionCheck(id: string, { picture, project }: StampGateLitSeen, at: number): StampGateWashCheck {
  // The cap's front face is what shows of it, mirrored: its middle.
  const { body, cap, width } = STAMP_GATE_STAND.post, mirrored = stampGateStandPostAt(at).add(new Vector3(0, -(body + cap / 2), width / 2));
  const expected = project('shadowed', mirrored), red = stampGateRedMiddle(picture, expected);
  const off = red ? Math.hypot(red.x - expected.x, red.y - expected.y) : Infinity;
  return {
    id: `${id}: reflection follows the camera`, passed: off <= STAMP_GATE_REFLECTION.within,
    detail: red
      ? `the cap's reflection's middle (${red.x.toFixed(1)}, ${red.y.toFixed(1)}) px, ${off.toFixed(1)} from the mirrored cap's (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)}) (within ${STAMP_GATE_REFLECTION.within} wanted)`
      : `no red reflection within ${STAMP_GATE_REFLECTION.window} px of the mirrored cap's (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)})`,
  };
}

/**
 * The shot's checks, given each frame (RGBA bytes, STAMP_GATE_LIGHTING_FRAMES in turn) read through the camera at its
 * moment: the shadow dark and sharp beside the foot, where the post casts it, softening down its length as the sun's
 * size says; the twin unshadowed; and the cap's reflection where the camera sees the cap mirrored, as it pans.
 */
export function checkStampGateLighting(frames: readonly Uint8ClampedArray[]): StampGateWashCheck[] {
  const { camera, world } = stampGateLightingPaintCamera();
  return frames.flatMap((rgba, f) => {
    const { at, mode } = STAMP_GATE_LIGHTING_FRAMES[f], id = `${STAMP_GATE_LIGHTING_ID} at ${at} s, ${mode}`;
    const seen = stampGateLitSeen(stampGateFramePicture(rgba), paintedThreeShotCamera(camera, world, 0, paintMoment(at), null));
    const contact = stampGateShadowEdge(stampGateShadowProfile(seen, 'shadowed', at, STAMP_GATE_PROFILE_AT.contact));
    const cast = stampGateShadowEdge(stampGateShadowProfile(seen, 'shadowed', at, STAMP_GATE_PROFILE_AT.cast)), disc = stampGateDiscPenumbraWidth(STAMP_GATE_PROFILE_AT.cast);
    const twin = stampGateShadowEdge(stampGateShadowProfile(seen, 'twin', at, STAMP_GATE_PROFILE_AT.cast, STAMP_GATE_TWIN.from));
    return [
      {
        id: `${id}: contact`, passed: contact.shadow <= STAMP_GATE_CONTACT_MOST * contact.lit,
        detail: `${STAMP_GATE_PROFILE_AT.contact} down the shadow from the foot, its darkest ${text(contact.shadow)} beside lit floor ${text(contact.lit)} (at most ${STAMP_GATE_CONTACT_MOST} of it wanted)`,
      },
      stampGateShadowPlacedCheck(id, seen, at),
      {
        id: `${id}: soft cast`,
        passed: cast.shadow <= STAMP_GATE_CONTACT_MOST * cast.lit && cast.width >= STAMP_GATE_CAST_WIDER * contact.width && Math.abs(cast.width - disc) <= STAMP_GATE_CAST_NEAR * disc,
        detail: `its edge ${contact.width} wide ${STAMP_GATE_PROFILE_AT.contact} from the foot, ${cast.width} at ${STAMP_GATE_PROFILE_AT.cast} (${STAMP_GATE_CAST_WIDER}× at least, and within ${STAMP_GATE_CAST_NEAR * 100}% of the ${STAMP_GATE_STAND.softness}° sun's ${disc.toFixed(2)}, wanted), its darkest there ${text(cast.shadow)} of lit ${text(cast.lit)}`,
      },
      {
        id: `${id}: unshadowed twin`, passed: twin.shadow >= STAMP_GATE_TWIN.least * twin.lit,
        detail: `the twin, asking for no shadows on the same renderer, its floor at least ${text(twin.shadow)} where a shadow would fall, lit ${text(twin.lit)} beside it (${STAMP_GATE_TWIN.least} of it wanted)`,
      },
      stampGateReflectionCheck(id, seen, at),
    ];
  });
}

/**
 * The checks of the shadowed stand's source rendered apart (STAMP_GATE_LIGHTING_EXPOSED), given each read render in
 * turn, each read through its exposure's camera, moved over the aperture and its lens shifted: its shadow where the
 * post stands at t, not where the render before it left it; and the cap's reflection registered through the shift.
 */
export function checkStampGateLightingExposed(renders: readonly StampGateLitRender[]): StampGateWashCheck[] {
  const { camera, world, margin } = stampGateLightingPaintCamera(), { t, apertures } = STAMP_GATE_LIGHTING_EXPOSED;
  return renders.flatMap((render, e) => {
    const aperture = apertures[e], id = `${STAMP_GATE_LIGHTING_ID} exposure at ${t} s from (${aperture.join(', ')}) on the aperture`;
    const seen = stampGateLitSeen(stampGateRenderPicture(render), paintedThreeShotCamera(camera, world, margin, paintMoment(t), aperture));
    return [stampGateShadowPlacedCheck(id, seen, t), stampGateReflectionCheck(id, seen, t)];
  });
}
