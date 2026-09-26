// Bar hook. The hook: one image, hitting on the downbeat. Blocked: flat pieces moving on its cues, at the real
// timing, placed in px of the default 1920×1080 frame, each move counted in 60 fps frames. Block what the scene
// shows, then build it to final; that changes this binding only, never timeline.ts. Its helpers go in bars/hook/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const hookBar = (clock: TimelineSceneClock<typeof timeline, 'hook'>) => blockingScene(clock, {
  note: "The hook: one image, hitting on the downbeat.",
  pieces: [
    { kind: 'image', name: 'hook image', pose: { x: 360, y: 150, w: 1200, h: 675, opacity: 0, scale: 1.2 }, keys: [{ at: clock.cues.hit, to: { opacity: 1, scale: 1 }, over: 10 }] },
  ],
});
