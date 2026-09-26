// capture-plane.tsx: a capture as a card in space, the way a reel shows product UI: a crop of a page (a View) on a
// rounded card posed in 3D, lit by one key light (shadow, rim, a sheen that slides as it turns, shade as it turns
// away), with one control able to lift out of the page toward the viewer.
//
// CSS 3D, not three.js, so the browser resamples the hi-DPI capture from its pixels. Each card is its own 3D context,
// so cards stack in drawing order (far first) and never cut into each other. Flatteners (filter, opacity, overflow,
// blend modes) go on the lens root or leaves, never between the card and its children, or the lift sinks into the page.

import type { CSSProperties, ReactNode } from 'react';
import { Img } from 'remotion';
import { inflate, rectToScreen, scaleFor, type Point, type Rect, type View } from '#models/camera/camera.ts';
import { FPS, H, W } from '#models/frame/frame.ts';
import { clamp } from '#models/motion/motion.ts';
import { cameraMotionAttrs, motionEchoAttrs, pieceMotionAttrs } from '../probe/motion-tag.ts';
import { dotVec3, type Vec3 } from '#models/camera/vec3.ts';
import {
  along, backOf, cornersOf, eyeOf, faceLight, framedStretch, lensScale, liftHeight, lightDirection, planeFrame, planeTrail, plateSheen, pointOn,
  sheenGradient, sheenLineLength, withDrift, PLANE_REST_POSE, type LiftedPlate, type PlaneFrame, type PlaneLift, type PlanePose,
} from '#models/reel/capture-plane.ts';

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
