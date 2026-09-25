// Bar 5, 05 — FILTER: the search, played as the show. "blue" types into the ink field a letter a sixteenth, each key
// popping the dots under it and ringing through the rest, as the count reads 174 OF 174. On the "e" the 17 blues flash
// up where they stand and the rest dim; on the beat they fall away as the count rolls to 17, and on its "and" the 17
// pack beside the word as the cursor swells into a cobalt flood that fills the frame on the downbeat. On the "and"
// the camera dives through the type as the real list swoops in, big two frames on, and slams down on the next beat,
// leaning as bar 6's bands will. Then the page scrolls up under its search box, a row every four frames into the cut,
// and on the "and" the box lifts off toward the lens, its shadow falling on the blues streaming under it.

import type { ReactNode } from 'react';
import {
  DISPLAY_FONT, FPS, H, W, centerOf, clamp, lerp, motionCurves, motionEchoAttrs, powerOutEase, rectToScreen, seg, springBy, view,
  type Point, type Rect, type View,
} from '../../../lib/studio/api.ts';
import { Odometer } from '../../../lib/studio/kit.tsx';
import { odometerWheels } from '../../../lib/studio/odometer-wheels.ts';
import { CapturePlane, capturePlaneProjection, capturePlaneView, lerpPlanePose, type PlanePose } from '../../../lib/studio/reel/capture-plane.tsx';
import { GlyphField, type GlyphClip, type GlyphFilterStep, type GlyphRegroup, type GlyphWave } from '../../../lib/studio/reel/glyph-field.tsx';
import { reelHudGrounds, reelHudReadGrounds, type ReelHudGround, type ReelHudRead, type ReelHudSlot } from '../../../lib/studio/reel/hud.tsx';
import { ARCHIVO_BASELINE_EM, ARCHIVO_CAP_EM, layoutGlyphLine } from '../../../lib/studio/reel/ticker-layout.ts';
import type { Bar } from '../bar.ts';
import { captures as C } from '../captures/index.ts';
import { SHOWCASE_HUD } from '../reel.tsx';
import { INK_COUNT, INK_DOT, INK_FIELD, type InkCell } from '../ink-field.ts';
import listSlam from '../sfx/list-slam.ts';
import { P, barFrame, barBeatFrame, isBlueInk, type Ink } from '../timeline.ts';

const FROM = barFrame(5), TO = barFrame(6);
// The track swings its sixteenths: across it, the second and fourth of a beat land about 35 ms (0.07 beat) behind the
// straight grid, a frame late, while its beats and "and"s sit on it. A letter on the straight grid's "a" would
// lead the music's hit by over two frames.
const SWING = 0.07;
const swungSixteenth = (n: number) => barBeatFrame(5, n % 0.5 ? n + SWING : n);
/** b, l, u, e: one a sixteenth from the downbeat, "blue" whole on its "a". */
const KEYS = [0, 0.25, 0.5, 0.75].map(swungSixteenth);
/** The query is whole: from the cursor, the 17 blues flash up where they stand and the rest dim. */
const FOUND = KEYS[3];
/** The next beat: the 17 pulse and the 157 fall out of the frame as the count starts down. */
const FALL = barBeatFrame(5, 1);
/** Its "and": the 17 fly to their block, whole on the "a". */
const PACK_FROM = barBeatFrame(5, 1.5);
const DOWNBEAT = barBeatFrame(5, 2);
/** The cursor swells for five frames; the frame is blue on the downbeat. */
const FLOOD_FROM = DOWNBEAT - 5;
const DIVE = barBeatFrame(5, 2.5);
/** The card comes in from past the frame's corner a frame into the dive, once the type has started to move. */
const SWOOP_FROM = DIVE + 1;
const LAND = barBeatFrame(5, 3);
const RISE = barBeatFrame(5, 3.5);
/** What the finale replays of this bar: the answer, "blue · 17 of 174" on cobalt, and the list slamming down. */
export const searchMoments = { answer: DOWNBEAT, listLand: LAND } as const;
const sec = (f: number) => f / FPS;
const CENTRE: Point = { x: W / 2, y: H / 2 };

const outExpo = motionCurves.expo.entrance;
const outQuad = powerOutEase(2);
const inQuad = (k: number) => clamp(k) ** 2;

// ---------- the typed word ----------

const WORD = { text: 'blue', left: 96, base: 548, size: 500, wdth: 100, tracking: -0.02 };
const WORD_LINE = layoutGlyphLine([...WORD.text].map((char) => ({ char, axes: { wght: 900, wdth: WORD.wdth }, tracking: WORD.tracking })), WORD.size);
// The type's band, ascender to a hair under the baseline: what a key clears of dots, and the cursor's height.
const BAND = { top: WORD.base - 0.74 * WORD.size, bottom: WORD.base + 0.06 * WORD.size };

/** Letters typed by frame `f`. */
const typedAt = (f: number) => KEYS.filter((k) => f >= k).length;

/** The block cursor after `typed` letters. */
function cursorRect(typed: number): Rect {
  const pen = typed === 0 ? 0 : WORD_LINE.x[typed - 1] + WORD_LINE.advance[typed - 1];
  return { x: WORD.left + pen + 0.035 * WORD.size, y: BAND.top, w: 0.13 * WORD.size, h: BAND.bottom - BAND.top };
}

const letterBox = (i: number): Rect => ({ x: WORD.left + WORD_LINE.x[i], y: BAND.top, w: WORD_LINE.advance[i], h: BAND.bottom - BAND.top });

/** A key's letter lands 20% large and snaps down onto its baseline. */
function TypedLetter({ i, f }: { i: number; f: number }) {
  const since = f - KEYS[i];
  if (since < 0) return null;
  const scale = lerp(1.2, 1, outExpo(since / 5));
  const box = letterBox(i);
  return (
    <div style={{
      position: 'absolute', left: box.x, top: WORD.base - ARCHIVO_BASELINE_EM * WORD.size, width: box.w, height: WORD.size,
      font: `900 ${WORD.size}px/${WORD.size}px ${DISPLAY_FONT}`, fontStretch: `${WORD.wdth}%`, color: P.cream,
      whiteSpace: 'pre', transform: `scale(${scale})`, transformOrigin: `50% ${ARCHIVO_BASELINE_EM * 100}%`,
    }}>
      {WORD.text[i]}
    </div>
  );
}

/**
 * The cursor: a cobalt block while the word types (it becomes the flood), then a cream one on the blue, blinking
 * once before the camera leaves.
 */
function Cursor({ f }: { f: number }) {
  const typed = typedAt(f);
  if (typed === 0) return null;
  const typing = f < FLOOD_FROM;
  const after = f >= DOWNBEAT + 1 && !(f >= DIVE - 2 && f < DIVE);
  if (!typing && !after) return null;
  const r = cursorRect(typed);
  return <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, background: typing ? P.blue : P.cream }} />;
}

// ---------- the count ----------

// The count stands where bar 4 landed it (INK_COUNT). OF 174 hangs from the digits' cap line, set as two words: at 72%
// width Archivo's space all but closes.
const OF = { cap: 126, gap: 0.13 * INK_COUNT.size, space: 0.32 };
const OF_SIZE = OF.cap / ARCHIVO_CAP_EM;
const OF_WORDS = ['OF', '174'].map((word) => ({
  word, width: layoutGlyphLine([...word].map((char) => ({ char, axes: { wght: INK_COUNT.weight, wdth: INK_COUNT.wdth }, tracking: INK_COUNT.tracking })), OF_SIZE).width,
}));
const OF_WIDTH = OF_WORDS[0].width + OF.space * OF_SIZE + OF_WORDS[1].width;

// It counts the fall away, landing with the flood. In-out, so 174 visibly starts to turn before it runs, and each
// wheel is still a digit while it spins.
const countAt = (t: number) => lerp(174, 17, seg(t * FPS, FALL, DOWNBEAT));

/** The digits' width now: the hundreds place squeezes away as the count drops under 100. */
function countWidth(t: number) {
  const wheels = odometerWheels(countAt, t, { decimals: 0, mode: 'direct', spin: 2, lockStagger: 2 / FPS });
  return wheels.reduce((sum, w) => sum + w.presence, 0) * INK_COUNT.cell;
}

const ofLeft = (t: number) => INK_COUNT.left + countWidth(t) + OF.gap;

function Count({ f }: { f: number }) {
  const t = sec(f);
  const left = ofLeft(t);
  return (
    <>
      <Odometer t={t} value={countAt} x={INK_COUNT.left} y={INK_COUNT.base} size={INK_COUNT.size} color={P.cream} weight={INK_COUNT.weight}
        stretch={INK_COUNT.wdth} tracking={INK_COUNT.tracking} mode="direct" blur={0.3} fade={0.03} punch={0.06} motion="count" />
      {OF_WORDS.map(({ word }, i) => (
        <div key={word} style={{
          position: 'absolute', left: i === 0 ? left : left + OF_WORDS[0].width + OF.space * OF_SIZE, top: INK_COUNT.top + OF.cap - ARCHIVO_BASELINE_EM * OF_SIZE,
          font: `${INK_COUNT.weight} ${OF_SIZE}px/${OF_SIZE}px ${DISPLAY_FONT}`, fontStretch: `${INK_COUNT.wdth}%`, letterSpacing: `${INK_COUNT.tracking}em`,
          color: P.cream, whiteSpace: 'pre',
        }}>
          {word}
        </div>
      ))}
    </>
  );
}

// ---------- the field ----------

const isBlue = (cell: InkCell) => isBlueInk(cell.item);
// A dot's radius at rest, in px.
const DOT_R = (INK_DOT.L * INK_FIELD.layout.pitch) / 2;

const near = (cell: InkCell, r: Rect, margin = DOT_R + 4) =>
  cell.x > r.x - margin && cell.x < r.x + r.w + margin && cell.y > r.y - margin && cell.y < r.y + r.h + margin;
/** The key whose letter or cursor first covers a cell (-1 for none): that key clears it. */
const clearingKey = (cell: InkCell) => KEYS.findIndex((_, i) => near(cell, letterBox(i)) || near(cell, cursorRect(i + 1)));
// The count's digits (174, as it opens) and OF 174 clear their dots on the downbeat, so no dot sits between digits.
const COUNT_BOXES: Rect[] = [
  { x: INK_COUNT.left, y: INK_COUNT.top, w: 3 * INK_COUNT.cell, h: INK_COUNT.base - INK_COUNT.top },
  { x: ofLeft(sec(FROM)), y: INK_COUNT.top, w: OF_WIDTH, h: OF.cap },
];
const underCount = (cell: InkCell) => clearingKey(cell) < 0 && COUNT_BOXES.some((box) => near(cell, box));
/** Under the type once it's set: a blue here stays hidden until it flies. */
const underType = (cell: InkCell) => clearingKey(cell) >= 0 || underCount(cell);

/** A cleared dot swells a touch, flashes, and is gone in four frames. */
const CLEAR_CLIP: GlyphClip<Ink> = {
  scale: [{ at: 1 / FPS, value: 1.3, ease: outQuad }, { at: 4 / FPS, value: 0, ease: inQuad }],
  brighten: [{ at: 0, value: 0.45 }, { at: 3 / FPS, value: 0 }],
};

/**
 * A key rings out through the dots still standing: a swell and a flash running from its letter at 270 px a frame,
 * across the field by the next key or just after. Slower or longer, the rings of keys a sixteenth apart merge into
 * one swell.
 */
const RING_CLIP: GlyphClip<Ink> = {
  scale: [{ at: 1 / FPS, value: 1.4, ease: outQuad }, { at: 3.5 / FPS, value: 1, ease: motionCurves.cubic.standard }],
  brighten: [{ at: 0.5 / FPS, value: 0.3 }, { at: 3 / FPS, value: 0, ease: outQuad }],
};
const RING_SPEED = 90;

const keyOrigin = (i: number): Point => {
  const box = letterBox(i);
  return { x: box.x + box.w / 2, y: WORD.base - 0.3 * WORD.size };
};
/** The search's answer runs out from the cursor on the "e", 360 px a frame: the field has answered by the next beat. */
const FOUND_ORIGIN: Point = { x: cursorRect(4).x, y: WORD.base - 0.3 * WORD.size };
const FOUND_SPEED = 120;
const foundDelay = (cell: InkCell) => Math.hypot(cell.x - FOUND_ORIGIN.x, cell.y - FOUND_ORIGIN.y) / (FOUND_SPEED * INK_FIELD.layout.pitch);

const LOWER_WAVES: GlyphWave<Ink>[] = [
  ...KEYS.map((key, i): GlyphWave<Ink> => ({ start: sec(key), front: { from: keyOrigin(i) }, speed: 60, where: (cell) => clearingKey(cell) === i, clip: CLEAR_CLIP })),
  // The "e" has no ring: the answer's front runs out from its cursor instead.
  ...KEYS.slice(0, 3).map((key, i): GlyphWave<Ink> => ({
    start: sec(key), front: { from: keyOrigin(i) }, speed: RING_SPEED, clip: RING_CLIP,
    where: (cell) => !underCount(cell) && (clearingKey(cell) < 0 || clearingKey(cell) > i),
  })),
  // The count's ground is clear on the cut: a dot between its digits would read as a decimal point.
  { start: sec(KEYS[0]), front: { delay: () => 0 }, where: underCount, clip: { opacity: [{ at: 0, value: 0 }] } },
  // Each blue hands over to its twin in the field of the 17 as the answer's front reaches it.
  { start: sec(FOUND), front: { delay: foundDelay }, where: isBlue, clip: { opacity: [{ at: 0, value: 0 }] } },
  // The rest dim on the same front, so the 17 light up against them before they fall.
  {
    start: sec(FOUND), front: { delay: foundDelay }, where: (cell) => !isBlue(cell) && !underCount(cell),
    clip: { opacity: [{ at: 1 / FPS, value: 0.3 }] },
  },
];
// On the next beat the rest fall out of the frame, gathering speed, into the field's lattice moved to 200 px under it:
// each path runs all but straight down, the shortest (the lower rows) first, the last gone by the "and" as the 17 fly.
// The blues it drops are already hidden, handed to their twins.
const PIT = { ...INK_FIELD.layout, center: { x: W / 2, y: H / 2 + 1100 } } as const satisfies GlyphRegroup;
const LOWER_FILTER: GlyphFilterStep<Ink>[] = [{ at: sec(FALL), keep: (cell) => !isBlue(cell), regroup: PIT }];
const FALL_TIMING = { move: 5 / FPS, moveSpread: 2 / FPS, moveEase: inQuad };

// The 17 pack right of the word in three columns at 1.8 times the dot, the results beside the query.
const BLOCK = { columns: 3, pitch: 120, center: { x: 1660, y: H / 2 }, lastRow: 'center' } as const satisfies GlyphRegroup;
const BLOCK_SCALE = 1.8;

// A black keyline round each of the 17, so the blues nearest cobalt read on the flood as well as the light ones do.
// GlyphField draws one fill a glyph, so the line is the layer's own outline, spread by sixteen offset copies. It comes
// up as the 17 settle: round a dot still in flight it would draw its smear as a solid pill.
const KEYLINE = { id: 'search-blues-keyline', width: 5, copies: 16, from: DOWNBEAT - 3, to: DOWNBEAT - 1 };
const keylineOpacity = (f: number) => seg(f, KEYLINE.from, KEYLINE.to);

function KeylineFilter({ id, opacity }: { id: string; opacity: number }) {
  if (opacity <= 0) return null;
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }}>
      <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        {Array.from({ length: KEYLINE.copies }, (_, i) => {
          const a = (2 * Math.PI * i) / KEYLINE.copies;
          return <feOffset key={i} in="SourceAlpha" dx={KEYLINE.width * Math.cos(a)} dy={KEYLINE.width * Math.sin(a)} result={`copy${i}`} />;
        })}
        <feMerge result="spread">
          {Array.from({ length: KEYLINE.copies }, (_, i) => <feMergeNode key={i} in={`copy${i}`} />)}
        </feMerge>
        <feFlood floodColor={P.ground} floodOpacity={opacity} />
        <feComposite in2="spread" operator="in" result="line" />
        <feMerge>
          <feMergeNode in="line" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </svg>
  );
}

const blueRest = (cell: InkCell) => ({ ...INK_DOT, fill: cell.item.color, opacity: 0 });
/**
 * Found: a blue flashes up where it stands as the front from the cursor reaches it, and holds a size up and a shade
 * light, so the darkest read on black, while the rest fall away round it.
 */
const FOUND_CLIP: GlyphClip<Ink> = {
  opacity: [{ at: 0, value: 1 }],
  scale: [{ at: 0, value: 0.6 }, { at: 2 / FPS, value: 1.45, ease: outQuad }, { at: 8 / FPS, value: 1.25, ease: motionCurves.cubic.entrance }],
  brighten: [{ at: 0, value: 0.7 }, { at: 6 / FPS, value: 0.2, ease: outQuad }],
};
/** On the next beat, as the rest start to fall, the 17 pulse once together. */
const PULSE_CLIP: GlyphClip<Ink> = {
  scale: [{ at: 1 / FPS, value: 1.5, ease: outQuad }, { at: 5 / FPS, value: 1.25, ease: motionCurves.cubic.standard }],
  brighten: [{ at: 0, value: 0.5 }, { at: 4 / FPS, value: 0.2, ease: outQuad }],
};
const BLUE_WAVES: GlyphWave<Ink>[] = [
  { start: sec(FOUND), front: { delay: foundDelay }, where: (cell) => isBlue(cell) && !underType(cell), clip: FOUND_CLIP },
  { start: sec(FALL), front: { delay: () => 0 }, where: (cell) => isBlue(cell) && !underType(cell), clip: PULSE_CLIP },
  {
    start: sec(PACK_FROM), front: { delay: () => 0 }, where: isBlue,
    clip: {
      // A blue under the type fades up as it flies out from behind the letters.
      opacity: [{ at: 0, value: (cell) => (underType(cell) ? 0 : 1) }, { at: 2 / FPS, value: 1 }],
      scale: [{ at: 0.3, value: BLOCK_SCALE, ease: outExpo }],
      brighten: [{ at: 0.3, value: 0, ease: outExpo }],
    },
  },
];

// Twelve of the 17 stand under the letters or the count, where a flash can't be seen. They flash up over the type
// instead, keylined against the cream, so all 17 are seen where they stand; on the "and" each shrinks away into the
// type over two frames as its twin flies out from under it.
const COVERED_KEYLINE = 'search-covered-keyline';
const isCovered = (cell: InkCell) => isBlue(cell) && underType(cell);
const COVERED_WAVES: GlyphWave<Ink>[] = [
  { start: sec(FOUND), front: { delay: foundDelay }, where: isCovered, clip: FOUND_CLIP },
  { start: sec(FALL), front: { delay: () => 0 }, where: isCovered, clip: PULSE_CLIP },
  { start: sec(PACK_FROM), front: { delay: () => 0 }, where: isCovered, clip: { scale: [{ at: 2 / FPS, value: 0, ease: outQuad }] } },
];
const coveredShown = (f: number) => f >= FOUND && f < PACK_FROM + 2;
const BLUE_FILTER: GlyphFilterStep<Ink>[] = [{ at: sec(PACK_FROM), keep: isBlue, regroup: BLOCK }];
// Five frames a flight, the last leaving a frame after the first, on out-cubic rather than the default expo: it's
// within a pixel or two of home a frame early, so the block is whole on the "a"; expo's long tail would leave
// dots still overlapping there.
const PACK_TIMING = { move: 5 / FPS, moveSpread: 1 / FPS, moveEase: motionCurves.cubic.entrance };

// ---------- the flood ----------

// The cursor grows at a steady rate a frame (x31 over five) until it holds the frame, its middle drifting to the
// frame's; its edges blur by as far as they travel while a half-frame shutter is open.
const FLOOD_FRAMES = DOWNBEAT - FLOOD_FROM;
const FLOOD_MARGIN = 60;

function floodRect(f: number): (Rect & { blurX: number; blurY: number }) | null {
  if (f < FLOOD_FROM) return null;
  const c0 = cursorRect(4);
  const [hw0, hh0] = [c0.w / 2, c0.h / 2];
  const cover = Math.max((W / 2 + FLOOD_MARGIN) / hw0, (H / 2 + FLOOD_MARGIN) / hh0);
  const u = (f - FLOOD_FROM) / FLOOD_FRAMES;
  const size = (k: number) => cover ** clamp(k);
  const pull = inQuad(u);
  const cx = lerp(c0.x + hw0, CENTRE.x, pull), cy = lerp(c0.y + hh0, CENTRE.y, pull);
  const s = size(u), grow = s - size(u - 0.5 / FLOOD_FRAMES);
  return { x: cx - hw0 * s, y: cy - hh0 * s, w: 2 * hw0 * s, h: 2 * hh0 * s, blurX: hw0 * grow, blurY: hh0 * grow };
}

function Flood({ f }: { f: number }) {
  if (f >= DOWNBEAT) return <div style={{ position: 'absolute', inset: 0, background: P.blue }} />;
  const r = floodRect(f);
  if (!r) return null;
  // Gaussian σ from the travel: a box smear of length L spreads like σ = L/√12; kept a pixel at least.
  const [sx, sy] = [Math.max(0.5, r.blurX / Math.sqrt(12)), Math.max(0.5, r.blurY / Math.sqrt(12))];
  return (
    <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <filter id="search-flood-smear" filterUnits="userSpaceOnUse" x={-W} y={-H} width={3 * W} height={3 * H}>
        <feGaussianBlur stdDeviation={`${sx} ${sy}`} />
      </filter>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={P.blue} filter="url(#search-flood-smear)" />
    </svg>
  );
}

// ---------- the camera ----------

// Every key punches the camera, then the fall's beat lightly and the downbeat hardest, decaying as the reference's do
// (τ 0.11 s).
const PUNCHES: readonly (readonly [number, number])[] = [
  [KEYS[0], 0.025], [KEYS[1], 0.018], [KEYS[2], 0.025], [KEYS[3], 0.02], [FALL, 0.015], [DOWNBEAT, 0.04],
];
function cameraPunch(f: number) {
  let k = 1;
  for (const [at, a] of PUNCHES) if (f >= at) k += a * Math.exp(-sec(f - at) / 0.11);
  return k;
}

// On the "and" the camera flies through the type, aimed at the gap between the word and the count so the two part
// (a point inside a letter would blow up to fill the frame): the layers grow e^(r·n²) on the nth frame, ×1.13, 1.65,
// 3.1, 7.4, the reference's tittle zoom at 30 fps, so the type is past the frame's edges by the card's third frame.
const DIVE_RATE = 0.125;
const DIVE_AIM: Point = { x: CENTRE.x, y: (WORD.base + INK_COUNT.top) / 2 };
const diveZoom = (f: number) => (f <= DIVE - 1 ? 1 : Math.exp(DIVE_RATE * (f - DIVE + 1) ** 2));
const DIVE_GONE = 60;

/** The camera over the poster: its punches about the frame's centre, then the fly-through about its aim. */
function cameraTransform(f: number) {
  const k = cameraPunch(f), z = diveZoom(f);
  // scale k about the centre, then z about the aim: x → aim + z·(centre + k·(x − centre) − aim).
  const tx = DIVE_AIM.x + z * (CENTRE.x - DIVE_AIM.x - k * CENTRE.x), ty = DIVE_AIM.y + z * (CENTRE.y - DIVE_AIM.y - k * CENTRE.y);
  return `matrix(${k * z}, 0, 0, ${k * z}, ${tx}, ${ty})`;
}

function Camera({ f, children }: { f: number; children: ReactNode }) {
  return <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: cameraTransform(f) }}>{children}</div>;
}

/** Where the camera puts poster point `p` on screen at `f`. */
function cameraPoint(p: Point, f: number): Point {
  const k = cameraPunch(f), z = diveZoom(f);
  return { x: DIVE_AIM.x + z * (CENTRE.x + k * (p.x - CENTRE.x) - DIVE_AIM.x), y: DIVE_AIM.y + z * (CENTRE.y + k * (p.y - CENTRE.y) - DIVE_AIM.y) };
}

// ---------- the card ----------

const SHOT = C['ink-blue-list'];
// Page px: the search box with "blue" in it, "17 of 174 choices" and the four matches the list shows, from just above
// the box. Only its left half is ever in shot, but a crop through the search box would show as one.
const CROP: Rect = { x: 800, y: 475, w: 562, h: 331 };
/** Frame px a page px at the card's rest depth: the row names' caps are 53 px as it lands, 55 by the bar's end. */
const CARD_ZOOM = 6.55;
const LENS = 2250;
const CARD_VIEW = capturePlaneView(SHOT, CROP, { fit: { w: CROP.w * CARD_ZOOM, h: CROP.h * CARD_ZOOM }, centre: { x: 2000, y: 862 } });
// The search box itself, measured on the capture's pixels.
const INPUT: Rect = { x: 814.6, y: 482, w: 536.4, h: 52.5 };

// At rest its rows lean −7°, the lean bar 6's bands take over the cut, its left edge turned away. "blue", the count and
// Blue Silver fill the band between the HUD's rows: the title and the timecode stay on the cobalt, the rest of the HUD
// lies over the card with no text under it, and Blue Sky's bottle peeks in under the bottom row.
const CARD_REST: PlanePose = { x: 0, y: 0, z: 0, rx: 11, ry: -15, rz: -6.3 };

// It swoops in over the type flying apart from the frame's bottom-right corner, turned the other way and high off the
// ground. In front of the type, not behind it: cream letters over the white card lose their edges. Turned further, a
// card this big would swing its near corner almost into the lens.
const CARD_FAR: PlanePose = { x: 900, y: 520, z: 0, rx: 18, ry: 8, rz: -18 };
/** How far toward the lens it swoops in from, px: the height it slams down from. */
const DROP = 300;
/** Frames the swoop takes to arrive: three quarters of the way on its first, so it's big on its second. */
const ARRIVE = 5;
// Penner's expo arrival, as motionCurves.expo.entrance, but not clamped below 0: the card was further out a frame
// before it enters, so its trail smears it in on its first frame rather than popping on sharp.
const swoopIn = (k: number) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
/** Frames it takes to turn into its lean. Any slower and its left edge sweeps over the HUD's timecode as it lands. */
const TURN = 6;

// After the slam it pushes on toward the lens through the bar's end, about a point on the count: the text grows where
// it stands rather than toward the frame's edges and the HUD. Pushed further, its edges cross the HUD's text.
const PUSH_Z = 80;
const PUSH_ABOUT = capturePlaneProjection(CARD_VIEW, CARD_REST, { lens: LENS }).pageInLens({ x: 880, y: 560 });
const PUSH_KEEP = (LENS - PUSH_ABOUT[2] - PUSH_Z) / (LENS - PUSH_ABOUT[2]);
const CARD_PUSH = { x: (CENTRE.x - PUSH_ABOUT[0]) * (1 - PUSH_KEEP), y: (CENTRE.y - PUSH_ABOUT[1]) * (1 - PUSH_KEEP), z: PUSH_Z };

/**
 * The slam: the card sweeps into place on an expo and turns on one a frame longer, while it falls to the ground from
 * DROP px up, accelerating, and hits on the beat (LAND) at full speed. It bounces a hair back up and settles, then pushes on.
 */
function cardPose(t: number): PlanePose {
  const u = clamp((t - sec(SWOOP_FROM)) / sec(LAND - SWOOP_FROM));
  const at = lerpPlanePose(CARD_FAR, CARD_REST, swoopIn((t - sec(SWOOP_FROM)) / sec(ARRIVE)));
  const turned = lerpPlanePose(CARD_FAR, CARD_REST, outExpo((t - sec(SWOOP_FROM)) / sec(TURN)));
  const since = t - sec(LAND);
  const bounce = since > 0 ? 40 * Math.exp(-since / 0.08) * Math.sin((2 * Math.PI * since) / 0.2) : 0;
  const push = clamp(since / sec(TO - LAND)) ** 1.2;
  return {
    x: at.x + CARD_PUSH.x * push, y: at.y + CARD_PUSH.y * push, z: DROP * (1 - u * u) + bounce + CARD_PUSH.z * push,
    rx: turned.rx, ry: turned.ry, rz: turned.rz,
  };
}

// The card's look, shared by the page and the search box's own card: one plane under one light. Neither floats, since
// the box's card must stay in the page's plane to the pixel until it lifts.
const LIGHT = { x: -30, y: 38 };
const CARD_LOOK = { lens: LENS, light: LIGHT, sheen: 0.14, shade: 0.08, drift: 0 } as const;
const CARD_RIM = 0.12;

// ---------- the list, scrolling under the search box ----------

// From the frame after the slam the page snaps up through the card a row (53 page px, 320–350 frame px) every four
// frames, as a list flicked row by row does: each row flicks up on out-cubic and settles, so every name holds sharp
// for two frames and Blue Silver, Blue Sky and two more blues pass at full size. At a steady rate each would only
// ever show smeared. The search box holds its place, as a sticky one does, and the rows slide under it. The capture
// runs to the listbox's foot, seven rows: the scroll's 190 px never shows past the fifth.
const ROW = 53;
const SCROLL = { from: LAND + 1, step: 4 };

/** Page px the page has scrolled by frame `f` (fractional for the smear's samples). */
function scrollAt(f: number) {
  const u = Math.max(0, f - SCROLL.from) / SCROLL.step, rows = Math.floor(u);
  return ROW * (rows + motionCurves.cubic.entrance(u - rows));
}

const scrolledView = (f: number): View => ({ ...CARD_VIEW, cam: { ...CARD_VIEW.cam, cy: CARD_VIEW.cam.cy + scrollAt(f) } });

// CapturePlane's trail smears only its pose, so the scroll's smear is the page drawn at moments across a third of a
// frame and averaged: a flick's first frame carries a row 200 frame px and smears it 55, and the settling frames
// under it are sharp. Each sample is softened by half the step to the next where the rows move fastest, so the steps
// melt.
const SCROLL_SHUTTER = 1 / 3;
const SCROLL_SAMPLES = 8;
/** Frame px per page px where the list is nearest the lens, at the frame's foot. */
const SCROLL_NEAR_ZOOM = 6.6;

// ---------- the search box's own card ----------

// The page's top to the box's foot, the box and its margins, over the scrolling page in the same plane: the rows pass
// under its lower edge. Its top edge is the card's, so no row shows above it.
const STICKY: Rect = { x: INPUT.x - 6, y: CROP.y, w: INPUT.w + 12, h: INPUT.y + INPUT.h + 6 - CROP.y };
const STICKY_BOX = rectToScreen(SHOT, CARD_VIEW.cam, STICKY, CARD_VIEW.box);
const STICKY_VIEW: View = view(SHOT, { cx: centerOf(STICKY).x, cy: centerOf(STICKY).y, zoom: CARD_VIEW.cam.zoom }, STICKY_BOX);

// It rises over the three frames before the "and": on 318 it's 166 px off the page toward the lens and 8% larger
// through it, overshooting to 192 px on 320 and settling at 180. Its shadow grows with it, offset and softened by its
// height.
const LIFT = { height: 180, dur: 0.13, bounce: 0.35, shadow: 0.55 };
const liftSpring = springBy(LIFT.dur, LIFT.bounce);
const liftAt = (t: number) => liftSpring(t - (sec(RISE) - LIFT.dur));

/** The box's card `up` of LIFT.height off the page along its normal, where its page rect lies. */
function stickyPoseAt(card: PlanePose, up: number): PlanePose {
  const [x, y, z] = capturePlaneProjection(CARD_VIEW, card, { lens: LENS }).pageInLens(centerOf(STICKY), LIFT.height * up);
  return { ...card, x: x - (STICKY_BOX.x + STICKY_BOX.w / 2), y: y - (STICKY_BOX.y + STICKY_BOX.h / 2), z };
}

/**
 * The box's card as it lifts, held by its top-left corner: straight up, the lens would grow it out from the frame's
 * centre, and its top edge would rise into the HUD's title row. So it slides back toward the centre as it rises, and
 * grows down and right over the rows instead.
 */
function stickyPose(t: number): PlanePose {
  const card = cardPose(t);
  const up = liftAt(t);
  const pose = stickyPoseAt(card, up);
  if (up === 0) return pose;
  const corner = (p: PlanePose) => capturePlaneProjection(STICKY_VIEW, p, { lens: LENS }).corners[0];
  const [at, rest] = [corner(pose), corner(stickyPoseAt(card, 0))];
  // A frame px at the card's depth is (LENS − z) / LENS px of lens space.
  const k = (LENS - pose.z) / LENS;
  return { ...pose, x: pose.x - (at.x - rest.x) * k, y: pose.y - (at.y - rest.y) * k };
}

function SearchBox({ f }: { f: number }) {
  const up = liftAt(sec(f)), lit = clamp(up);
  // Its rim and shadow come up with it: at rest it's the page's own pixels, with no edge to show.
  return (
    <CapturePlane t={sec(f)} view={STICKY_VIEW} pose={stickyPose} {...CARD_LOOK} radius={30} rim={CARD_RIM * lit}
      elevation={LIFT.height * up} shadow={lit > 0.01 ? `rgba(0, 0, 0, ${LIFT.shadow * lit})` : false} motion="search box" />
  );
}

function SearchCard({ f }: { f: number }) {
  // A settling row travels a hair under the shutter: under half a frame px where it's nearest, it's drawn once, sharp.
  const moving = (scrollAt(f) - scrollAt(f - SCROLL_SHUTTER)) * SCROLL_NEAR_ZOOM > 0.5;
  const samples = moving ? SCROLL_SAMPLES : 1;
  const step = SCROLL_SHUTTER / samples;
  // Each later sample over the ones before at 1/(i+1) leaves every one an equal share, as ShutterBlur averages; the
  // card's edges are the same in all of them, so only the first casts the ground shadow. A half-frame shutter smears
  // the swoop's flight; the frame it lands on is pin-sharp.
  return (
    <>
      {Array.from({ length: samples }, (_, i) => {
        const at = f - SCROLL_SHUTTER + step * (i + 1);
        const soften = moving ? ((scrollAt(at) - scrollAt(at - step)) * SCROLL_NEAR_ZOOM) / 2 : 0;
        return (
          <div key={i} {...(i < samples - 1 && motionEchoAttrs)} style={{
            position: 'absolute', inset: 0, opacity: 1 / (i + 1), filter: soften > 0.5 ? `blur(${soften}px)` : undefined,
          }}>
            <CapturePlane t={sec(f)} view={scrolledView(at)} pose={cardPose} {...CARD_LOOK}
              rim={CARD_RIM} elevation={90} shadow={i === 0 && 'rgba(0, 0, 0, 0.5)'} shutter={f === LAND ? 0 : 0.5} motion="list" />
          </div>
        );
      })}
      {f >= SCROLL.from && <SearchBox f={f} />}
    </>
  );
}

// ---------- the bar ----------

/**
 * Everything the camera flies through: the field, the 17 and the type. The 17 fly under the type, so their smears
 * never cross the word; only the covered ones' flash stands over it.
 */
function Poster({ f }: { f: number }) {
  const t = sec(f);
  if (diveZoom(f) > DIVE_GONE) return null;
  return (
    <Camera f={f}>
      <GlyphField t={t} {...INK_FIELD} waves={LOWER_WAVES} filter={LOWER_FILTER} filterTiming={FALL_TIMING} seed="search" motion="ink field" />
      <div style={{ position: 'absolute', inset: 0, filter: keylineOpacity(f) > 0 ? `url(#${KEYLINE.id})` : undefined }}>
        <GlyphField t={t} {...INK_FIELD} rest={blueRest} waves={BLUE_WAVES} filter={BLUE_FILTER} filterTiming={PACK_TIMING} seed="search" motion="blues" />
      </div>
      {KEYS.map((_, i) => <TypedLetter key={i} i={i} f={f} />)}
      <Cursor f={f} />
      <Count f={f} />
      {coveredShown(f) && (
        <div style={{ position: 'absolute', inset: 0, filter: `url(#${COVERED_KEYLINE})` }}>
          <GlyphField t={t} {...INK_FIELD} rest={blueRest} waves={COVERED_WAVES} seed="search" motion="covered blues" />
        </div>
      )}
    </Camera>
  );
}

// The fly-through's shutter: samples across half a frame, each a share of the whole, summed with plus-lighter so the
// type's smear averages over whatever is under it, which ShutterBlur's stacked layers can't do. Each is softened by
// half the step to the next, measured 450 px out from the aim, so the steps melt.
const DIVE_SAMPLES = 10;
const DIVE_STEP_RADIUS = 450;

function SearchBar({ f }: { f: number }) {
  const diving = f >= DIVE && diveZoom(f - 0.5) < DIVE_GONE;
  const step = 0.5 / DIVE_SAMPLES;
  return (
    <>
      <KeylineFilter id={KEYLINE.id} opacity={keylineOpacity(f)} />
      <KeylineFilter id={COVERED_KEYLINE} opacity={coveredShown(f) ? 1 : 0} />
      <div style={{ position: 'absolute', inset: 0, background: P.ground }} />
      {/* Once it holds the frame the flood is the ground, out of the camera: e^(r·n²) overflows long before the bar ends. */}
      {f >= DOWNBEAT ? <Flood f={f} /> : <Camera f={f}><Flood f={f} /></Camera>}
      {diving ? (
        <div style={{ position: 'absolute', inset: 0, isolation: 'isolate' }}>
          {Array.from({ length: DIVE_SAMPLES }, (_, i) => {
            const at = f - 0.5 + step * (i + 1);
            const soften = (DIVE_STEP_RADIUS * (diveZoom(at) - diveZoom(at - step))) / 2;
            return (
              <div key={i} {...(i < DIVE_SAMPLES - 1 && motionEchoAttrs)} style={{
                position: 'absolute', inset: 0, opacity: 1 / DIVE_SAMPLES, mixBlendMode: 'plus-lighter', filter: soften > 0.5 ? `blur(${soften}px)` : undefined,
              }}>
                <Poster f={at} />
              </div>
            );
          })}
        </div>
      ) : <Poster f={f} />}
      {f >= SWOOP_FROM && <SearchCard f={f} />}
    </>
  );
}

function floodCovers(p: Point, f: number) {
  if (f >= DOWNBEAT) return true;
  const r = floodRect(f);
  if (!r) return false;
  const a = cameraPoint({ x: r.x + r.blurX, y: r.y + r.blurY }, f), b = cameraPoint({ x: r.x + r.w - r.blurX, y: r.y + r.h - r.blurY }, f);
  return p.x > a.x && p.x < b.x && p.y > a.y && p.y < b.y;
}

// ---------- the HUD's ground ----------

// The poster's cream in poster px: each letter by its ink's box (b and l to the ascender, u and e to the x-height),
// the count's 17, OF 174, and the cursor.
const POSTER_CREAM: Rect[] = [
  ...[...WORD.text].map((char, i) => {
    const box = letterBox(i), top = WORD.base - (char === 'b' || char === 'l' ? 0.72 : 0.54) * WORD.size;
    return { x: box.x, y: top, w: box.w, h: WORD.base - top };
  }),
  { x: INK_COUNT.left, y: INK_COUNT.top, w: 2 * INK_COUNT.cell, h: INK_COUNT.base - INK_COUNT.top },
  { x: ofLeft(sec(DOWNBEAT)), y: INK_COUNT.top, w: OF_WIDTH, h: OF.cap },
  cursorRect(KEYS.length),
];

/** The poster point the camera shows at frame point `p` on frame `f`: `cameraPoint` undone. */
function posterPoint(p: Point, f: number): Point {
  const k = cameraPunch(f), z = diveZoom(f);
  return { x: CENTRE.x + ((p.x - DIVE_AIM.x) / z + DIVE_AIM.x - CENTRE.x) / k, y: CENTRE.y + ((p.y - DIVE_AIM.y) / z + DIVE_AIM.y - CENTRE.y) / k };
}

type SearchGround = 'card' | 'cream' | 'cobalt' | 'flood';

/**
 * What the HUD sees at each frame point on frame `f`, a sampler for each of the fly-through's samples as SearchBar
 * averages them: the card, the poster's cream (the smear of letters blown past the HUD washes the cobalt pale, luma
 * 130–220 under the title and the timecode over the swoop's first three frames), or the cobalt, flooded or not.
 */
function searchGroundsAt(f: number): ((p: Point) => SearchGround)[] {
  const card = f >= SWOOP_FROM ? capturePlaneProjection(CARD_VIEW, cardPose(sec(f)), { lens: LENS }) : null;
  const diving = f >= DIVE;
  const times = diving ? Array.from({ length: DIVE_SAMPLES }, (_, i) => f - 0.5 + (0.5 / DIVE_SAMPLES) * (i + 1)) : [f];
  return times.map((at) => (p) => {
    if (card?.covers(p)) return 'card';
    const q = !(diving && diveZoom(at) > DIVE_GONE) && posterPoint(p, at);
    if (q && POSTER_CREAM.some((r) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h)) return 'cream';
    return floodCovers(p, f) ? 'flood' : 'cobalt';
  });
}

/**
 * The grounds as the HUD reads them. On the card the list's rows, thumbnails and the search box's border stream under
 * the parts, so a part mostly on it sits on the page's white, unseen but over them. The flood's lit square is paper.
 */
const SEARCH_GROUNDS: Record<SearchGround, ReelHudGround> = {
  card: { color: '#ffffff', busy: true }, cream: { color: P.cream }, cobalt: { color: P.blue, tone: 'light' }, flood: { color: P.blue, tone: 'on-accent' },
};
/** A third of a part's ground pale takes it past luma 130, the reference's turn to ink type. */
const PALE_FOR_INK = 1 / 3;
// The parts set in type. The squares and the rule are shapes, seen on any ground a tone suits.
const HUD_TEXT: readonly ReelHudSlot[] = ['tl', 'tr', 'timecode', 'section'];

/**
 * How a part reads over the search. Where the dive's smear half-covers a part set in type, light ink vanishes on the
 * cream and dark ink all but does on the cobalt, so it sits on a plate of whichever covers more.
 */
function searchHudRead(slot: ReelHudSlot, f: number, box: Rect): ReelHudRead {
  const read = reelHudReadGrounds(reelHudGrounds(box, searchGroundsAt(f)), SEARCH_GROUNDS, { inkFrom: PALE_FOR_INK, palette: SHOWCASE_HUD.palette });
  return HUD_TEXT.includes(slot) ? read : { tone: read.tone };
}

export const searchBar: Bar = {
  id: 'search',
  note: '"blue" types into the ink field a letter a sixteenth, each key ringing through it, as the count reads 174 of 174; on the "e" the 17 blues flash up where they stand and the rest dim, then fall away on the next beat as the count rolls to 17; on its "and" the 17 pack beside the word as the cursor swells into a blue flood; then the camera dives through the type as the real list swoops in over it and slams down huge and tilted; the list scrolls up under its search box, which lifts off toward the lens.',
  from: FROM, to: TO,
  render: (f) => <SearchBar f={f} />,
  hudRead: searchHudRead,
  // Not a cut, but the card's slam: the lens kicks with it.
  kicks: [LAND],
  sounds: [{ id: 'list-slam', at: LAND, sound: listSlam }],
};
