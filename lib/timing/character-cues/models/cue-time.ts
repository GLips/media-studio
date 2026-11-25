// cue-time.ts: when a cue lands, said the way the storyboard already times things: a cue (the scene's own, a word cue,
// or another scene's as `<scene>.<cue>`), a bar and beat of a music-cut scene, or an offset from either. A score adds
// no clock of its own: every time is read through the scene's clock in its `s.t` seconds (sceneSecondsOf), so a
// retimed storyboard moves the whole performance with it.

import { sceneSecondsOf, type SceneClockSeconds } from '#lib/timing/timeline/models/scene-seconds.ts';
import type { ResolvedSceneClock } from '#lib/timing/timeline/models/timeline.ts';

/** A distance in time: seconds, video frames, or beats of the scene's grid. */
export type CueOffset =
  | { readonly seconds: number; readonly frames?: never; readonly beats?: never }
  | { readonly frames: number; readonly seconds?: never; readonly beats?: never }
  | { readonly beats: number; readonly seconds?: never; readonly frames?: never };

/** A named moment: a cue, or `[bar, beat]` from 1, bars counted in the grid's meter from the scene's own first beat. */
export type CueAnchor<Cue extends string> = Cue | readonly [bar: number, beat: number];

/** When a cue lands: an anchor, or an offset from one, as `{ from: 'first', offset: { seconds: 0.5 } }`. */
export type CueTime<Cue extends string> = CueAnchor<Cue> | { readonly from: CueAnchor<Cue>; readonly offset: CueOffset };

/** The scene clock a score is timed on: the clock a scene's binding is given. */
export type CueClock<Cue extends string = string, AnyCue extends string = string> = ResolvedSceneClock<string, Cue, string, AnyCue>;

/** The cue names a scene's clock reaches, its own and other scenes' as `<scene>.<cue>`, for typing a score. */
export type CueNamesOfClock<C> = C extends ResolvedSceneClock<string, infer Cue, string, infer AnyCue> ? Cue | AnyCue : never;

/** A scene's clock read for a score: in seconds, with its meter. */
export type CueSeconds = SceneClockSeconds & { readonly id: string; readonly beatsPerBar: number; readonly sceneBeats: number };

export const cueSecondsOf = (clock: CueClock): CueSeconds => ({ ...sceneSecondsOf(clock), id: clock.id, beatsPerBar: clock.beatsPerBar, sceneBeats: clock.beats });

function anchorSeconds(clock: CueSeconds, anchor: CueAnchor<string>): number {
  if (typeof anchor === 'string') return clock.cue(anchor);
  const [bar, beat] = anchor;
  if (!(bar >= 1 && beat >= 1)) throw new Error(`score for scene ${clock.id}: [${bar}, ${beat}] counts bars and beats from 1`);
  return clock.beat((bar - 1) * clock.beatsPerBar + (beat - 1));
}

/** How long `offset` lasts from `from` seconds: a beat offset is read through the grid from there. */
export function cueOffsetSeconds(clock: CueSeconds, from: number, offset: CueOffset): number {
  if (offset.seconds !== undefined) return offset.seconds;
  if (offset.frames !== undefined) return clock.frames(offset.frames);
  return gridSeconds(clock, clock.beatAt(from) + offset.beats) - from;
}

/** Beat `n`'s time, at the grid's pace past either end of the scene: a blend in beats may run on past its cut. */
function gridSeconds(clock: CueSeconds, n: number): number {
  const last = clock.sceneBeats;
  if (n < 0) return clock.beat(0) + clock.beats(n);
  return n > last ? clock.beat(last) + clock.beats(n - last) : clock.beat(n);
}

/** Where `at` lands, in the scene's `s.t` seconds, 0 on its cut. */
export function cueTimeSeconds(clock: CueSeconds, at: CueTime<string>): number {
  if (typeof at === 'string' || !('from' in at)) return anchorSeconds(clock, at);
  const start = anchorSeconds(clock, at.from);
  return start + cueOffsetSeconds(clock, start, at.offset);
}
