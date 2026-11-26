/** A stepped pose rate, a live pose with one token per video frame, or one pose for the entire phase. */
export type DrawingCadence = { readonly fps: number } | { readonly live: number } | 'held';

/** A cut starts a new cadence interval at scene second `at`. */
export type DrawingPhase = { readonly at: number; readonly cadence: DrawingCadence };

/** A drawing's identity within its source, suitable for seeding local choices. */
export type RedrawToken = string;

/** The phase-local index, pose sample time in scene seconds, and redraw identity. */
export type ScheduledDrawing = { readonly index: number; readonly time: number; readonly token: RedrawToken };

/** A source's drawings, seekable in any order by scene time in seconds. */
export type DrawingSchedule = {
  readonly at: (t: number) => ScheduledDrawing;
  /** A held frame keeps its pose through the shutter. A live pose follows the exposure. */
  readonly poseAt: (frame: number, exposure: number) => number;
  /** Return the scene time that far back in drawings, or -Infinity before an initially held drawing. */
  readonly earlier: (t: number, count: number) => number;
};

// Scene-local frame arithmetic can land a rounding error before the cue or interval it names.
export const CUE_TIME_SLACK = 1e-6;

export function checkDrawingRate(fps: number, owner: string): void {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`${owner}: drawing fps must be finite and positive, got ${fps}`);
}

function drawingPhase(cadence: DrawingCadence, start: number, key: string, ordinal: number) {
  const live = cadence !== 'held' && 'live' in cadence;
  let rate = 0;
  if (cadence !== 'held') {
    rate = live ? cadence.live : cadence.fps;
    checkDrawingRate(rate, `drawing phase at ${start}s`);
  }
  const indexAt = (t: number) => rate ? Math.floor((t - start + CUE_TIME_SLACK) * rate) : 0;
  const timeOf = (index: number) => rate ? start + index / rate : start;
  return { start, ordinal, rate, key, live, indexAt, timeOf };
}

/** The initial grid counts from zero. Each cut begins a fresh drawing, even inside a hold. */
export function drawingSchedule(initial: DrawingCadence, cuts: readonly DrawingPhase[] = []): DrawingSchedule {
  const phases = [drawingPhase(initial, 0, 'initial', 0)];
  for (const [i, { at, cadence }] of cuts.entries()) {
    if (!Number.isFinite(at) || (i > 0 && at <= cuts[i - 1].at)) throw new Error('drawing cuts need finite, strictly increasing scene times');
    const previous = phases[i];
    const count = previous.rate ? Math.ceil((at - previous.start - CUE_TIME_SLACK) * previous.rate) : 1;
    phases.push(drawingPhase(cadence, at, String(at), previous.ordinal + count));
  }
  const phaseAt = (t: number) => phases.findLast((phase, i) => i === 0 || phase.start <= t + CUE_TIME_SLACK)!;
  return {
    at(t) {
      const phase = phaseAt(t), index = phase.indexAt(t);
      return { index, time: phase.live ? t : phase.timeOf(index), token: `${phase.key}/${index}` };
    },
    poseAt(frame, exposure) {
      const phase = phaseAt(frame);
      return phase.live ? exposure : phase.timeOf(phase.indexAt(frame));
    },
    earlier(t, count) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('drawing history needs a nonnegative whole count');
      if (!count || !Number.isFinite(t)) return t;
      const current = phaseAt(t), index = current.indexAt(t);
      const ordinal = current.ordinal + index - count;
      const target = phases.findLast((phase, i) => i === 0 || phase.ordinal <= ordinal)!;
      if (!target.rate && target.ordinal !== ordinal) return -Infinity;
      const start = target.timeOf(ordinal - target.ordinal);
      const shifted = start + Math.max(0, t - current.timeOf(index));
      // A shortened drawing may have ended before this offset into the current hold.
      return phaseAt(shifted) === target && target.indexAt(shifted) === ordinal - target.ordinal ? shifted : start;
    },
  };
}

/** Seeds a local choice from its permanent mark or cell address and its source's redraw token. */
export const redrawSeed = (address: string, token: RedrawToken): string => JSON.stringify([address, token]);
