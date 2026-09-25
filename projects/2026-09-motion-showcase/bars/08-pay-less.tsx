// Bar 8, "08 — ODOMETER": the copy's payoff, BUY MORE, PAY LESS., landed in one number and then on the real page.
// Bar 7's camera whips right, so this page whips in from the right, $2.00 whole on the downbeat. The price counts
// down a tenth at a time, faster and faster, and slams onto $1.60 on the second beat with a clack and a punch-in; the
// old price is slashed on the "and" and PAY LESS. rises into the third, where "$1.60 PAY LESS." holds as the poster
// the recap replays. Just before the fourth the poster whips off and the Tilum page swings in on a tilted card,
// landing on the beat as a −20% stamp drops onto its 5–9 row, and the camera leans in on it to the cut.

import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  DISPLAY_FONT, FPS, MONO_FONT, W, clamp, lerp, motionAttrs, motionCurves, motionEchoAttrs, shutterTravel, smearSigma,
  type Point, type Rect,
} from '../../../lib/studio/api.ts';
import { Odometer } from '../../../lib/studio/kit.tsx';
import { CapturePlane, capturePlaneProjection, capturePlaneView, lerpPlanePose, type PlanePose } from '../../../lib/studio/reel/capture-plane.tsx';
import { reelHudGrounds, reelHudReadGrounds, type ReelHudGround } from '../../../lib/studio/reel/hud.tsx';
import { ARCHIVO_BASELINE_EM } from '../../../lib/studio/reel/ticker-layout.ts';
import { RiseWord } from '../../../lib/studio/reel/type.tsx';
import type { Bar } from '../bar.ts';
import { captures as C } from '../captures/index.ts';
import { SHOWCASE_HUD } from '../reel.tsx';
import priceClack from '../sfx/clack-461.ts';
import stampSlam from '../sfx/stamp-491.ts';
import { P, barFrame, hitFrame } from '../timeline.ts';

const FROM = barFrame(8), TO = barFrame(9);
/** The bar's four hits and the "and" the old price is slashed on. */
const HIT = { cut: hitFrame(28), land: hitFrame(29), slash: hitFrame(29.5), words: hitFrame(30), stamp: hitFrame(31) } as const;
const CENTRE: Point = { x: 960, y: 540 };

// ---------- the type's camera ----------

// The lockup at scale 1: the price's digits 426 px tall (0.71 of its size) and 1206 px wide, centred on x 960; the
// label and the old price over its ends; PAY LESS. under it, as wide. Pushed to PUSH.hold by the poster's last frame,
// it all sits clear of the HUD's rows.
const PRICE = { x: 357, y: 649, size: 600, stretch: 68 };
const LABEL = { x: 369, y: 157, size: 26 };
const WAS = { right: 1563, y: 187, size: 72 };
const WORDS = { x: 357, y: 918, cap: 200, stretch: 77 };

// Bar 7 whips its camera to the right, so the page comes in from the right. Its out-expo settle (2^(−10k) of the way
// still to go) starts WHIP.lead frames before the cut, so the cut lands it 234 px short, still streaking at 180 px a
// frame with $2.00 whole, and it's still by the roll.
const WHIP = { lead: 3, frames: 9, px: 2350 };
const whipAt = (f: number) => WHIP.px * 2 ** ((-10 * (f - (HIT.cut - WHIP.lead))) / WHIP.frames);
// The poster held, the camera whips it off to the left over the fourth beat's run-up, faster and faster (cubic), as
// the card comes in from the right: gone on the frame the card and stamp land.
const EXIT = { from: HIT.stamp - 3, px: 2200 };
const exitAt = (f: number) => -EXIT.px * clamp((f - EXIT.from) / (HIT.stamp - EXIT.from)) ** 3;
const typeWhipAt = (f: number) => whipAt(f) + exitAt(f);
// Its smear: the travel under a half-frame shutter (180° at 30 fps) centred on the frame.
const whipSmearAt = (f: number) => smearSigma(shutterTravel(typeWhipAt, f, 0.5));

// The price rolls just right of centre, the camera pushing in faster and faster into the lock. From the lock it
// pushes on 0.3% a frame, so the punched lock stands 6% over where it settles; from the third beat the poster holds
// on 0.16% a frame, readable but never still.
const PUSH = { cut: 0.92, land: 1, words: 1.046, hold: 1.066 };
const POSTER_END = EXIT.from;
// From the lock the camera drifts up and left at a steady 13 px a frame, opening the room PAY LESS. rises into; on the
// third beat the drift glides out (by e every DRIFT.tau frames) so the poster settles without a stop.
const DRIFT = { from: { x: 70, y: 104 }, to: { x: -100, y: 8 }, tau: 2.5 };

function pushAt(f: number) {
  if (f <= HIT.land) return PUSH.cut * (PUSH.land / PUSH.cut) ** (((f - HIT.cut) / (HIT.land - HIT.cut)) ** 2);
  if (f <= HIT.words) return PUSH.land * (PUSH.words / PUSH.land) ** ((f - HIT.land) / (HIT.words - HIT.land));
  return PUSH.words * (PUSH.hold / PUSH.words) ** ((f - HIT.words) / (POSTER_END - HIT.words));
}

/** DRIFT's move at `f`: still before the lock, steady to the third beat, gliding out after it. */
function driftAt(f: number): Point {
  const k = Math.max(0, (f - HIT.land) / (HIT.words - HIT.land));
  if (k <= 1) return { x: lerp(DRIFT.from.x, DRIFT.to.x, k), y: lerp(DRIFT.from.y, DRIFT.to.y, k) };
  const glide = DRIFT.tau * (1 - Math.exp(-(f - HIT.words) / DRIFT.tau)) / (HIT.words - HIT.land);
  return { x: DRIFT.to.x + (DRIFT.to.x - DRIFT.from.x) * glide, y: DRIFT.to.y + (DRIFT.to.y - DRIFT.from.y) * glide };
}

// The lock punches the camera in 8% about the price, falling back by e every 1.6 frames, gone after 6; the slash
// knocks it 2.5% about the old price.
const PUNCHES = [
  { at: HIT.land, size: 0.08, tau: 1.6, frames: 6, into: { x: 960, y: 436 } },
  { at: HIT.slash, size: 0.025, tau: 1.6, frames: 5, into: { x: 1468, y: 162 } },
];

/** The type's transform, screen = scale × lockup + (x, y): pushed about the frame's centre, drifted, whipped, punched. */
function typeCameraAt(f: number) {
  const s = pushAt(f), d = driftAt(f);
  const x = CENTRE.x * (1 - s) + d.x + typeWhipAt(f), y = CENTRE.y * (1 - s) + d.y;
  const hit = PUNCHES.find(({ at, frames }) => f >= at && f < at + frames);
  if (!hit) return { x, y, scale: s };
  // The punch holds what it's into where the camera has it, and scales about it.
  const k = 1 + hit.size * Math.exp(-(f - hit.at) / hit.tau);
  const fx = s * hit.into.x + x, fy = s * hit.into.y + y;
  return { x: fx + k * (x - fx), y: fy + k * (y - fy), scale: k * s };
}

/** The exit whip has carried the type off the frame by the stamp's beat. */
const TYPE_GONE = HIT.stamp;

// ---------- the price ----------

// $2.00 → $1.60 a tenth at a time, the cents' 0 painted on. The Odometer draws a wheel midway along its last frame's
// turn, so the tenths wheel turns half a row a frame (ROLL_ROWS, a frame each): each digit sits a quarter row off
// whole at most, lightly smeared, and $1.90 and $1.80 hold. It rests before the lock, so the lock's frame is sharp.
const ROLL = { from: HIT.land - 11, blur: 0.3 };
const ROLL_ROWS = [0, 0.5, 1, 1, 1.5, 2, 2, 2.5, 3, 3.5, 4];
function rollAt(t: number) {
  const k = clamp(t * FPS - ROLL.from, 0, ROLL_ROWS.length - 1), i = Math.min(Math.floor(k), ROLL_ROWS.length - 2);
  return lerp(ROLL_ROWS[i], ROLL_ROWS[i + 1], k - i) / ROLL_ROWS[ROLL_ROWS.length - 1];
}
const priceAt = (t: number) => lerp(2, 1.6, rollAt(t));

/** The mono label over the price. Its quantity rolls up 1 → 5 on the price's own roll: buy more, pay less. */
function QtyLabel({ f }: { f: number }) {
  const qty = lerp(1, 5, rollAt(f / FPS));
  const { x, y, size } = LABEL;
  return (
    <div style={{ position: 'absolute', left: x, top: y - 0.86 * size, display: 'flex', font: `600 ${size}px/1 ${MONO_FONT}`, letterSpacing: '0.12em', color: P.cream, whiteSpace: 'pre' }}>
      <span>PRICE PER PIECE · QTY </span>
      <span style={{ position: 'relative', display: 'inline-block', width: '0.6em', height: '1em', overflow: 'hidden' }}>
        <span {...motionAttrs({ name: 'qty', values: { qty } })} style={{ position: 'absolute', left: 0, top: 0, transform: `translateY(${-(qty - 1)}em)` }}>
          {[1, 2, 3, 4, 5].map((q) => <span key={q} style={{ display: 'block', height: '1em' }}>{q}</span>)}
        </span>
      </span>
    </div>
  );
}

// The old price rises into its row a frame after the roll starts, a letter every 25 ms. It stands unstruck over the
// new price's landing and is slashed on the "and" after it: the rule arrives on the "and", starting a frame early, and
// knocks the old price down SLASH.knock px, settling by e every SLASH.tau frames.
const WAS_START = ROLL.from + 1;
const WAS_RISE = 0.3, WAS_EACH = 0.025;
const SLASH = { start: HIT.slash - 1, time: 0.12, knock: 12, tau: 2 };

/** The old price, slashed: "$2.00", small, rising out of a line at its baseline, with an ink rule drawn across it. */
function WasPrice({ f }: { f: number }) {
  const t = (f - WAS_START) / FPS;
  if (t <= 0) return null;
  const { right, y, size } = WAS;
  // The line box's top, which puts the baseline on `y`; the mask's edge, 0.92 em down it, is just under the $'s tail.
  const top = y - ARCHIVO_BASELINE_EM * size;
  const slash = motionCurves.expo.entrance((f - SLASH.start) / FPS / SLASH.time);
  const knock = f >= HIT.slash ? SLASH.knock * Math.exp(-(f - HIT.slash) / SLASH.tau) : 0;
  return (
    <div style={{ position: 'absolute', right: W - right, top: top + knock, height: 0.92 * size, overflow: 'hidden', font: `800 ${size}px/1 ${DISPLAY_FONT}`, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: P.cream, whiteSpace: 'pre' }}>
      <div {...motionAttrs({ name: 'was', values: { slash, knock } })} style={{ position: 'relative', height: size }}>
        {[...'$2.00'].map((c, i) => {
          const k = motionCurves.expo.entrance((t - i * WAS_EACH) / WAS_RISE);
          return <span key={i} style={{ display: 'inline-block', transform: `translateY(${(1 - k) * 0.95 * size}px)` }}>{c}</span>;
        })}
        {slash > 0 && (
          <div style={{ position: 'absolute', left: '-4%', width: '108%', top: ARCHIVO_BASELINE_EM * size - 0.4 * size, height: 0.1 * size, background: P.ink, transform: `rotate(-5deg) scaleX(${slash})`, transformOrigin: '0 50%' }} />
        )}
      </div>
    </div>
  );
}

// PAY LESS. rises from three frames before the third beat, far quicker than RiseWord's default: every letter is 90%
// up on the beat and the last is whole three frames after it (7 × 7 ms + 150 ms), before the card swings over it.
const WORDS_RISE = { from: HIT.words - 3, duration: 0.15, each: 0.007 };

/** The lockup: smeared along x while the whip carries it, then pushed, drifted, punched and pulled back. */
function TypeLayer({ f }: { f: number }) {
  const id = useId().replace(/[^\w-]/g, '');
  if (f >= TYPE_GONE) return null;
  const cam = typeCameraAt(f);
  const sigma = whipSmearAt(f);
  const filter = sigma >= 0.3 ? `url(#${id}-whip)` : undefined;
  return (
    <>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={`${id}-whip`} x="-30%" y="-5%" width="160%" height="110%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${sigma} 0`} />
        </filter>
      </svg>
      <div style={{ position: 'absolute', inset: 0, filter }}>
        <div {...motionAttrs({ name: 'page', values: { scale: cam.scale } })}
          style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})` }}>
          <QtyLabel f={f} />
          <WasPrice f={f} />
          <Odometer t={f / FPS} value={priceAt} x={PRICE.x} y={PRICE.y} size={PRICE.size} color={P.cream} weight={900} stretch={PRICE.stretch}
            decimals={1} prefix="$" suffix="0" mode="mechanical" blur={ROLL.blur} fade={0.03} motion="price" />
          <RiseWord t={(f - WORDS_RISE.from) / FPS} text="PAY LESS." x={WORDS.x} y={WORDS.y} cap={WORDS.cap} align="left" color={P.ink}
            stretch={WORDS.stretch} duration={WORDS_RISE.duration} each={WORDS_RISE.each} motion="pay-less" />
        </div>
      </div>
    </>
  );
}

// ---------- the card ----------

// tilum-5 at 6×: its near edge takes about 2.6 frame px a page px by the cut, as the camera leans in, so the page's
// small type stays sharp.
const SHOT = C['tilum-5-close'];
// Page px: the jewel's column and the buy box, from under the price line (its "19% Off" badge would argue with the
// stamp) down to the tier table, short of the shipping notes.
const CROP: Rect = { x: 60, y: 444, w: 1340, h: 782 };
/** Layout px a page px: the rest pose's tilt makes that 0.8 at the jewel and 2.4 at the tier table. */
const CARD_ZOOM = 1.6377;
const LENS = 800;
const CARD_VIEW = capturePlaneView(SHOT, CROP, { fit: { w: CROP.w * CARD_ZOOM, h: CROP.h * CARD_ZOOM }, centre: { x: 412.5, y: 348 } });

// Tipped well back, the page lies on the red like a sheet on a table: the jewel far off in the upper left, the tier
// table near and big along the bottom, its rows level. It runs off the frame's top and left edges, clear of the
// corners; the HUD's top row sits on plates where it touches.
const CARD_REST: PlanePose = { x: 0, y: 0, z: -330, rx: 29.7, ry: -11.4, rz: 0.2 };
// It comes in with the exit whip from past the frame's right edge, a little tipped up and turned, faster and faster,
// and stops dead on the stamp's beat, the stamp landing on it on the same frame.
const CARD_FAR: PlanePose = { x: 2900, y: 80, z: 0, rx: 36, ry: -24, rz: -5 };
const SWOOP = { from: EXIT.from, land: HIT.stamp };
// Held, it comes on toward the lens by SETTLE through the bar's end, turning a hair toward the light.
const SETTLE: PlanePose = { x: 0, y: 0, z: 20, rx: -1, ry: 1.2, rz: 0 };

// The stamp's impact shakes the card: 6 px on the hit, 3 back, halving a frame, gone after four. Down and to the
// left, the way the stamp comes down.
const SHAKE_PX = [6, -3, 1.5, -0.75];
function stampShakeAt(f: number) {
  const a = SHAKE_PX[Math.round(f) - HIT.stamp] ?? 0;
  return { x: -0.45 * a, y: 0.89 * a };
}

/** A quadratic ease-in, signed below 0: the card was further out a frame before it enters, so its trail smears it in. */
const swoopIn = (k: number) => (k >= 1 ? 1 : k * Math.abs(k));

/** The card's pose at video frame `f` (fractional within a shutter): whipped in, then drifting, shaken by the stamp. */
function cardPoseAt(f: number): PlanePose {
  const at = lerpPlanePose(CARD_FAR, CARD_REST, swoopIn((f - SWOOP.from) / (SWOOP.land - SWOOP.from)));
  const held = clamp((f - SWOOP.land) / (TO - SWOOP.land)), shake = stampShakeAt(f);
  return {
    x: at.x + SETTLE.x * held + shake.x, y: at.y + SETTLE.y * held + shake.y, z: at.z + SETTLE.z * held,
    rx: at.rx + SETTLE.rx * held, ry: at.ry + SETTLE.ry * held, rz: at.rz + SETTLE.rz * held,
  };
}

const cardAt = (pose: PlanePose) => capturePlaneProjection(CARD_VIEW, pose, { lens: LENS });

// The stamp punches the camera in 4% about it, falling back by e every 1.8 frames, gone after 6.
const STAMP_PUNCH = { size: 0.04, tau: 1.8, frames: 6 };
// From the stamp to the cut the camera leans in on it by LEAN, 1.5% a frame, so the held card keeps driving to the
// cut, and rolls, carrying the jewel down and away from the HUD's top-left corner, which a push alone would run it into.
const LEAN = { push: 1.232, roll: -3 };

type CardCamera = { k: number; turn: number; at: Point };

/** The camera over the card: a scale `k` and a roll `turn` (degrees) about frame point `at`, none until the stamp lands. */
function cardCameraAt(f: number): CardCamera {
  const since = f - HIT.stamp, lean = clamp(since / (TO - HIT.stamp));
  const punch = since >= 0 && since < STAMP_PUNCH.frames ? 1 + STAMP_PUNCH.size * Math.exp(-since / STAMP_PUNCH.tau) : 1;
  return { k: punch * LEAN.push ** lean, turn: LEAN.roll * lean, at: cardAt(cardPoseAt(HIT.stamp)).pageToScreen(STAMP_AT) };
}

/** Frame point `q` where it was before the card's camera moved it: the point to ask the card's projection about. */
function beforeCardCamera({ k, turn, at }: CardCamera, q: Point): Point {
  const a = (-turn * Math.PI) / 180, dx = (q.x - at.x) / k, dy = (q.y - at.y) / k;
  return { x: at.x + dx * Math.cos(a) - dy * Math.sin(a), y: at.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

// ---------- the stamp ----------

/** Where the stamp lands, page px: on the 5–9 row between its $1.60 and its 20%, clear of both. Its radius, page px. */
const STAMP_AT: Point = { x: 1241, y: 1154 };
const STAMP_R = 62;
/** The stamp's artwork is drawn in these units a radius, then fitted to STAMP_R. */
const ART_R = 225;

// Hidden until two frames before the fourth hit, then out of the lens onto the row: FALL.height px off the card on
// its first frame, in from its upper right (page px), turning, a little soft and nearly solid, speeding up into the
// card, landing whole and sharp on the hit.
const FALL = { frames: 2, height: 260, du: 50, dv: -90, turn: 24, blur: 2, alpha: 0.9, ease: 0.8 };
// Each falling frame smears it over a third of a frame's fall: any longer and the smear thins it to a ghost.
const SMEAR = { shutter: 0.35, samples: 10 };
// After the hit the ring of text around the −20% keeps turning, SPIN degrees a second, so the stamp never sets hard.
const SPIN = 60;
const TURN = -12;

type StampPose = { lift: number; du: number; dv: number; turn: number; ringTurn: number; blur: number; alpha: number };

/** The stamp at video frame `f` (fractional within a shutter): how far it still has to fall, as `h` 1 → 0. */
function stampPoseAt(f: number): StampPose {
  const h = Math.max(0, (HIT.stamp - f) / FALL.frames), u = h ** FALL.ease;
  const turn = TURN + FALL.turn * u;
  return {
    lift: FALL.height * u, du: FALL.du * u, dv: FALL.dv * u, turn,
    ringTurn: h > 0 ? turn : TURN - (SPIN * (f - HIT.stamp)) / FPS,
    blur: FALL.blur * u, alpha: 1 - (1 - FALL.alpha) * h ** 1.2,
  };
}

/**
 * `children` laid out about page point `at`, `lift` px off the card's face, in the card's plane as CapturePlane poses
 * it: the same lens root, box and transform, laid out `ss` times larger and shrunk back so the lens doesn't upsample
 * them. CapturePlane can't host children on its face, so the bar mirrors its transform, as bar 3 does.
 */
function OnCard({ pose, at, lift = 0, style, children }: { pose: PlanePose; at: Point; lift?: number; style?: CSSProperties; children: (unit: number) => ReactNode }) {
  const { box } = CARD_VIEW;
  const depth = cardAt(pose).pageInLens(at, lift)[2];
  const ss = clamp((1.25 * LENS) / Math.max(LENS - depth, 1), 1, 2.5);
  const unit = CARD_ZOOM * ss;
  return (
    <div style={{ position: 'absolute', inset: 0, perspective: LENS, perspectiveOrigin: `${CENTRE.x}px ${CENTRE.y}px`, pointerEvents: 'none', ...style }}>
      <div style={{
        position: 'absolute', left: box.x + (box.w * (1 - ss)) / 2, top: box.y + (box.h * (1 - ss)) / 2, width: box.w * ss, height: box.h * ss,
        transform: `translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) translateZ(${lift}px) scale3d(${1 / ss}, ${1 / ss}, ${1 / ss})`,
      }}>
        <div style={{ position: 'absolute', left: (at.x - CROP.x) * unit, top: (at.y - CROP.y) * unit }}>{children(unit)}</div>
      </div>
    </div>
  );
}

/** The −20% stamp, `size` px across, centred on its parent's origin. */
function DiscountStamp({ pose, size }: { pose: StampPose; size: number }) {
  const id = useId().replace(/[^\w-]/g, '');
  const r = ART_R, ring = r - 42;
  return (
    <svg width={size} height={size} viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`} style={{ position: 'absolute', left: -size / 2, top: -size / 2, overflow: 'visible' }}>
      <defs>
        <path id={`${id}-ring`} d={`M 0 ${-ring} A ${ring} ${ring} 0 1 1 0 ${ring} A ${ring} ${ring} 0 1 1 0 ${-ring}`} />
      </defs>
      <circle r={r} fill={P.ink} />
      <circle r={r - 13} fill="none" stroke={P.cream} strokeWidth={3} />
      <text transform={`rotate(${pose.ringTurn})`} style={{ font: `600 20px ${MONO_FONT}` }} fill={P.cream} letterSpacing="0.1em">
        <textPath href={`#${id}-ring`} textLength={2 * Math.PI * ring - 8} lengthAdjust="spacing">
          {'BUY MORE · PAY LESS · BUY MORE · PAY LESS · BUY MORE · PAY LESS · '}
        </textPath>
      </text>
      <text y={37} transform={`rotate(${pose.turn})`} textAnchor="middle" fill={P.cream} style={{ font: `900 108px ${DISPLAY_FONT}`, fontStretch: '76%', letterSpacing: '-0.01em' }}>
        −<tspan dx={9}>20%</tspan>
      </text>
    </svg>
  );
}

/** One exposure of the stamp over the card: blurred and faint while it's high. */
function StampExposure({ f, pose, opacity, echo = false }: { f: number; pose: StampPose; opacity: number; echo?: boolean }) {
  return (
    <OnCard pose={cardPoseAt(f)} at={{ x: STAMP_AT.x + pose.du, y: STAMP_AT.y + pose.dv }} lift={pose.lift} style={{
      opacity, filter: pose.blur > 0.3 ? `blur(${pose.blur}px)` : undefined, mixBlendMode: echo ? 'plus-lighter' : undefined,
    }}>
      {(unit) => (
        <div {...(echo ? motionEchoAttrs : motionAttrs({ name: 'stamp', values: { lift: pose.lift, alpha: pose.alpha } }))} style={{ position: 'absolute' }}>
          <DiscountStamp pose={pose} size={2 * STAMP_R * unit} />
        </div>
      )}
    </OnCard>
  );
}

/** Its shadow on the card, under where it will land: soft and faint while it's high, closing in and darkening as it lands. */
function StampShadow({ f }: { f: number }) {
  const u = Math.min(1, Math.max(0, (HIT.stamp - f) / FALL.frames) ** FALL.ease);
  return (
    <OnCard pose={cardPoseAt(f)} at={{ x: STAMP_AT.x + lerp(4, 24, u), y: STAMP_AT.y + lerp(5, 30, u) }} style={{ opacity: lerp(0.35, 0.12, u), filter: `blur(${lerp(4, 16, u)}px)` }}>
      {(unit) => {
        const d = 2 * STAMP_R * unit * lerp(1, 1.12, u);
        return <div style={{ position: 'absolute', left: -d / 2, top: -d / 2, width: d, height: d, borderRadius: '50%', background: P.ink }} />;
      }}
    </OnCard>
  );
}

// The landing rings the page, as the reference's full stop does: an ink ring leaves just outside the stamp's rim on
// out-expo, reaching RING.reach of its radius further over RING.frames, thinning and fading as it goes.
const RING = { frames: 6, from: 1.06, reach: 0.55, stroke: 5, alpha: 0.6 };

function LandingRing({ f }: { f: number }) {
  const k = (f - HIT.stamp) / RING.frames;
  if (k < 0 || k >= 1) return null;
  const radius = STAMP_R * (RING.from + RING.reach * motionCurves.expo.entrance(k)), stroke = RING.stroke * (1 - k);
  return (
    <OnCard pose={cardPoseAt(f)} at={STAMP_AT} style={{ opacity: RING.alpha * (1 - k) ** 2 }}>
      {(unit) => {
        const d = 2 * (radius + stroke / 2) * unit;
        return <div {...motionAttrs({ name: 'stamp ring', values: { radius } })} style={{ position: 'absolute', left: -d / 2, top: -d / 2, width: d, height: d, borderRadius: '50%', border: `${stroke * unit}px solid ${P.ink}`, boxSizing: 'border-box' }} />;
      }}
    </OnCard>
  );
}

/**
 * The stamp over the card. Falling, its exposures across the shutter are summed with plus-lighter, each a share of
 * the whole and of its own alpha, which averages them over the card exactly; landed, it's drawn once, sharp.
 */
function Stamp({ f }: { f: number }) {
  if (f < HIT.stamp - FALL.frames) return null;
  if (f >= HIT.stamp) {
    return (
      <>
        <StampShadow f={f} />
        <LandingRing f={f} />
        <StampExposure f={f} pose={stampPoseAt(f)} opacity={1} />
      </>
    );
  }
  const { shutter, samples } = SMEAR;
  return (
    <>
      <StampShadow f={f} />
      <div style={{ position: 'absolute', inset: 0, isolation: 'isolate' }}>
        {Array.from({ length: samples }, (_, i) => {
          const at = f - shutter / 2 + (shutter * (i + 0.5)) / samples, pose = stampPoseAt(at);
          return <StampExposure key={i} f={at} pose={pose} opacity={pose.alpha / samples} echo={i < samples - 1} />;
        })}
      </div>
    </>
  );
}

/** The card and its stamp, under the camera's punch on the stamp. */
function CardLayer({ f }: { f: number }) {
  if (f <= SWOOP.from) return null;
  const cam = cardCameraAt(f);
  return (
    <div {...motionAttrs({ name: 'card camera', values: { k: cam.k, turn: cam.turn } })}
      style={{ position: 'absolute', inset: 0, transformOrigin: `${cam.at.x}px ${cam.at.y}px`, transform: `rotate(${cam.turn}deg) scale(${cam.k})` }}>
      {/* A half-frame shutter smears the swing; the frame it lands on is sharp. */}
      <CapturePlane t={f / FPS} view={CARD_VIEW} pose={(t) => cardPoseAt(t * FPS)} lens={LENS} light={{ x: -30, y: 38 }} elevation={70}
        shadow="rgba(40, 6, 0, 0.5)" sheen={0.12} rim={0.12} shade={0.08} drift={0} shutter={f === SWOOP.land ? 0 : 0.5} motion="tilum card" />
      <Stamp f={f} />
    </div>
  );
}

// ---------- the HUD ----------

type PayLessGround = 'card' | 'red';
// On the red a part takes paper inks, on the card ink ones: neither reads on the other (ink stands only ΔL 33 off the
// red). A part the card touches at all sits on a plate of whichever ground holds most of it, in that ground's inks,
// the plate hiding the page's type or the card's corner under it.
const PAY_LESS_GROUNDS: Record<PayLessGround, ReelHudGround> = { card: { color: '#ffffff', busy: true }, red: { color: P.red } };

/** What's under each frame point on frame `f`: the card, through the card's camera, or the red. */
function payLessGroundsAt(f: number): (p: Point) => PayLessGround {
  const card = f > SWOOP.from ? cardAt(cardPoseAt(f)) : null, cam = cardCameraAt(f);
  return (p) => (card?.covers(beforeCardCamera(cam, p)) ? 'card' : 'red');
}

export const payLessBar: Bar = {
  id: 'pay-less',
  note: 'The price whips in on red and counts down from $2.00, slamming onto $1.60 on the next beat with a punch-in; the old price is slashed on the "and" and PAY LESS. rises and holds as the poster; the camera whips it off as the real Tilum page whips in on a tilted card, landing on the last beat with a −20% stamp dropped out of the lens onto its 5–9 row, the camera leaning in on it to the cut.',
  from: FROM, to: TO,
  render: (f) => (
    <>
      <div style={{ position: 'absolute', inset: 0, background: P.red }} />
      <TypeLayer f={f} />
      <CardLayer f={f} />
    </>
  ),
  hudRead: (_slot, f, box) => reelHudReadGrounds(reelHudGrounds(box, payLessGroundsAt(f)), PAY_LESS_GROUNDS, { mixed: 0, palette: SHOWCASE_HUD.palette }),
  // The price's landing and the stamp's slam kick the lens, as the cut does.
  kicks: [HIT.land, HIT.stamp],
  // The track leaves the price's beat empty, so its clack carries it alone, raised to sit just under the music; the
  // stamp's contact slams over the music's hit.
  sounds: [{ at: HIT.land, sound: priceClack, volume: 1.74 }, { at: HIT.stamp, sound: stampSlam }],
};
