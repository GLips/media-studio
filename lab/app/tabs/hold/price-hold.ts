// price-hold.ts: the hold tab's one source of motion. `priceBoxAt` says where the price card is on a frame; the stage
// draws it there, and `holdLabTracks` measures the same frames into the MotionTracks a render would write, so the
// real `holdProblems` judges exactly what's on screen. Pure.
import { holdProblems, type HoldExpectation, type HoldSteadySpan } from '../../../../lib/hold-check.ts';
import { roundMotionValue, type MotionTracks } from '../../../../lib/motion-tracks.ts';
import { clamp, motionCurves } from '../../../../lib/studio/motion.ts';
import { FPS } from '../../../../lib/studio/frame.ts';

export type PriceHoldParams = {
  /** Seconds the card takes to slide in. */
  entrance: number;
  /** How far it shakes either way, px. */
  wobble: number;
  /** How fast it keeps creeping once it's in, px per second. */
  drift: number;
  /** When it starts fading away, seconds; the scene's length means never. */
  fadeAt: number;
  /** How opaque it gets at most, 0..1. */
  peak: number;
  /** Seconds the scene promises it holds: `expect: [{ hold: 'price', for }]`. */
  need: number;
  /** The hold's `within`: px any edge may move and still count as still. */
  within: number;
};

export const PRICE_HOLD_SECONDS = 5;
export const PRICE_HOLD_FRAMES = PRICE_HOLD_SECONDS * FPS;
/** The card mounts here, so the frames before it are frames it "isn't drawn" on. */
export const PRICE_ARRIVES_AT = 0.3;
export const PRICE_REST = { x: 960, y: 330, w: 760, h: 300 };
const SLIDE_FROM_PX = 720;
const FADE_OUT_SECONDS = 0.5;

export type PriceBox = { x: number; y: number; w: number; h: number; opacity: number };

/** The card's centre, size and opacity on frame `f`, or null before it mounts. */
export function priceBoxAt(f: number, p: PriceHoldParams): PriceBox | null {
  const t = f / FPS;
  if (t < PRICE_ARRIVES_AT) return null;
  const since = t - PRICE_ARRIVES_AT;
  const landed = motionCurves.cubic.entrance(since / p.entrance);
  // Two incommensurate sines per axis read as a hand-held shake and stay within ±wobble.
  const tau = 2 * Math.PI;
  const shakeX = p.wobble * (0.62 * Math.sin(tau * 2.3 * t) + 0.38 * Math.sin(tau * 5.9 * t + 1.3));
  const shakeY = p.wobble * (0.55 * Math.sin(tau * 1.7 * t + 0.4) + 0.45 * Math.sin(tau * 4.1 * t + 2.1));
  const creep = p.drift * Math.max(0, since - p.entrance);
  const fadeIn = motionCurves.dissolve(since / Math.min(0.4, p.entrance));
  const fadeOut = 1 - motionCurves.dissolve((t - p.fadeAt) / FADE_OUT_SECONDS);
  return {
    x: roundMotionValue(PRICE_REST.x + SLIDE_FROM_PX * (1 - landed) - creep + shakeX),
    y: roundMotionValue(PRICE_REST.y + shakeY),
    w: PRICE_REST.w,
    h: PRICE_REST.h,
    opacity: roundMotionValue(p.peak * clamp(fadeIn) * fadeOut),
  };
}

/** Every frame of the scene measured as the probe would: one track, `buy/price`, from the frame it mounts. */
export function holdLabTracks(p: PriceHoldParams): MotionTracks {
  const boxes = Array.from({ length: PRICE_HOLD_FRAMES }, (_, f) => priceBoxAt(f, p));
  const start = boxes.findIndex(Boolean);
  const drawn = boxes.slice(start) as PriceBox[];
  const col = (k: keyof PriceBox) => drawn.map((b) => b[k]);
  return {
    version: 2, fps: FPS, frames: { first: 0, last: PRICE_HOLD_FRAMES - 1 },
    tracks: [{
      id: 'buy/price', scene: 'buy', name: 'price',
      segments: [{
        start, end: PRICE_HOLD_FRAMES - 1, phase: 'solo', parent: null, attribution: 'scene',
        screen: { x: col('x'), y: col('y'), w: col('w'), h: col('h'), opacity: col('opacity') },
        local: null, values: {},
      }],
    }],
    coverage: { scenes: [{ id: 'buy', tracks: 1, unmeasured: [] }], ambiguous: [] },
    errors: [],
  };
}

export type PriceHoldVerdict = {
  /** The check's own words, or null when the hold is kept. */
  problem: string | null;
  /** The longest stretch it was steady and visible, or null if it never was. */
  steady: HoldSteadySpan | null;
};

const hold = (p: PriceHoldParams, seconds: number): HoldExpectation =>
  ({ scene: 'buy', hold: 'price', for: seconds, within: p.within, start: 0, end: PRICE_HOLD_SECONDS });

/**
 * The real check on the lab's scene, and the longest stretch it would accept. A failure carries its longest steady
 * stretch, so the stretch comes from asking for a hold over the whole scene, which the card can't keep: it mounts late.
 */
export function checkPriceHold(p: PriceHoldParams): PriceHoldVerdict {
  const motion = holdLabTracks(p), none = { crossfades: [] };
  const problem = holdProblems(motion, none, [hold(p, p.need)], 'lab').problems[0]?.problem ?? null;
  const [whole] = holdProblems(motion, none, [hold(p, PRICE_HOLD_SECONDS)], 'lab').problems;
  return { problem, steady: whole.steady };
}

const CHANNEL_WORDS: Record<string, string> = { x: 'left-right position', y: 'up-down position', width: 'width', height: 'height' };
const channel = (c: string) => CHANNEL_WORDS[c] ?? c;

/** One clause of the check's reason, reworded for someone who's never read it. */
function plainCause(clause: string): string {
  let m;
  if ((m = /^its (\w+) is moving \(([\d.]+)px in its last frame\)/.exec(clause))) return `it was still moving: its ${channel(m[1])} jumped ${m[2]}px in a single frame`;
  if ((m = /^its (\w+) drifts \(([\d.]+)px with the stretch, holds within ([\d.]+)px\)/.exec(clause))) return `it hadn't quite stopped: its ${channel(m[1])} was still inching along (${m[2]}px over that stretch, and only ${m[3]}px counts as still)`;
  if ((m = /^its (\w+) moves ([\d.]+)px \(holds within ([\d.]+)px\)/.exec(clause))) return `its ${channel(m[1])} had moved ${m[2]}px, past the ${m[3]}px that still counts as still`;
  if ((m = /^it is (\d+)% opaque/.exec(clause))) return `it was only ${m[1]}% solid, and under 95% the check treats it as not really visible`;
  if (/^it isn't drawn/.test(clause)) return 'it wasn\'t on screen yet';
  return clause;
}

/** The check's message in plain words. Leans on its phrasing, so a reworded message falls back to showing clauses raw. */
export function explainPriceHold(v: PriceHoldVerdict, need: number): string {
  const s = (n: number) => `${+n.toFixed(2)}s`;
  if (!v.problem) {
    const len = v.steady ? v.steady.to - v.steady.from : need;
    return `It sat still and fully visible for ${s(len)}${v.steady ? ` (${s(v.steady.from)} to ${s(v.steady.to)})` : ''}, and the scene only promised ${s(need)}. An agent can trust a viewer had time to read the price — if it's big and clear enough, which only a person can judge.`;
  }
  const reason = v.problem.replace(/^.*?\): /, '').replace(/ Review: .*$/, '');
  const faint = /never gets past (\d+)% opaque/.exec(reason);
  if (faint) return `It never became solid enough to count as seen: it tops out at ${faint[1]}% solid, and the check wants at least 95%. Stillness doesn't matter if it's see-through.`;
  const most = /^it is for ([\d.]+)s at most, ([\d.]+)–([\d.]+)s\./.exec(reason);
  if (!most) return reason;
  const before = /Until ([\d.]+)s (.*?);/.exec(reason);
  const after = /^\s*at ([\d.]+)s (.*?)\.(?:\s|$)/.exec(reason.slice(before ? before.index + before[0].length : most[0].length));
  return [
    `The longest it sat still and fully visible was ${s(Number(most[1]))} (${s(Number(most[2]))} to ${s(Number(most[3]))}), short of the ${s(need)} the scene promised.`,
    before && `Before that, ${plainCause(before[2])}.`,
    after ? `Then at ${s(Number(after[1]))}, ${plainCause(after[2])}.`
      : reason.includes('it runs to the end of the span') ? 'It was still steady when the scene ended — it just settled too late.'
      : reason,
  ].filter(Boolean).join(' ');
}
