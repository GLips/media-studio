// The Silent delivery video: each scene bound to its clock on timeline.ts, drawn in its own file.

import { bindTimeline } from '#models/timeline/bind-timeline.ts';
import { defineVideo } from '#studio';
import { openScene } from './scenes/open.tsx';
import { showScene } from './scenes/show.tsx';
import { closeScene } from './scenes/close.tsx';
import { timeline } from './timeline.ts';

export default defineVideo({
  title: "Silent delivery",
  voice: {},
  scenes: bindTimeline(timeline, { open: openScene, show: showScene, close: closeScene }),
});
