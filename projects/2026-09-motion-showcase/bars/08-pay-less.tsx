// Bar 8, "08 — ODOMETER": the copy's payoff, BUY MORE, PAY LESS., landed in one number and held as a poster.
// Bar 7's camera whips right, so this page whips in from the right, $2.00 whole on the downbeat. Each part gets its
// own beat: the price counts down and slams onto $1.60 on the third with a clack and a punch-in, the old price is
// slashed on the fourth, and PAY LESS. rises into the music's next downbeat. Two beats on, a −20% stamp falls out of
// the lens onto the poster beside the price; the camera pushes in and pans toward it over the finale's downbeat, to
// the cut on its "and".

import { useId } from 'react';
import {
  DISPLAY_FONT, FPS, MONO_FONT, W, clamp, lerp, motionAttrs, motionCurves, motionEchoAttrs, shutterTravel, smearSigma,
  type Point, type Rect,
} from '#studio';
import { Odometer } from '#studio/kit/kit.tsx';
import { reelHudGrounds, reelHudReadGrounds, type ReelHudGround } from '#models/reel/hud.ts';
import { ARCHIVO_BASELINE_EM } from '#models/reel/ticker-layout.ts';
import { RiseWord } from '#studio/reel/type.tsx';
import type { Bar, ShowcaseClock } from '../bar.ts';
import {
  PAY_LESS_CENTRE as CENTRE, PAY_LESS_LABEL as LABEL, PAY_LESS_PRICE as PRICE, PAY_LESS_STAMP_AT as STAMP_AT, PAY_LESS_TYPE_BOXES,
  PAY_LESS_WAS as WAS, PAY_LESS_WORDS as WORDS, onPoster, payLessPoster,
} from './08-pay-less-model.ts';
import { SHOWCASE_HUD } from '../hud.ts';
import priceLock from '../sfx/price-lock.ts';
import stampSlam from '../sfx/stamp-slam.ts';
import { P } from '../look.ts';

export function payLessBar(clock: ShowcaseClock<'pay-less'>): Bar {
  const FROM = clock.from, TO = clock.to;
  // The poster's lockup and camera are the bar's model (08-pay-less-model.ts), which `studio look --graph=models` reads.
  const { hit: HIT, whipAt, posterCameraAt } = payLessPoster(clock);
  // The whip's smear: the travel under a half-frame shutter (180° at 30 fps) centred on the frame.
  const whipSmearAt = (f: number) => smearSigma(shutterTravel(whipAt, f, 0.5));

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
  // new price's landing and is slashed on the beat after it: the rule arrives on the beat, starting a frame early, and
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

  // PAY LESS. rises from three frames before the music's downbeat, far quicker than RiseWord's default: every letter is
  // 90% up on the beat and the last is whole three frames after it (7 × 7 ms + 150 ms).
  const WORDS_RISE = { from: HIT.words - 3, duration: 0.15, each: 0.007 };

  /** The lockup: smeared along x while the whip carries it, then framed, punched and shaken. */
  function TypeLayer({ f }: { f: number }) {
    const id = useId().replace(/[^\w-]/g, '');
    const cam = posterCameraAt(f);
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

  // ---------- the stamp ----------

  /** The stamp's radius, lockup px: its disc a little taller than the price's digits. */
  const STAMP_R = 250;
  /** The stamp's artwork is drawn in these units a radius, then fitted to STAMP_R. */
  const ART_R = 225;
  /** How far the lens stands off the poster, px: a stamp `lift` px off it looks LENS / (LENS − lift) as large. */
  const LENS = 800;

  // Hidden until two frames before its beat, then out of the lens: FALL.height px off the poster at first, big,
  // soft and turning, landing whole and sharp on the hit. The lens throws a point off the frame's centre further out,
  // so du and dv (lockup px) pull the fall up and in, under the HUD's top row.
  const FALL = { frames: 2, height: 260, du: -100, dv: -212, turn: 24, blur: 6, alpha: 0.9, ease: 0.8 };
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

  /** The stamp's centre in the frame at `f`, and its radius there, as the lens sees it `lift` px off the poster. */
  function stampOnScreen(f: number, pose: StampPose) {
    const cam = posterCameraAt(f), at = onPoster(cam, { x: STAMP_AT.x + pose.du, y: STAMP_AT.y + pose.dv });
    const k = LENS / (LENS - pose.lift);
    return { x: CENTRE.x + (at.x - CENTRE.x) * k, y: CENTRE.y + (at.y - CENTRE.y) * k, r: STAMP_R * cam.scale * k };
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

  /** One exposure of the stamp over the poster: blurred and faint while it's high. */
  function StampExposure({ f, pose, opacity, echo = false }: { f: number; pose: StampPose; opacity: number; echo?: boolean }) {
    const { x, y, r } = stampOnScreen(f, pose);
    return (
      <div {...(echo ? motionEchoAttrs : motionAttrs({ name: 'stamp', values: { lift: pose.lift, alpha: pose.alpha } }))} style={{
        position: 'absolute', left: x, top: y, opacity, filter: pose.blur > 0.3 ? `blur(${pose.blur}px)` : undefined, mixBlendMode: echo ? 'plus-lighter' : undefined,
      }}>
        <DiscountStamp pose={pose} size={2 * r} />
      </div>
    );
  }

  // Its shadow on the poster, under where it will land: soft, faint and off to the lower right while the stamp is
  // high, closing in and darkening as it lands. Offsets are lockup px, blurs frame px.
  const SHADOW = { near: { x: 10, y: 14 }, far: { x: 70, y: 90 }, blur: [10, 40], alpha: [0.35, 0.12], grow: 1.12 } as const;

  function StampShadow({ f }: { f: number }) {
    const u = Math.min(1, Math.max(0, (HIT.stamp - f) / FALL.frames) ** FALL.ease);
    const cam = posterCameraAt(f);
    const at = onPoster(cam, { x: STAMP_AT.x + lerp(SHADOW.near.x, SHADOW.far.x, u), y: STAMP_AT.y + lerp(SHADOW.near.y, SHADOW.far.y, u) });
    const d = 2 * STAMP_R * cam.scale * lerp(1, SHADOW.grow, u);
    return (
      <div style={{
        position: 'absolute', left: at.x - d / 2, top: at.y - d / 2, width: d, height: d, borderRadius: '50%', background: P.ink,
        opacity: lerp(SHADOW.alpha[0], SHADOW.alpha[1], u), filter: `blur(${lerp(SHADOW.blur[0], SHADOW.blur[1], u)}px)`,
      }} />
    );
  }

  // The landing rings the poster, as the reference's full stop does: an ink ring leaves just outside the stamp's rim on
  // out-expo, reaching RING.reach of its radius further over RING.frames, thinning and fading as it goes. The downbeat
  // inside the hold rings it again, fainter. Stroke in lockup px.
  const RING = { frames: 6, from: 1.06, reach: 0.55, stroke: 16 };
  const RINGS = [{ at: HIT.stamp, alpha: 0.6 }, { at: HIT.downbeat, alpha: 0.35 }];

  function LandingRing({ f }: { f: number }) {
    const ring = RINGS.find(({ at }) => f >= at && f < at + RING.frames);
    if (!ring) return null;
    const k = (f - ring.at) / RING.frames, cam = posterCameraAt(f), c = onPoster(cam, STAMP_AT);
    const radius = STAMP_R * (RING.from + RING.reach * motionCurves.expo.entrance(k)), stroke = RING.stroke * (1 - k);
    const d = 2 * (radius + stroke / 2) * cam.scale;
    return (
      <div {...motionAttrs({ name: 'stamp ring', values: { radius } })} style={{
        position: 'absolute', left: c.x - d / 2, top: c.y - d / 2, width: d, height: d, borderRadius: '50%',
        border: `${stroke * cam.scale}px solid ${P.ink}`, boxSizing: 'border-box', opacity: ring.alpha * (1 - k) ** 2,
      }} />
    );
  }

  /**
   * The stamp over the poster. Falling, its exposures across the shutter are summed with plus-lighter, each a share of
   * the whole and of its own alpha, which averages them over the poster exactly; landed, it's drawn once, sharp.
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

  // ---------- the HUD ----------

  type PayLessGround = 'red' | 'paper' | 'ink';
  const PAY_LESS_GROUNDS: Record<PayLessGround, ReelHudGround> = { red: { color: P.red }, paper: { color: P.cream }, ink: { color: P.ink } };

  // Where the lockup's type stands (lockup px) once shown: the label, the price, its $ past the digits, and the old
  // price in paper; PAY LESS. in ink. The bar keeps them off the HUD's rows, but the finale's grids can put a part over
  // any of them.
  const TYPE_BOXES: readonly (Rect & { ground: PayLessGround; from: number })[] = [
    { ground: 'paper', from: FROM, ...PAY_LESS_TYPE_BOXES.label },
    { ground: 'paper', from: FROM, ...PAY_LESS_TYPE_BOXES.price },
    { ground: 'paper', from: WAS_START, x: WAS.right - 195, y: 132, w: 195, h: 60 },
    { ground: 'ink', from: WORDS_RISE.from, ...PAY_LESS_TYPE_BOXES.words },
  ];

  /** What's under each frame point on frame `f`: the stamp's disc from its fall on, the lockup's type, or the red. */
  function payLessGroundsAt(f: number): (p: Point) => PayLessGround {
    const disc = f >= HIT.stamp - FALL.frames ? stampOnScreen(f, stampPoseAt(f)) : null;
    const cam = posterCameraAt(f), shown = TYPE_BOXES.filter((b) => f >= b.from);
    return (p) => {
      if (disc && Math.hypot(p.x - disc.x, p.y - disc.y) < disc.r) return 'ink';
      const x = (p.x - cam.x) / cam.scale, y = (p.y - cam.y) / cam.scale;
      return shown.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)?.ground ?? 'red';
    };
  }

  return {
    id: 'pay-less',
    note: 'The price whips in on red as $2.00 and glides on as the camera pushes in; it counts down and slams onto $1.60 two beats in with a punch-in, the old price is slashed a beat later, and PAY LESS. rises on the music\'s second downbeat as the camera swings toward the stamp; two beats on a −20% stamp drops out of the lens and slams onto the poster beside the price, and the camera pushes in and pans toward it over the finale\'s downbeat, to the cut on its "and".',
    clock,
    render: (f) => (
      <>
        <div style={{ position: 'absolute', inset: 0, background: P.red }} />
        <TypeLayer f={f} />
        <Stamp f={f} />
      </>
    ),
    hudRead: (_slot, f, box) => reelHudReadGrounds(reelHudGrounds(box, payLessGroundsAt(f)), PAY_LESS_GROUNDS, { palette: SHOWCASE_HUD.palette }),
    // The price's landing, PAY LESS.'s downbeat and the stamp's slam kick the lens, as the cut does.
    kicks: [HIT.land, HIT.words, HIT.stamp],
    sounds: [{ id: 'price-lock', at: HIT.land, sound: priceLock, volume: 1.6 }, { id: 'stamp', at: HIT.stamp, sound: stampSlam }],
  };
}
