// timeline-scene.tsx: a timed video's scenes, bound to its resolved timeline. A scene takes its id from its clock and
// everything else about its timing from the timeline, so a composition binds pictures to it without restating any.

import type { ResolvedSceneClock } from '#lib/timing/timeline/models/timeline.ts';
import type { SceneDef } from './video.ts';

export { sceneCueSeconds } from '#lib/timing/timeline/models/scene-cue-seconds.ts';

/** The scene that plays one scene of the timeline, from its cut to the next one's, with the lines the timeline placed in it. */
export const sceneForTimelineClock = (clock: ResolvedSceneClock, scene: Omit<SceneDef, 'id'>): SceneDef => ({ ...scene, id: clock.id });
