// The Transparent overlay video: each scene bound to its clock on timeline.ts, drawn in its own file.

import { bindTimeline } from '#models/timeline/bind-timeline.ts';
import { defineVideo } from '#studio';
import { openScene } from './scenes/open.tsx';
import { showScene } from './scenes/show.tsx';
import { closeScene } from './scenes/close.tsx';
import { timeline } from './timeline.ts';

export default defineVideo({
  title: "Transparent overlay",
  // An overlay: a lower-third and a badge over whatever page or footage it's laid on.
  format: { transparent: true },
  voice: {},
  scenes: bindTimeline(timeline, { open: openScene, show: showScene, close: closeScene }),
});
