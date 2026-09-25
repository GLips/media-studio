// Bar 4, 04 — INK × 174: the piece's signature. A tattoo cartridge needle, standing up out of the frame toward the
// lens, strikes the dark ink field on each beat, springs back, lifts toward the lens on the "and" as it crosses to its
// next dot and falls onto it. Every strike squashes its dot and bursts its ink out through the field as a ripple, one
// ink per ring: the three ripples run the colour wheel from the brand's red-orange round to magenta. The count ticks
// up after the first two strikes, 0 → 58 → 116, and locks on 174 as INKS. slams beside it on 236; the last ripple
// lands every cell on its own ink, the field bar 5 opens on.

import { DISPLAY_FONT, FPS, H, W, clamp, motionAttrs, motionCurves, powerOutEase, seg } from '../../../lib/studio/api.ts';
import { Odometer } from '../../../lib/studio/kit.tsx';
import { GlyphField, ShockRing, parseGlyphColor, type GlyphClip, type GlyphHit, type GlyphKey, type GlyphWave } from '../../../lib/studio/reel/glyph-field.tsx';
import { Needle, type NeedleStrike } from '../../../lib/studio/reel/needle.tsx';
import { archivoAdvance, layoutGlyphLine } from '../../../lib/studio/reel/ticker-layout.ts';
import type { Bar } from '../bar.ts';
import { INK_COUNT, INK_DOT, INK_FIELD, INK_FIELD_LAYOUT, INK_FIELD_SLOTS, INK_FIRST_STRIKE, inkFieldSlotAt, type InkCell } from '../ink-field.ts';
import needle206 from '../sfx/needle-206.ts';
import needle221 from '../sfx/needle-221.ts';
import needle236 from '../sfx/needle-236.ts';
import needle251 from '../sfx/needle-251.ts';
import { P, barFrame, hitFrame, inksByHue, type Ink } from '../timeline.ts';

const FROM = barFrame(4), TO = barFrame(5);
const HITS = [12, 13, 14, 15].map(hitFrame);
const sec = (f: number) => f / FPS;

const outQuad = powerOutEase(2);
const outCubic = motionCurves.cubic.entrance;

// ---------- the strikes ----------

/**
 * The chart's ink nearest `hue` in its brightest strength (0: L .62, C .20) or its lightest (2: L .74, C .15). The
 * chart runs 2.4° a place with five strengths in turn, so strength s sits at places 5m + s, every 12°.
 */
function chartInk(hue: number, strength: 0 | 2) {
  const m = Math.round((((hue - 2.4 * strength) % 360) + 360) % 360 / 12) % 30;
  return inksByHue[5 * m + strength].color;
}

/**
 * A ripple's rings, one ink each: from `hue` outward `step`° a ring. The burst (the struck dot and the ring round it,
 * both inked on the strike's frame) is bright; past it, light and bright rings take turns so each reads.
 */
const hueRings = (hue: number, step: number) => (k: number) => chartInk(hue + step * k, k > 1 && k % 2 === 0 ? 2 : 0);

type Strike = { frame: number; x: number; y: number; ring: (k: number) => string };

// Centre, left, right, centre again, on the middle rows: the body rises to the upper right from each, and the
// middle rows keep it under the HUD's top row at the top of every lift, and the tip above the type. The ripples take
// the wheel in order: the brand's red-orange (36°) out to amber, green out to teal, blue out to violet and magenta.
// The first steps finer because the chart's yellows (past 90°) are olive at its strengths; the second, so the teal it
// leaves under the third strike stands apart from that strike's blue.
const STRIKES: readonly Strike[] = [
  { frame: HITS[0], ...INK_FIRST_STRIKE, ring: hueRings(36, 5) },
  { frame: HITS[1], ...inkFieldSlotAt(3, 5), ring: hueRings(132, 6) },
  { frame: HITS[2], ...inkFieldSlotAt(11, 5), ring: hueRings(252, 8) },
  { frame: HITS[3], ...inkFieldSlotAt(8, 4), ring: () => '' },
];
const LAST = STRIKES.length - 1;
const cellOf = (s: Strike) => INK_FIELD_SLOTS.findIndex((c) => c.x === s.x && c.y === s.y);
/** The ink strike `i` lands: its ripple's first ring, and the last one's the struck cell's own. */
const strikeInk = (i: number) => (i === LAST ? INK_FIELD.items[cellOf(STRIKES[i])].color : STRIKES[i].ring(0));

// three.js reads hex and rgb(), not oklch().
const rgbOf = (css: string) => {
  const [r, g, b] = parseGlyphColor(css);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
};
const NEEDLE_STRIKES: NeedleStrike[] = STRIKES.map((s, i) => ({ at: sec(s.frame), x: s.x, y: s.y, ink: rgbOf(strikeInk(i)) }));

/**
 * The piece's rig (standing up to 58° out of the picture plane as it lifts on each "and" till its image is 25% bigger,
 * swung down to 46° in a two-frame fall) gripped lower, 20° above the horizontal, and at 18 px a mm: any
 * steeper or bigger and the top of a lift over row 4 reaches the HUD's top row. It leaves to the right, level, four
 * frames after the last strike, gone by 261. Its shadow falls down and right of it, further the higher it lifts, and
 * races back under the tip on each fall.
 */
const NEEDLE_SHOT = { grip: 20, scale: 18, from: 0, exit: 4 / FPS, samples: 16, shadow: 0.3 };

// ---------- the field ----------

// Unlit, each cell is a small dim dot: the matrix reads on black before any ink reaches it.
const DIM = { L: 0.3, w: 0.3, r: 0.15, fill: '#222228' };

/**
 * How a cell rings as a front passes: up to 1 + amp in `peak` s, then a damped cosine, tapered to exactly 1 at `end`.
 * The size crests travel outward with the front, so the field ripples as a liquid does.
 */
function ringingScale({ amp, peak, period, decay, end }: { amp: number; peak: number; period: number; decay: number; end: number }): GlyphKey<number, Ink>[] {
  const keys: GlyphKey<number, Ink>[] = [{ at: peak, value: 1 + amp, ease: outQuad }];
  for (let at = peak + 1 / 60; at < end - 1e-9; at += 1 / 60) {
    const u = at - peak, taper = 1 - motionCurves.dissolve((at - (end - 0.1)) / 0.1);
    keys.push({ at, value: 1 + amp * Math.exp(-u / decay) * Math.cos((2 * Math.PI * u) / period) * taper });
  }
  keys.push({ at: end, value: 1 });
  return keys;
}

/** A front's clip: the cell takes its new ink at full strength, grows to an ink dot in a frame and rings down. */
function splash(ink: (cell: InkCell, hit: GlyphHit) => string, scale: GlyphKey<number, Ink>[]): GlyphClip<Ink> {
  return { fill: [{ at: 0, value: ink }], shape: [{ at: 1 / FPS, value: INK_DOT }], scale };
}

// The middle ripples run 27 pitches a second, the reference's reveal; the last runs 45 and rings tighter, so the cell
// farthest from its strike (9.9 pitches) has landed on its own ink by 264, a frame before the hand-over. Each front
// leaves the needle already `burst` pitches out, so the struck dot and its neighbours are inked on the strike's own
// frame, as the reference's newborn dots are red on theirs.
const RIPPLE = { speed: 27, burst: 1.5, scale: ringingScale({ amp: 0.5, peak: 1 / FPS, period: 0.2, decay: 0.14, end: 0.5 }) };
const RESOLVE = { speed: 45, burst: 1.5, scale: ringingScale({ amp: 0.4, peak: 1 / FPS, period: 0.14, decay: 0.06, end: 0.2 }) };
// The first strike opens the bar out of bar 3's dive, so it bursts: 4.2 pitches of dots inked on 206, swelling to
// twice their size so the middle runs together as one splash about 750 px across, and a front at 72 pitches a second
// that has reached the farthest cell (10.8 pitches) by 209.
const OPEN = { speed: 72, burst: 4.2, scale: ringingScale({ amp: 1, peak: 1 / FPS, period: 0.2, decay: 0.14, end: 0.5 }) };

const WAVES: GlyphWave<Ink>[] = STRIKES.map((s, i) => {
  const { speed, burst, scale } = i === 0 ? OPEN : i === LAST ? RESOLVE : RIPPLE;
  const ink = i === LAST ? (cell: InkCell) => cell.item.color : (_: InkCell, hit: GlyphHit) => s.ring(Math.round(hit.distance));
  return { start: sec(s.frame) - burst / speed, front: { from: s }, speed, clip: splash(ink, scale) };
});

// Each strike's shock ring leaves a little ahead of the contact, so on the strike's frame it already circles the tip
// rather than covering the struck dot. It's in the strike's ink, so as it fades it darkens toward the ink, not grey.
const SHOCK = { speed: 3000, lead: 0.02, opacity: [0.9, 0.7] };

// The struck dot squashes 1.5:1 under the tip on the contact frame, then springs back tall and round over the next
// two, sized as the ripple rings it. A field glyph is two crossed bars and can't draw an oval, so for those frames
// the field hides the dot and an ellipse stands in for it.
const SQUASH = { ratio: [1.5, 1 / 1.2, 1.06], size: [1.35, 1, 0.85] };
const SQUASH_WAVES: GlyphWave<Ink>[] = STRIKES.map((s) => {
  const back = (SQUASH.ratio.length - 0.5) / FPS;
  return {
    start: sec(s.frame), front: { delay: () => 0 }, where: (cell) => cell.index === cellOf(s),
    clip: { opacity: [{ at: 0, value: 0 }, { at: back, value: 0 }, { at: back + 1e-3, value: 1 }] },
  };
});

function StruckDots({ f }: { f: number }) {
  const r = (INK_DOT.L * INK_FIELD_LAYOUT.pitch) / 2;
  return (
    <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
      {STRIKES.map((s, i) => {
        const k = f - s.frame;
        if (k < 0 || k >= SQUASH.ratio.length) return null;
        const size = r * SQUASH.size[k], a = Math.sqrt(SQUASH.ratio[k]);
        return <ellipse key={i} {...motionAttrs({ name: `struck dot ${i + 1}`, values: { ratio: SQUASH.ratio[k] } })} cx={s.x} cy={s.y} rx={size * a} ry={size / a} fill={strikeInk(i)} />;
      })}
    </svg>
  );
}

// ---------- the punch ----------

// Each strike punches 3% about its own point, falling as the reference's punch does (τ 0.11 s) and cut to exactly
// nothing 14 frames on, so the last one has let go by the hand-over frame. The first punches 5%, so on the cut the
// outer columns jump 30-45 px, as 221's do.
const PUNCH = { amount: 0.03, first: 0.05, tau: 0.11, frames: 14 };
function punchAt(frame: number, f: number, amount = PUNCH.amount) {
  const k = f - frame;
  if (k < 0 || k >= PUNCH.frames) return 0;
  const tail = Math.exp(-PUNCH.frames / FPS / PUNCH.tau);
  return (amount * (Math.exp(-k / FPS / PUNCH.tau) - tail)) / (1 - tail);
}

// As the needle falls the field draws in toward the point, as skin dimples under a needle, so the punch springs it
// out from under the tip: half of `amount` on the fall's first frame, all of it on the next.
const DIMPLE = { amount: 0.015, frames: 2 };
function dimpleAt(frame: number, f: number) {
  const before = frame - f;
  return before > 0 && before <= DIMPLE.frames ? (-DIMPLE.amount * (DIMPLE.frames + 1 - before)) / DIMPLE.frames : 0;
}

/**
 * The field's transform at `f`: each strike's dimple and punch scale it about the strike's point, so the struck dot
 * stays under the tip.
 */
function fieldTransform(f: number) {
  let s = 1, tx = 0, ty = 0;
  for (const strike of STRIKES) {
    const a = dimpleAt(strike.frame, f) + punchAt(strike.frame, f, strike === STRIKES[0] ? PUNCH.first : PUNCH.amount);
    if (!a) continue;
    s *= 1 + a;
    tx = (1 + a) * tx - a * strike.x;
    ty = (1 + a) * ty - a * strike.y;
  }
  return `translate(${tx}px, ${ty}px) scale(${s})`;
}

// ---------- the type ----------

// One line, 174 INKS., across the foot of the frame under the strikes: the count as INK_COUNT sets it, INKS. at the
// same size a word space after it. Bar 5 opens on the count standing exactly there, so on 265 it must be where it
// landed, untransformed but for the push into the cut (CUT_PUSH).
const AXES = { wght: INK_COUNT.weight, wdth: INK_COUNT.wdth };
const WORD = (() => {
  const text = 'INKS.';
  const line = layoutGlyphLine([...text].map((char) => ({ char, axes: AXES, tracking: INK_COUNT.tracking })), INK_COUNT.size);
  const left = INK_COUNT.left + 3 * INK_COUNT.cell + archivoAdvance(' ', AXES) * INK_COUNT.size;
  return { text, x: line.x.map((x) => left + x), left, right: left + line.width };
})();
const LINE_CENTRE = (INK_COUNT.left + WORD.right) / 2;

// The count answers the strikes rather than running beside them: over the four frames after each of the first two it
// ticks up a third of the chart, easing in, and holds between; on the third it is set on 174 in the frame INKS. lands.
// Each frame shows one whole figure, never a wheel caught between two, so every digit is sharp.
const COUNT = { steps: [58, 116, 174], ticks: 4 };
function countAt(f: number) {
  const [a, b, all] = COUNT.steps;
  if (f >= HITS[2]) return all;
  const tick = (hit: number, from: number, to: number) => from + Math.round((to - from) * outCubic(clamp((f - hit) / COUNT.ticks)));
  return f >= HITS[1] ? tick(HITS[1], a, b) : tick(HITS[0], 0, a);
}

// INKS. slams on 236: it comes at the lens over two frames, faster and faster, and stops dead on the hit with a
// squash, as the count locks and the lens splits. It grows from its own left end on the baseline, so it never crosses
// the count, and stretched along its travel: 1.24× wide is as far as its S can reach and stay in frame, and 1.08×
// tall keeps its top under the third strike's dot. Half a frame's shutter smears it in; the landed frame is sharp.
const SLAM = { frames: 2, from: { x: 1.24, y: 1.08 }, power: 1.6, squash: 0.07, exposures: 12, shutter: 0.5 };
const slamLeft = (f: number) => 1 - clamp((f - (HITS[2] - SLAM.frames)) / SLAM.frames) ** SLAM.power;

// Once down, INKS. keeps opening out to the cut, each gap between its letters widening at a steady 0.6 px a frame.
// The count beside it stays put for bar 5.
const DRIFT = { gap: 18 };

function InksWord({ f }: { f: number }) {
  if (f < HITS[2] - SLAM.frames) return null;
  const landed = f >= HITS[2];
  const k = f - HITS[2];
  const squash = landed ? SLAM.squash * Math.exp(-k / 1.1) * Math.cos(1.9 * k) : 0;
  const spread = DRIFT.gap * seg(f, HITS[2], TO, motionCurves.linear);
  // Exposures across the open shutter, added so they average. The first frame's reach back before the word's start,
  // where it holds at its widest, so it arrives whole rather than as one exposure's share of itself.
  const exposures = landed ? [f] : Array.from({ length: SLAM.exposures }, (_, j) => f - SLAM.shutter * (1 - (j + 1) / SLAM.exposures));
  const weight = landed ? 1 : 1 / SLAM.exposures;
  const face = { fontFamily: DISPLAY_FONT, fontSize: INK_COUNT.size, fontWeight: INK_COUNT.weight, fontStretch: `${INK_COUNT.wdth}%` };
  return (
    <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', isolation: 'isolate' }}
      {...motionAttrs({ name: 'inks', values: { scale: landed ? 1 : 1 + (SLAM.from.x - 1) * slamLeft(f) } })}>
      {exposures.map((e) => {
        const left = landed ? 0 : slamLeft(e);
        const sx = (1 + (SLAM.from.x - 1) * left) * (1 + 0.6 * squash), sy = (1 + (SLAM.from.y - 1) * left) * (1 - squash);
        const transform = `translate(${WORD.left} ${INK_COUNT.base}) scale(${sx} ${sy}) translate(${-WORD.left} ${-INK_COUNT.base})`;
        return (
          <g key={e} transform={transform} opacity={weight} style={{ mixBlendMode: 'plus-lighter' }}>
            {[...WORD.text].map((char, i) => <text key={i} x={WORD.x[i] + i * spread} y={INK_COUNT.base} fill={P.cream} style={face}>{char}</text>)}
          </g>
        );
      })}
    </svg>
  );
}

// The line punches with each strike, about its middle on the baseline; the last punch has let go by 265.
function typeTransform(f: number) {
  const punch = STRIKES.reduce((sum, s) => sum + punchAt(s.frame, f, 0.045), 0);
  return { transformOrigin: `${LINE_CENTRE}px ${INK_COUNT.base}px`, transform: `scale(${1 + punch})` };
}

// ---------- the bar ----------

// Over the last four frames the camera pushes in 2% about the frame's middle, easing in, and bar 5's 2.5% punch on
// 266 lands the push: the field and count move into the cut rather than holding.
const CUT_PUSH = { frames: 4, amount: 0.02, power: 1.5 };
const cutPushAt = (f: number) => 1 + CUT_PUSH.amount * clamp((f - (TO - 1 - CUT_PUSH.frames)) / CUT_PUSH.frames) ** CUT_PUSH.power;

function InkBar({ f }: { f: number }) {
  const t = sec(f);
  const shown = countAt(f);
  // A ripple joins on its strike's frame: its front leaves `BURST` pitches early, so it would ink the struck dot
  // under the plunging needle a frame before the needle lands.
  const waves = [...WAVES.filter((_, i) => f >= STRIKES[i].frame), ...SQUASH_WAVES];
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: P.ground }} />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${cutPushAt(f)})` }}>
      <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: fieldTransform(f) }}>
        <GlyphField t={t} {...INK_FIELD} rest={DIM} waves={waves} shutter={0} motion="ink field" />
        <StruckDots f={f} />
      </div>
      {STRIKES.map((s, i) => (
        <ShockRing key={i} t={t} at={sec(s.frame) - SHOCK.lead} origin={s} speed={SHOCK.speed} opacity={SHOCK.opacity[i === 0 ? 0 : 1]}
          color={NEEDLE_STRIKES[i].ink} motion={`ring ${i + 1}`} />
      ))}
      <div style={{ position: 'absolute', inset: 0, ...typeTransform(f) }}>
        {/* The frame's figure as a constant, which the Odometer draws at rest. Handed the stepped count, it would draw
            each tick halfway through its step from the frame before. */}
        <Odometer t={t} value={() => shown} x={INK_COUNT.left} y={INK_COUNT.base} size={INK_COUNT.size} color={P.cream} weight={INK_COUNT.weight}
          stretch={INK_COUNT.wdth} tracking={INK_COUNT.tracking} motion="count" />
        <InksWord f={f} />
      </div>
      <Needle t={t} strikes={NEEDLE_STRIKES} {...NEEDLE_SHOT} ground={P.ground} motion="needle" />
      </div>
    </>
  );
}

export const inkBar: Bar = {
  id: 'ink',
  note: 'The signature: a tattoo needle strikes the dark ink field on each beat, and every strike ripples ink through it, one ink per ring, as the count answers each strike and locks on 174 as INKS. slams; the last ripple lands every cell on its own ink.',
  from: FROM, to: TO,
  render: (f) => <InkBar f={f} />,
  // INKS.'s slam: the lens kicks and splits with it.
  kicks: [HITS[2]],
  glitches: [HITS[2]],
  // A take per strike, so four in a row don't repeat. Each buzz whispers in a tenth of a second early, 14 dB under,
  // so the track's gap before the downbeat stays open, and bites on the contact.
  sounds: STRIKES.map((s, i) => ({ at: s.frame, sound: [needle206, needle221, needle236, needle251][i] })),
};
