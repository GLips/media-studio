// timeline-scene.tsx: a timed video's scenes, bound to its resolved timeline. A scene takes its id from its clock and
// everything else about its timing from the timeline, so a composition binds pictures to it without restating any.

import type { ResolvedSceneClock } from '#lib/timing/timeline/models/timeline.ts';
import type { SceneDef } from './video.ts';

/** The scene that plays one scene of the timeline, from its cut to the next one's, with the lines the timeline placed in it. */
export const sceneForTimelineClock = (clock: ResolvedSceneClock, scene: Omit<SceneDef, 'id'>): SceneDef => ({ ...scene, id: clock.id });

/** A scene's own cues in seconds of its `s.t`, for a scene drawn in seconds: `seg(s.t, at.land, at.land + 0.4)`. */
export function sceneCueSeconds<Cue extends string>(clock: ResolvedSceneClock<string, Cue>): Readonly<Record<Cue, number>> {
  return Object.fromEntries(Object.entries(clock.cues).map(([name, frame]) => [name, ((frame as number) - clock.from) / clock.fps])) as Record<Cue, number>;
}
