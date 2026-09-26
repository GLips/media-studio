// The fidelity ladder's demo: four silent scenes, one composition. `open`, `collection` and `layout` are blocked in
// flat pieces, `price` is built. Each rises in place, and none of this timing moves when it does.

import { defineTimeline, fixedSpan } from '#models/timeline/timeline.ts';

const XFADE = 0.5;

export const timeline = defineTimeline({
  scenes: {
    open: fixedSpan(3, { cues: { name: 0.6, promise: 1.6 } }),
    collection: fixedSpan(3.5, { crossfade: XFADE, cues: { click: 2.4 }, moves: { push: { from: 0.3, to: 2.3 } } }),
    layout: fixedSpan(4, { crossfade: XFADE, cues: { photo: 0.3, title: 0.8, swatches: 1.4, filter: 2.3, sale: 2.9 }, moves: { settle: { from: 0.2, to: 3.8 } } }),
    price: fixedSpan(3.5, { crossfade: XFADE, cues: { land: 0.5, strike: 1.4 } }),
  },
});
