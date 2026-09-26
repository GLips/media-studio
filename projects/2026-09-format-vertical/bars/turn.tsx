// Bar turn. The turn: what changes, revealed on beat 2. Blocked: flat pieces moving on its cues, at the real
// timing, placed in px of the video's 1080×1920 frame. Block what the scene shows, then build it to final; that changes
// this binding only, never timeline.ts. Its helpers go in bars/turn/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const turnBar = (clock: TimelineSceneClock<typeof timeline, 'turn'>) => blockingScene(clock, {
  note: "The turn: what changes, revealed on beat 2.",
  pieces: [
    { kind: 'box', name: 'before', pose: { x: 90, y: 360, w: 900, h: 1100 }, keys: [{ at: clock.cues.reveal, to: { x: -1000 }, over: 8 }] },
    { kind: 'box', name: 'after', color: '#9fb0c9', pose: { x: 1120, y: 360, w: 900, h: 1100 }, keys: [{ at: clock.cues.reveal, to: { x: 90 }, over: 8 }] },
  ],
});
