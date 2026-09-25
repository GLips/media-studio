// Bar 1, 01 — SQUASH & STRETCH, and the pickup: the product's name, THE NEW BUY BOX., a word a beat, wall to wall on
// the ground line, the reel's red ink drop bouncing across it. THE stands on frame 0 and the pickup's landing (beat
// −1) presses it. Each of the bar's landings sends a shock along the line that stamps the next word down over the last
// and punches the last through: NEW, BUY and BOX on beats 0–2. The fourth, on beat 3, lands on the pad after BOX as
// its full stop, crouches, launches and swells until its red covers the bar's last frame, bar 2's ground. The reel
// ends on ONE BOX. and the same red dot.

import {
  DISPLAY_FONT, FPS, H, REEL_SHUTTER, W, motionAttrs, motionCurves, seededRandom, shutterTravel, smearSigma,
} from '../../../lib/studio/api.ts';
import { BounceBall, bouncingBallAt, type BounceParams } from '../../../lib/studio/reel/bounce.tsx';
import { ARCHIVO_CAP_EM, layoutGlyphLine } from '#models/reel/ticker-layout.ts';
import type { Bar, ShowcaseClock } from '../bar.ts';
import { P } from '../look.ts';

export function bounceBar(clock: ShowcaseClock<'bounce'>): Bar {
  const outExpo = motionCurves.expo.entrance;

  const FROM = clock.from;
  const TO = clock.to;

  // ---------- the layout ----------

  /** The words' box: every word spans it, BOX with its full stop (the drop at rest on the pad), 85% of the frame. */
  const SPAN = { left: 90, right: W - 90 };
  const GROUND_Y = 930;
  const CAP = 560;

  // ---------- the drop ----------

  // Landings on the pickup's hit and the bar's four beats; with no drop the loop runs back a beat, so on frame 0 the
  // drop is 4 frames up out of a landing on beat −2 (frame −4), at the left edge. The last is the pad.
  const LANDING_BEATS = [-1, 0, 1, 2, 3];
  const BALL_SIZE = 340;
  const BALL_STEP = 280;
  /** The pad: BOX's full stop, as far right as its crouch (4.2:1, 697 px across as it leaves) stays inside the frame. */
  const PAD_X = 1555;
  const BALL: BounceParams = {
    beats: LANDING_BEATS.map((n) => clock.beat(n) / FPS), spb: clock.spb, drop: false,
    size: BALL_SIZE, height: 440, groundY: GROUND_Y, step: BALL_STEP, x: PAD_X - (LANDING_BEATS.length - 1) * BALL_STEP,
    launch: {
      // Frame 85 is the last of the bar: the swell covers it exactly there, not the 0.2 ms before that spb's rounding gives.
      fill: (TO - 1) / FPS,
      // Deeper than the piece's crouch (3.9:1, 0.139 × size), so the press reads as loading the spring at speed: from
      // the landing's 3.4:1 it spreads about 13 px and sinks about 7 px a frame until it leaves. A deeper dent would sink
      // its bottom into the HUD's bottom row.
      anticipation: { squash: 4.2, dent: 0.16 * BALL_SIZE },
    },
  };
  /** Where the drop lands on beat `n` (beat −2's is the loop's, before the video): it holds still through a landing. */
  const landingX = (n: number) => bouncingBallAt(clock.beat(n) / FPS, BALL).x;

  // The line is the words' floor, as wide as they are; drawn a second before the video starts, so frame 0 has it whole
  // and only the dent from the landing on beat −2 still ringing in it.
  const LINE = { from: SPAN.left, to: SPAN.right };
  const LINE_IN = -1;

  // ---------- the dot lattice ----------

  // The reference's ground: a 40 px lattice centred on the frame, each dot 2 px, luma 12–27 on the 12 of the ground,
  // switching on at random over the pickup and the bar's first beat.
  const LATTICE_PITCH = 40;
  const LATTICE_REVEAL = { from: -3, to: 34 };
  const LATTICE = (() => {
    const rnd = seededRandom('bar-01 lattice');
    const dots: { x: number; y: number; on: number; luma: number }[] = [];
    for (let y = LATTICE_PITCH; y < H; y += LATTICE_PITCH) {
      for (let x = LATTICE_PITCH; x < W; x += LATTICE_PITCH) {
        dots.push({ x, y, on: LATTICE_REVEAL.from + rnd() * (LATTICE_REVEAL.to - LATTICE_REVEAL.from), luma: 12 + Math.floor(rnd() * 16) });
      }
    }
    return dots;
  })();

  /** The lattice at frame `f`: one path per luma level, so 1,200 dots cost 16 nodes. */
  function Lattice({ f }: { f: number }) {
    const levels = new Map<number, string[]>();
    for (const d of LATTICE) {
      if (f < d.on) continue;
      const level = levels.get(d.luma) ?? [];
      level.push(`M${d.x - 1} ${d.y - 1}h2v2h-2z`);
      levels.set(d.luma, level);
    }
    return (
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {[...levels].map(([luma, dots]) => <path key={luma} d={dots.join('')} fill={`rgb(${luma},${luma},${luma + 2})`} />)}
      </svg>
    );
  }

  // ---------- the words ----------

  // Each word Archivo Black at one cap height, its width axis solved so it spans the box; BOX leaves room for the drop.
  type Word = { text: string; beat: number };
  const WORDS: readonly Word[] = [
    { text: 'THE', beat: -2 }, { text: 'NEW', beat: 0 }, { text: 'BUY', beat: 1 }, { text: 'BOX', beat: 2 },
  ];
  const TYPE = {
    spacing: -0.02,
    /** The full stop's gap after the X, as a share of the cap. */
    stopGap: 0.05,
    /**
     * How fast a landing's shock runs out along the line (px/s): the letter nearest the landing moves a frame before
     * the hit, the far end of the word a frame or so after it.
     */
    push: 20000,
    /** As the shock passes, a letter stamps down onto its place from `caps` above, on out-expo over `seconds`. */
    stamp: { caps: 0.4, seconds: 0.3 },
    /**
     * The letter it replaces is punched down through the line on out-expo, much faster: gone a frame and a half later,
     * so the new word stands clear on its hit.
     */
    sink: { caps: 1.1, seconds: 0.12 },
    /** The ground drawn round each letter, as a share of the cap, so the word going down reads behind it. */
    halo: 0.03,
  };
  const TYPE_SIZE = CAP / ARCHIVO_CAP_EM;

  const layoutText = (text: string, wdth: number) =>
    layoutGlyphLine([...text].map((char) => ({ char, axes: { wght: 900, wdth }, tracking: TYPE.spacing })), TYPE_SIZE);
  /** The width axis that sets `text` `width` px wide at the reel's cap. */
  function widthAxisFor(text: string, width: number) {
    let lo = 62, hi = 125;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (layoutText(text, mid).width < width) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  const WORD_SETS = WORDS.map((word, n) => {
    const last = n === WORDS.length - 1;
    const right = last ? PAD_X - BALL_SIZE / 2 - TYPE.stopGap * CAP : SPAN.right;
    const wdth = widthAxisFor(word.text, right - SPAN.left);
    const line = layoutText(word.text, wdth);
    const xs = line.x.map((x) => SPAN.left + x);
    return { ...word, n, wdth, xs, mids: xs.map((x, i) => x + line.advance[i] / 2) };
  });

  /** When the shock from the landing on `beat` reaches `mid`: its word's nearest letter a frame early, half down on the hit. */
  function shockAt(beat: number) {
    const x = landingX(beat), next = WORD_SETS.find((set) => set.beat === beat)!;
    const nearest = Math.min(...next.mids.map((m) => Math.abs(m - x)));
    return (mid: number) => (clock.beat(beat) - 1 + 0.05) / FPS + (Math.abs(mid - x) - nearest) / TYPE.push;
  }

  type Letter = { char: string; x: number; mid: number; word: number; at: number; out: number };
  const LETTERS: Letter[] = WORD_SETS.flatMap((set) => {
    const arrive = shockAt(set.beat);
    const leave = set.n + 1 < WORD_SETS.length ? shockAt(WORD_SETS[set.n + 1].beat) : () => Infinity;
    return [...set.text].map((char, i) => ({
      char, x: set.xs[i], mid: set.mids[i], word: set.n, at: arrive(set.mids[i]), out: leave(set.mids[i]),
    }));
  });

  // A later landing presses the letters into the line, most under it: down to a peak a frame and a half after its hit
  // and back with no overshoot, as the reference's type never overshoots. The pickup's presses THE; the pad's, BOX.
  const PRESS = { depth: 26, reach: 0.89 * BALL_SIZE, peak: 1.5 / FPS };
  const PRESSES = LANDING_BEATS.map((beat) => ({ beat, t: clock.beat(beat) / FPS, x: landingX(beat) }));
  function pressAt(t: number, l: Letter) {
    let y = 0;
    for (const p of PRESSES) {
      const k = (t - p.t) / PRESS.peak;
      if (p.beat <= WORDS[l.word].beat || k <= 0) continue;
      y += PRESS.depth * Math.exp(-((l.mid - p.x) ** 2) / (2 * PRESS.reach ** 2)) * k * Math.exp(1 - k);
    }
    return y;
  }
  /** A letter's baseline: stamped down onto the line, pressed by later landings, then punched under it by the next word. */
  const letterY = (t: number, l: Letter) =>
    GROUND_Y + pressAt(t, l)
    - TYPE.stamp.caps * CAP * (1 - outExpo((t - l.at) / TYPE.stamp.seconds))
    + (t < l.out ? 0 : TYPE.sink.caps * CAP * outExpo((t - l.out) / TYPE.sink.seconds));
  const letterSmear = (t: number, l: Letter) => smearSigma(shutterTravel((tt) => letterY(tt, l), t, REEL_SHUTTER, l.at));

  function Words({ f }: { f: number }) {
    const t = f / FPS;
    const shown = LETTERS
      .map((l) => ({ ...l, y: letterY(t, l), id: `${l.word}-${Math.round(l.x)}` }))
      .filter((l) => t >= l.at && l.y - CAP < GROUND_Y)
      .map((l) => ({ ...l, sigma: letterSmear(t, l) }));
    const glyph = (l: (typeof shown)[number], tagged: boolean) => (
      <text
        key={l.id} x={l.x} y={l.y} filter={l.sigma > 0.25 ? `url(#bar01-smear-${l.id})` : undefined}
        {...(tagged ? motionAttrs({ name: `${WORDS[l.word].text} ${l.char}`, values: { y: Math.round(l.y) } }) : {})}
      >
        {l.char}
      </text>
    );
    return (
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <clipPath id="bar01-ground">
            <rect x={0} y={-H} width={W} height={H + GROUND_Y} />
          </clipPath>
          {shown.map((l) => l.sigma > 0.25 && (
            <filter key={l.id} id={`bar01-smear-${l.id}`} x="-10%" y="-40%" width="120%" height="180%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={`0 ${l.sigma.toFixed(2)}`} />
            </filter>
          ))}
        </defs>
        <g clipPath="url(#bar01-ground)">
          {WORD_SETS.map((set) => {
            const letters = shown.filter((l) => l.word === set.n);
            return letters.length > 0 && (
              <g key={set.text} style={{ fontFamily: DISPLAY_FONT, fontSize: TYPE_SIZE, fontWeight: 900, fontStretch: `${set.wdth}%` }}>
                {/* Words draw oldest first, each over a halo of ground that cuts it clear of the one it replaces. */}
                <g fill={P.ground} stroke={P.ground} strokeWidth={2 * TYPE.halo * CAP} strokeLinejoin="round">
                  {letters.map((l) => glyph(l, false))}
                </g>
                <g fill={P.cream}>{letters.map((l) => glyph(l, true))}</g>
              </g>
            );
          })}
        </g>
      </svg>
    );
  }

  // ---------- the bar ----------

  return {
    id: 'bounce',
    note: 'THE NEW BUY BOX., a word a beat wall to wall on the ground line, the red drop bouncing across it: each landing\'s shock stamps the next word down over the last and punches the last through the line; the fourth lands as BOX\'s full stop, crouches, launches and swells into a full red frame by 85.',
    clock,
    render: (f) => {
      const drop = { t: f / FPS, ...BALL, background: null, line: LINE, inAt: LINE_IN, shutter: 0.25, seed: 'bar-01' };
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: P.ground }} />
          <Lattice f={f} />
          <Words f={f} />
          {/* The drop's lines and marks cross the words: in difference they read cream on the ground, dark on a letter. */}
          <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'difference' }}>
            <BounceBall {...drop} color="transparent" ink={P.cream} motion={false} />
          </div>
          <BounceBall {...drop} color={P.red} ink="transparent" />
        </>
      );
    },
    // Paper inks throughout: the words stand between the HUD's rows, so its parts sit on the ground or the swell's red,
    // and paper reads on both. The drop is bar 1's only red, so the lit beat square is paper too. No cuts or glitches:
    // one shot, and a red/blue split would put blue in it.
    hudRead: (slot) => ({ tone: slot === 'beats' ? 'on-accent' : 'light' }),
  };
}
