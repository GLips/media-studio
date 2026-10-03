// scene-cue-seconds.ts: a scene's cues in seconds of its own clock, for code that draws in seconds: a scene's `s.t`, or
// a painting source fixing an application's `at` to a cue the timeline resolves.

import type { ResolvedSceneClock } from './timeline.ts';

/** A scene's own cues in seconds of its `s.t`, for a scene drawn in seconds: `seg(s.t, at.land, at.land + 0.4)`. */
export function sceneCueSeconds<Cue extends string>(clock: ResolvedSceneClock<string, Cue>): Readonly<Record<Cue, number>> {
  // SAFETY: the entries are the clock's own cues, every one a frame number, so the record keeps their names.
  return Object.fromEntries(Object.entries(clock.cues).map(([name, frame]) => [name, ((frame as number) - clock.from) / clock.fps])) as Record<Cue, number>;
}
