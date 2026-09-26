// Bar 3, 03 — DEPTH / UI: every colour, one tap. The Solice's page lands on a card over black, turned so the machine
// photo stands two-thirds of the frame's height beside its name, price and swatches; one camera move orbits and pushes
// in on it. Each beat taps a swatch: it lifts throwing two rings, the page swaps so the machine turns that colour, the
// colour floods out behind the card as the ground, and its name rises huge under the swatches. Then the camera whips
// onto the black machine and glides round it in slow motion, its display waking on the music's downbeat, and dives
// into its screen, drawn as vector, to land on the .00's period where bar 4's needle first strikes.

import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  DISPLAY_FONT, REEL_SHUTTER, centerOf, clamp, lerp, motionAttrs, motionCurves, motionEchoAttrs, type Point, type Rect, type Shot, type Vec3, type View,
} from '#studio';
import { CapturePlane } from '#studio/reel/capture-plane.tsx';
import { capturePlaneProjection, capturePlaneView, planeLiftStart, type PlaneLift, type PlanePose } from '#models/reel/capture-plane.ts';
import { reelHudGrounds, reelHudReadGrounds, type ReelHudGround, type ReelHudRead, type ReelHudTone } from '#models/reel/hud.ts';
import { RiseWord } from '#studio/reel/type.tsx';
import type { Bar, ShowcaseClock } from '../bar.ts';
import { captures as C } from '../captures/index.ts';
import { SHOWCASE_HUD, showcaseHudBoxesIn } from '../hud.ts';
import tapPink from '../sfx/tap-pink.ts';
import tapCharcoal from '../sfx/tap-charcoal.ts';
import tapBlack from '../sfx/tap-black.ts';
import { INK_FIRST_STRIKE } from '../ink-field.ts';
import { P } from '../look.ts';
import { SHOWCASE_FORMAT } from '../timeline.ts';

export function swatchesBar(clock: ShowcaseClock<'swatches'>): Bar {
  const { fps } = clock;
  const outExpo = motionCurves.expo.entrance;

  const FROM = clock.from;
  const TO = clock.to;
  const LENS = 1100;
  const VANISH: Point = { x: SHOWCASE_FORMAT.width / 2, y: SHOWCASE_FORMAT.height / 2 };

  // ---------- the page ----------

  // Every capture of the page lays out alike (only the picked swatch, its legend, the SKU, the machine and the rows the
  // words replace differ), so the black one places everything.
  const PAGE = C['sol-black-word'].rects;
  const SWATCHES = PAGE.swatches;
  // Measured off the captures: the machine photo's silhouette; the face plate round its screen, dark on every machine;
  // the screen and its white voltage box.
  const MACHINE: Rect = { x: 274, y: 269, w: 107, h: 427 };
  const FACE: Rect = { x: 285, y: 292, w: 73, h: 128 };
  const SCREEN: Rect = { x: 299, y: 308, w: 58.5, h: 89.5 };
  const VOLTAGE: Rect = { x: 304.7, y: 327.5, w: 44.5, h: 27.5 };
  // The options panel the swatches sit on: left showing when one lifts out of it, and blank below them for the word.
  const PANEL = '#f9f9f9';

  // The card holds the machine and the column: from just left of the photo to past the page's right edge (the card runs
  // the page on in white), from just over the name to the panel's foot. At 1.6 card px a page px the 3× capture stays
  // sharp, and the card fills about 60% of the frame between the HUD's rows, the machine two-thirds of its height.
  const CROP: Rect = { x: 225, y: 205, w: 975, h: 498 };
  const CARD_SCALE = 1.6;
  const CARD_MIDDLE = centerOf(CROP);
  /** A crop of the page as the card at CARD_SCALE, centred at rest: the view of each page, and how the card lays out. */
  type CardCrop = { crop: Rect; middle: Point; view: (shot: Shot) => View; layout: View };
  function cardCropOf(crop: Rect): CardCrop {
    const view = (shot: Shot) => capturePlaneView(shot, crop, SHOWCASE_FORMAT, { fit: { w: crop.w * CARD_SCALE, h: crop.h * CARD_SCALE }, centre: VANISH });
    return { crop, middle: centerOf(crop), view, layout: view(C['sol-black-word']) };
  }
  const CARD = cardCropOf(CROP);

  // ---------- the worlds ----------

  type Tap = { frame: number; swatch: number; color: string; word: string; stretch: number; cap: number };
  /** A page on the card and the ground round it, with the HUD's tone over the ground and over the machine's body. */
  type World = { shot: Shot; ground: string; hud: ReelHudTone; machineHud: ReelHudTone; tap?: Tap };

  // The swatches in the order they're tapped, one a beat: the colour script's black, pink, charcoal, black, landing on
  // bar 4's black. The bar opens on the whole buy box, its battery and quantity rows too; the tapped pages clear them
  // for the word. Each word is the page's own name for its colour, its caps (page px) and width axis set so it spans
  // the panel's lower half and, lifted, stays 38 px or more inside the card through the orbit.
  const WORLDS: readonly World[] = [
    { shot: C.sol, ground: P.ground, hud: 'light', machineHud: 'light' },
    { shot: C['sol-pink-word'], ground: P.magenta, hud: 'on-accent', machineHud: 'dark', tap: { frame: clock.cues.pinkTap, swatch: 1, color: P.magenta, word: 'PINK', stretch: 110, cap: 140 } },
    { shot: C['sol-grey-word'], ground: P.graphite, hud: 'light', machineHud: 'light', tap: { frame: clock.cues.charcoalTap, swatch: 2, color: P.graphite, word: 'CHARCOAL', stretch: 62, cap: 112 } },
    { shot: C['sol-black-word'], ground: P.black, hud: 'light', machineHud: 'light', tap: { frame: clock.beat(3), swatch: 0, color: P.black, word: 'BLACK', stretch: 80, cap: 140 } },
  ];
  const TAPS = WORLDS.flatMap((w) => (w.tap ? [w.tap] : []));
  /** The world whose page is on the card at `f`: each tap swaps it on its own frame. */
  const worldAt = (f: number) => TAPS.filter((tap) => f >= tap.frame).length;

  // ---------- the camera ----------

  type Turn = { rx: number; ry: number; rz: number };
  /** What the camera holds: page point `at` on screen at `on`, `zoom` frame px a page px there, the card turned `turn`. */
  type Framing = { at: Point; on: Point; zoom: number; turn: Turn };

  // One move from the cut to the whip: the card swings 8° through square to the lens, the machine's edge nearest first,
  // and tilts 2° less as the camera pushes in 3% on its middle. At each end the card is as large as the HUD's rows allow,
  // 12 px clear of them: 60% of the frame, then 64%, the machine two-thirds of the frame's height, then 63%.
  const START: Framing = { at: CARD_MIDDLE, on: VANISH, zoom: 1.6, turn: { rx: 4, ry: 5, rz: 0 } };
  const END = { zoom: 1.645, turn: { rx: 2, ry: -3, rz: 0 } };
  // The move drives the offbeats: 40% of it runs at an even rate, the rest in three in-out swings of six frames, each on
  // the half-beat before a tap, so the camera is never still between the taps' punches.
  const SWINGS = { share: 0.6, frames: 6 };
  const swingAt = (tap: Tap) => tap.frame - 7.5;
  /** How far along the move the camera is at `f`, 0 on the cut to 1 as the whip starts. */
  function moveAt(f: number) {
    const even = clamp((f - FROM) / (WHIP.from - FROM));
    const swung = TAPS.reduce((sum, tap) => sum + motionCurves.cubic.standard((f - swingAt(tap) + SWINGS.frames / 2) / SWINGS.frames), 0) / TAPS.length;
    return lerp(even, swung, SWINGS.share);
  }

  // It drops in from above and toward the lens, three frames before the cut: out-expo has it all but landed on the cut,
  // so the bar's first frame is the whole card, just down, sharp on its beat.
  const FLY: PlanePose = { x: 0, y: -900, z: 250, rx: 8, ry: -4, rz: 2 };
  const ARRIVE = { from: FROM - 3, frames: 6 };

  // Each tap punches the camera in 2%, gone in a few frames, as the reference's camera does on its ball's impacts.
  const PUNCH = { amount: 0.02, decay: 1.5 };

  const lerpTurn = (a: Turn, b: Turn, k: number): Turn => ({ rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k), rz: lerp(a.rz, b.rz, k) });
  const punchAt = (f: number) => 1 + PUNCH.amount * TAPS.reduce((sum, tap) => sum + (f >= tap.frame ? Math.exp(-(f - tap.frame) / PUNCH.decay) : 0), 0);

  /** The card's framing through the taps: the move and its punches. */
  function cardFramingAt(f: number): Framing {
    const u = moveAt(f);
    return { at: START.at, on: START.on, zoom: START.zoom * (END.zoom / START.zoom) ** u * punchAt(f), turn: lerpTurn(START.turn, END.turn, u) };
  }

  // The bar's end ramps speed: a whip onto the black machine on beat 3's "and", a sharp slow-motion glide round it
  // through beats 4 (the music's downbeat, where its display wakes) and 5, and a dive that lands the ".00"'s period on
  // bar 4's first strike, on the bar's last frame. DOT is that period (page px).
  const DOT: Point = { x: 331.7, y: 363.5 };
  // The whip's zoom lands in its first third, before the one frame it shows opens its shutter: that frame's smear is
  // the pan's streak, where the push's radial smear about a machine at the middle reads as the focus going.
  const WHIP = { from: clock.beat(3.5) - 1.75, zoomed: clock.beat(3.5) - 1.25, to: clock.beat(3.5) - 0.25 };
  // From the whip on, the card is cut wider: its crop runs on left over the gallery's white to the photo's edge, so the
  // close-up has page all round the machine. The whip's smear hides the cut, and the close-up never shows the card's
  // edges.
  const CLOSE_CARD = cardCropOf({ x: 60, y: CROP.y, w: CROP.x + CROP.w - 60, h: CROP.h });
  const cardCropAt = (f: number) => (f > WHIP.from ? CLOSE_CARD : CARD);
  // The whip lands with the machine left of the middle, turned right side and foot near, as if the camera had swung
  // past; the hold carries it on the whip's way to the middle, turning square as the camera trucks round and pushes in,
  // and never leaves the gallery's white, between the card's left edge and the column.
  const HOLD = {
    on: { x: 700, y: 440 }, zoom: 4.3, turn: { rx: 3, ry: -18, rz: -2 },
    // Each channel's rate as it leaves the whip and as it meets the dive, in multiples of its mean rate over the hold:
    // the slide eases out of the whip's speed, the turn settles square, and the zoom gathers speed for the dive. The
    // slide carries the hold's motion: any slower, its frames read as stills.
    ease: { slide: [1.5, 0.85], turn: [1.5, 0], zoom: [0.4, 1.6] },
  } as const;
  // On the downbeat the camera surges in 5%, half of it by that beat's frame, and glides that much slower after, so it
  // meets the dive where it would have.
  const PUSH = { at: clock.beat(4) - 0.5, by: Math.log(1.05), frames: 5 };
  // The dive takes 2.75 frames, landing on the bar's last: it enters square at 5.4×, zooming 2.5% a frame (its log's
  // rate) as its dot drifts up and left (frame px a frame), and lands the dot on the strike at 35×, where the voltage
  // box and band fill the frame, the dot is 38 px across, and the HUD's rows fall on plain ground.
  const DIVE = {
    ...clock.moves.dive, zoom: { from: 5.4, to: 35 }, creep: 0.025, on: { from: { x: 962, y: 546 }, to: INK_FIRST_STRIKE },
    drift: { x: -4, y: -2 }, rate: 1,
  };

  /**
   * A channel keyed by (frame, value, rate a frame): cubic Hermite between keys, held at the first, straight on past the
   * last. Two keys on one frame change its rate there: the first ends the segment before, the second starts the next.
   */
  type Key = readonly [at: number, value: number, rate: number];
  function keyedAt(keys: readonly Key[], f: number) {
    const [first, last] = [keys[0], keys[keys.length - 1]];
    if (f <= first[0]) return first[1];
    if (f >= last[0]) return last[1] + last[2] * (f - last[0]);
    const i = keys.findIndex((k) => k[0] > f) - 1;
    const [[a, va, ra], [b, vb, rb]] = [keys[i], keys[i + 1]];
    const d = b - a, t = (f - a) / d, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * va + (t3 - 2 * t2 + t) * d * ra + (3 * t2 - 2 * t3) * vb + (t3 - t2) * d * rb;
  }

  type ShotKeys = { x: Key[]; y: Key[]; zoom: Key[]; rx: Key[]; ry: Key[]; rz: Key[] };
  let shotKeysMemo: ShotKeys | undefined;
  /**
   * The whip, the hold and the dive. The whip snaps off at three times its mean rate, so its one frame is most of the way
   * in. The hold eases each channel as HOLD.ease has it, ending the turn square for DiveScreen; the dive takes the slide
   * and the zoom (its log) on at its own rates: two keys on one frame.
   */
  function shotKeys(): ShotKeys {
    if (shotKeysMemo) return shotKeysMemo;
    const card = cardFramingAt(WHIP.from);
    const plane = cardAt(WHIP.from);
    const on = plane.pageToScreen(DOT);
    const zoom = (CARD_SCALE * LENS) / (LENS - plane.pageInLens(DOT)[2]);
    const snap = (from: number, to: number, end = WHIP.to): Key => [WHIP.from, from, (3 * (to - from)) / (end - WHIP.from)];
    const glide = (start: number, from: number, to: number, [first, last]: readonly number[]): Key[] => {
      const mean = (to - from) / (DIVE.from - start);
      return [[start, from, mean * first], [DIVE.from, to, mean * last]];
    };
    const turn = (c: keyof Turn): Key[] => [snap(card.turn[c], HOLD.turn[c]), ...glide(WHIP.to, HOLD.turn[c], 0, HOLD.ease.turn)];
    const pan = (c: 'x' | 'y'): Key[] => [
      snap(on[c], HOLD.on[c]), ...glide(WHIP.to, HOLD.on[c], DIVE.on.from[c], HOLD.ease.slide), [DIVE.from, DIVE.on.from[c], DIVE.drift[c]],
      [DIVE.to, DIVE.on.to[c], 0],
    ];
    const [held, dive] = [Math.log(HOLD.zoom), Math.log(DIVE.zoom.from)];
    shotKeysMemo = {
      x: pan('x'), y: pan('y'), rx: turn('rx'), ry: turn('ry'), rz: turn('rz'),
      zoom: [
        snap(Math.log(zoom), held, WHIP.zoomed), ...glide(WHIP.zoomed, held, dive, HOLD.ease.zoom), [DIVE.from, dive, DIVE.creep],
        [DIVE.to, Math.log(DIVE.zoom.to), DIVE.rate],
      ],
    };
    return shotKeysMemo;
  }

  /** The downbeat's surge in the zoom's log at `f`: up by PUSH.by, then given back evenly by the dive. */
  const pushAt = (f: number) => PUSH.by * (outExpo((f - PUSH.at) / PUSH.frames) - clamp((f - PUSH.at) / (DIVE.from - PUSH.at)));

  function framingAt(f: number): Framing {
    if (f <= WHIP.from) return cardFramingAt(f);
    const k = shotKeys();
    return {
      at: DOT, on: { x: keyedAt(k.x, f), y: keyedAt(k.y, f) }, zoom: Math.exp(keyedAt(k.zoom, f) + pushAt(f)),
      turn: { rx: keyedAt(k.rx, f), ry: keyedAt(k.ry, f), rz: keyedAt(k.rz, f) },
    };
  }

  const rad = (deg: number) => (deg * Math.PI) / 180;

  /** The card's x and y axes in lens space, as CSS composes rotateX · rotateY · rotateZ. */
  function cardAxes({ rx, ry, rz }: Turn): [Vec3, Vec3] {
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(rad(rx)), Math.sin(rad(rx)), Math.cos(rad(ry)), Math.sin(rad(ry)), Math.cos(rad(rz)), Math.sin(rad(rz))];
    return [[cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz], [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz]];
  }

  /** The pose that frames the card cut to `middle` so: `at` goes where the lens shows it at `on`, magnified to `zoom`. */
  function poseFor({ at, on, zoom, turn }: Framing, middle: Point): PlanePose {
    const s = zoom / CARD_SCALE;
    const z = LENS * (1 - 1 / s);
    const target: Vec3 = [VANISH.x + (on.x - VANISH.x) / s, VANISH.y + (on.y - VANISH.y) / s, z];
    const [u, v] = [(at.x - middle.x) * CARD_SCALE, (at.y - middle.y) * CARD_SCALE];
    const [ex, ey] = cardAxes(turn);
    const centre = [0, 1, 2].map((i) => target[i] - ex[i] * u - ey[i] * v);
    return { x: centre[0] - VANISH.x, y: centre[1] - VANISH.y, z: centre[2], ...turn };
  }

  function cardPose(f: number): PlanePose {
    const pose = poseFor(framingAt(f), cardCropAt(f).middle);
    const away = 1 - outExpo((f - ARRIVE.from) / ARRIVE.frames);
    if (away <= 0) return pose;
    return {
      x: pose.x + FLY.x * away, y: pose.y + FLY.y * away, z: pose.z + FLY.z * away,
      rx: pose.rx + FLY.rx * away, ry: pose.ry + FLY.ry * away, rz: pose.rz + FLY.rz * away,
    };
  }

  /** The card as posed at frame `f`, cut as it is then. */
  const cardAt = (f: number) => capturePlaneProjection(cardCropAt(f).layout, cardPose(f), { lens: LENS, vanish: VANISH });

  /** Page point `p` of the card on screen at frame `f`, `w` card px off its face toward the viewer. */
  const cardPoint = (p: Point, f: number, w = 0) => cardAt(f).pageToScreen(p, w);

  /** The page point under frame point `q` on the posed card: Newton's method on the projection. */
  function pageUnder(card: ReturnType<typeof cardAt>, q: Point): Point {
    let p = CARD_MIDDLE;
    for (let i = 0; i < 8; i++) {
      const [a, ax, ay] = [card.pageToScreen(p), card.pageToScreen({ x: p.x + 1, y: p.y }), card.pageToScreen({ x: p.x, y: p.y + 1 })];
      const [j00, j01, j10, j11] = [ax.x - a.x, ay.x - a.x, ax.y - a.y, ay.y - a.y];
      const det = j00 * j11 - j01 * j10;
      const [dx, dy] = [q.x - a.x, q.y - a.y];
      p = { x: p.x + (j11 * dx - j01 * dy) / det, y: p.y + (j00 * dy - j10 * dx) / det };
    }
    return p;
  }

  // ---------- the lift ----------

  // Each swatch rises off the page over the four frames before its tap and hangs over the tap, where the page swaps
  // under it and it shows picked, then settles back as its word rises. Card px up, and scale: on screen it rises to
  // about 1.6 times its size on the page. The drop is twice the rise's pace, or it would start before the swatch arrives.
  const LIFT = { height: 80, scale: 1.4, dim: 0.03, pad: 4, radius: 10, socket: PANEL, dur: 0.3, bounce: 0.45, dropDur: 0.15 };
  const liftAt = (i: number) => (TAPS[i].frame - 1) / fps;
  const landAt = (i: number) => (TAPS[i].frame + 6) / fps;
  /** The tap whose swatch is lifting, up or landing at `f`: CapturePlane lifts one control at a time. */
  const liftingAt = (f: number) => TAPS.findLastIndex((_, i) => f / fps >= planeLiftStart({ ...LIFT, at: liftAt(i) }));

  function liftFor(f: number): PlaneLift | undefined {
    const i = liftingAt(f);
    return i < 0 ? undefined : { ...LIFT, rect: SWATCHES[TAPS[i].swatch], at: liftAt(i), drop: landAt(i) };
  }

  // ---------- the flood ----------

  // A tap's colour floods out from its lifted swatch behind the card, over the ground before it, and stays: out-expo
  // over three frames from half a frame before the tap, so the tap's own frame shows it two-thirds grown and the next
  // the whole ground.
  const FLOOD_FRAMES = 3;
  const floodStart = (i: number) => TAPS[i].frame - 0.5;
  /** Where tap `i`'s flood grows from: its swatch at the top of its lift. */
  const floodOrigin = (i: number) => cardPoint(centerOf(SWATCHES[TAPS[i].swatch]), floodStart(i), LIFT.height);
  const FLOOD_REACH = TAPS.map((_, i) => {
    const o = floodOrigin(i);
    return Math.max(...[[0, 0], [SHOWCASE_FORMAT.width, 0], [SHOWCASE_FORMAT.width, SHOWCASE_FORMAT.height], [0, SHOWCASE_FORMAT.height]].map(([x, y]) => Math.hypot(x - o.x, y - o.y))) + 60;
  });
  const floodRadius = (i: number, f: number) => FLOOD_REACH[i] * outExpo((f - floodStart(i)) / FLOOD_FRAMES);
  const flooded = (i: number, f: number) => floodRadius(i, f) >= FLOOD_REACH[i] - 1;
  const floodCovers = (i: number, f: number, p: Point) => {
    const o = floodOrigin(i);
    return Math.hypot(p.x - o.x, p.y - o.y) < floodRadius(i, f);
  };

  /** A mask image of what lies inside tap `i`'s flood at `f`: a circle whose edge is smeared by its speed. */
  function floodMask(i: number, f: number) {
    const r = floodRadius(i, f);
    // The edge travels this far while the reel's shutter is open, but no more than a fifth of the radius, the reference's
    // zoom-through at its fastest: on the flood's first frame the full smear would blur the disc into a cloud.
    const smear = Math.max(8, Math.min(0.2 * r, r - floodRadius(i, f - REEL_SHUTTER * fps)));
    const o = floodOrigin(i);
    return `radial-gradient(circle at ${o.x.toFixed(1)}px ${o.y.toFixed(1)}px, #000 ${Math.max(0, r - smear / 2).toFixed(1)}px, transparent ${(r + smear / 2).toFixed(1)}px)`;
  }

  const maskedBy = (image: string): CSSProperties => ({
    WebkitMaskImage: image, maskImage: image, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
  });

  /** The grounds at `f`, oldest first: the newest one its flood has covered the frame with, and any flooding over it. */
  function Grounds({ f }: { f: number }) {
    const shown: number[] = [];
    for (let w = 0; w < WORLDS.length; w++) {
      const i = w - 1;
      if (i >= 0 && f < floodStart(i)) break;
      if (i >= 0 && flooded(i, f)) shown.length = 0;
      shown.push(w);
    }
    return shown.map((w) => {
      const i = w - 1;
      const flooding = i >= 0 && !flooded(i, f);
      return (
        <div key={w} {...(i >= 0 && motionAttrs({ name: `flood ${TAPS[i].word.toLowerCase()}`, kind: 'flood', values: { r: floodRadius(i, f) } }))}
          style={{ position: 'absolute', inset: 0, background: WORLDS[w].ground, ...(flooding ? maskedBy(floodMask(i, f)) : {}) }} />
      );
    });
  }

  // ---------- the words ----------

  // Each colour's name floats in the options panel's lower half, blank in these captures (capture.ts), centred under
  // the column and lifted toward the lens, its shadow on the panel below it: the orbit slides one over the other. Page
  // px for its middle and baseline, card px up.
  const WORD = { x: 812, base: 662, height: 96 };
  // Down and right of the word on the page, away from the key light, and soft: card px a card px of height, and caps.
  const WORD_SHADOW = { dx: 0.14, dy: 0.2, blur: 0.08, color: 'rgba(20, 11, 14, 0.22)' };
  // A word rises from half a frame after its tap, quicker than RiseWord's default (seconds a letter, and between
  // letters' starts), so it's whole four frames on; the next tap's page swap cuts it, and the whip cuts BLACK, which
  // it would throw off the frame's corner inside its one frame.
  const wordStart = (i: number) => TAPS[i].frame + 0.5;
  const WORD_RISE = { duration: 0.2, each: 0.012 };

  /**
   * `children` laid out in page px about `anchor`, `height` card px off the card's face, drawn as CapturePlane poses the
   * card at `f`: the same lens root, box and transform, laid out `ss` times larger and shrunk back so the lens doesn't
   * upsample them. CapturePlane can't host children on or over its face, so the bar mirrors its transform.
   */
  function OnCard({ f, anchor, height = 0, children }: { f: number; anchor: Point; height?: number; children: (unit: number) => ReactNode }) {
    const { crop, layout: { box } } = cardCropAt(f);
    const pose = cardPose(f);
    const depth = cardAt(f).pageInLens(anchor, height)[2];
    const ss = clamp((1.25 * LENS) / Math.max(LENS - depth, 1), 1, 2.5);
    const unit = CARD_SCALE * ss;
    return (
      <div style={{ position: 'absolute', inset: 0, perspective: LENS, perspectiveOrigin: `${VANISH.x}px ${VANISH.y}px`, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', left: box.x + (box.w * (1 - ss)) / 2, top: box.y + (box.h * (1 - ss)) / 2, width: box.w * ss, height: box.h * ss,
          transform: `translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) translateZ(${height}px) scale3d(${1 / ss}, ${1 / ss}, ${1 / ss})`,
        }}>
          <div style={{ position: 'absolute', left: (anchor.x - crop.x) * unit, top: (anchor.y - crop.y) * unit }}>{children(unit)}</div>
        </div>
      </div>
    );
  }

  function ColourWord({ i, f }: { i: number; f: number }) {
    const tap = TAPS[i];
    const t = (f - wordStart(i)) / fps;
    if (t < 0 || f > WHIP.from) return null;
    const word = (unit: number, color: string, motion?: string) => (
      <RiseWord t={t} text={tap.word} x={0} y={0} cap={tap.cap * unit} color={color} stretch={tap.stretch} {...WORD_RISE} motion={motion ?? false} />
    );
    const shadowAt = { x: WORD.x + (WORD_SHADOW.dx * WORD.height) / CARD_SCALE, y: WORD.base + (WORD_SHADOW.dy * WORD.height) / CARD_SCALE };
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <OnCard f={f} anchor={shadowAt}>
          {(unit) => <div style={{ position: 'absolute', filter: `blur(${WORD_SHADOW.blur * tap.cap * unit}px)` }}>{word(unit, WORD_SHADOW.color)}</div>}
        </OnCard>
        <OnCard f={f} anchor={{ x: WORD.x, y: WORD.base }} height={WORD.height}>
          {(unit) => word(unit, tap.color, `word ${tap.word.toLowerCase()}`)}
        </OnCard>
      </div>
    );
  }

  // ---------- the screen ----------

  // What the machine's screen shows, measured off the captures in page px: the glass, the battery, the white voltage
  // box over the blue band with its readings, the lime timer and the PEAK row. The close-up draws it as vector over the
  // photo, whose 3× capture goes soft past a 4× zoom. Sizes are cap heights; each run of type is set to its measured
  // width, so the layout holds whatever Archivo's advances.
  const SCREEN_INK = { glass: '#2b2b2d', white: '#ffffff', blue: '#2a6afe', lime: '#dbfd62', type: '#1d1d1f' };
  const GLASS: Rect = { x: 298.9, y: 308.3, w: 58.75, h: 89 };
  /** A run of the screen's type; a `reading` counts up to its value as the display wakes, one decimal shown. */
  type ScreenType = { text: string; x: number; base: number; cap: number; width: number; color: string; wdth?: number; reading?: number };
  const SCREEN_TYPE: readonly ScreenType[] = [
    { text: '100%', x: 306.1, base: 321.9, cap: 4.2, width: 14.8, color: SCREEN_INK.white },
    { text: '7.5', x: 318.6, base: 351.1, cap: 19.6, width: 22.2, color: SCREEN_INK.type, wdth: 62, reading: 7.5 },
    { text: 'V', x: 343.2, base: 350.8, cap: 4.5, width: 2.3, color: SCREEN_INK.type },
    { text: '102', x: 309.3, base: 364, cap: 4.8, width: 11.8, color: SCREEN_INK.white },
    { text: 'HZ', x: 322.8, base: 363.8, cap: 1.9, width: 4.2, color: SCREEN_INK.white },
    { text: '00', x: 333.4, base: 364, cap: 4.8, width: 8.6, color: SCREEN_INK.white },
    { text: 'A', x: 343.2, base: 363.8, cap: 1.9, width: 2.2, color: SCREEN_INK.white },
    { text: '00:00:00', x: 313.3, base: 377.5, cap: 4.1, width: 27.9, color: SCREEN_INK.lime },
    { text: 'PEAK', x: 306.8, base: 387.2, cap: 2.75, width: 12.75, color: SCREEN_INK.white },
  ];
  // Archivo's caps stand 0.7 of its size.
  const ARCHIVO_CAP = 0.7;
  const POWER = { x: 344.9, y: 386.1, r: 2.3, gap: 0.7 };

  // The display sleeps from the whip, backlit at 40%: any dimmer, the slide before the downbeat reads as a still. On
  // the downbeat it wakes: the backlight comes on past full, washing the glass white and glowing onto the face plate
  // (page px of blur), then settles over four frames as the voltage counts up over five.
  const WAKE = { at: clock.beat(4), standby: 0.4, flare: 0.6, glow: 3, settle: 4, count: 5 };
  type ScreenState = { lit: number; flare: number; count: number };
  /** The display at `f`: how lit its backlight is, how far past full, and how far its readings have counted up. */
  function screenAt(f: number): ScreenState {
    if (f < WAKE.at) return { lit: WAKE.standby, flare: 0, count: 0 };
    return { lit: 1, flare: WAKE.flare * (1 - clamp((f - WAKE.at) / WAKE.settle)) ** 2, count: motionCurves.cubic.entrance((f - WAKE.at) / WAKE.count) };
  }

  /** The screen in page px as lit `state`; the dive's dot, where it lands, drawn as its own circle. */
  function ScreenFace({ state }: { state: ScreenState }) {
    const glow = `screen-glow-${useId().replace(/[^\w-]/g, '')}`;
    const arc = `M${POWER.x + POWER.r * Math.sin(POWER.gap)} ${POWER.y - POWER.r * Math.cos(POWER.gap)}A${POWER.r} ${POWER.r} 0 1 1 ${POWER.x - POWER.r * Math.sin(POWER.gap)} ${POWER.y - POWER.r * Math.cos(POWER.gap)}`;
    const glass = { x: GLASS.x, y: GLASS.y, width: GLASS.w, height: GLASS.h, rx: 6.7 };
    return (
      <>
        {state.flare > 0 && (
          <>
            <filter id={glow} x={-0.5} y={-0.5} width={2} height={2}><feGaussianBlur stdDeviation={WAKE.glow} /></filter>
            <rect {...glass} fill={SCREEN_INK.white} opacity={state.flare} filter={`url(#${glow})`} />
          </>
        )}
        <rect {...glass} fill={SCREEN_INK.glass} />
        <g opacity={state.lit}>
          <rect x={323.3} y={315.25} width={26.4} height={8.75} rx={4.375} fill="none" stroke={SCREEN_INK.white} strokeWidth={0.67} />
          <rect x={325.2} y={317.1} width={22.9} height={5.4} rx={2.2} fill={SCREEN_INK.lime} />
          {[329.3, 333.9, 338.5, 343.25].map((x) => <rect key={x} x={x - 0.45} y={317} width={0.9} height={5.6} fill={SCREEN_INK.glass} />)}
          <rect x={305} y={327.3} width={44.3} height={41.3} rx={2} fill={SCREEN_INK.blue} />
          <rect x={305} y={327.3} width={44.3} height={27.5} rx={2} fill={SCREEN_INK.white} />
          <rect x={305} y={350} width={44.3} height={4.8} fill={SCREEN_INK.white} />
          <rect x={305.3} y={371.4} width={43.6} height={8} rx={4} fill="none" stroke={SCREEN_INK.lime} strokeWidth={0.67} />
          <rect x={328.5} y={384} width={5.8} height={1.25} rx={0.6} fill={SCREEN_INK.blue} />
          <rect x={326.4} y={385.7} width={9.8} height={1.6} rx={0.8} fill={SCREEN_INK.blue} />
          <path d={arc} fill="none" stroke={SCREEN_INK.white} strokeWidth={0.55} strokeLinecap="round" />
          <path d={`M${POWER.x} ${POWER.y - POWER.r - 0.4}V${POWER.y}`} stroke={SCREEN_INK.white} strokeWidth={0.55} strokeLinecap="round" />
          {SCREEN_TYPE.map((s, i) => (
            <text key={i} x={s.x} y={s.base} fill={s.color} textLength={s.width} lengthAdjust="spacingAndGlyphs"
              style={{ fontFamily: DISPLAY_FONT, fontSize: s.cap / ARCHIVO_CAP, fontWeight: 600, fontStretch: `${s.wdth ?? 100}%`, textRendering: 'geometricPrecision' }}>
              {s.reading === undefined ? s.text : (s.reading * state.count).toFixed(1)}
            </text>
          ))}
          <circle cx={DOT.x} cy={DOT.y} r={0.55} fill={SCREEN_INK.white} />
        </g>
        {state.flare > 0 && <rect {...glass} fill={SCREEN_INK.white} opacity={state.flare} />}
      </>
    );
  }

  /**
   * `children`, drawn in page px over `rect` of the posed card, exact under its perspective: laid out at the frame px a
   * page px shows at, in the lens CapturePlane poses the card in, so Chrome rasterizes it at its size on screen rather
   * than upsampling it.
   */
  function OnCardSvg({ f, rect, children }: { f: number; rect: Rect; children: ReactNode }) {
    const card = cardAt(f);
    const o = card.pageInLens({ x: rect.x, y: rect.y });
    const [ax, ay] = [card.pageInLens({ x: rect.x + 1, y: rect.y }), card.pageInLens({ x: rect.x, y: rect.y + 1 })].map((p) => p.map((c, i) => c - o[i]));
    const k = framingAt(f).zoom;
    const n = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]];
    const m = [...ax.map((c) => c / k), 0, ...ay.map((c) => c / k), 0, ...n.map((c) => c / Math.hypot(...n)), 0, ...o, 1];
    return (
      <div style={{ position: 'absolute', inset: 0, perspective: LENS, perspectiveOrigin: `${VANISH.x}px ${VANISH.y}px`, pointerEvents: 'none' }}>
        <svg width={rect.w * k} height={rect.h * k} viewBox={`${rect.x} ${rect.y} ${rect.w} ${rect.h}`}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', transformOrigin: '0 0', transform: `matrix3d(${m.join(',')})` }}>
          {children}
        </svg>
      </div>
    );
  }

  const CardScreen = ({ f }: { f: number }) => <OnCardSvg f={f} rect={GLASS}><ScreenFace state={screenAt(f)} /></OnCardSvg>;

  // On the downbeat a glint of the key light crosses the machine's body, left to right: a soft band of white leaning
  // with the light (upper left), page px from its middle to each edge, swelling and fading as it crosses. White over the
  // page leaves it white, so only the machine and its screen take it.
  const GLINT = { at: clock.beat(4) - 0.5, frames: 10, half: 30, lean: 25, peak: 0.4 };

  function MachineGlint({ f }: { f: number }) {
    const id = `machine-glint-${useId().replace(/[^\w-]/g, '')}`;
    const k = (f - GLINT.at) / GLINT.frames;
    if (k <= 0 || k >= 1) return null;
    const x = lerp(MACHINE.x - GLINT.half, MACHINE.x + MACHINE.w + GLINT.half, k);
    const [nx, ny] = [Math.cos(rad(GLINT.lean)), Math.sin(rad(GLINT.lean))];
    const [x1, y1, x2, y2] = [x - nx * GLINT.half, DOT.y - ny * GLINT.half, x + nx * GLINT.half, DOT.y + ny * GLINT.half];
    const peak = GLINT.peak * Math.sin(Math.PI * k);
    return (
      <OnCardSvg f={f} rect={MACHINE}>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
          {[[0, 0], [0.35, 0.3 * peak], [0.5, peak], [0.65, 0.3 * peak], [1, 0]].map(([at, a]) => <stop key={at} offset={at} stopColor={SCREEN_INK.white} stopOpacity={a} />)}
        </linearGradient>
        <rect x={MACHINE.x} y={MACHINE.y} width={MACHINE.w} height={MACHINE.h} fill={`url(#${id})`} />
      </OnCardSvg>
    );
  }

  // The dive smears the screen over a quarter-frame shutter weighted up to its close, so each point streaks back toward
  // the dot and fades along its streak: an even shutter draws the timer's digits and the 102 as overlapping copies. Its
  // dot, the zoom's centre, stays sharp.
  const SCREEN_SMEAR = { shutter: 0.25, exposures: 64 };

  type Exposure = { t: number; w: number };
  /** A shutter `shutter` frames long about frame `f` in `n` exposures, weighted as a ramp up to its close: centred on `f` by weight. */
  function rampedShutter(f: number, shutter: number, n: number): Exposure[] {
    return Array.from({ length: n }, (_, j) => {
      const w = (j + 0.5) / n;
      return { t: f + shutter * (w - 2 / 3), w };
    });
  }
  const weightOf = (xs: readonly Exposure[]) => xs.reduce((sum, x) => sum + x.w, 0);

  /**
   * SVG exposures averaged by weight as a tree of halves, each added at its share: every level rounds to 8 bits once,
   * where 64 exposures added at their own small weights round each to 0 or 1 and darken the glass.
   */
  function AveragedExposures({ exposures, render }: { exposures: readonly Exposure[]; render: (t: number) => ReactNode }): ReactNode {
    if (exposures.length === 1) return render(exposures[0].t);
    const halves = [exposures.slice(0, exposures.length >> 1), exposures.slice(exposures.length >> 1)];
    const total = weightOf(exposures);
    return halves.map((half, i) => (
      <g key={i} opacity={weightOf(half) / total} style={{ mixBlendMode: 'plus-lighter' }}>
        <AveragedExposures exposures={half} render={render} />
      </g>
    ));
  }

  /** The screen through the dive, drawn in frame px as the card's pose maps its page px through the dot: the card is square. */
  function DiveScreen({ f }: { f: number }) {
    const { shutter, exposures } = SCREEN_SMEAR;
    return (
      <svg width={SHOWCASE_FORMAT.width} height={SHOWCASE_FORMAT.height} style={{ position: 'absolute', left: 0, top: 0, isolation: 'isolate', pointerEvents: 'none' }}
        {...motionAttrs({ name: 'dive screen', values: { zoom: framingAt(f).zoom } })}>
        <AveragedExposures exposures={rampedShutter(f, shutter, exposures)} render={(t) => {
          const card = cardAt(t);
          const o = card.pageToScreen(DOT), ax = card.pageToScreen({ x: DOT.x + 1, y: DOT.y }), ay = card.pageToScreen({ x: DOT.x, y: DOT.y + 1 });
          return (
            <g transform={`matrix(${ax.x - o.x} ${ax.y - o.y} ${ay.x - o.x} ${ay.y - o.y} ${o.x} ${o.y}) translate(${-DOT.x} ${-DOT.y})`}>
              <ScreenFace state={screenAt(t)} />
            </g>
          );
        }} />
      </svg>
    );
  }

  // ---------- the tap ring ----------

  // Two ripples leave the lifted swatch, the first two frames before the tap, the second on it. They spread in the plane
  // the swatch has risen to, so they stay round it, from just outside its plate. Page px; each thins and fades as it
  // spreads. On the card they're the tap's colour; off it, over the ground that colour floods, cream.
  const RIPPLES = [
    { lead: 2, life: 0.42, from: 45, to: 420, width: 7 },
    { lead: 0, life: 0.38, from: 45, to: 320, width: 3.5 },
  ] as const;
  const RIPPLE_OFF_CARD = P.cream;
  // Off the card the ripples reach the HUD's rows, and a cream line through its glyphs muddles them, so they fade out
  // short of the rows: clear for `gap` frame px past the rows' boxes, whole `fade` px further in. The card stays clear
  // of the rows, so the ripples on it never reach them.
  const RIPPLE_HUD_CLEAR = { gap: 6, fade: 48 };
  const HUD_PART_BOXES = Object.values(showcaseHudBoxesIn('swatches'));
  const HUD_ROW_TOP_FOOT = Math.max(...HUD_PART_BOXES.filter((b) => b.y < SHOWCASE_FORMAT.height / 2).map((b) => b.y + b.h));
  const HUD_ROW_BOTTOM_HEAD = Math.min(...HUD_PART_BOXES.filter((b) => b.y > SHOWCASE_FORMAT.height / 2).map((b) => b.y));
  /** A mask's gradient stops down the frame (y, colour) that hide the off-card ripples on the HUD's rows. */
  const RIPPLE_HUD_STOPS: readonly (readonly [number, string])[] = [
    [HUD_ROW_TOP_FOOT + RIPPLE_HUD_CLEAR.gap, '#000'], [HUD_ROW_TOP_FOOT + RIPPLE_HUD_CLEAR.gap + RIPPLE_HUD_CLEAR.fade, '#fff'],
    [HUD_ROW_BOTTOM_HEAD - RIPPLE_HUD_CLEAR.gap - RIPPLE_HUD_CLEAR.fade, '#fff'], [HUD_ROW_BOTTOM_HEAD - RIPPLE_HUD_CLEAR.gap, '#000'],
  ];

  function TapRing({ i, f }: { i: number; f: number }) {
    const id = `tap-ring-${useId().replace(/[^\w-]/g, '')}`;
    const tap = TAPS[i];
    const rings = RIPPLES.map((ring, n) => ({ ...ring, n, age: (f - (tap.frame - ring.lead)) / fps })).filter(({ age, life }) => age >= 0 && age <= life);
    // The black tap's rings would still be fading over the machine's close-up: the whip ends them.
    if (!rings.length || f > WHIP.from) return null;
    const c = centerOf(SWATCHES[tap.swatch]);
    // The page's own axes at the lifted swatch, on screen: the rings lie parallel to the card.
    const at = (p: Point) => cardPoint(p, f, LIFT.height);
    const o = at(c), ax = at({ x: c.x + 1, y: c.y }), ay = at({ x: c.x, y: c.y + 1 });
    const edge = cardAt(f).corners.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    const ringsIn = (color: string, clip: string, tagged: boolean) => (
      <g clipPath={`url(#${clip})`}>
        <g transform={`matrix(${ax.x - o.x} ${ax.y - o.y} ${ay.x - o.x} ${ay.y - o.y} ${o.x} ${o.y})`}>
          {rings.map(({ n, age, life, from, to, width }) => {
            const k = outExpo(age / (life * 0.8));
            return (
              <circle key={n} {...(tagged && n === 0 && motionAttrs({ name: `ring ${tap.word.toLowerCase()}`, kind: 'tap-ring', values: { k } }))}
                r={lerp(from, to, k)} fill="none" stroke={color} strokeWidth={lerp(width, 1.5, k)} opacity={1 - clamp((age - 0.06) / (life - 0.06)) ** 1.5} />
            );
          })}
        </g>
      </g>
    );
    return (
      <svg width={SHOWCASE_FORMAT.width} height={SHOWCASE_FORMAT.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
        <defs>
          <clipPath id={`${id}-on`}><path d={`M${edge.join('L')}Z`} /></clipPath>
          <clipPath id={`${id}-off`}><path d={`M0 0H${SHOWCASE_FORMAT.width}V${SHOWCASE_FORMAT.height}H0Z M${edge.join('L')}Z`} clipRule="evenodd" /></clipPath>
          <linearGradient id={`${id}-rows`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={SHOWCASE_FORMAT.height}>
            {RIPPLE_HUD_STOPS.map(([y, color]) => <stop key={y} offset={y / SHOWCASE_FORMAT.height} stopColor={color} />)}
          </linearGradient>
          <mask id={`${id}-clear`} maskUnits="userSpaceOnUse" x={0} y={0} width={SHOWCASE_FORMAT.width} height={SHOWCASE_FORMAT.height}>
            <rect width={SHOWCASE_FORMAT.width} height={SHOWCASE_FORMAT.height} fill={`url(#${id}-rows)`} />
          </mask>
        </defs>
        {ringsIn(tap.color, `${id}-on`, true)}
        <g mask={`url(#${id}-clear)`}>{ringsIn(RIPPLE_OFF_CARD, `${id}-off`, false)}</g>
      </svg>
    );
  }

  // ---------- the bar ----------

  /** The card and what's on it at `f`; from the whip on, the screen as vector on it and its glint, unless the dive draws it. */
  function SwatchesFrame({ f, screen }: { f: number; screen: boolean }) {
    const w = worldAt(f);
    return (
      <>
        <Grounds f={f} />
        <CapturePlane
          t={f / fps} view={cardCropAt(f).view(WORLDS[w].shot)} pose={(t) => cardPose(t * fps)} lens={LENS} vanish={VANISH}
          light={{ x: -30, y: 38 }} elevation={70} shadow="rgba(0, 0, 0, 0.55)" sheen={0.1} rim={0.12} shade={0.05}
          drift={0} lift={liftFor(f)} shutter={0} motion="buy-box"
        />
        {screen && f > WHIP.from && <CardScreen f={f} />}
        {screen && <MachineGlint f={f} />}
        {w > 0 && <ColourWord i={w - 1} f={f} />}
        {TAPS.map((_, i) => <TapRing key={i} i={i} f={f} />)}
      </>
    );
  }

  // Where the whip or the dive moves the page over 60 px a frame, the shutter smears it: exposures 8 px apart along the
  // push (what the corners add to the middle's travel) or the pan (the middle's), whichever is longer, each blurred by
  // half the gap between them. The hold is the slow motion, drawn sharp.
  const CAMERA_SMEAR = {
    over: 60, shutter: SCREEN_SMEAR.shutter, step: 8, filter: 'swatches-camera-smear',
    // More exposures of the card than this are more than Chrome holds at full size: it drops their tiles, greying the
    // frame. CapturePlane's own trail is off for the same reason, and lies under the sharp card anyway.
    most: 12,
  };
  const FRAME_PROBES: Point[] = [VANISH, { x: 0, y: 0 }, { x: SHOWCASE_FORMAT.width, y: 0 }, { x: SHOWCASE_FORMAT.width, y: SHOWCASE_FORMAT.height }, { x: 0, y: SHOWCASE_FORMAT.height }];

  /**
   * How the page under the frame moves from frame `a` to frame `b`: under its middle, how far its corners stray from
   * that at most, and the most any of them travels.
   */
  function pageMotion(a: number, b: number) {
    const [from, to] = [cardAt(a), cardAt(b)];
    const [pan, ...corners] = FRAME_PROBES.map((q) => {
      const p = from.pageToScreen(pageUnder(to, q));
      return { x: q.x - p.x, y: q.y - p.y };
    });
    return {
      pan,
      push: Math.max(...corners.map((m) => Math.hypot(m.x - pan.x, m.y - pan.y))),
      fastest: Math.max(...[pan, ...corners].map((m) => Math.hypot(m.x, m.y))),
    };
  }

  function SwatchesBar({ f }: { f: number }) {
    const { shutter, step, most } = CAMERA_SMEAR;
    const diving = f > DIVE.from;
    const { pan, push, fastest } = pageMotion(f - (shutter * 2) / 3, f + shutter / 3);
    const dive = diving && <DiveScreen f={f} />;
    // Only the whip and the dive smear: a tap's punch is a jump, which a quarter-frame shutter would read as over 60 px
    // a frame.
    const moving = f > WHIP.from && (f < WHIP.to || diving);
    if (!moving || fastest / shutter <= CAMERA_SMEAR.over) return <><SwatchesFrame f={f} screen={!diving} />{dive}</>;
    // A frame of its own: bar 9's recap plays this bar's frames side by side.
    const filter = `${CAMERA_SMEAR.filter}-${f}`;
    // Two at least: one exposure blurred by half the pan would smear it 1.6 times too long.
    const samples = Math.round(clamp(Math.max(push, Math.hypot(pan.x, pan.y)) / step, 2, most));
    const [gapX, gapY, gapPush] = [Math.abs(pan.x) / samples, Math.abs(pan.y) / samples, push / samples];
    const exposures = rampedShutter(f, shutter, samples);
    // Each later exposure over the ones before at its share of the weight so far: a running weighted average.
    const shares = exposures.map((_, i) => exposures[i].w / weightOf(exposures.slice(0, i + 1)));
    return (
      <>
        <svg width={0} height={0} style={{ position: 'absolute' }}>
          <filter id={filter} x={-0.25} y={-0.25} width={1.5} height={1.5} colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${Math.hypot(gapX, gapPush) / 2} ${Math.hypot(gapY, gapPush) / 2}`} />
          </filter>
        </svg>
        {exposures.map(({ t }, i) => (
          <div key={i} {...(i < exposures.length - 1 && motionEchoAttrs)} style={{ position: 'absolute', inset: 0, opacity: shares[i], filter: `url(#${filter})` }}>
            <SwatchesFrame f={t} screen={!diving} />
          </div>
        ))}
        {dive}
      </>
    );
  }

  // ---------- the HUD ----------

  const MACHINE_EDGE = 14;
  const inRect = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // In the close-up the page is the ground and the machine the figure: a part a third or more over the page reads as on
  // it, plated white, so the rule's plate doesn't flip dark as the machine grows under it.
  const CLOSE_UP_READ = { inkFrom: 1 / 3 };

  /** What a HUD part can sit over: the ground each tone reads on, or the machine's sides in the close-up. */
  type SwatchesHudGround = ReelHudTone | 'machine-edge';

  /**
   * The ground under frame point `q` at `f`: on the card, its white page, its machine or the screen's dark glass and
   * blue band or its white voltage box; off it, the ground its flood has reached.
   */
  function groundUnder(q: Point, f: number): SwatchesHudGround {
    const card = cardAt(f);
    if (card.covers(q)) {
      const p = pageUnder(card, q);
      if (inRect(p, SCREEN)) return inRect(p, VOLTAGE) ? 'dark' : 'light';
      if (!inRect(p, MACHINE)) return 'dark';
      if (inRect(p, FACE)) return 'light';
      // MACHINE bounds the photo's widest point, and the close-up magnifies its edges, which curve in: near its sides
      // the body or the page's white may show, and the dive smears one over the other.
      if (f > WHIP.from && Math.min(p.x - MACHINE.x, MACHINE.x + MACHINE.w - p.x) < MACHINE_EDGE) return 'machine-edge';
      return WORLDS[worldAt(f)].machineHud;
    }
    return WORLDS[TAPS.findLastIndex((_, i) => f >= floodStart(i) && floodCovers(i, f, q)) + 1].hud;
  }

  /**
   * The grounds under the HUD, and the plate each tone reads on where a part's box is split between dark and light: no
   * share of the other is too small to plate, as a glyph over the card's edge vanishes into it. The machine's sides ink
   * as the page does.
   */
  const SWATCHES_HUD_GROUNDS: Record<SwatchesHudGround, ReelHudGround> = {
    dark: { color: '#ffffff' }, light: { color: P.ground }, 'on-accent': { color: P.magenta, tone: 'on-accent' }, 'machine-edge': { color: '#ffffff' },
  };

  /** How a HUD part reads at `f`: plated too where it crosses the machine's sides, as no one tone reads over both. */
  function swatchesHudRead(f: number, box: Rect): ReelHudRead {
    const grounds = reelHudGrounds(box, (q) => groundUnder(q, f));
    const read = reelHudReadGrounds(grounds, SWATCHES_HUD_GROUNDS, { mixed: 0, palette: SHOWCASE_HUD.palette, ...(f > WHIP.from && CLOSE_UP_READ) });
    return read.plate || !grounds.some((g) => g.ground === 'machine-edge') ? read : { ...read, plate: SWATCHES_HUD_GROUNDS[read.tone].color };
  }

  // ---------- the taps ----------

  // Each tap floods the ground, so it lands as a dry impact with a light kick, not a UI pop: on the first tap's empty
  // beat, a pop's tone stood only 3 dB of attack over the hats. Each take steps lower as the colours darken (pink,
  // charcoal, black). Louder buys no attack: the master's limiter takes it back.
  const TAP_SOUNDS = [
    { id: 'tap-pink', sound: tapPink, volume: 1.3 },
    { id: 'tap-charcoal', sound: tapCharcoal, volume: 1.25 },
    { id: 'tap-black', sound: tapBlack, volume: 1.2 },
  ];

  return {
    id: 'swatches',
    note: 'The Solice page lands on a tilted card over black, the machine photo two-thirds of the frame tall beside its name, price and swatches; each beat taps a swatch, the page swaps so the machine turns pink, charcoal, black, the colour floods the ground behind the card and holds for the beat, and its name (PINK, CHARCOAL, BLACK) rises huge under the swatches; then the camera whips onto the black machine and glides round it big in slow motion for two beats, sliding it to the middle and turning it square as it pushes in; on the music\'s downbeat its sleeping display flares awake, the voltage counting up to 7.5 as a glint sweeps its body and the camera surges in; then it dives into the display, drawn sharp, and lands on its ".00", where bar 4\'s needle strikes.',
    clock,
    render: (f) => <SwatchesBar f={f} />,
    hudRead: (_slot, f, box) => swatchesHudRead(f, box),
    kicks: TAPS.map((tap) => tap.frame),
    sounds: TAPS.map((tap, i) => ({ ...TAP_SOUNDS[i], at: tap.frame })),
  };
}
