// odometer-wheels.ts: the arithmetic of kit.tsx's Odometer, apart from its drawing so it runs (and is tested) without
// a browser. A wheel's position is in unwrapped rows: at position p it shows digit floor(p) mod 10 rolling into the
// next, and a whole turn adds 10. Places count up from the lowest one shown, so place 0 is the cents of a price with 2
// decimals.

import { clamp, lerp, motionCurves } from '#models/motion/motion.ts';

// A place that comes or goes changes width over this many frames, so a fast carry never jumps the layout.
const PRESENCE_FRAMES = 6;
// Direct and slot modes find a roll's ends by stepping frame by frame from `t`; past this many seconds they turn geared
// instead.
const ROLL_SEARCH_SECONDS = 10;

/**
 * How the wheels turn. `mechanical`: geared, so a place turns only while the one below rolls over from 9 to 0.
 * `direct`: in each roll every wheel turns straight from its old digit to its new one, all together. `slot`: direct
 * plus extra whole turns, the wheels locking left to right like a slot machine's reels.
 */
export type OdometerMode = 'mechanical' | 'direct' | 'slot';

export type OdometerTurning = {
  decimals: number;
  mode: OdometerMode;
  /** Slot mode: whole extra turns each wheel makes in a roll. */
  spin: number;
  /** Slot mode: seconds between neighbouring wheels locking, the leftmost first. */
  lockStagger: number;
  /** The video's frame rate: the wheels step, and smear, a frame at a time. */
  fps: number;
};

/** One wheel on one frame. */
export type OdometerWheel = {
  /** Its position now and a frame ago: it smears along the travel between. */
  at: number;
  was: number;
  /** Rows outside this range are blank: a leading zero rolls away instead of showing. */
  digitRows: readonly [number, number];
  /** 0..1, how much of a digit's width the place takes, so a place that comes or goes grows or shrinks. */
  presence: number;
};

/** `value` in its lowest place's units (cents, for 2 decimals), with float dust off whole units swept away. */
export function odometerUnits(value: number, decimals: number): number {
  const units = value * 10 ** decimals;
  const whole = Math.round(units);
  return Math.abs(units - whole) < 1e-6 ? whole : units;
}

/**
 * Where `count` wheels geared as a mechanical counter's stand at `units`, lowest place first. Each turns only while
 * the one below it rolls from 9 over to 0, so on whole units every wheel sits on a whole row.
 */
export function mechanicalWheels(units: number, count: number): number[] {
  const wheels = [units];
  for (let place = 1; place < count; place++) {
    const below = wheels[place - 1];
    const turns = Math.floor(below / 10);
    wheels.push(turns + clamp(below - turns * 10 - 9));
  }
  return wheels;
}

/**
 * A direct or slot wheel's path through a roll from `from` to `to` units: from its old digit to its new one in the
 * value's direction, plus `spin` whole turns, ending on the new digit's row. A place blank at both ends doesn't turn.
 */
export function slotWheelPath(place: number, from: number, to: number, { decimals, spin }: { decimals: number; spin: number }) {
  const digit = (units: number) => Math.floor(units / 10 ** place) % 10;
  const blank = (units: number) => place > decimals && Math.floor(units / 10 ** place) === 0;
  const up = to > from;
  const steps = blank(from) && blank(to) ? 0 : ((up ? digit(to) - digit(from) : digit(from) - digit(to)) + 10) % 10 + 10 * spin;
  const end = digit(to);
  const start = up ? end - steps : end + steps;
  // A place that is blank at an end stays blank past it, so blur spreading beyond the end shows no stray digit.
  const digitRows: readonly [number, number] = up
    ? [blank(from) ? start + 1 : -Infinity, blank(to) ? end - 1 : Infinity]
    : [blank(to) ? end + 1 : -Infinity, blank(from) ? start - 1 : Infinity];
  return { start, end, digitRows };
}

/**
 * Every wheel on the frame at `t`, lowest place first. `value` gives the number shown at any time; direct and slot
 * modes read it around `t` to find the roll it's in, so any curve drives any mode.
 */
export function odometerWheels(value: (t: number) => number, t: number, { decimals, mode, spin, lockStagger, fps }: OdometerTurning): OdometerWheel[] {
  const frame = 1 / fps;
  const units = (at: number) => odometerUnits(value(at), decimals);
  const around = Array.from({ length: 2 * PRESENCE_FRAMES + 1 }, (_, i) => units(t + (i - PRESENCE_FRAMES) * frame));
  const roll = mode === 'mechanical' ? null : findOdometerRoll(value, t, decimals, fps);
  const ends = roll ? [odometerUnits(roll.from, decimals), odometerUnits(roll.to, decimals)] : [];
  const count = Math.max(...[...around, ...ends].map((u) => Math.max(decimals + 1, String(Math.ceil(u)).length)));
  const presence = odometerPresence(around, count, decimals);

  if (!roll) {
    const now = mechanicalWheels(around[PRESENCE_FRAMES], count);
    const before = mechanicalWheels(around[PRESENCE_FRAMES - 1], count);
    return now.map((at, place) => ({ at, was: before[place], digitRows: [place > decimals ? 1 : -Infinity, Infinity], presence: presence[place] }));
  }
  const [from, to] = ends;
  const slot = mode === 'slot';
  // Each wheel runs the roll's own curve squeezed to end `place * lead` early: all start together, the leftmost
  // locks first. The squeeze is capped at half the roll, so a short roll still reads as a roll.
  const lead = slot ? Math.min(lockStagger, (0.5 * (roll.t1 - roll.t0)) / Math.max(1, count - 1)) : 0;
  return Array.from({ length: count }, (_, place) => {
    const path = slotWheelPath(place, from, to, { decimals, spin: slot ? spin : 0 });
    const along = (at: number) => lerp(path.start, path.end, slotProgress(value, roll, at, place * lead));
    return { at: along(t), was: along(t - frame), digitRows: path.digitRows, presence: presence[place] };
  });
}

/**
 * Each place's presence on the middle frame of `around` (units on consecutive frames), lowest first: there while its
 * geared wheel shows a digit, in every mode. Coming or going takes PRESENCE_FRAMES and only while the value moves. A
 * cell grows after its digit arrives and shrinks before it leaves, unless a move's start or end leaves no room.
 */
function odometerPresence(around: number[], count: number, decimals: number): number[] {
  const mid = PRESENCE_FRAMES;
  const wheels = around.map((u) => mechanicalWheels(u, count));
  const still = (i: number) => Math.abs(around[i] - around[i - 1]) <= 1e-6 || Math.abs(around[i] - around[i + 1]) <= 1e-6;
  return Array.from({ length: count }, (_, place) => {
    if (place <= decimals) return 1;
    const shown = (i: number) => clamp(wheels[i][place]);
    if (still(mid)) return motionCurves.dissolve(shown(mid));
    // Changing by at most 1/PRESENCE_FRAMES a frame: the most it can be without outrunning its digit, and the least
    // that still reaches the frames at rest on either side.
    let most = Infinity, least = -Infinity;
    for (let i = 1; i < around.length - 1; i++) {
      const slack = Math.abs(i - mid) / PRESENCE_FRAMES;
      most = Math.min(most, shown(i) + slack);
      if (still(i)) least = Math.max(least, shown(i) - slack);
    }
    return motionCurves.dissolve(Math.max(most, least));
  });
}

/**
 * Seconds since the value landed (the first frame at its new rest), if that was at most `within` seconds ago; null
 * while it's moving, or once it has rested longer.
 */
export function odometerSinceLanding(value: (t: number) => number, t: number, within: number, decimals: number, fps: number): number | null {
  const frame = 1 / fps;
  const moving = movingAt(value, decimals, frame);
  for (let back = 0; back * frame <= within + 1e-9; back++) {
    const at = t - back * frame;
    if (moving(at)) return back === 0 && moving(t + frame) ? null : back * frame;
  }
  return null;
}

type OdometerRoll = { t0: number; t1: number; from: number; to: number };

/**
 * The roll `t` is part of, on the frame grid through `t`: from the last frame at rest before the value moved (`t0`)
 * to the first frame at its new rest (`t1`). Null at rest, or if either end is more than ROLL_SEARCH_SECONDS away.
 */
function findOdometerRoll(value: (t: number) => number, t: number, decimals: number, fps: number): OdometerRoll | null {
  const frame = 1 / fps, most = ROLL_SEARCH_SECONDS * fps;
  const moving = movingAt(value, decimals, frame);
  if (!moving(t) && !moving(t + frame)) return null;
  let back = 0;
  while (moving(t - back * frame)) if (++back > most) return null;
  let ahead = moving(t) ? 0 : 1;
  while (moving(t + (ahead + 1) * frame)) if (++ahead > most) return null;
  const t0 = t - back * frame, t1 = t + ahead * frame;
  const from = value(t0), to = value(t1);
  // A value that moves and comes back to where it was has nothing to roll to.
  return odometerUnits(from, decimals) === odometerUnits(to, decimals) ? null : { t0, t1, from, to };
}

/** How far through `roll` a wheel that locks `lead` seconds before its end is at `t`, as the value's own progress. */
function slotProgress(value: (t: number) => number, roll: OdometerRoll, t: number, lead: number): number {
  const span = roll.t1 - roll.t0;
  const at = roll.t0 + ((t - roll.t0) * span) / (span - lead);
  if (at <= roll.t0) return 0;
  if (at >= roll.t1) return 1;
  return (value(at) - roll.from) / (roll.to - roll.from);
}

/** Whether the value changed between the frame before `at` and `at`, by more than float noise in its lowest place. */
const movingAt = (value: (t: number) => number, decimals: number, frame: number) => {
  const epsilon = 1e-6 / 10 ** decimals;
  return (at: number) => Math.abs(value(at) - value(at - frame)) > epsilon;
};
