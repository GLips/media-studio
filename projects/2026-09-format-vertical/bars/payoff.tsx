// Bar payoff. The payoff: the name, held to the music's final hit. Blocked: flat pieces moving on its cues, at the real
// timing, placed in px of the video's 1080×1920 frame. Block what the scene shows, then build it to final; that changes
// this binding only, never timeline.ts. Its helpers go in bars/payoff/.
import type { TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene } from '#studio';
import type { timeline } from '../timeline.ts';

export const payoffBar = (clock: TimelineSceneClock<typeof timeline, 'payoff'>) => blockingScene(clock, {
  note: "The payoff: the name, held to the music's final hit.",
  pieces: [
    { kind: 'type', name: 'name', text: 'The name', pose: { x: 140, y: 820, w: 800, h: 140, opacity: 0, scale: 0.8 }, keys: [{ at: clock.beat(0), to: { opacity: 1, scale: 1 }, over: 6 }] },
  ],
});
