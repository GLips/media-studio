// Bar 2, 02 — KINETIC TYPE: a word a beat, red and black trading places at every cut. EVERY rises out of its rule
// on bar 1's red (86). COLOR cuts to black in five inks, the only multicoloured type before bar 4, sweeping Thin to
// Black as a cream selection closes on it (101). ONE cuts back to red, its O a hole into black (116); the camera
// dives through it onto TAP., which decodes on the black beyond (131). Its full stop lands on the next sixteenth
// and is tapped, red ripples ringing out. It ends on black, TAP. held, for bar 3's card. No blue: that's bar 5's.

import type { CSSProperties } from 'react';
import {
  DISPLAY_FONT, FPS, H, ShutterBlur, W, applyAffine, clamp, inflate, lerp, motionCurves, multiplyAffine, powerOutEase, seg, sineInOutEase,
  type AffineMatrix, type Point, type Rect,
} from '../../../lib/studio/api.ts';
import { ShockRing } from '../../../lib/studio/reel/glyph-field.tsx';
import { reelHudGrounds, reelHudReadGrounds, type ReelHudGround, type ReelHudRead, type ReelHudSlot } from '../../../lib/studio/reel/hud.tsx';
import { layoutGlyphLine } from '../../../lib/studio/reel/ticker-layout.ts';
import { IndexLabel, RiseWord, ScrambleText, SelectionBox, SlantWord, slantMatrix, slantWordPose, type SlantEntrance } from '../../../lib/studio/reel/type.tsx';
import type { Bar } from '../bar.ts';
import { Field } from '../parts.tsx';
import { SHOWCASE_HUD } from '../reel.tsx';
import { P, barFrame, grid, hitFrame, inksByHue } from '../timeline.ts';

const outExpo = motionCurves.expo.entrance;
const outQuart = powerOutEase(4);

/** Each word's cut: EVERY, COLOR, ONE and TAP. land on beats 4–7. */
const CUT = { every: hitFrame(4), color: hitFrame(5), one: hitFrame(6), tap: hitFrame(7) } as const;
const since = (f: number, cut: number) => (f - cut) / FPS;

// A word's font size is its cap height over this, as the type pieces set Archivo, so letters placed here from the
// font's advances land where the pieces draw them.
const CAP_EM = 0.687;

/** The index labels' ink: P.ink at `alpha`. */
const inkAt = (alpha: number) => `rgba(20, 11, 14, ${alpha})`;
const INK_64 = inkAt(0.64);
const CREAM_70 = 'rgba(243, 240, 231, 0.7)';
const LAYER: CSSProperties = { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' };

/** A line of Archivo at one weight and width, centred on the frame: its font size, width, and letters' left edges and advances. */
function centredLine(text: string, cap: number, wght: number, wdth: number, tracking = 0) {
  const size = cap / CAP_EM;
  const line = layoutGlyphLine([...text].map((char) => ({ char, axes: { wght, wdth }, tracking })), size);
  const left = W / 2 - line.width / 2;
  return { size, left, width: line.width, x: line.x.map((x) => left + x), advance: line.advance };
}

// ---------- 86: EVERY ----------

// Two and a half frames ahead, so the cut's frame already shows E and V risen: a word still under its mask on the hit
// reads as an empty red frame, and the reference's E is past a quarter up on its beat.
const EVERY_LEAD = 2.5 / FPS;
/** RiseWord's defaults, the reference's EVERY: set here to be measured. */
const EVERY_SET = { cap: 318, weight: 900, stretch: 91.3, spacing: -0.02 } as const;

// On landing the lockup breathes: the word 6% wider on Archivo's width axis and all of it 4% larger, fullest on 92 as
// the last letter settles, then relaxing at a steady rate into the cut, so no frame holds. Width and scale move
// together: a push-in under a narrowing word would cancel it across the frame.
const EVERY_BREATH = { widen: 0.06, scale: 0.04, peak: CUT.every + 6, end: CUT.color };
const everyWidth = (stretch: number) => centredLine('EVERY', EVERY_SET.cap, EVERY_SET.weight, stretch, EVERY_SET.spacing).width;
// Advance widths run near linear along the axis, so a width's stretch is one secant step from the set one.
const EVERY_PX_PER_STRETCH = (everyWidth(1.1 * EVERY_SET.stretch) - everyWidth(EVERY_SET.stretch)) / (0.1 * EVERY_SET.stretch);

/** The landing's breath on frame `f`, fractional: 0 on the cut, 1 at its fullest on 92, back to 0 on the next cut. */
const everyBreath = (f: number) =>
  f <= EVERY_BREATH.peak ? seg(f, CUT.every, EVERY_BREATH.peak, powerOutEase(2)) : 1 - seg(f, EVERY_BREATH.peak, EVERY_BREATH.end, (k) => k);

function Every({ t }: { t: number }) {
  const breath = everyBreath(CUT.every + t * FPS);
  const stretch = EVERY_SET.stretch + (EVERY_BREATH.widen * everyWidth(EVERY_SET.stretch) * breath) / EVERY_PX_PER_STRETCH;
  // RiseWord's own widen only relaxes, wide to set, so it's off and the word is set at each frame's width.
  return (
    <>
      <Field color={P.red} />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${1 + EVERY_BREATH.scale * breath})` }}>
        <RiseWord t={t + EVERY_LEAD} text="EVERY" color={P.ink} {...EVERY_SET} stretch={stretch} widen={0} rule label="(01)" labelColor={INK_64} />
      </div>
    </>
  );
}

// ---------- 101: COLOR ----------

const COLOR = { text: 'COLOR', cap: 300, stretch: 85, from: 100, to: 900, sweep: 0.3 } as const;
const COLOR_BASE = H / 2 + COLOR.cap / 2;
const colorLine = (weight: number) => centredLine(COLOR.text, COLOR.cap, weight, COLOR.stretch);
const COLOR_LANDED = colorLine(COLOR.to);
/** The selection's rest: the landed word's cap box with 0.13 cap round it, as WeightWord pads its own. */
const COLOR_BOX = inflate({ x: COLOR_LANDED.left, y: COLOR_BASE - COLOR.cap, w: COLOR_LANDED.width, h: COLOR.cap }, 0.13 * COLOR.cap);

// Rose, orange, gold, green and teal from the chart's bright strength (l 0.74, c 0.15), hues 5° to 173°: a spectrum
// across the word that stops short of blue. Its 101° is olive at this lightness, so gold (89°) stands in for yellow.
const SPECTRUM = [2, 22, 37, 57, 72].map((i) => inksByHue[i].color);
// Once the word and its box have landed, the inks step a letter to the right on each sixteenth: the held word
// re-lights twice before the cut, every ink in a new place.
const RELIGHTS = [hitFrame(5.5), hitFrame(5.75)];

/**
 * WeightWord's sweep, Thin to Black on its out-quart over 0.3 s, each letter in its own ink. WeightWord sets its word
 * as one text in one fill, so the letters are placed here from Archivo's advances at each frame's weight.
 */
function InkWord({ t, step }: { t: number; step: number }) {
  const weight = lerp(COLOR.from, COLOR.to, outQuart(t / COLOR.sweep));
  const line = colorLine(weight);
  const face: CSSProperties = { fontFamily: DISPLAY_FONT, fontSize: line.size, fontWeight: weight, fontStretch: `${COLOR.stretch}%`, fontVariantLigatures: 'none' };
  const n = SPECTRUM.length;
  return (
    <svg width={W} height={H} style={LAYER}>
      {[...COLOR.text].map((char, i) => <text key={i} x={line.x[i]} y={COLOR_BASE} fill={SPECTRUM[(((i - step) % n) + n) % n]} style={face}>{char}</text>)}
    </svg>
  );
}

function Color({ t, step }: { t: number; step: number }) {
  return (
    <>
      <Field color={P.ground} />
      <InkWord t={t} step={step} />
      {/* The label where WeightWord sets its own over a selection. */}
      <svg width={W} height={H} style={LAYER}>
        <IndexLabel text="(02)" x={COLOR_BOX.x + 6} y={COLOR_BOX.y - 23} t={t - 0.1} color={CREAM_70} />
      </svg>
      <SelectionBox t={t} to={COLOR_BOX} color={P.cream} handle={P.red} readoutColor={P.ink} />
    </>
  );
}

// ---------- 116: ONE, and the dive through its O ----------

const ONE = { text: 'ONE', cap: 420, weight: 250 } as const;
// SlantWord's entrance, passed to it and replayed below to carry the O's hole with the word; level and still by 0.3 s.
const ONE_IN = { scale: 1.5, duration: 0.3, turn: -18, turnDuration: 0.12, slant: 15.5, slantFrom: 13, slantDuration: 0.17 } as const satisfies SlantEntrance;
const ONE_BASE = H / 2 + ONE.cap / 2;
const ONE_LINE = centredLine(ONE.text, ONE.cap, ONE.weight, 100);

// Archivo's O, N and E at weight 250 and width 100, from fontTools' instancer, in font units (y up) from each letter's
// origin: the O's outline and counter, the counter's centre, and the ring's thinnest run round it (62 units top and
// bottom, 75 at the sides).
const O_OUTLINE = 'M395.6 -12Q289.4 -12 213.3 27.7Q137.2 67.3 96.5 146.3Q55.8 225.3 55.8 343Q55.8 461.7 96.5 540.2Q137.2 618.7 213.3 658.3Q289.4 698 395.6 698Q502.9 698 578.8 658.3Q654.8 618.7 695.5 540.2Q736.2 461.7 736.2 343Q736.2 225.3 695.5 146.3Q654.8 67.3 578.8 27.7Q502.9 -12 395.6 -12Z';
const O_COUNTER = 'M395.6 50.2Q455.3 50.2 504.5 66Q553.6 81.8 588.7 115.9Q623.8 150 642.8 203.5Q661.8 257.1 661.8 332.5V353Q661.8 428.7 642.8 482.3Q623.8 536 588.7 570.1Q553.6 604.2 504.5 620Q455.3 635.8 395.6 635.8Q335.9 635.8 287.2 620Q238.4 604.2 203.3 570.1Q168.3 536 149.4 482.3Q130.5 428.7 130.5 353V332.5Q130.5 257.1 149.4 203.5Q168.3 150 203.3 115.9Q238.4 81.8 287.2 66Q335.9 50.2 395.6 50.2Z';
const N_OUTLINE = 'M92.9 0V686H163.8L523 202.4Q528.8 195.7 537.4 183.2Q545.9 170.8 555 157.7Q564.1 144.6 570.7 134.8H574.9Q574.9 151.9 574.9 168.7Q574.9 185.6 574.9 202.4V686H645.2V0H583.8L217.4 495Q210.2 504.7 194.7 526.5Q179.2 548.2 167.5 564.4H163.3Q163.3 546.8 163.3 529.9Q163.3 512.9 163.3 495V0Z';
const E_OUTLINE = 'M92.9 0V686H616.4V623.5H164.4V382.9H572.4V320.4H164.4V62.5H622.4V0Z';
const O_CENTRE: Point = { x: 396, y: 343 };
const O_RING = 62;
/** Frame px a font unit of ONE's letters. */
const ONE_UNIT = ONE_LINE.size / 1000;

/**
 * The matrix SlantWord draws ONE with `t` s into its entrance, about the middle of its cap box. SlantWord has no hook
 * for drawing inside a letter, so the O's hole replays its pose.
 */
const onePose = (t: number) => slantMatrix({ x: W / 2, y: ONE_BASE - ONE.cap / 2 }, slantWordPose(t, ONE_IN));

/** The O's hole at rest, in frame px: where the dive aims. */
const HOLE = applyAffine(onePose(ONE_IN.duration), { x: ONE_LINE.x[0] + O_CENTRE.x * ONE_UNIT, y: ONE_BASE - O_CENTRE.y * ONE_UNIT });

/** The O's counter filled with the black beyond it, stroked out to the ring's middle so its edge hides under the ring. */
function OHole({ t }: { t: number }) {
  const m = onePose(t);
  return (
    <svg width={W} height={H} style={LAYER}>
      <path d={O_COUNTER} fill={P.ground} stroke={P.ground} strokeWidth={O_RING} strokeLinejoin="round"
        transform={`matrix(${m.join(' ')}) translate(${ONE_LINE.x[0]} ${ONE_BASE}) scale(${ONE_UNIT} ${-ONE_UNIT})`} />
    </svg>
  );
}

// The dive: the camera pushes into the O as the hole pans to the frame's centre, its log scale growing as u^2.8 to
// ×7 on TAP.'s cut. So late a push leaves its last frame at ×3.4, ring and red still round the hole: no frame before
// the cut is mostly black.
const DIVE = { from: CUT.one + 8.5, to: CUT.tap, scale: 7, bite: 2.8 };

function diveAt(f: number) {
  const u = clamp((f - DIVE.from) / (DIVE.to - DIVE.from));
  const s = DIVE.scale ** (u ** DIVE.bite), pan = sineInOutEase(u);
  const x = lerp(HOLE.x, W / 2, pan), y = lerp(HOLE.y, H / 2, pan);
  return { u, s, dx: x - s * HOLE.x, dy: y - s * HOLE.y };
}

// ---------- the ground under the HUD, over ONE ----------

/** A glyph contour of M, L, H, V, Q and Z as a polygon, each curve cut into `steps` chords. */
function contourPolygon(d: string, steps = 8): Point[] {
  const tokens = d.match(/[MLHVQZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: Point[] = [];
  let i = 0, pen: Point = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'Q') {
      const c = { x: num(), y: num() }, end = { x: num(), y: num() }, from = pen;
      for (let k = 1; k <= steps; k++) {
        const s = k / steps, [a, b, e] = [(1 - s) ** 2, 2 * (1 - s) * s, s * s];
        points.push({ x: a * from.x + b * c.x + e * end.x, y: a * from.y + b * c.y + e * end.y });
      }
      pen = end;
    } else if (op !== 'Z') {
      pen = op === 'H' ? { x: num(), y: pen.y } : op === 'V' ? { x: pen.x, y: num() } : { x: num(), y: num() };
      points.push(pen);
    }
  }
  return points;
}

const inPolygon = (poly: readonly Point[], p: Point) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const O_HOLE_EDGE = contourPolygon(O_COUNTER);
/** Each letter's cream, in ONE's order: the O's ring round its hole, the N, the E. */
const ONE_LETTER_EDGES = [O_OUTLINE, N_OUTLINE, E_OUTLINE].map((d) => contourPolygon(d));

const invert = ([a, b, c, d, e, f]: AffineMatrix): AffineMatrix => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};

type OneGround = 'red' | 'cream' | 'black';

/** What ONE's shot shows on frame `f` at each frame point: the red ground, a letter's cream, or the O's black. */
function oneGroundsAt(f: number): (p: Point) => OneGround {
  const dive = diveAt(f), toWord = invert(onePose(Math.max(0, since(f, CUT.one))));
  return (p) => {
    const g = applyAffine(toWord, { x: (p.x - dive.dx) / dive.s, y: (p.y - dive.dy) / dive.s });
    const inLetter = (i: number, edge: readonly Point[]) => inPolygon(edge, { x: (g.x - ONE_LINE.x[i]) / ONE_UNIT, y: (ONE_BASE - g.y) / ONE_UNIT });
    if (inLetter(0, O_HOLE_EDGE)) return 'black';
    return ONE_LETTER_EDGES.some((edge, i) => inLetter(i, edge)) ? 'cream' : 'red';
  };
}

const ONE_GROUND_SAMPLES = 8;
const ONE_GROUNDS: Record<OneGround, ReelHudGround> = { red: { color: P.red }, cream: { color: P.cream }, black: { color: P.ground } };

/**
 * How a part reads over ONE on frame `f`, judged across the shutter: the entrance and the dive smear the letters'
 * cream over red and the hole's black. Paper inks vanish on the cream and ink type all but does on red, so a part
 * across both sits on a plate. The progress rule goes bare: a plate half the frame wide would bar the dive.
 */
function oneHudRead(slot: ReelHudSlot, f: number, box: Rect): ReelHudRead {
  const shutter = Array.from({ length: ONE_GROUND_SAMPLES }, (_, i) => oneGroundsAt(f + ONE_SHUTTER * ((i + 0.5) / ONE_GROUND_SAMPLES - 0.5)));
  const read = reelHudReadGrounds(reelHudGrounds(box, shutter), ONE_GROUNDS, { palette: SHOWCASE_HUD.palette });
  return slot === 'progress' ? { tone: read.tone } : read;
}

/** The share of the dive over which ONE's "(03)" fades: any later, the small label only smears into scratches. */
const ONE_LABEL_FADE = 0.2;

function OneShot({ t }: { t: number }) {
  const word = Math.max(0, t), dive = diveAt(CUT.one + t * FPS);
  return (
    <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${dive.dx}px, ${dive.dy}px) scale(${dive.s})` }}>
      <Field color={P.red} />
      <OHole t={word} />
      <SlantWord t={word} text={ONE.text} cap={ONE.cap} weight={ONE.weight} color={P.cream} {...ONE_IN}
        label="(03)" labelColor={inkAt(0.64 * (1 - clamp(dive.u / ONE_LABEL_FADE)))} shutter={0} />
    </div>
  );
}

// The whole shot is smeared by sampling, entrance and dive alike, so the ring and its hole blur as one. ShutterBlur's
// samples trail its `t`: half a span on centres them on the frame, as the reference's shutter is.
const ONE_SHUTTER = 0.5;
/** Frame px a point may travel between two samples before a smear shows its steps. */
const ONE_SAMPLE_STEP = 5;
/** The word's cap box at rest: its corners travel furthest under the pose's turn and the dive's push. */
const ONE_CORNERS: Point[] = [0, 1].flatMap((i) => [0, 1].map((j) => ({ x: ONE_LINE.left + i * ONE_LINE.width, y: ONE_BASE - j * ONE.cap })));

/** ONE's shot `t` s in, as a matrix: SlantWord's pose inside the dive's push. */
function oneShotMatrix(t: number): AffineMatrix {
  const dive = diveAt(CUT.one + t * FPS);
  return multiplyAffine([dive.s, 0, 0, dive.s, dive.dx, dive.dy], onePose(Math.max(0, t)));
}

function One({ t }: { t: number }) {
  // Enough samples that nothing steps more than ONE_SAMPLE_STEP: 10 while ONE sits, 32 as the dive flings the ring
  // hundreds of px within one shutter. On the cut's frame half the samples fall before the cut, all on the first pose.
  const span = ONE_SHUTTER / FPS, [a, b] = [oneShotMatrix(t - span / 2), oneShotMatrix(t + span / 2)];
  const travel = Math.max(...ONE_CORNERS.map((p) => Math.hypot(applyAffine(a, p).x - applyAffine(b, p).x, applyAffine(a, p).y - applyAffine(b, p).y)));
  const samples = Math.round(clamp((travel / ONE_SAMPLE_STEP) * (t < span / 2 ? 2 : 1), 10, 32));
  // The dive's pan starts ahead of its push, sliding the shot's own red off the frame's left edge for a few frames.
  return (
    <>
      <Field color={P.red} />
      <ShutterBlur t={t + ONE_SHUTTER / FPS / 2} shutter={ONE_SHUTTER} samples={samples} render={(ts) => <OneShot t={ts} />} />
    </>
  );
}

// ---------- 131: TAP. ----------

const TAP = { text: 'TAP.', cap: 440, stretch: 75, spacing: -0.02 } as const;
const TAP_BASE = H / 2 + TAP.cap / 2;
const TAP_LINE = centredLine(TAP.text, TAP.cap, 900, TAP.stretch, TAP.spacing);
/** The glitch hits, on the beat's first three sixteenths. */
const SIXTEENTHS = [0, 1, 2].map((n) => (n * grid.spb) / 4);
// The letters lock a touch faster than ScrambleText's 0.05 s apart, so the full stop lands on the second sixteenth's
// hit. That's the tap: red rings out from the stop, the sentence's last mark, behind the word.
const TAP_DECODE = { delay: 0.03, each: (SIXTEENTHS[1] - 0.03) / (TAP.text.length - 1) };
// The full stop's middle: Archivo Black's period at width 75 spans x 47–213 and y 0–186 font units.
const TAP_DOT: Point = { x: TAP_LINE.x[3] + 0.13 * TAP_LINE.size, y: TAP_BASE - 0.093 * TAP_LINE.size };
// Slower and longer-lived than a shock ring, so they read as a touch. The first is born just before the hit, hidden
// by the stop, so it has cleared the stop's edge by the next frame; the second follows a tenth of a second on.
const TAP_RING_AT = SIXTEENTHS[1] - 0.02;
const RIPPLES = [{ at: TAP_RING_AT, stroke: 22, opacity: 1 }, { at: TAP_RING_AT + 0.1, stroke: 12, opacity: 0.8 }] as const;
const RIPPLE = { origin: TAP_DOT, speed: 1300, tau: 0.35 };

function Tap({ t }: { t: number }) {
  // The dive's momentum, braking: TAP. comes on at 0.9 and eases home over 0.45 s, then drifts on in.
  const s = 1 - 0.1 * (1 - outExpo(t / 0.45)) + 0.05 * t;
  return (
    <>
      <Field color={P.ground} />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${s})` }}>
        {/* Looks redundant: the scale makes this div its own stacking context, and ScrambleText's colour split blends
            with what's under it there. Without a ground of its own, the split and ghost blend with nothing and go teal. */}
        <Field color={P.ground} />
        {RIPPLES.map((r, i) => <ShockRing key={r.at} t={t} {...r} {...RIPPLE} color={P.red} motion={`tap-ring-${i + 1}`} />)}
        <ScrambleText t={t} text={TAP.text} cap={TAP.cap} stretch={TAP.stretch} spacing={TAP.spacing} color={P.cream} hits={SIXTEENTHS}
          {...TAP_DECODE} label="(04)" labelColor={CREAM_70} />
      </div>
    </>
  );
}

export const everyColorBar: Bar = {
  id: 'every-color',
  note: 'One word a beat, red and black trading places: EVERY rises on red and swells wider as it lands, COLOR in five inks on black under a cream selection, ONE on red with its O a hole into black, the camera dives through it onto TAP., which decodes on black and is tapped at its full stop, red ripples ringing out.',
  from: barFrame(2), to: barFrame(3),
  render: (f) => {
    if (f < CUT.color) return <Every t={since(f, CUT.every)} />;
    if (f < CUT.one) return <Color t={since(f, CUT.color)} step={RELIGHTS.filter((r) => f >= r).length} />;
    if (f < CUT.tap) return <One t={since(f, CUT.one)} />;
    return <Tap t={since(f, CUT.tap)} />;
  },
  // Red grounds take the on-accent HUD, so its lit beat square isn't red on red. Under ONE the entering word, then the
  // dive's ring and hole, sweep past the HUD's parts.
  hudRead: (slot, f, box) => {
    if (f < CUT.color) return { tone: 'on-accent' };
    if (f < CUT.one || f >= CUT.tap) return { tone: 'light' };
    return oneHudRead(slot, f, box);
  },
  kicks: [CUT.color, CUT.one, CUT.tap],
};
