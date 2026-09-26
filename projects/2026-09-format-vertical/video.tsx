// The Format vertical video: each scene bound to its clock on timeline.ts, drawn in its own file.
// Once a fitted track replaces the tempo grid, it plays as `music: { track }` here.

import { bindTimeline } from '#models/timeline/bind-timeline.ts';
import { defineVideo } from '#studio';
import { hookBar } from './bars/hook.tsx';
import { turnBar } from './bars/turn.tsx';
import { payoffBar } from './bars/payoff.tsx';
import { timeline } from './timeline.ts';

export default defineVideo({
  title: "Format vertical",
  // A fixture for a video's own frame size: a vertical cut for a phone's feed.
  format: { width: 1080, height: 1920 },
  voice: {},
  scenes: bindTimeline(timeline, { hook: hookBar, turn: turnBar, payoff: payoffBar }),
});
