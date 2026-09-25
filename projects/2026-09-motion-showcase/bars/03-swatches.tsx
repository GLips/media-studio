// Bar 3, 03 — DEPTH / UI: every colour, one tap. The Solice's page lands on a card over black, turned so the machine
// photo stands two-thirds of the frame's height beside its name, price and swatches; one camera move orbits and pushes
// in on it. Each beat taps a swatch: it lifts off the page throwing two rings, the page swaps on the tap so the machine
// turns that colour, the colour floods out behind the card and holds as the ground for the beat, and its name rises
// huge in the panel under the swatches. On the last half-beat the camera dives into the black machine's screen,
// drawn as vector so it stays sharp at any size, and lands on the period of its .00 reading where bar 4's needle
// strikes on 206.

import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  DISPLAY_FONT, FPS, H, REEL_SHUTTER, ShutterBlur, W, centerOf, clamp, lerp, motionAttrs, motionCurves, type Point, type Rect, type Shot, type Vec3, type View,
} from '../../../lib/studio/api.ts';
import { CapturePlane, capturePlaneProjection, capturePlaneView, type PlaneLift, type PlanePose } from '../../../lib/studio/reel/capture-plane.tsx';
import { reelHudBoxes, reelHudGrounds, reelHudReadGrounds, type ReelHudGround, type ReelHudTone } from '../../../lib/studio/reel/hud.tsx';
import { RiseWord } from '../../../lib/studio/reel/type.tsx';
import type { Bar } from '../bar.ts';
import { captures as C } from '../captures/index.ts';
import { SHOWCASE_HUD } from '../reel.tsx';
import tap161 from '../sfx/tap-161.ts';
import tap176 from '../sfx/tap-176.ts';
import tap191 from '../sfx/tap-191.ts';
import { INK_FIRST_STRIKE } from '../ink-field.ts';
import { P, barFrame, hitFrame } from '../timeline.ts';

const outExpo = motionCurves.expo.entrance;

const FROM = barFrame(3);
const TO = barFrame(4);
const LENS = 1100;
const VANISH: Point = { x: W / 2, y: H / 2 };

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
const cardView = (shot: Shot): View => capturePlaneView(shot, CROP, { fit: { w: CROP.w * CARD_SCALE, h: CROP.h * CARD_SCALE }, centre: VANISH });
const LAYOUT = cardView(C['sol-black-word']);

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
  { shot: C['sol-pink-word'], ground: P.magenta, hud: 'on-accent', machineHud: 'dark', tap: { frame: hitFrame(9), swatch: 1, color: P.magenta, word: 'PINK', stretch: 110, cap: 140 } },
  { shot: C['sol-grey-word'], ground: P.graphite, hud: 'light', machineHud: 'light', tap: { frame: hitFrame(10), swatch: 2, color: P.graphite, word: 'CHARCOAL', stretch: 62, cap: 112 } },
  { shot: C['sol-black-word'], ground: P.black, hud: 'light', machineHud: 'light', tap: { frame: hitFrame(11), swatch: 0, color: P.black, word: 'BLACK', stretch: 80, cap: 140 } },
];
const TAPS = WORLDS.flatMap((w) => (w.tap ? [w.tap] : []));
/** The world whose page is on the card at `f`: each tap swaps it on its own frame. */
const worldAt = (f: number) => TAPS.filter((tap) => f >= tap.frame).length;

// ---------- the camera ----------

type Turn = { rx: number; ry: number; rz: number };
/** What the camera holds: page point `at` on screen at `on`, `zoom` frame px a page px there, the card turned `turn`. */
type Framing = { at: Point; on: Point; zoom: number; turn: Turn };

// One move from the cut to the dive: the card swings 8° through square to the lens, the machine's edge nearest first,
// and tilts 2° less as the camera pushes in 3% on its middle. At each end the card is as large as the HUD's rows allow,
// 12 px clear of them: 60% of the frame, then 64%, the machine two-thirds of the frame's height, then 63%.
const START: Framing = { at: CARD_MIDDLE, on: VANISH, zoom: 1.6, turn: { rx: 4, ry: 5, rz: 0 } };
const END = { zoom: 1.645, turn: { rx: 2, ry: -3, rz: 0 } };
// The move drives the offbeats: 40% of it runs at an even rate, the rest in three in-out swings of six frames, each on
// the half-beat before a tap, so the camera is never still between the taps' punches.
const SWINGS = { share: 0.6, frames: 6 };
const swingAt = (tap: Tap) => tap.frame - 7.5;
/** How far along the move the camera is at `f`, 0 on the cut to 1 as the dive starts. */
function moveAt(f: number) {
  const even = clamp((f - FROM) / (DIVE.from - FROM));
  const swung = TAPS.reduce((sum, tap) => sum + motionCurves.cubic.standard((f - swingAt(tap) + SWINGS.frames / 2) / SWINGS.frames), 0) / TAPS.length;
  return lerp(even, swung, SWINGS.share);
}

// It drops in from above and toward the lens, three frames before the cut: out-expo has it all but landed on the cut,
// so the bar's first frame is the whole card, just down, sharp on its beat.
const FLY: PlanePose = { x: 0, y: -900, z: 250, rx: 8, ry: -4, rz: 2 };
const ARRIVE = { from: FROM - 3, frames: 6 };

// On the last half-beat the camera dives into the machine's screen onto the period of its .00 reading, a white dot on
// the blue band: the dot's screen point eases over six frames from where it stands onto bar 4's first strike, while
// the zoom about it grows 21-fold, its exponent easing in over all eight frames as the reference's zoom-through, so
// the push only accelerates. On 205 the voltage box and band fill the frame and the dot, 38 px across, sits on the
// strike: the cut is a match on it, as the reference's CRT collapses to a dot. At 35× the HUD's rows fall on plain
// ground, the top one between the 7.5's foot and the band, the bottom one between the timer's digits and its outline.
const DIVE = { from: hitFrame(11) + 6, frames: 8, pan: 6, at: { x: 331.7, y: 363.5 }, on: INK_FIRST_STRIKE, zoom: 35 };

let diveStartMemo: { on: Point; zoom: number } | undefined;
/** Where the dot stands on screen as the dive starts, and how magnified: its push leaves from there. */
function diveStart() {
  if (!diveStartMemo) {
    const card = cardAt(cardPose(DIVE.from));
    const on = card.pageToScreen(DIVE.at), next = card.pageToScreen({ x: DIVE.at.x + 1, y: DIVE.at.y });
    diveStartMemo = { on, zoom: Math.hypot(next.x - on.x, next.y - on.y) };
  }
  return diveStartMemo;
}

// Each tap punches the camera in 2%, gone in a few frames, as the reference's camera does on its ball's impacts.
const PUNCH = { amount: 0.02, decay: 1.5 };

const lerpPoint = (a: Point, b: Point, k: number): Point => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
const lerpTurn = (a: Turn, b: Turn, k: number): Turn => ({ rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k), rz: lerp(a.rz, b.rz, k) });
const punchAt = (f: number) => 1 + PUNCH.amount * TAPS.reduce((sum, tap) => sum + (f >= tap.frame ? Math.exp(-(f - tap.frame) / PUNCH.decay) : 0), 0);

function framingAt(f: number): Framing {
  const u = moveAt(f);
  const zoom = START.zoom * (END.zoom / START.zoom) ** u * punchAt(f);
  const turn = lerpTurn(START.turn, END.turn, u);
  if (f <= DIVE.from) return { at: START.at, on: START.on, zoom, turn };
  const pan = motionCurves.cubic.standard((f - DIVE.from) / DIVE.pan);
  const k = clamp((f - DIVE.from) / DIVE.frames);
  const start = diveStart();
  return {
    at: DIVE.at, on: lerpPoint(start.on, DIVE.on, pan), zoom: start.zoom * (DIVE.zoom / start.zoom) ** (k * k),
    turn: lerpTurn(turn, { rx: 0, ry: 0, rz: 0 }, pan),
  };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The card's x and y axes in lens space, as CSS composes rotateX · rotateY · rotateZ. */
function cardAxes({ rx, ry, rz }: Turn): [Vec3, Vec3] {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rad(rx)), Math.sin(rad(rx)), Math.cos(rad(ry)), Math.sin(rad(ry)), Math.cos(rad(rz)), Math.sin(rad(rz))];
  return [[cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz], [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz]];
}

/** The pose that frames the card so: `at` goes where the lens shows it at `on`, magnified to `zoom`. */
function poseFor({ at, on, zoom, turn }: Framing): PlanePose {
  const s = zoom / CARD_SCALE;
  const z = LENS * (1 - 1 / s);
  const target: Vec3 = [VANISH.x + (on.x - VANISH.x) / s, VANISH.y + (on.y - VANISH.y) / s, z];
  const [u, v] = [(at.x - CARD_MIDDLE.x) * CARD_SCALE, (at.y - CARD_MIDDLE.y) * CARD_SCALE];
  const [ex, ey] = cardAxes(turn);
  const centre = [0, 1, 2].map((i) => target[i] - ex[i] * u - ey[i] * v);
  return { x: centre[0] - VANISH.x, y: centre[1] - VANISH.y, z: centre[2], ...turn };
}

function cardPose(f: number): PlanePose {
  const pose = poseFor(framingAt(f));
  const away = 1 - outExpo((f - ARRIVE.from) / ARRIVE.frames);
  if (away <= 0) return pose;
  return {
    x: pose.x + FLY.x * away, y: pose.y + FLY.y * away, z: pose.z + FLY.z * away,
    rx: pose.rx + FLY.rx * away, ry: pose.ry + FLY.ry * away, rz: pose.rz + FLY.rz * away,
  };
}

const cardAt = (pose: PlanePose) => capturePlaneProjection(LAYOUT, pose, { lens: LENS, vanish: VANISH });

/** Page point `p` of the card on screen at frame `f`, `w` card px off its face toward the viewer. */
const cardPoint = (p: Point, f: number, w = 0) => cardAt(cardPose(f)).pageToScreen(p, w);

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

// Each swatch rises off the page over the five frames before its tap and hangs over the tap, where the page swaps
// under it and it shows picked, then settles back as its word rises. Card px up, and scale: on screen it rises to
// about 1.6 times its size on the page.
const LIFT = { height: 80, scale: 1.4, dim: 0.03, pad: 4, radius: 10, socket: PANEL, dur: 0.17, bounce: 0.45 };
const liftAt = (i: number) => (TAPS[i].frame - 1) / FPS;
const landAt = (i: number) => (TAPS[i].frame + 6) / FPS;
/** The tap whose swatch is lifting, up or landing at `f`: CapturePlane lifts one control at a time. */
const liftingAt = (f: number) => TAPS.findLastIndex((_, i) => f / FPS >= liftAt(i) - LIFT.dur);

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
  return Math.max(...[[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => Math.hypot(x - o.x, y - o.y))) + 60;
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
  const smear = Math.max(8, Math.min(0.2 * r, r - floodRadius(i, f - REEL_SHUTTER * FPS)));
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
// letters' starts), so it's whole four frames on; the next tap's page swap cuts it, and the dive carries BLACK off.
const wordStart = (i: number) => TAPS[i].frame + 0.5;
const WORD_RISE = { duration: 0.2, each: 0.012 };

/**
 * `children` laid out in page px about `anchor`, `height` card px off the card's face, drawn as CapturePlane poses the
 * card: the same lens root, box and transform, laid out `ss` times larger and shrunk back so the lens doesn't upsample
 * them. CapturePlane can't host children on or over its face, so the bar mirrors its transform.
 */
function OnCard({ pose, anchor, height = 0, children }: { pose: PlanePose; anchor: Point; height?: number; children: (unit: number) => ReactNode }) {
  const { box } = LAYOUT;
  const depth = cardAt(pose).pageInLens(anchor, height)[2];
  const ss = clamp((1.25 * LENS) / Math.max(LENS - depth, 1), 1, 2.5);
  const unit = CARD_SCALE * ss;
  return (
    <div style={{ position: 'absolute', inset: 0, perspective: LENS, perspectiveOrigin: `${VANISH.x}px ${VANISH.y}px`, pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: box.x + (box.w * (1 - ss)) / 2, top: box.y + (box.h * (1 - ss)) / 2, width: box.w * ss, height: box.h * ss,
        transform: `translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) translateZ(${height}px) scale3d(${1 / ss}, ${1 / ss}, ${1 / ss})`,
      }}>
        <div style={{ position: 'absolute', left: (anchor.x - CROP.x) * unit, top: (anchor.y - CROP.y) * unit }}>{children(unit)}</div>
      </div>
    </div>
  );
}

// The dive leaves BLACK behind: it fades over the dive's first two frames, so the HUD's section never sits half on
// its strokes and half on white page.
const WORD_LEFT = { frames: 2 };

function ColourWord({ i, f }: { i: number; f: number }) {
  const tap = TAPS[i];
  const t = (f - wordStart(i)) / FPS;
  const left = 1 - clamp((f - DIVE.from) / WORD_LEFT.frames);
  if (t < 0 || left <= 0) return null;
  const pose = cardPose(f);
  const word = (unit: number, color: string, motion?: string) => (
    <RiseWord t={t} text={tap.word} x={0} y={0} cap={tap.cap * unit} color={color} stretch={tap.stretch} {...WORD_RISE} motion={motion ?? false} />
  );
  const shadowAt = { x: WORD.x + (WORD_SHADOW.dx * WORD.height) / CARD_SCALE, y: WORD.base + (WORD_SHADOW.dy * WORD.height) / CARD_SCALE };
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: left }}>
      <OnCard pose={pose} anchor={shadowAt}>
        {(unit) => <div style={{ position: 'absolute', filter: `blur(${WORD_SHADOW.blur * tap.cap * unit}px)` }}>{word(unit, WORD_SHADOW.color)}</div>}
      </OnCard>
      <OnCard pose={pose} anchor={{ x: WORD.x, y: WORD.base }} height={WORD.height}>
        {(unit) => word(unit, tap.color, `word ${tap.word.toLowerCase()}`)}
      </OnCard>
    </div>
  );
}

// ---------- the screen ----------

// What the machine's screen shows, measured off the captures in page px: the glass, the battery, the white voltage
// box over the blue band with its readings, the lime timer and the PEAK row. The dive draws it as vector over the
// photo, whose 3× capture goes soft past a 4× zoom. Sizes are cap heights; each run of type is set to its measured
// width, so the layout holds whatever Archivo's advances.
const SCREEN_INK = { glass: '#2b2b2d', white: '#ffffff', blue: '#2a6afe', lime: '#dbfd62', type: '#1d1d1f' };
type ScreenType = { text: string; x: number; base: number; cap: number; width: number; color: string; wdth?: number };
const SCREEN_TYPE: readonly ScreenType[] = [
  { text: '100%', x: 306.1, base: 321.9, cap: 4.2, width: 14.8, color: SCREEN_INK.white },
  { text: '7.5', x: 318.6, base: 351.1, cap: 19.6, width: 22.2, color: SCREEN_INK.type, wdth: 62 },
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

/** The screen in page px, the dive's dot, where it lands, drawn as its own circle. */
function ScreenFace() {
  const arc = `M${POWER.x + POWER.r * Math.sin(POWER.gap)} ${POWER.y - POWER.r * Math.cos(POWER.gap)}A${POWER.r} ${POWER.r} 0 1 1 ${POWER.x - POWER.r * Math.sin(POWER.gap)} ${POWER.y - POWER.r * Math.cos(POWER.gap)}`;
  return (
    <>
      <rect x={298.9} y={308.3} width={58.75} height={89} rx={6.7} fill={SCREEN_INK.glass} />
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
      {SCREEN_TYPE.map((s) => (
        <text key={s.text} x={s.x} y={s.base} fill={s.color} textLength={s.width} lengthAdjust="spacingAndGlyphs"
          style={{ fontFamily: DISPLAY_FONT, fontSize: s.cap / ARCHIVO_CAP, fontWeight: 600, fontStretch: `${s.wdth ?? 100}%` }}>{s.text}</text>
      ))}
      <circle cx={DIVE.at.x} cy={DIVE.at.y} r={0.55} fill={SCREEN_INK.white} />
    </>
  );
}

// The dive smears the screen over a quarter-frame shutter in exposures added so they average: the corners of 205
// travel about 200 px while it's open, and 24 exposures keep its edges a smooth streak. Its dot, the zoom's centre,
// stays sharp.
const SCREEN_SMEAR = { shutter: 0.25, exposures: 24 };

/** The screen, drawn in frame px as the card's pose maps its page px through the dot: exact once the card squares up. */
function DiveScreen({ f }: { f: number }) {
  if (f <= DIVE.from) return null;
  const { shutter, exposures } = SCREEN_SMEAR;
  return (
    <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, isolation: 'isolate', pointerEvents: 'none' }}
      {...motionAttrs({ name: 'dive screen', values: { zoom: framingAt(f).zoom } })}>
      {Array.from({ length: exposures }, (_, j) => {
        const card = cardAt(cardPose(f + shutter * ((j + 0.5) / exposures - 0.5)));
        const o = card.pageToScreen(DIVE.at), ax = card.pageToScreen({ x: DIVE.at.x + 1, y: DIVE.at.y }), ay = card.pageToScreen({ x: DIVE.at.x, y: DIVE.at.y + 1 });
        return (
          <g key={j} opacity={1 / exposures} style={{ mixBlendMode: 'plus-lighter' }}
            transform={`matrix(${ax.x - o.x} ${ax.y - o.y} ${ay.x - o.x} ${ay.y - o.y} ${o.x} ${o.y}) translate(${-DIVE.at.x} ${-DIVE.at.y})`}>
            <ScreenFace />
          </g>
        );
      })}
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
const HUD_PART_BOXES = Object.values(reelHudBoxes(SHOWCASE_HUD, FROM / FPS));
const HUD_ROW_TOP_FOOT = Math.max(...HUD_PART_BOXES.filter((b) => b.y < H / 2).map((b) => b.y + b.h));
const HUD_ROW_BOTTOM_HEAD = Math.min(...HUD_PART_BOXES.filter((b) => b.y > H / 2).map((b) => b.y));
/** A mask's gradient stops down the frame (y, colour) that hide the off-card ripples on the HUD's rows. */
const RIPPLE_HUD_STOPS: readonly (readonly [number, string])[] = [
  [HUD_ROW_TOP_FOOT + RIPPLE_HUD_CLEAR.gap, '#000'], [HUD_ROW_TOP_FOOT + RIPPLE_HUD_CLEAR.gap + RIPPLE_HUD_CLEAR.fade, '#fff'],
  [HUD_ROW_BOTTOM_HEAD - RIPPLE_HUD_CLEAR.gap - RIPPLE_HUD_CLEAR.fade, '#fff'], [HUD_ROW_BOTTOM_HEAD - RIPPLE_HUD_CLEAR.gap, '#000'],
];

function TapRing({ i, f }: { i: number; f: number }) {
  const id = `tap-ring-${useId().replace(/[^\w-]/g, '')}`;
  const tap = TAPS[i];
  const rings = RIPPLES.map((ring, n) => ({ ...ring, n, age: (f - (tap.frame - ring.lead)) / FPS })).filter(({ age, life }) => age >= 0 && age <= life);
  if (!rings.length) return null;
  const c = centerOf(SWATCHES[tap.swatch]);
  // The page's own axes at the lifted swatch, on screen: the rings lie parallel to the card.
  const at = (p: Point) => cardPoint(p, f, LIFT.height);
  const o = at(c), ax = at({ x: c.x + 1, y: c.y }), ay = at({ x: c.x, y: c.y + 1 });
  const edge = cardAt(cardPose(f)).corners.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
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
    <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        <clipPath id={`${id}-on`}><path d={`M${edge.join('L')}Z`} /></clipPath>
        <clipPath id={`${id}-off`}><path d={`M0 0H${W}V${H}H0Z M${edge.join('L')}Z`} clipRule="evenodd" /></clipPath>
        <linearGradient id={`${id}-rows`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
          {RIPPLE_HUD_STOPS.map(([y, color]) => <stop key={y} offset={y / H} stopColor={color} />)}
        </linearGradient>
        <mask id={`${id}-clear`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <rect width={W} height={H} fill={`url(#${id}-rows)`} />
        </mask>
      </defs>
      {ringsIn(tap.color, `${id}-on`, true)}
      <g mask={`url(#${id}-clear)`}>{ringsIn(RIPPLE_OFF_CARD, `${id}-off`, false)}</g>
    </svg>
  );
}

// ---------- the bar ----------

function SwatchesFrame({ f }: { f: number }) {
  const w = worldAt(f);
  return (
    <>
      <Grounds f={f} />
      <CapturePlane
        t={f / FPS} view={cardView(WORLDS[w].shot)} pose={(t) => cardPose(t * FPS)} lens={LENS} vanish={VANISH}
        light={{ x: -30, y: 38 }} elevation={70} shadow="rgba(0, 0, 0, 0.55)" sheen={0.1} rim={0.12} shade={0.05}
        drift={0} lift={liftFor(f)} shutter={0} motion="buy-box"
      />
      {w > 0 && <ColourWord i={w - 1} f={f} />}
      {TAPS.map((_, i) => <TapRing key={i} i={i} f={f} />)}
    </>
  );
}

// Where the camera moves the page over 60 px a frame, a quarter-frame shutter centred on the frame smears it: the
// dive's push (what the corners add to the middle's travel) as exposures 8 px apart, the swing's pan (the middle's
// travel) as a blur on each, half the gap to the next. A tap's punch stays under 60.
const CAMERA_SMEAR = {
  over: 60, shutter: SCREEN_SMEAR.shutter, step: 8, filter: 'swatches-camera-smear',
  // Sampling the pan too would take 30-odd exposures of the card, more than Chrome holds at full size: it drops their
  // tiles, greying the frame. CapturePlane's own trail is off for the same reason, and lies under the sharp card anyway.
  most: 12,
};
const FRAME_PROBES: Point[] = [VANISH, { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];

/**
 * How the page under the frame moves from frame `a` to frame `b`: under its middle, how far its corners stray from
 * that at most, and the most any of them travels.
 */
function pageMotion(a: number, b: number) {
  const [from, to] = [cardAt(cardPose(a)), cardAt(cardPose(b))];
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
  const { pan, push, fastest } = pageMotion(f - shutter / 2, f + shutter / 2);
  // Only the dive smears: a tap's punch is a jump, which a quarter-frame shutter would read as over 60 px a frame.
  if (f <= DIVE.from || fastest / shutter <= CAMERA_SMEAR.over) return <><SwatchesFrame f={f} /><DiveScreen f={f} /></>;
  // A frame of its own: bar 9's recap plays this bar's frames side by side.
  const filter = `${CAMERA_SMEAR.filter}-${f}`;
  // Two at least: one exposure blurred by half the pan would smear it 1.6 times too long.
  const samples = Math.round(clamp(push / step, 2, most));
  // ShutterBlur's samples end their slices of the shutter, so a half slice back centres them.
  return (
    <>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <filter id={filter} x={-0.25} y={-0.25} width={1.5} height={1.5} colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${Math.abs(pan.x) / samples / 2} ${Math.abs(pan.y) / samples / 2}`} />
        </filter>
      </svg>
      <ShutterBlur t={(f + shutter / 2 - shutter / samples / 2) / FPS} shutter={shutter} samples={samples}
        render={(t) => <div style={{ position: 'absolute', inset: 0, filter: `url(#${filter})` }}><SwatchesFrame f={t * FPS} /></div>} />
      <DiveScreen f={f} />
    </>
  );
}

// ---------- the HUD ----------

const MACHINE_EDGE = 14;
const inRect = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * The HUD's tone over frame point `q` at `f`: on the card, its white page, its machine or the screen's dark glass and
 * blue band or its white voltage box; off it, the ground its flood has reached.
 */
function toneUnder(q: Point, f: number): ReelHudTone {
  const card = cardAt(cardPose(f));
  if (card.covers(q)) {
    const p = pageUnder(card, q);
    if (inRect(p, SCREEN)) return inRect(p, VOLTAGE) ? 'dark' : 'light';
    if (!inRect(p, MACHINE)) return 'dark';
    if (inRect(p, FACE)) return 'light';
    // MACHINE bounds the photo's widest point, and the dive magnifies its edges, which curve in: there, near its
    // sides, read the page's white, so a part over the edge is plated rather than inked for the body alone.
    if (f > DIVE.from && Math.min(p.x - MACHINE.x, MACHINE.x + MACHINE.w - p.x) < MACHINE_EDGE) return 'dark';
    return WORLDS[worldAt(f)].machineHud;
  }
  return WORLDS[TAPS.findLastIndex((_, i) => f >= floodStart(i) && floodCovers(i, f, q)) + 1].hud;
}

/**
 * The grounds under the HUD, named by the tone each takes, and the plate that tone reads on where a part's box is split
 * between dark and light (the card's edge or the machine's under it as the camera dives): no share of the other is
 * too small to plate, as a glyph over the card's edge vanishes into it.
 */
const TONE_GROUNDS: Record<ReelHudTone, ReelHudGround> = {
  dark: { color: '#ffffff' }, light: { color: P.ground }, 'on-accent': { color: P.magenta, tone: 'on-accent' },
};

// ---------- the taps ----------

// Each tap floods the ground, so it lands as a bright impact with its sub thump cut, not a UI pop: the track leaves the
// first tap's beat empty, a pop's tone stood only 3 dB of attack over the hats, and a thump's low end set off the
// master's limiter on its own beat. Each is a take of its own, a step lower as the colours darken (pink, charcoal,
// black), set to about 1 LU under the music.
const TAP_VOLUMES = [1.8, 1.7, 1.6];

export const swatchesBar: Bar = {
  id: 'swatches',
  note: 'The Solice page lands on a tilted card over black, the machine photo two-thirds of the frame tall beside its name, price and swatches; each beat taps a swatch, the page swaps so the machine turns pink, charcoal, black, the colour floods the ground behind the card and holds for the beat, and its name (PINK, CHARCOAL, BLACK) rises huge under the swatches; then the camera pushes into the black machine\'s display, drawn sharp, and lands on its ".00", where bar 4\'s needle strikes.',
  from: FROM, to: TO,
  render: (f) => <SwatchesBar f={f} />,
  hudRead: (_slot, f, box) => reelHudReadGrounds(reelHudGrounds(box, (q) => toneUnder(q, f)), TONE_GROUNDS, { mixed: 0, palette: SHOWCASE_HUD.palette }),
  kicks: TAPS.map((tap) => tap.frame),
  sounds: TAPS.map((tap, i) => ({ at: tap.frame, sound: [tap161, tap176, tap191][i], volume: TAP_VOLUMES[i] })),
};
