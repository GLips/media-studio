// Scene open. The open: the name, then what it promises. Blocked: flat pieces moving on its cues, at the real
// timing. Block what the scene shows, then build it to final; that changes this binding only, never timeline.ts. Its
// helpers go in scenes/open/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const openScene = (clock: TimelineSceneClock<typeof timeline, 'open'>) => blockingScene(clock, {
  note: "The open: the name, then what it promises.",
  pieces: [
    { kind: 'type', name: 'name', text: 'The name', pose: { x: 160, y: 380, w: 900, h: 130, opacity: 0 }, keys: [{ at: clock.cues.name, to: { opacity: 1, y: 360 }, over: 10 }] },
    { kind: 'type', name: 'promise', text: 'What it does for you', color: '#6d737d', pose: { x: 166, y: 540, w: 900, h: 56, opacity: 0 }, keys: [{ at: clock.cues.promise, to: { opacity: 1 }, over: 10 }] },
  ],
});
