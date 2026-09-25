// timeline-scene.tsx: a timed video's scenes, bound to its resolved timeline. A scene takes its length, the crossfade
// into it and its voiced lines' starts from its resolved clock, so a composition binds pictures to the timeline without
// restating any of its timing.

import type { ReactNode } from 'react';
import type { ResolvedSceneClock } from '../../models/timeline/timeline.ts';
import { FPS } from '../frame.ts';
import type { SceneClock, SceneDef } from '../timeline.ts';

/** The scene that plays one scene of the timeline, from its cut to the next one's, with the lines the timeline placed in it. */
export function sceneForTimelineClock(clock: ResolvedSceneClock, { note, render }: { note?: string; render: (s: SceneClock) => ReactNode }): SceneDef {
  const seconds = (frame: number) => (frame - clock.from) / FPS;
  return {
    id: clock.id, note, render, lines: clock.lines.map((line) => line.id),
    resolved: { dur: seconds(clock.to), xfade: clock.crossfade, lines: Object.fromEntries(clock.lines.map((line) => [line.id, seconds(line.frame)])) },
  };
}

/** A scene's own cues in seconds of its `s.t`, for a scene drawn in seconds: `seg(s.t, at.land, at.land + 0.4)`. */
export function sceneCueSeconds<Cue extends string>(clock: ResolvedSceneClock<string, Cue>): Readonly<Record<Cue, number>> {
  return Object.fromEntries(Object.entries(clock.cues).map(([name, frame]) => [name, ((frame as number) - clock.from) / FPS])) as Record<Cue, number>;
}
