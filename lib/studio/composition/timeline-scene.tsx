// timeline-scene.tsx: a timed video's scenes, bound to its resolved timeline. A scene takes its length, the crossfade
// into it and its voiced lines' starts from its resolved clock, so a composition binds pictures to the timeline without
// restating any of its timing.

import type { ReactNode } from 'react';
import type { ResolvedSceneClock } from '#models/timeline/timeline.ts';
import type { SceneRung } from '#models/timeline/scene-rung.ts';
import type { SceneClock, SceneDef } from './timeline.ts';

/** The scene that plays one scene of the timeline, from its cut to the next one's, with the lines the timeline placed in it. */
export function sceneForTimelineClock(clock: ResolvedSceneClock, { note, rung, render }: { note?: string; rung?: SceneRung; render: (s: SceneClock) => ReactNode }): SceneDef {
  const seconds = (frame: number) => (frame - clock.from) / clock.fps;
  return {
    id: clock.id, note, rung, render, lines: clock.lines.map((line) => line.id),
    resolved: { dur: seconds(clock.to), xfade: clock.crossfade, lines: Object.fromEntries(clock.lines.map((line) => [line.id, seconds(line.frame)])), fps: clock.fps },
  };
}

/** A scene's own cues in seconds of its `s.t`, for a scene drawn in seconds: `seg(s.t, at.land, at.land + 0.4)`. */
export function sceneCueSeconds<Cue extends string>(clock: ResolvedSceneClock<string, Cue>): Readonly<Record<Cue, number>> {
  return Object.fromEntries(Object.entries(clock.cues).map(([name, frame]) => [name, ((frame as number) - clock.from) / clock.fps])) as Record<Cue, number>;
}
