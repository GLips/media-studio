// Bar 6, 06 — TYPE AS TEXTURE: the reference reel's ticker bands (its bar 5) as the ad's BUY MORE, tilted. Seven
// bands breathe and drift, neighbours opposite ways; the hero band's QTY rolls 1 → 2 → 3 → 5, landing on the beats.
// The bands slam in all blue over bar 5's blue, then colour runs out from the hero a band a beat, blue, then cream,
// then red, so bar 5's blue hands back to red, all red on QTY 5. On the last beat the camera pushes into QTY 5,
// rolling level with it, as the bands fly off and the hero closes onto its word: a display-size QTY 5 on red, still
// closing in on the cut to bar 7's black. The HUD's rows ride on two lanes of flat ground laid across the field.

import { FPS, H, ShutterBlur, W, clamp, motionCurves, seg } from '../../../lib/studio/api.ts';
import { reelHudBoxes, type ReelHudTone } from '../../../lib/studio/reel/hud.tsx';
import { TickerBands, tickerLookBeat, type TickerColors, type TickerEnter, type TickerLook } from '../../../lib/studio/reel/ticker.tsx';
import type { Bar } from '../bar.ts';
import { SHOWCASE_HUD } from '../reel.tsx';
import tapQty2 from '../sfx/tap-qty-2.ts';
import whipIntoBuyMore from '../sfx/whip-into-buy-more.ts';
import { P } from '../look.ts';
import { timeline } from '../timeline.ts';

const clock = timeline.bar('buy-more');
const FROM = clock.from, TO = clock.to;
/** The bar's hits: the cut, then QTY 2, 3 and 5. */
const HITS = [clock.beat(0), clock.cues.qty2, clock.cues.qty3, clock.beat(3)];

// The piece's clock: 0 on the bar's first hit and a beat every 15 frames, so its looks flip on the hit frames.
const SPB = (HITS[1] - HITS[0]) / FPS;
const pieceT = (f: number) => (f - FROM) / FPS;

/** TickerBands' middle band of its seven. */
const HERO = 3;

// ---------- the piece's looks ----------

// The bands whip in across the cut: the reference's whip (decay 71 ms, 20 ms a band out from the hero), started 3½
// frames earlier, as if it began under bar 5's last frames. On the cut the hero's edge is 7% of the frame from home
// and the outermost bands' 17%, so they hold nine tenths of the frame, still flying, and BUY MORE reads. On the
// reference's own timing the cut opens on a smear at the right. The exit is the reference's: the bands clear 50 ms
// before the next downbeat, so the bar's last frame shows only the word.
const ENTER: TickerEnter = { decay: 0.071, stagger: 0.02, lead: 0.069 + 3.5 / FPS };

/** One look a beat: the colour wave does the stripes, beat 2 leans, beat 3 holds the hero. */
const LOOKS: readonly TickerLook[] = [
  {},
  {},
  { oblique: 11.3, light: { scaleX: 0.68, tracking: -0.045 }, bold: { tracking: -0.034 } },
  { heroHold: true },
];

/** The beat whose look shows at `t`, by the piece's own rule, so the colours flip on the frame its looks do. */
const beatAt = (t: number) => clamp(tickerLookBeat(t, SPB), 0, LOOKS.length - 1);

// ---------- the quantity ----------

// Each roll lands on its hit frame: the wheel flicks over the frames just before it, so the new digit reads a frame
// early and shows sharp on the hit. 3 → 5 turns two rows, so it starts earlier.
const ROLLS = [{ beat: 1, by: 1, frames: 3 }, { beat: 2, by: 1, frames: 3 }, { beat: 3, by: 2, frames: 5 }];
const quantityAt = (t: number) => ROLLS.reduce((q, r) => q + r.by * seg(t, r.beat * SPB - r.frames / FPS, r.beat * SPB, motionCurves.cubic.entrance), 1);

// ---------- colour ----------

/**
 * The ground, seen in the HUD's lanes and where a band is displaced: bar 5's blue, held across the cut while the
 * slam-in's type and red hero carry it (cream is only ever paper and bands), and red on the last beat, so the exit
 * clears to red.
 */
const groundAt = (t: number) => (beatAt(t) < 3 ? P.blue : P.red);

/**
 * Red owns the hero and a pair more each beat (d ≤ beat); from beat 1 the pair just outside it is cream with blue
 * type, the rest blue with cream type. The hero's `type` is its word once the band has closed.
 */
function bandColors(band: number, t: number): Partial<TickerColors> {
  const beat = beatAt(t);
  const d = Math.abs(band - HERO);
  const ground = groundAt(t);
  const hero = { hero: P.red, heroType: P.ink };
  if (d <= beat) return { ground, band: P.red, type: P.cream, dot: P.ink, ...hero };
  if (beat >= 1 && d === beat + 1) return { ground, band: P.cream, type: P.blue, dot: P.red, ...hero };
  return { ground, band: P.blue, type: P.cream, dot: P.red, ...hero };
}

// ---------- the camera ----------

// The field rises to the right, as bar 5's card does, scaled to cover the frame. From the last hit the camera pushes
// into the hero's word, about its centre, rolling level with it. The push would land two frames after the cut, so
// the last frame is still closing in on a display-size QTY 5 (cap 330 px) and the cut to black comes on motion.
const TILT = -7;
const PUSH = { from: HITS[3], to: TO + 1, scale: 3 };

/** The least scale at which a frame-sized layer turned `deg` about its centre still covers the frame. */
function coverScale(deg: number) {
  const r = (Math.abs(deg) * Math.PI) / 180;
  return Math.cos(r) + (W / H) * Math.sin(r);
}

/** The camera at frame `f`, fractional for the shutter's samples: the field's roll, and its scale about the word. */
function cameraAt(f: number) {
  const k = seg(f, PUSH.from, PUSH.to, motionCurves.cubic.standard);
  const roll = TILT * (1 - k);
  return { roll, scale: coverScale(roll) * (1 + (PUSH.scale - 1) * k) };
}

// ---------- the HUD's lanes ----------

// However the field is laid out, the HUD's level rows cross the tilted bands' letters, so each row gets a lane: flat
// ground the frame's width over the row's parts (their text and brackets) and 12 px either side, laid over the field.
// The type runs on beyond the lanes, bleeding off every edge.
const LANE_SPARE = 12;
// Hard-edged, like the bands: clipping the field short of both rows would letterbox it, framing beat 2's red in blue,
// and a fade would haze the cream and red bands into the blue.
const LANES = [...new Map(Object.values(reelHudBoxes(SHOWCASE_HUD, FROM / FPS)).map((box) => [box.y, box])).values()].map((row) => ({
  top: Math.round(row.y - LANE_SPARE), bottom: Math.round(row.y + row.h + LANE_SPARE),
}));

/** The HUD's tone over each ground: paper inks and a paper lit square, as over bar 5's blue flood and the reel's reds. */
const HUD_TONE_OVER: Record<ReturnType<typeof groundAt>, ReelHudTone> = { [P.blue]: 'on-accent', [P.red]: 'on-accent' };

// ---------- the bar ----------

export const buyMoreBar: Bar = {
  id: 'buy-more',
  note: 'BUY MORE in tilted ticker bands that slam in and breathe; the hero QTY rolls 1, 2, 3, 5 onto the beats while red takes the bands a pair a beat from the hero out; the camera pushes into QTY 5, rolling level, as the bands fly off, and QTY 5 fills the frame on red.',
  clock,
  render: (f) => {
    const t = pieceT(f);
    const bands = (
      <TickerBands
        t={t} spb={SPB} text="BUY MORE" hero="QTY" count={quantityAt} colors={bandColors} looks={LOOKS} enter={ENTER}
        seed="buy-more" motion="buy-more"
      />
    );
    // The piece smears its own motion; the shutter's samples add only the camera's, each the same frame from where
    // the camera was.
    const shot = (at: number) => {
      const { roll, scale } = cameraAt(at * FPS);
      return (
        <div style={{ position: 'absolute', inset: 0, transform: `rotate(${roll}deg) scale(${scale})`, transformOrigin: `${W / 2}px ${H / 2}px` }}>
          {bands}
        </div>
      );
    };
    // The lanes lie on the screen, outside the camera: its push and roll move the type under them. They cover the
    // field rather than mask it out, since a CSS mask re-rasterises the bands' edges and glyphs.
    return (
      <>
        <ShutterBlur t={f / FPS} shutter={0.5} samples={8} moving={f > PUSH.from && f <= PUSH.to} render={shot} />
        {LANES.map((l) => (
          <div key={l.top} style={{ position: 'absolute', left: 0, top: l.top, width: W, height: l.bottom - l.top, background: groundAt(t) }} />
        ))}
      </>
    );
  },
  // Every part sits in a lane, so what's under it is the ground at that frame.
  hudRead: (_slot, f) => ({ tone: HUD_TONE_OVER[groundAt(pieceT(f))] }),
  kicks: HITS.slice(1),
  // The bands whip in on the cut, their fastest frame. The track leaves QTY 2's beat empty, so its step taps there
  // alone, a swatch tap's kin; QTY 3 and 5 land on the track's own hits.
  sounds: [{ id: 'whip-in', at: FROM, sound: whipIntoBuyMore }, { id: 'tap-qty-2', at: HITS[1], sound: tapQty2, volume: 1.3 }],
};
