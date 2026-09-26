// Scene show. The show: the product, then what changes, revealed. Blocked: flat pieces moving on its cues, at the real
// timing. Block what the scene shows, then build it to final; that changes this binding only, never timeline.ts. Its
// helpers go in scenes/show/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const showScene = (clock: TimelineSceneClock<typeof timeline, 'show'>) => blockingScene(clock, {
  note: "The show: the product, then what changes, revealed.",
  pieces: [
    { kind: 'image', name: 'before', pose: { x: 360, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: -1300 }, over: 8 }] },
    { kind: 'image', name: 'after', color: '#9fb0c9', pose: { x: 1960, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: 360 }, over: 8 }] },
  ],
});
