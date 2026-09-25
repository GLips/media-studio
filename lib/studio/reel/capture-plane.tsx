// capture-plane.tsx: a capture as a card in space, the way a reel shows product UI: a crop of a page (a View) on a
// rounded card posed in 3D, lit by one key light (shadow, rim, a sheen that slides as it turns, shade as it turns
// away), with one control able to lift out of the page toward the viewer.
//
// CSS 3D, not three.js, so the browser resamples the hi-DPI capture from its pixels. Each card is its own 3D context,
// so cards stack in drawing order (far first) and never cut into each other. Flatteners (filter, opacity, overflow,
// blend modes) go on the lens root or leaves, never between the card and its children, or the lift sinks into the page.

import type { CSSProperties, ReactNode } from 'react';
import { Img } from 'remotion';
import { inflate, rectToScreen, scaleFor, toScreen, view, type Point, type Rect, type Shot, type View } from '../camera.ts';
import { FPS, H, W } from '../frame.ts';
import { clamp, lerp, perceptualSpring, type PerceptualSpring } from '../motion.ts';
import { cameraMotionAttrs, motionEchoAttrs, pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom } from '../random.ts';
import { crossVec3, dotVec3, unitVec3, type Vec3 } from '../vec3.ts';

/**
 * Where a card is and how it's turned. `x`, `y` are px from its view's box, `z` px toward the viewer. `rx` tips the top
 * edge away, `ry` turns the face to the right (right edge away), `rz` turns it clockwise; degrees, any value.
 */
export type PlanePose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };

/** HyperFrames' resting tilt for a UI card (rotateY −8°, rotateX 3°): any channel a pose leaves out is this one's. */
export const PLANE_REST_POSE: PlanePose = { x: 0, y: 0, z: 0, rx: 3, ry: -8, rz: 0 };

/** Each channel of pose `a` to `b`, `k` of the way; channels either leaves out are the rest pose's. */
export function lerpPlanePose(a: Partial<PlanePose>, b: Partial<PlanePose>, k: number): PlanePose {
  const [from, to] = [{ ...PLANE_REST_POSE, ...a }, { ...PLANE_REST_POSE, ...b }];
  return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), z: lerp(from.z, to.z, k), rx: lerp(from.rx, to.rx, k), ry: lerp(from.ry, to.ry, k), rz: lerp(from.rz, to.rz, k) };
}

/**
 * The view that shows page `rect` (grown by `pad` page px) filling a card as large as fits in `fit`, centred on
 * `centre`. Text stays crisp while the card's page zoom times its lens magnification stays under the capture's
 * pixels: about 2.2 for a 3× capture of a 1440 px page.
 */
export function capturePlaneView(shot: Shot, rect: Rect, { fit = { w: 1040, h: 800 }, centre = { x: W / 2, y: H / 2 }, pad = 0 }: { fit?: { w: number; h: number }; centre?: Point; pad?: number } = {}): View {
  const r = inflate(rect, pad);
  const k = Math.min(fit.w / r.w, fit.h / r.h);
  const [w, h] = [r.w * k, r.h * k];
  return view(shot, { cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom: k / scaleFor(shot, 1) }, { x: centre.x - w / 2, y: centre.y - h / 2, w, h });
}

/** One control raised out of the page: the same crop's `rect` drawn again above the card, casting its own shadow. */
export type PlaneLift = {
  /** A page rect of the view's capture: a swatch row, a price. */
  rect: Rect;
  /** When it arrives at full height (its spring's `arrival`), in the piece's seconds: put it on a beat. */
  at: number;
  /** When it arrives back down, if it drops. */
  drop?: number;
  /** Px toward the viewer (64), and how much it grows as it rises (1.08; HyperFrames' pop is 80 px and 1.15). */
  height?: number;
  scale?: number;
  /** How far the rest of the card darkens, 0..1 (0.12), and px of blur on it (0), as focus pulls to the lift. */
  dim?: number;
  focus?: number;
  /** Page px of page kept around the rect (6), and its corners in frame px (10). */
  pad?: number;
  radius?: number;
  /** The colour it leaves behind in the page: the background of the panel it sat on (the card's `paper`). */
  socket?: string;
  /**
   * The rise's `perceptualSpring` pace (0.3) and bounce (0.35): a UI reaction may bounce. The drop is smooth, at
   * `dropDur` (`dur`); a drop soon after `at` wants a quicker one, or it starts before the rise has arrived.
   */
  dur?: number;
  bounce?: number;
  dropDur?: number;
};

type PoseInput = Partial<PlanePose> | ((t: number) => Partial<PlanePose>);

export type CapturePlaneProps = {
  /** Seconds since the piece starts: drives the drift, the lift, and `pose` when it's a function. */
  t: number;
  /** The crop, as any capture is aimed: its box is the card at rest, its camera what the card shows. */
  view: View;
  /**
   * The pose, or the pose at a time (`(t) => …`, called with the piece's seconds), which lets the card smear its fast
   * moves. Channels left out are PLANE_REST_POSE's.
   */
  pose?: PoseInput;
  /** CSS perspective in px (1100; HyperFrames 1000–1200) and the vanishing point (the frame's centre). */
  lens?: number;
  vanish?: Point;
  radius?: number;
  /** Where the key light comes from, in degrees: `x` left (−) or right, `y` above (+). It sets the shadow, rim and sheen. */
  light?: { x: number; y: number };
  /** Px the card floats in front of the surface it casts its shadow on (44): how far and soft the shadow falls. */
  elevation?: number;
  /** The shadow's colour at its darkest (its alpha is its strength), or false for none. */
  shadow?: string | false;
  /** The sheen band's peak white (0.16; HyperFrames 0.10–0.25) and width as a share of the card (0.28; 0.15–0.35). */
  sheen?: number;
  sheenWidth?: number;
  /** The rim's white along the edge facing the light (0.14; HyperFrames' 1 px at 0.10), and brighter edge-on. */
  rim?: number;
  /** How dark the face gets as it turns away from the light, 0..1 (0.2). */
  shade?: number;
  /** Depth of field: px of blur for a card out of focus behind another (HyperFrames 3–6 px a depth step, 8–24 max). */
  blur?: number;
  alpha?: number;
  /** What's on the back past edge-on: a colour, or another view's crop the right way round, in the card's box. */
  back?: string | View;
  /** The colour behind the crop where it runs off the page. */
  paper?: string;
  /** How much it floats while held (1: 2–8 px, under 1°, HyperFrames' hold drift), seeded by `seed`; 0 for still. */
  drift?: number;
  seed?: string | number;
  /**
   * Frames of shutter smearing moves over 40 px a frame (1, a 360° shutter): the card's recent poses averaged behind
   * its sharp one, HyperFrames' smear. 0 for none. Only a `pose` function can smear.
   */
  shutter?: number;
  lift?: PlaneLift;
  /** Its name in the motion tracks, `plane` by default; its pose is reported as values and its camera tracked inside it. */
  motion?: string | false;
};

/**
 * A capture on a card in space: the view's crop on a rounded plane at `pose`, with its shadow, rim, sheen and shade
 * from one key light, a lifted control if `lift` is given, and a shutter smear when it moves fast.
 *
 *   <CapturePlane t={s.t} view={hero} pose={(t) => lerpPlanePose(FROM, {}, seg(t, 0, 1, motionCurves.expo.entrance))}
 *     lift={{ rect: union(...shot.rects.swatches), at: grid.at(3) }} />
 */
export function CapturePlane(props: CapturePlaneProps) {
  const { t, view: v, pose = {}, lens = 1100, vanish = { x: W / 2, y: H / 2 }, drift = 1, seed, shutter = 1, shadow = 'rgba(0, 0, 0, 0.6)', elevation = 44, blur = 0, alpha = 1 } = props;
  if (alpha <= 0) return null;
  const driftSeed = seed ?? `${v.shot.src}|${v.box.x}|${v.box.y}`;
  const poseAt = (at: number) => withDrift({ ...PLANE_REST_POSE, ...(typeof pose === 'function' ? pose(at) : pose) }, at, driftSeed, drift);
  const now = poseAt(t);
  const trail = typeof pose === 'function' && shutter > 0 ? planeTrail(v, now, poseAt(t - 1 / FPS), lens, vanish, shutter) : null;
  return (
    <>
      {shadow !== false && <PlaneShadow box={v.box} pose={now} lens={lens} vanish={vanish} radius={props.radius ?? 18} light={lightDirection(props.light)} elevation={elevation} color={shadow} blur={blur} alpha={alpha} />}
      {trail && (
        // Isolated, so the exposures add up among themselves and the sum lies over the ground as one layer.
        <div {...motionEchoAttrs} style={{ position: 'absolute', inset: 0, isolation: 'isolate', pointerEvents: 'none' }}>
          {trail.exposures.map(({ ago, share }) => (
            <PlaneExposure key={ago} {...props} pose={poseAt(t - ago / FPS)} at={t - ago / FPS} opacity={alpha * share} blur={Math.hypot(blur, trail.soften)} echo />
          ))}
        </div>
      )}
      <PlaneExposure {...props} pose={now} at={t} opacity={alpha} />
    </>
  );
}

// ---------- the card in space ----------

const along = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** A posed face in lens space (CSS axes: x right, y down, z toward the viewer): its centre and its x, y and out axes. */
type PlaneFrame = { c: Vec3; ex: Vec3; ey: Vec3; n: Vec3 };

function planeFrame(box: Rect, p: PlanePose): PlaneFrame {
  // CSS composes rotateX(rx) rotateY(ry) rotateZ(rz) as Rx·Ry·Rz on column vectors; its columns are the card's axes.
  const r = (d: number) => (d * Math.PI) / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(r(p.rx)), Math.sin(r(p.rx)), Math.cos(r(p.ry)), Math.sin(r(p.ry)), Math.cos(r(p.rz)), Math.sin(r(p.rz))];
  return {
    c: [box.x + box.w / 2 + p.x, box.y + box.h / 2 + p.y, p.z],
    ex: [cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz],
    ey: [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz],
    n: [sy, -sx * cy, cx * cy],
  };
}

/** The same card seen from behind, as its back face lays out: rotateY(180°) mirrors its x axis and its normal. */
const backOf = (f: PlaneFrame): PlaneFrame => ({ ...f, ex: along([0, 0, 0], f.ex, -1), n: along([0, 0, 0], f.n, -1) });

const pointOn = (f: PlaneFrame, u: number, v: number, w = 0): Vec3 => along(along(along(f.c, f.ex, u), f.ey, v), f.n, w);
// Past the lens a point has no image; the card should never get there, so hold it just in front.
const lensScale = (z: number, lens: number) => lens / Math.max(lens - z, 1);
const project = (p: Vec3, lens: number, vp: Point): Point => {
  const s = lensScale(p[2], lens);
  return { x: vp.x + (p[0] - vp.x) * s, y: vp.y + (p[1] - vp.y) * s };
};
const eyeOf = (lens: number, vp: Point): Vec3 => [vp.x, vp.y, lens];
const cornersOf = (box: Rect): [number, number][] => [[-box.w / 2, -box.h / 2], [box.w / 2, -box.h / 2], [box.w / 2, box.h / 2], [-box.w / 2, box.h / 2]];

/** A lift's plate on the card: its centre from the card's (u, v), its size, how far it's up, and its scale. */
type LiftedPlate = { u: number; v: number; w: number; h: number; z: number; scale: number };

/**
 * The most the card, or its lifted plate (by its own scale on top), is stretched in any direction where it's in frame,
 * as frame px per layout px: sampled on a grid, since a push-in's nearest corner is often out of frame, and taken from
 * the projection's local stretch, since perspective stretches a tilted card past its depth's scale toward the frame's
 * edges. 0 when none of it is in frame.
 */
function framedStretch(f: PlaneFrame, box: Rect, lens: number, vanish: Point, lifted: LiftedPlate | null) {
  const N = 16;
  let most = 0;
  const sample = (u: number, v: number, w: number, h: number, z: number, scale: number) => {
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const [pu, pv] = [u + w * (i / N - 0.5), v + h * (j / N - 0.5)];
        const s = project(pointOn(f, pu, pv, z), lens, vanish);
        if (s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
        const du = project(pointOn(f, pu + 1, pv, z), lens, vanish), dv = project(pointOn(f, pu, pv + 1, z), lens, vanish);
        most = Math.max(most, largestStretch(du.x - s.x, dv.x - s.x, du.y - s.y, dv.y - s.y) * scale);
      }
    }
  };
  sample(0, 0, box.w, box.h, 0, 1);
  if (lifted) sample(lifted.u, lifted.v, lifted.w * lifted.scale, lifted.h * lifted.scale, lifted.z, lifted.scale);
  return most;
}

/** The largest singular value of the Jacobian [[a, b], [c, d]]: how far it stretches in its worst direction. */
function largestStretch(a: number, b: number, c: number, d: number) {
  const sum = a * a + b * b + c * c + d * d, det = a * d - b * c;
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2);
}

/** Where a card at a pose puts things, as CapturePlane draws it. */
export type CapturePlaneProjection = {
  /** A page point of the view's capture, `w` px off the card's face toward the viewer, in lens space (CSS axes). */
  pageInLens: (page: Point, w?: number) => Vec3;
  /** A lens-space point's image in frame px. */
  lensToScreen: (q: Vec3) => Point;
  /** A page point on the card, `w` px off its face, in frame px. */
  pageToScreen: (page: Point, w?: number) => Point;
  /** The card's corners in frame px, clockwise from its top left while its face is toward the lens. */
  corners: Point[];
  /** Whether frame point `p` falls on the card, whichever face shows. */
  covers: (p: Point) => boolean;
};

/**
 * The card `view` shows, at `pose` (as given: CapturePlane's seeded float, a few px, isn't in it) through `lens` and
 * `vanish` as CapturePlane takes them: for what a scene hangs on the card or asks about it, like a flood from a swatch
 * or the HUD's tone over it.
 */
export function capturePlaneProjection(view: View, pose: PlanePose, { lens = 1100, vanish = { x: W / 2, y: H / 2 } }: { lens?: number; vanish?: Point } = {}): CapturePlaneProjection {
  const { box, shot, cam } = view;
  const f = planeFrame(box, pose);
  const pageInLens = (page: Point, w = 0) => {
    const s = toScreen(shot, cam, page, box);
    return pointOn(f, s.x - box.x - box.w / 2, s.y - box.y - box.h / 2, w);
  };
  const lensToScreen = (q: Vec3) => project(q, lens, vanish);
  const corners = cornersOf(box).map(([u, v]) => lensToScreen(pointOn(f, u, v)));
  const covers = (p: Point) => {
    const sides = corners.map((a, i) => {
      const b = corners[(i + 1) % corners.length];
      return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    });
    return sides.every((s) => s >= 0) || sides.every((s) => s <= 0);
  };
  return { pageInLens, lensToScreen, pageToScreen: (page, w) => lensToScreen(pageInLens(page, w)), corners, covers };
}

/** The key light's direction (toward it) from its angles: left/right of the lens axis, then above it. */
function lightDirection({ x, y }: { x: number; y: number } = { x: -25, y: 35 }): Vec3 {
  const [az, el] = [(x * Math.PI) / 180, (y * Math.PI) / 180];
  return [Math.sin(az) * Math.cos(el), -Math.sin(el), Math.cos(az) * Math.cos(el)];
}

// Seconds a cycle and amplitude of each channel's float at drift 1. Periods sit near HyperFrames' X:Y of 1.3 and share
// no common beat, so the card floats rather than bobs; the amplitudes are their hold drift (2–8 px, under 1°).
const DRIFT: Record<keyof PlanePose, readonly [amp: number, period: number]> = {
  x: [6, 4.3], y: [4, 3.3], z: [10, 5.1], rx: [0.5, 3.9], ry: [0.9, 5.7], rz: [0.2, 6.9],
};

function withDrift(p: PlanePose, t: number, seed: string | number, amount: number): PlanePose {
  if (!amount) return p;
  const out = { ...p };
  for (const key of Object.keys(DRIFT) as (keyof PlanePose)[]) {
    const [amp, period] = DRIFT[key];
    out[key] += amount * amp * Math.sin((2 * Math.PI * t) / period + 2 * Math.PI * hashRandom(seed, key));
  }
  return out;
}

/**
 * The exposures smearing a fast card, `ago` frames back, `share` of one each: summed with plus-lighter they average as
 * a shutter does, not stack into copies, and blur by half their spacing so the steps melt. None under 40 px a frame
 * (the 30 fps strobe threshold), fading in over the next 40 so it never pops on.
 */
function planeTrail(v: View, now: PlanePose, before: PlanePose, lens: number, vanish: Point, shutter: number) {
  const [a, b] = [capturePlaneProjection(v, now, { lens, vanish }).corners, capturePlaneProjection(v, before, { lens, vanish }).corners];
  const moved = Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
  const strength = clamp((moved - 40) / 40);
  if (strength <= 0) return null;
  const n = clamp(Math.ceil((moved * shutter) / 20), 2, 12);
  return {
    soften: Math.min(12, (moved * shutter) / n / 2),
    exposures: Array.from({ length: n }, (_, i) => ({ ago: (shutter * (n - i)) / n, share: strength / n })),
  };
}

// ---------- light ----------

// HyperFrames' rake: the sheen band runs at 105°, leaning like "/", and its strip light leans the same way in the world.
const SHEEN_DEG = 105;
const SHEEN_DIR = [Math.sin((SHEEN_DEG * Math.PI) / 180), -Math.cos((SHEEN_DEG * Math.PI) / 180)] as const;
const SHEEN_STRIP: Vec3 = [-SHEEN_DIR[1], SHEEN_DIR[0], 0];
const sheenLineLength = (w: number, h: number) => w * Math.abs(SHEEN_DIR[0]) + h * Math.abs(SHEEN_DIR[1]);

/**
 * Where the key light's reflection crosses a face, px from its centre along the sheen's gradient line: where the view
 * ray, mirrored in the face, meets a long light's plane. It slides twice as fast as the face turns (3% of the card a
 * degree, as HyperFrames' yaw-driven sweep), and in from off the face, held `reach` px out.
 */
function sheenOffset(f: PlaneFrame, w: number, h: number, eye: Vec3, light: Vec3, reach: number): number {
  const across = unitVec3(crossVec3(light, SHEEN_STRIP));
  const len = sheenLineLength(w, h);
  const angle = (u: number) => {
    const p = pointOn(f, SHEEN_DIR[0] * u, SHEEN_DIR[1] * u);
    const toEye = unitVec3(along(eye, p, -1));
    const mirrored = along(along([0, 0, 0], f.n, 2 * dotVec3(f.n, toEye)), toEye, -1);
    return Math.asin(clamp(dotVec3(mirrored, across), -1, 1));
  };
  const us = Array.from({ length: 9 }, (_, i) => -len / 2 + (len * i) / 8);
  const as = us.map(angle);
  for (let i = 1; i < us.length; i++) {
    if (as[i - 1] <= 0 !== as[i] <= 0) return us[i - 1] + ((us[i] - us[i - 1]) * as[i - 1]) / (as[i - 1] - as[i]);
  }
  const [end, next] = Math.abs(as[0]) < Math.abs(as[8]) ? [0, 1] : [8, 7];
  const slope = (as[next] - as[end]) / (us[next] - us[end]);
  const off = Math.abs(slope) > 1e-6 ? us[end] - as[end] / slope : Infinity;
  // Out of the face on the side it can slide in from, or nowhere near it.
  return clamp(Number.isFinite(off) && (end === 0 ? off < us[0] : off > us[8]) ? off : (end === 0 ? -1 : 1) * reach, -reach, reach);
}

/** A gaussian band of white `peak` centred `centre`% along a 105° gradient line, `width`% wide at half its height. */
function sheenGradient(centre: number, width: number, peak: number) {
  const sd = width / 2.355;
  const stops = [-2.6, -1.6, -0.8, 0, 0.8, 1.6, 2.6].map((x) => {
    const a = Math.abs(x) > 2.5 ? 0 : peak * Math.exp((-x * x) / 2);
    return `rgba(255, 255, 255, ${a.toFixed(4)}) ${(centre + x * sd).toFixed(3)}%`;
  });
  return `linear-gradient(${SHEEN_DEG}deg, ${stops.join(', ')})`;
}

/** What one face shows of the light: its shade, its sheen's centre, and its rim. */
type FaceLight = { shade: number; sheen: number; rim: string };

function faceLight(f: PlaneFrame, box: Rect, props: ExposureProps, ss: number): FaceLight {
  const { lens = 1100, vanish = { x: W / 2, y: H / 2 }, shade = 0.2, rim = 0.14, sheenWidth = 0.28 } = props;
  const len = sheenLineLength(box.w, box.h);
  const light = lightDirection(props.light);
  const eye = eyeOf(lens, vanish);
  // Lambert against the card's rest: nothing at rest or turned toward the light, `shade` edge-on to it.
  const dark = shade * clamp((light[2] - dotVec3(f.n, light)) / light[2]);
  // The edge facing the light catches it, brighter as the face turns edge-on to the viewer (Fresnel).
  const grazing = 1 - Math.abs(dotVec3(f.n, unitVec3(along(eye, f.c, -1))));
  const [lx, ly] = [dotVec3(light, f.ex), dotVec3(light, f.ey)];
  const l = Math.hypot(lx, ly) || 1;
  const [ox, oy] = [(-lx / l) * 1.5 * ss, (-ly / l) * 1.5 * ss];
  const lit = Math.min(0.9, rim * (1 + 3 * grazing));
  return {
    shade: dark,
    // The band's gaussian fades out 1.1 widths from its centre.
    sheen: sheenOffset(f, box.w, box.h, eye, light, len * (0.5 + 1.1 * sheenWidth)),
    rim: `inset ${ox}px ${oy}px 0 0 rgba(255, 255, 255, ${lit}), inset 0 0 0 ${ss}px rgba(255, 255, 255, ${lit * 0.35}), inset ${-ox}px ${-oy}px 0 0 rgba(0, 0, 0, ${rim * 0.5})`,
  };
}

// ---------- the lift ----------

const springs = new Map<string, PerceptualSpring>();
const springFor = (dur: number, bounce: number) => {
  const key = `${dur}|${bounce}`;
  if (!springs.has(key)) springs.set(key, perceptualSpring(dur, bounce));
  return springs.get(key)!;
};
const riseOf = ({ dur = 0.3, bounce = 0.35 }: Pick<PlaneLift, 'dur' | 'bounce'>) => springFor(dur, bounce);

/** When a lift leaves the page, in the piece's seconds: its spring starts `arrival` before `at`. */
export const planeLiftStart = (lift: Pick<PlaneLift, 'at' | 'dur' | 'bounce'>) => lift.at - riseOf(lift).arrival;

/** How far the lift is up: 0 down, 1 at its height, past 1 while it overshoots. */
function liftHeight(lift: PlaneLift, t: number) {
  const { at, drop, dur = 0.3, dropDur = dur } = lift;
  const rise = riseOf(lift), fall = springFor(dropDur, 0);
  const up = rise(t - (at - rise.arrival));
  return drop === undefined ? up : up * (1 - fall(t - (drop - fall.arrival)));
}

// ---------- drawing ----------

type ExposureProps = Omit<CapturePlaneProps, 'pose'> & { pose: PlanePose; at: number; opacity: number; echo?: boolean };

/** One exposure of the card: its lens root, the card at `pose`, whichever face is toward the viewer, and the lift. */
function PlaneExposure(props: ExposureProps) {
  const { view: v, pose, at, opacity, echo = false, lens = 1100, vanish = { x: W / 2, y: H / 2 }, radius = 18, blur = 0, sheen = 0.16, sheenWidth = 0.28, back = '#1d1d21', paper = '#fff', lift, motion } = props;
  const { box, shot, cam } = v;
  const f = planeFrame(box, pose);
  const facing = dotVec3(along(eyeOf(lens, vanish), f.c, -1), f.n) > 0;
  const up = lift ? liftHeight(lift, at) : 0;
  const plate = lift && up > 0.001 ? rectToScreen(shot, cam, inflate(lift.rect, lift.pad ?? 6), box) : null;
  const plateScale = 1 + ((lift?.scale ?? 1.08) - 1) * up;
  const plateZ = (lift?.height ?? 64) * up;
  // Chrome rasterizes a 3D layer at its layout size, so a card the lens magnifies would be upsampled and soft. It's
  // laid out at its largest on-screen scale and shrunk back in its transform; a far card is laid out small, so it's
  // filtered down when drawn rather than aliased by the compositor.
  const lifted: LiftedPlate | null = plate && facing
    ? { u: plate.x - box.x + plate.w / 2 - box.w / 2, v: plate.y - box.y + plate.h / 2 - box.h / 2, w: plate.w, h: plate.h, z: plateZ, scale: plateScale }
    : null;
  const scales = cornersOf(box).map(([u, vv]) => lensScale(pointOn(f, u, vv)[2], lens));
  if (lifted) scales.push(lensScale(pointOn(f, lifted.u, lifted.v, lifted.z)[2], lens) * lifted.scale);
  const ss = clamp(Math.max(...scales), 0.2, 3);
  // Frame px per capture px where the shown capture is most magnified in frame, recorded so a graph can show a capture
  // too small for its closest frame: past about 1.3, its text goes soft. A parent's scale multiplies it.
  const shown = facing ? v : typeof back === 'string' ? null : back;
  const upscale = shown ? (scaleFor(shown.shot, shown.cam.zoom) * framedStretch(f, box, lens, vanish, lifted)) / shown.shot.scale : 0;
  const side = facing ? f : backOf(f);
  const lit = faceLight(side, box, props, ss);
  const len = sheenLineLength(box.w, box.h);
  const sheenCentre = ((lit.sheen + len / 2) / len) * 100;
  const tagged = !echo && motion !== false;
  const layer: CSSProperties = { position: 'absolute', inset: 0 };
  const face: CSSProperties = { ...layer, borderRadius: radius * ss, overflow: 'hidden', backfaceVisibility: 'hidden' };
  const overlays = (sheenCss: string | null): ReactNode => (
    <>
      {lit.shade > 0.002 && <div style={{ ...layer, background: `rgba(0, 0, 0, ${lit.shade})` }} />}
      {sheenCss && <div style={{ ...layer, background: sheenCss }} />}
      <div style={{ ...layer, borderRadius: radius * ss, boxShadow: lit.rim }} />
    </>
  );
  const sheenCss = sheen > 0 ? sheenGradient(sheenCentre, sheenWidth * 100, sheen) : null;
  return (
    <div style={{
      ...layer, perspective: lens, perspectiveOrigin: `${vanish.x}px ${vanish.y}px`, opacity, filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
      mixBlendMode: echo ? 'plus-lighter' : undefined, pointerEvents: 'none',
    }}>
      <div
        {...(tagged && pieceMotionAttrs(motion, 'plane', { kind: 'capture-plane', values: { ...pose, lift: up, sheen: sheenCentre / 100, upscale } }))}
        style={{
          position: 'absolute', left: box.x + (box.w * (1 - ss)) / 2, top: box.y + (box.h * (1 - ss)) / 2, width: box.w * ss, height: box.h * ss,
          transformStyle: 'preserve-3d',
          transform: `translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) scale3d(${1 / ss}, ${1 / ss}, ${1 / ss})`,
        }}>
        {facing ? (
          <div {...(tagged && cameraMotionAttrs(v))} style={{ ...face, background: paper }}>
            <CaptureCrop view={v} ss={ss} blur={plate && lift?.focus ? lift.focus * clamp(up) * ss : 0} />
            {plate && lift && <UnderLift plate={plate} box={box} f={f} light={lightDirection(props.light)} z={plateZ} scale={plateScale} up={up} lift={lift} socket={lift.socket ?? paper} ss={ss} />}
            {overlays(sheenCss)}
          </div>
        ) : (
          <div {...(tagged && typeof back !== 'string' && cameraMotionAttrs({ ...back, box }, 'back'))} style={{ ...face, background: typeof back === 'string' ? back : paper, transform: 'rotateY(180deg)' }}>
            {typeof back !== 'string' && <CaptureCrop view={{ ...back, box }} ss={ss} />}
            {overlays(sheenCss)}
          </div>
        )}
        {facing && plate && lift && (
          <div style={{
            position: 'absolute', left: (plate.x - box.x) * ss, top: (plate.y - box.y) * ss, width: plate.w * ss, height: plate.h * ss,
            borderRadius: (lift.radius ?? 10) * ss, overflow: 'hidden', backfaceVisibility: 'hidden', background: paper,
            transform: `translateZ(${plateZ * ss}px) scale(${plateScale})`,
          }}>
            <div style={{ position: 'absolute', left: -(plate.x - box.x) * ss, top: -(plate.y - box.y) * ss, width: box.w * ss, height: box.h * ss }}>
              <CaptureCrop view={v} ss={ss} />
            </div>
            {sheen > 0 && <div style={{ ...layer, background: plateSheen(lit.sheen, box, plate, sheenWidth * len, sheen * 1.3) }} />}
            <div style={{ ...layer, borderRadius: (lift.radius ?? 10) * ss, boxShadow: lit.rim }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The view's crop laid out at `ss` times its on-screen size, as Capture lays it out at 1. */
function CaptureCrop({ view: { shot, cam, box }, ss, blur = 0 }: { view: View; ss: number; blur?: number }) {
  const k = scaleFor(shot, cam.zoom) * ss;
  return (
    <Img src={shot.src} style={{
      position: 'absolute', left: (box.w * ss) / 2 - cam.cx * k, top: (box.h * ss) / 2 - cam.cy * k, width: shot.w * k, height: shot.h * k, maxWidth: 'none',
      filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
    }} />
  );
}

/** The card's sheen band continued across the lifted plate, in the plate's own gradient line. */
function plateSheen(offset: number, box: Rect, plate: Rect, widthPx: number, peak: number) {
  const len = sheenLineLength(plate.w, plate.h);
  const shift = (plate.x + plate.w / 2 - (box.x + box.w / 2)) * SHEEN_DIR[0] + (plate.y + plate.h / 2 - (box.y + box.h / 2)) * SHEEN_DIR[1];
  return sheenGradient(((offset - shift + len / 2) / len) * 100, (widthPx / len) * 100, peak);
}

/**
 * What the lift leaves on the page under it: the empty socket it rose from (its panel's colour, as the DOM would show
 * with the element gone, so parallax never uncovers a second copy), its shadow cast along the key light and softer
 * the higher it rises, and the rest of the page dimmed.
 */
function UnderLift({ plate, box, f, light, z, scale, up, lift, socket, ss }: {
  plate: Rect; box: Rect; f: PlaneFrame; light: Vec3; z: number; scale: number; up: number; lift: PlaneLift; socket: string; ss: number;
}) {
  const [lx, ly, lz] = [dotVec3(light, f.ex), dotVec3(light, f.ey), dotVec3(light, f.n)];
  // A light grazing the face would throw the shadow off the card: hold it to a steep angle and fade it instead.
  const steep = Math.max(lz, 0.25);
  const [dx, dy] = [(-z * lx) / steep, (-z * ly) / steep];
  const [x, y] = [plate.x - box.x, plate.y - box.y];
  const [w, h] = [plate.w * scale, plate.h * scale];
  const radius = (lift.radius ?? 10) * ss;
  const k = clamp(up);
  const dim = lift.dim ?? 0.12;
  return (
    <>
      <div style={{ position: 'absolute', left: x * ss, top: y * ss, width: plate.w * ss, height: plate.h * ss, borderRadius: radius, background: socket, opacity: clamp(up * 4) }} />
      {dim > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(0, 0, 0, ${dim * k})` }} />}
      <div style={{
        position: 'absolute', left: (x + plate.w / 2 + dx - w / 2) * ss, top: (y + plate.h / 2 + dy - h / 2) * ss, width: w * ss, height: h * ss, borderRadius: radius,
        background: `rgba(0, 0, 0, ${0.45 * k * clamp(lz / 0.35)})`, filter: `blur(${(2 + 0.3 * z) * ss}px)`,
      }} />
    </>
  );
}

/**
 * The card's shadow on the surface behind it: its silhouette pushed `elevation` px back and along the key light, so it
 * parallaxes, shrinks with depth and follows each turn. HyperFrames' two layers: a tight one under the card, a wide
 * soft one. Each blurs on its lens root: a penumbra lies on the surface, not in the tilted card.
 */
function PlaneShadow({ box, pose, lens, vanish, radius, light, elevation, color, blur, alpha }: {
  box: Rect; pose: PlanePose; lens: number; vanish: Point; radius: number; light: Vec3; elevation: number; color: string; blur: number; alpha: number;
}) {
  const layers = [
    { reach: 0.3, soft: 0.35, strength: 0.55 },
    { reach: 1, soft: 0.55, strength: 0.75 / (1 + elevation / 120) },
  ];
  const [sx, sy] = [-light[0] / light[2], -light[1] / light[2]];
  return (
    <>
      {layers.map(({ reach, soft, strength }, i) => {
        const e = elevation * reach;
        const z = pose.z - e;
        const sigma = (3 + soft * e) * lensScale(z, lens);
        return (
          <div key={i} style={{ position: 'absolute', inset: 0, perspective: lens, perspectiveOrigin: `${vanish.x}px ${vanish.y}px`, filter: `blur(${Math.hypot(sigma, blur)}px)`, opacity: alpha * strength, pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: radius, background: color,
              transform: `translate3d(${pose.x + sx * e}px, ${pose.y + sy * e}px, ${z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg)`,
            }} />
          </div>
        );
      })}
    </>
  );
}
