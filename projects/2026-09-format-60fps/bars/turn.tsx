// Bar turn. The turn: what changes, revealed on beat 2. Blocked: flat pieces moving on its cues, at the real
// timing, placed in px of the default 1920×1080 frame, each move counted in 60 fps frames. Block what the scene
// shows, then build it to final; that changes this binding only, never timeline.ts. Its helpers go in bars/turn/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const turnBar = (clock: TimelineSceneClock<typeof timeline, 'turn'>) => blockingScene(clock, {
  note: "The turn: what changes, revealed on beat 2.",
  pieces: [
    { kind: 'box', name: 'before', pose: { x: 360, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: -1300 }, over: 16 }] },
    { kind: 'box', name: 'after', color: '#9fb0c9', pose: { x: 1960, y: 240, w: 1200, h: 600 }, keys: [{ at: clock.cues.reveal, to: { x: 360 }, over: 16 }] },
  ],
});
