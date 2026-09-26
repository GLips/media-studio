// Scene close. The close: the end card. Blocked: flat pieces moving on its cues, at the real
// timing. Block what the scene shows, then build it to final; that changes this binding only, never timeline.ts. Its
// helpers go in scenes/close/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const closeScene = (clock: TimelineSceneClock<typeof timeline, 'close'>) => blockingScene(clock, {
  note: "The close: the end card.",
  pieces: [
    { kind: 'box', name: 'end card', color: '#9fb0c9', pose: { x: 0, y: 0, w: 1920, h: 1080, opacity: 0 }, keys: [{ at: clock.cues.card, to: { opacity: 1 }, over: 12 }] },
  ],
});
