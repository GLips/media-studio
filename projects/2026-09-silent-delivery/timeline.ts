// The Silent delivery video's timing, stated once: each scene's driver and the cues its picture moves on. `studio clock silent-delivery`
// prints it. Each scene lasts the seconds it states. The video plays no voice, music or sound, and delivers
// with no audio track: project.ts declares it silent.

import { defineTimeline, fixedSpan } from '#models/timeline/timeline.ts';

export const timeline = defineTimeline({
  scenes: {
    open: fixedSpan(3, { cues: { name: 0.4, promise: 1.4 } }),
    show: fixedSpan(4, { crossfade: 0.5, cues: { reveal: 1.5 } }),
    close: fixedSpan(3, { crossfade: 0.5, cues: { card: 0.8 } }),
  },
});
