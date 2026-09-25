// Bar 4, 04 — INK × 174: the piece's signature. A tattoo needle running off the frame strikes the dark ink field in
// one blow, smeared in from off frame, sharp on contact and snapped back out, knocking the camera as the field
// ripples. The first strike, on bar 3's ".00", gets two beats to land: its splash rolls across the field as the count
// rolls up to 58, and rebounds on the next beat. From the music's downbeat a beat each: the second strike, the third
// (174), INKS. slamming beside the count, and the fourth. The ripples run the colour wheel from the brand's red-orange
// to magenta; the last lands every cell on its own ink, the field bar 5 opens on.

import { DISPLAY_FONT, FPS, H, W, clamp, motionAttrs, motionCurves, powerOutEase, seg, type Point, type Rect } from '../../../lib/studio/api.ts';
import { Odometer } from '../../../lib/studio/kit.tsx';
import { GlyphField, ShockRing } from '../../../lib/studio/reel/glyph-field.tsx';
import type { GlyphClip, GlyphHit, GlyphKey, GlyphWave } from '#models/reel/glyph-field.ts';
import { parseGlyphColor } from '#models/reel/glyph-field-frame.ts';
import { reelHudBoxPoints, type ReelHudRead, type ReelHudSlot } from '#models/reel/hud.ts';
import { Needle } from '../../../lib/studio/reel/needle.tsx';
import { needleCoversAt, type NeedleStrike } from '#models/reel/needle.ts';
import { archivoAdvance, layoutGlyphLine } from '#models/reel/ticker-layout.ts';
import type { Bar, ShowcaseClock } from '../bar.ts';
import { INK_COUNT, INK_DOT, INK_FIELD, INK_FIELD_LAYOUT, INK_FIELD_SLOTS, INK_FIRST_STRIKE, inkFieldSlotAt, type InkCell } from '../ink-field.ts';
import needleStrike1 from '../sfx/needle-strike-1.ts';
import needleStrike2 from '../sfx/needle-strike-2.ts';
import needleStrike3 from '../sfx/needle-strike-3.ts';
import needleStrike4 from '../sfx/needle-strike-4.ts';
import { P, inksByHue, type Ink } from '../look.ts';

export function inkBar(clock: ShowcaseClock<'ink'>): Bar {
  const FROM = clock.from, TO = clock.to;
  // The strikes, in beats: the first, two beats of room, then the music's downbeat and a beat each, with INKS. on its own
  // beat before the last so its lens split never doubles a needle.
  const HITS = [clock.beat(0), clock.cues.strike2, clock.beat(3), clock.beat(5)];
  const INKS_AT = clock.beat(4);
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

  // Centre, left, right, centre again, on the middle rows: the body runs off the top right from each, and the tip
  // stays above the type. The ripples take the wheel in order: the brand's red-orange (36°) out to amber, green out to
  // teal, blue out to violet and magenta.
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
  // The first strike opens the bar on bar 3's cut, with no frame to come in on: its contact frame shows the way in too.
  const NEEDLE_STRIKES: NeedleStrike[] = STRIKES.map((s, i) => ({ at: sec(s.frame), x: s.x, y: s.y, ink: rgbOf(strikeInk(i)), streak: i === 0 }));

  /**
   * 32 px a mm: a barrel over 300 px across. Each blow drops in over two and a half frames, one streak on the frame
   * before the contact, drives in for a frame and tears back out, gone by the fourth after. Its gunmetal is light enough
   * for the streaks to read on the field.
   */
  const NEEDLE_SHOT = {
    tilt: 52, grip: 35, scale: 32, from: 15, climb: 42, enter: 2.5 / FPS, dwell: 1 / FPS, overdrive: 1, exit: 2.5 / FPS, lean: 8,
    samples: 16, shadow: 0.3, color: '#5a5e65', fastShutter: 0.6,
  };

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

  /** A crest catching the light: the dot's ink lifts `amount` toward white as the front reaches it, settled by `fade` s. */
  function glint(amount: number, fade: number): GlyphKey<number, Ink>[] {
    return [{ at: 1 / FPS, value: amount, ease: outQuad }, { at: fade, value: 0, ease: outQuad }];
  }

  /** A front's clip: the cell takes its new ink at full strength, grows to an ink dot in a frame and rings down. */
  function splash(ink: (cell: InkCell, hit: GlyphHit) => string, { scale, brighten }: Pick<GlyphClip<Ink>, 'scale' | 'brighten'>): GlyphClip<Ink> {
    return { fill: [{ at: 0, value: ink }], shape: [{ at: 1 / FPS, value: INK_DOT }], scale, brighten };
  }

  // The middle ripples run 27 pitches a second, the reference's reveal; the last runs 45, so the cell farthest from its
  // strike (9.9 pitches) takes its own ink over half a beat before the hand-over, catching the light as it does, and
  // rings on until SETTLE.
  const RIPPLE = { speed: 27, burst: 1.5, scale: ringingScale({ amp: 0.6, peak: 1 / FPS, period: 0.2, decay: 0.25, end: 0.5 }) };
  const RESOLVE = {
    speed: 45, burst: 1.5, scale: ringingScale({ amp: 0.6, peak: 1 / FPS, period: 0.2, decay: 0.25, end: 0.45 }), brighten: glint(0.3, 0.25),
  };
  // The first strike opens the bar, so it bursts: 4.2 pitches of dots inked on its frame, swelling to twice their size
  // into one splash 750 px across. With two beats to land, its front rolls out at the reference's reveal pace, over a
  // quarter second, and the field rings slower and longer, till the rebound.
  const OPEN = { speed: 26, burst: 4.2, scale: ringingScale({ amp: 1, peak: 1 / FPS, period: 0.3, decay: 0.4, end: 1 }) };
  // The splash rebounds on the next beat, as a drop's does: a second ring swells out from the struck dot through the
  // inked field, its crest catching the light, so the field is still rolling as the second strike comes in.
  const REBOUND = {
    frame: clock.beat(1), speed: 24,
    clip: { scale: ringingScale({ amp: 0.8, peak: 2 / FPS, period: 0.25, decay: 0.25, end: 0.6 }), brighten: glint(0.35, 0.3) },
  };

  // Each front leaves the needle already `burst` pitches out, so the struck dot and its neighbours are inked on the
  // strike's own frame, as the reference's newborn dots are red on theirs.
  const WAVES: GlyphWave<Ink>[] = STRIKES.map((s, i) => {
    const rings = i === 0 ? OPEN : i === LAST ? RESOLVE : RIPPLE;
    const ink = i === LAST ? (cell: InkCell) => cell.item.color : (_: InkCell, hit: GlyphHit) => s.ring(Math.round(hit.distance));
    return { start: sec(s.frame) - rings.burst / rings.speed, front: { from: s }, speed: rings.speed, clip: splash(ink, rings) };
  });

  // The last ripple rings into the bar's last frames, so over the last three every dot eases onto its rest size: on the
  // bar's last frame the field stands exactly as bar 5 opens on it.
  const SETTLE = { frames: 3 };
  const SETTLE_WAVE: GlyphWave<Ink> = {
    start: sec(TO - 1 - SETTLE.frames), front: { delay: () => 0 },
    clip: { scale: [{ at: SETTLE.frames / FPS, value: 1, ease: motionCurves.dissolve }] },
  };

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

  // Each strike punches 3% about its point, and each swell about its origin, falling as the reference's punch does
  // (τ 0.11 s) and cut to nothing 14 frames on, so the last has let go by the hand-over frame. The first strike punches
  // 5%, so on the cut the outer columns jump 30-45 px, as the second strike's do.
  const PUNCH = { amount: 0.03, first: 0.05, tau: 0.11, frames: 14 };
  function punchAt(frame: number, f: number, amount = PUNCH.amount) {
    const k = f - frame;
    if (k < 0 || k >= PUNCH.frames) return 0;
    const tail = Math.exp(-PUNCH.frames / FPS / PUNCH.tau);
    return (amount * (Math.exp(-k / FPS / PUNCH.tau) - tail)) / (1 - tail);
  }

  // As the needle comes in the field draws in toward the point, as skin dimples under a needle, so the punch springs it
  // out from under the tip: half of `amount` two frames before the contact, all of it on the next.
  const DIMPLE = { amount: 0.015, frames: 2 };
  function dimpleAt(frame: number, f: number) {
    const before = frame - f;
    return before > 0 && before <= DIMPLE.frames ? (-DIMPLE.amount * (DIMPLE.frames + 1 - before)) / DIMPLE.frames : 0;
  }

  /**
   * The field's transform at `f`: each strike's dimple and punch scale it about the strike's point, so the struck dot
   * stays under the tip, and each swell's punch about its origin.
   */
  function fieldTransform(f: number) {
    const punches = [
      ...STRIKES.map((s, i) => ({ ...s, a: dimpleAt(s.frame, f) + punchAt(s.frame, f, i === 0 ? PUNCH.first : PUNCH.amount) })),
      ...SWELLS.map((s) => ({ ...s.origin, a: punchAt(s.frame, f) })),
    ];
    let s = 1, tx = 0, ty = 0;
    for (const { x, y, a } of punches) {
      if (!a) continue;
      s *= 1 + a;
      tx = (1 + a) * tx - a * x;
      ty = (1 + a) * ty - a * y;
    }
    return `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  // ---------- the type ----------

  // One line, 174 INKS., across the foot of the frame under the strikes: the count as INK_COUNT sets it, INKS. at the
  // same size a word space after it. Bar 5 opens on the count standing exactly there, so on the bar's last frame it must
  // be where it landed, untransformed but for the push into the cut (CUT_PUSH).
  const AXES = { wght: INK_COUNT.weight, wdth: INK_COUNT.wdth };
  const WORD = (() => {
    const text = 'INKS.';
    const line = layoutGlyphLine([...text].map((char) => ({ char, axes: AXES, tracking: INK_COUNT.tracking })), INK_COUNT.size);
    const left = INK_COUNT.left + 3 * INK_COUNT.cell + archivoAdvance(' ', AXES) * INK_COUNT.size;
    return { text, x: line.x.map((x) => left + x), left, right: left + line.width };
  })();
  const LINE_CENTRE = (INK_COUNT.left + WORD.right) / 2;
  // INKS. lands on the field, so its slam rings the ink out from the word's middle as a strike's ripple does, with a
  // glint on the crest.
  const INKS_SPOT = { x: (WORD.left + WORD.right) / 2, y: (INK_COUNT.top + INK_COUNT.base) / 2 };
  const INKS_SWELL = { speed: RIPPLE.speed, clip: { scale: ringingScale({ amp: 0.8, peak: 1 / FPS, period: 0.2, decay: 0.18, end: 0.5 }), brighten: glint(0.3, 0.25) } };

  // The swells that carry no ink: the splash's rebound and INKS.'s landing. Each punches the field about its origin as a
  // strike does and rings its dots in the inks the strikes left; the next strike's ripple takes the ringing over.
  const SWELLS = [
    { origin: INK_FIRST_STRIKE, ...REBOUND },
    { frame: INKS_AT, origin: INKS_SPOT, ...INKS_SWELL },
  ];
  const SWELL_WAVES: GlyphWave<Ink>[] = SWELLS.map((s) => ({ start: sec(s.frame), front: { from: s.origin }, speed: s.speed, clip: s.clip }));

  // The count answers the strikes: after each of the first three it ticks up a third of the chart, easing in, and holds
  // between. The first rolls up over a beat as its splash spreads; the others tick over four frames. Each frame shows
  // one whole figure, never a wheel caught between two, so every digit is sharp.
  const COUNT = { steps: [58, 116, 174], ticks: [15, 4, 4] };
  function countAt(f: number) {
    const i = HITS.slice(0, COUNT.steps.length).findLastIndex((hit) => f >= hit);
    if (i < 0) return 0;
    const from = i === 0 ? 0 : COUNT.steps[i - 1];
    return from + Math.round((COUNT.steps[i] - from) * outCubic(clamp((f - HITS[i]) / COUNT.ticks[i])));
  }

  // INKS. slams on the beat after the count reaches 174, coming at the lens over two frames, faster and faster, and
  // stopping dead with a squash as the lens splits. It grows from its left end on the baseline, clear of the count:
  // 1.24× wide keeps its S in frame, 1.08× tall its top under the third strike's dot.
  const SLAM = { frames: 2, from: { x: 1.24, y: 1.08 }, power: 1.6, squash: 0.07, exposures: 12, shutter: 0.5 };
  const slamLeft = (f: number) => 1 - clamp((f - (INKS_AT - SLAM.frames)) / SLAM.frames) ** SLAM.power;

  // Once down, INKS. keeps opening out to the cut, each gap between its letters widening at a steady 0.6 px a frame.
  // The count beside it stays put for bar 5.
  const DRIFT = { gap: 18 };

  function InksWord({ f }: { f: number }) {
    if (f < INKS_AT - SLAM.frames) return null;
    const landed = f >= INKS_AT;
    const k = f - INKS_AT;
    const squash = landed ? SLAM.squash * Math.exp(-k / 1.1) * Math.cos(1.9 * k) : 0;
    const spread = DRIFT.gap * seg(f, INKS_AT, TO, motionCurves.linear);
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

  // The line punches with each strike and with the rebound, about its middle on the baseline; the last punch has let go
  // by the bar's last frame.
  function typeTransform(f: number) {
    const punch = [...STRIKES.map((s) => s.frame), REBOUND.frame].reduce((sum, frame) => sum + punchAt(frame, f, 0.045), 0);
    return { transformOrigin: `${LINE_CENTRE}px ${INK_COUNT.base}px`, transform: `scale(${1 + punch})` };
  }

  // ---------- the bar ----------

  // Over the last four frames the camera pushes in 2% about the frame's middle, easing in, and bar 5's 2.5% punch on
  // its first frame lands the push: the field and count move into the cut rather than holding.
  const CUT_PUSH = { frames: 4, amount: 0.02, power: 1.5 };
  const cutPushAt = (f: number) => 1 + CUT_PUSH.amount * clamp((f - (TO - 1 - CUT_PUSH.frames)) / CUT_PUSH.frames) ** CUT_PUSH.power;

  // Each blow knocks the camera left, the way the needle comes in, a frame after the contact (so the first contact stays
  // on bar 3's point), then it springs back, gone 14 frames on: between strikes the field never stands still. Level, as
  // a drop would push the first strike's swollen bottom row onto the HUD's beat squares.
  const RECOIL = { px: 38, period: 12, decay: 7, frames: 14 };
  function recoilAt(f: number): Point {
    let d = 0;
    for (const s of STRIKES) {
      const k = f - s.frame - 1, end = RECOIL.frames - 1;
      if (k >= 0 && k < end) d += RECOIL.px * Math.exp(-k / RECOIL.decay) * Math.cos((2 * Math.PI * k) / RECOIL.period) * (1 - k / end);
    }
    return { x: -d, y: 0 };
  }

  // The HUD reads light over the field. Where the needle stands sharp under a part (the barrel runs off past the top
  // right's readout on three strikes), that part sits on a plate of the field's ground: one look on every strike, where
  // the barrel's grey would want dark ink over half the box and light over the rest.
  function inkHudRead(_slot: ReelHudSlot, f: number, box: Rect): ReelHudRead {
    const shift = recoilAt(f);
    const onNeedle = reelHudBoxPoints(box).some((p) => needleCoversAt(NEEDLE_STRIKES, sec(f), { x: p.x - shift.x, y: p.y - shift.y }, NEEDLE_SHOT));
    return onNeedle ? { tone: 'light', plate: P.ground } : { tone: 'light' };
  }

  function InkBar({ f }: { f: number }) {
    const t = sec(f);
    const shown = countAt(f);
    // A ripple joins on its strike's frame: its front leaves `BURST` pitches early, so it would ink the struck dot
    // under the plunging needle a frame before the needle lands.
    const waves = [...WAVES.filter((_, i) => f >= STRIKES[i].frame), ...SWELL_WAVES, ...SQUASH_WAVES, SETTLE_WAVE];
    const recoil = recoilAt(f);
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: P.ground }} />
        <div style={{ position: 'absolute', inset: 0, transform: `scale(${cutPushAt(f)})` }}>
          <div style={{ position: 'absolute', inset: 0, transform: `translate(${recoil.x}px, ${recoil.y}px)` }}>
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
          </div>
          <Needle t={t} strikes={NEEDLE_STRIKES} {...NEEDLE_SHOT} ground={P.ground} shift={recoil} motion="needle" />
        </div>
      </>
    );
  }

  return {
    id: 'ink',
    note: 'The signature: a tattoo needle strikes the dark ink field, the first strike with two beats to land and rebound, the rest a beat apart; every strike ripples ink through it, one ink per ring, as the count answers each strike and locks on 174 as INKS. slams; the last ripple lands every cell on its own ink.',
    clock,
    render: (f) => <InkBar f={f} />,
    hudRead: inkHudRead,
    // INKS.'s slam: the lens kicks and splits with it.
    kicks: [INKS_AT],
    glitches: [INKS_AT],
    // A take per strike, so four in a row don't repeat. Each buzz whispers in a tenth of a second early, 14 dB under,
    // so the track's gap before the downbeat stays open, and bites on the contact.
    sounds: STRIKES.map((s, i) => ({ id: `needle-strike-${i + 1}`, at: s.frame, sound: [needleStrike1, needleStrike2, needleStrike3, needleStrike4][i] })),
  };
}
