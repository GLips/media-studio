// Scene show. The show: the lower-third holds, and a badge pops in at the top right. Blocked: flat pieces moving on its cues, at the real
// timing, placed in px of the default 1920×1080 frame. Block what the scene shows, then build it to final; that changes
// this binding only, never timeline.ts. Its helpers go in scenes/show/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const showScene = (clock: TimelineSceneClock<typeof timeline, 'show'>) => blockingScene(clock, {
  note: "The show: the lower-third holds, and a badge pops in at the top right.",
  pieces: [
    { kind: 'box', name: 'bar', color: '#9fb0c9', pose: { x: 120, y: 800, w: 880, h: 170 } },
    { kind: 'type', name: 'name', text: 'Ada Lovelace', pose: { x: 160, y: 820, w: 700, h: 70 } },
    { kind: 'type', name: 'promise', text: 'Wrote the first program', color: '#6d737d', pose: { x: 162, y: 905, w: 600, h: 40 } },
    { kind: 'image', name: 'badge', color: '#c9a59f', pose: { x: 1520, y: 80, w: 300, h: 300, scale: 0 }, keys: [{ at: clock.cues.reveal, to: { scale: 1 }, over: 8 }] },
  ],
});
