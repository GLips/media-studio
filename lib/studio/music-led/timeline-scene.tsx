// timeline-scene.tsx: a timed video's scenes, bound to its resolved timeline. A scene takes its length from its
// resolved clock, so a composition binds pictures to the timeline without restating any of its timing.

import type { ReactNode } from 'react';
import type { ResolvedSceneClock } from '../../models/timeline/timeline.ts';
import { FPS } from '../frame.ts';
import { defineScene, type SceneClock, type SceneDef } from '../timeline.ts';

/** The scene that plays one scene of the timeline: a hard cut in on its first frame, lasting until the next one's. */
export function sceneForTimelineClock(clock: ResolvedSceneClock, { note, render }: { note?: string; render: (s: SceneClock) => ReactNode }): SceneDef {
  return defineScene({ id: clock.id, note, min: (clock.to - clock.from) / FPS, lead: 0, tail: 0, cut: true, render });
}
