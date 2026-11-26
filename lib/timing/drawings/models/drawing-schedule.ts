/** A stepped pose rate, a live pose with one token per video frame, or one pose for the entire phase. */
export type DrawingCadence = { readonly fps: number } | { readonly live: number } | 'held';

/** A cut starts a new cadence interval at scene second `at`. */
export type DrawingPhase = { readonly at: number; readonly cadence: DrawingCadence };

/** A drawing's identity within its source, suitable for seeding local choices. */
export type RedrawToken = string;

/** The phase-local index, pose sample time in scene seconds, and redraw identity. */
export type ScheduledDrawing = { readonly index: number; readonly time: number; readonly token: RedrawToken };

/** A source's drawings, seekable in any order by scene time in seconds. */
export type DrawingSchedule = { readonly at: (t: number) => ScheduledDrawing };

// Scene-local frame arithmetic can land a rounding error before the cue or interval it names.
export const CUE_TIME_SLACK = 1e-6;

export function checkDrawingRate(fps: number, owner: string): void {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`${owner}: drawing fps must be finite and positive, got ${fps}`);
}

function phaseSampler(cadence: DrawingCadence, phase: number, key: string): DrawingSchedule {
  if (cadence === 'held') return { at: () => ({ index: 0, time: phase, token: key + '/0' }) };
  const live = 'live' in cadence;
  const fps = live ? cadence.live : cadence.fps;
  checkDrawingRate(fps, `drawing phase at ${phase}s`);
  return {
    at(t) {
      const index = Math.floor((t - phase + CUE_TIME_SLACK) * fps);
      return { index, time: live ? t : phase + index / fps, token: `${key}/${index}` };
    },
  };
}

/** Builds a seekable schedule. The initial cadence counts from zero even before the scene. Cuts are in scene-time order. */
export function drawingSchedule(initial: DrawingCadence, cuts: readonly DrawingPhase[] = []): DrawingSchedule {
  const first = phaseSampler(initial, 0, 'initial');
  const phases = cuts.map(({ at, cadence }, i) => {
    if (!Number.isFinite(at) || (i > 0 && at <= cuts[i - 1].at)) throw new Error('drawing cuts need finite, strictly increasing scene times');
    return { at, sampler: phaseSampler(cadence, at, String(at)) };
  });
  return { at: (t) => (phases.findLast((phase) => phase.at <= t + CUE_TIME_SLACK)?.sampler ?? first).at(t) };
}

/** Seeds a local choice from its permanent mark or cell address and its source's redraw token. */
export const redrawSeed = (address: string, token: RedrawToken): string => JSON.stringify([address, token]);
