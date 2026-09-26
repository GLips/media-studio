// The Format vertical video's timing, stated once: each scene's driver and the cues its picture moves on. `studio clock format-vertical`
// prints it. Until there's a track the bars run on a steady tempo: `studio music add` (or `gen`),
// then `studio music fit --bars`, gives one to cut to, and `recordedGrid(music['<name>'])` from its music/index.ts
// replaces tempoGrid.

import { beatSpan, defineTimeline, tempoGrid } from '#models/timeline/timeline.ts';

export const timeline = defineTimeline({
  grid: tempoGrid(120),
  scenes: {
    hook: beatSpan(4, { cues: { hit: 0 } }),
    turn: beatSpan(4, { cues: { reveal: 2 } }),
    payoff: beatSpan(4, { cues: { stop: 'end' } }),
  },
  // The music's final hit ends the last bar: pending on a tempo grid, checked against a fitted track.
  landmarks: [{ name: 'the final hit', cue: 'payoff.stop', downbeat: -1 }],
});
