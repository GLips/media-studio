// Scene open. The open: the lower-third slides in with a name, then a role. Blocked: flat pieces moving on its cues, at the real
// timing, placed in px of the default 1920×1080 frame. Block what the scene shows, then build it to final; that changes
// this binding only, never timeline.ts. Its helpers go in scenes/open/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const openScene = (clock: TimelineSceneClock<typeof timeline, 'open'>) => blockingScene(clock, {
  note: "The open: the lower-third slides in with a name, then a role.",
  pieces: [
    { kind: 'box', name: 'bar', color: '#9fb0c9', pose: { x: -900, y: 800, w: 880, h: 170 }, keys: [{ at: clock.cues.name, to: { x: 120 }, over: 10 }] },
    { kind: 'type', name: 'name', text: 'Ada Lovelace', pose: { x: 160, y: 820, w: 700, h: 70, opacity: 0 }, keys: [{ at: clock.cues.name, to: { opacity: 1 }, over: 10 }] },
    { kind: 'type', name: 'promise', text: 'Wrote the first program', color: '#6d737d', pose: { x: 162, y: 905, w: 600, h: 40, opacity: 0 }, keys: [{ at: clock.cues.promise, to: { opacity: 1 }, over: 10 }] },
  ],
});
