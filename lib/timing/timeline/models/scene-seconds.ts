// scene-seconds.ts: a scene's clock read in the seconds its own code draws in, `s.t`, from its cut: its cues and beats
// as times, beats and frames as lengths, the beat at a time, its end, and the span its frames show, which a painted
// shot samples its values over. A move timed through these lands where the timeline puts its moments; nothing here is
// a new way to write a time, only the clock's own read in seconds.

import type { ResolvedSceneClock } from './timeline.ts';

/**
 * The scene seconds a scene's frames show, from `from` (negative while it fades in over the scene before) to `to`,
 * exclusive (past its length while the next fades in over it), at `fps` frames a second. A painted shot is drawn over
 * these, so its values are sampled over them.
 */
export type SceneShownSpan = { readonly from: number; readonly to: number; readonly fps: number };

/** A scene's clock in seconds of its `s.t` (sceneSecondsOf). */
export type SceneClockSeconds<Cue extends string = string, AnyCue extends string = string> = {
  /** Its own cue `name`, or another scene's named `<scene>.<cue>`, in scene seconds. */
  readonly cue: (name: Cue | AnyCue) => number;
  /** When its beat `n` hits, in scene seconds, on a frame as the clock rounds it; throws outside its frames. */
  readonly beat: (n: number) => number;
  /** How long `n` beats last, in seconds; throws for a scene off the beat grid. */
  readonly beats: (n: number) => number;
  /** How long `n` frames last, in seconds. */
  readonly frames: (n: number) => number;
  /**
   * The beat scene second `s` falls on, fractional: `beat`'s inverse, straight between the frames its beats hit on and
   * at the grid's pace past them, so `beatAt(beat(n))` is `n`. Throws for a scene with no beats.
   */
  readonly beatAt: (s: number) => number;
  /** Its nominal end, in scene seconds: its last beat's boundary, or its origin plus its length. */
  readonly end: number;
  /** The span its frames show. */
  readonly span: SceneShownSpan;
};

/** `clock` read in seconds of its scene's `s.t`, for code drawing a scene in seconds: a shot's keys, a play's `at`. */
export function sceneSecondsOf<Cue extends string, AnyCue extends string>(clock: ResolvedSceneClock<string, Cue, string, AnyCue>): SceneClockSeconds<Cue, AnyCue> {
  const { fps, spb } = clock, seconds = (frame: number) => (frame - clock.from) / fps;
  const beatFrames = clock.beatFrames, framesPerBeat = spb * fps;
  const ownCue = (name: string): number => {
    // SAFETY: the clock's cues are keyed by its own cue names, which `name` is when it holds no dot.
    const frame = (clock.cues as Readonly<Record<string, number>>)[name];
    if (frame === undefined) throw new Error(`scene ${clock.id} has no cue ${name}; another scene's is named <scene>.<cue>`);
    return frame;
  };
  const gridded = (what: string) => {
    if (!(framesPerBeat > 0) || !beatFrames.length) throw new Error(`scene ${clock.id} is off the beat grid, so it has no ${what}`);
  };
  return {
    // SAFETY: a name with a dot is another scene's, which the clock's `cue` takes.
    cue: (name) => seconds(name.includes('.') ? clock.cue(name as AnyCue) : ownCue(name)),
    beat: (n) => seconds(clock.beat(n)),
    beats: (n) => {
      gridded('beats');
      return n * spb;
    },
    frames: (n) => n / fps,
    beatAt: (s) => {
      gridded('beats');
      const frame = s * fps + clock.from, last = beatFrames.length - 1;
      if (frame <= beatFrames[0]) return (frame - beatFrames[0]) / framesPerBeat;
      if (frame >= beatFrames[last]) return last + (frame - beatFrames[last]) / framesPerBeat;
      const n = beatFrames.findLastIndex((hit) => hit <= frame);
      return n + (frame - beatFrames[n]) / (beatFrames[n + 1] - beatFrames[n]);
    },
    end: seconds(clock.end),
    span: { from: seconds(clock.visible.from), to: seconds(clock.visible.to), fps },
  };
}
