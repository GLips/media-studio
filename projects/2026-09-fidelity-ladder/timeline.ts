// The fidelity ladder's demo: four silent scenes at four rungs, one composition. `open` is a title card, `sketch` a
// board frame pushing into a sketch, `layout` blocked in flat pieces, `price` built. Each rises in place, and none of
// this timing moves when it does.

import { defineTimeline, fixedSpan } from '#models/timeline/timeline.ts';

const XFADE = 0.5;

export const timeline = defineTimeline({
  scenes: {
    open: fixedSpan(3, { cues: { name: 0.6, promise: 1.6 } }),
    sketch: fixedSpan(3.5, { crossfade: XFADE, moves: { push: { from: 0.3, to: 3.3 } } }),
    layout: fixedSpan(4, { crossfade: XFADE, cues: { photo: 0.3, title: 0.8, swatches: 1.4, filter: 2.3, sale: 2.9 }, moves: { settle: { from: 0.2, to: 3.8 } } }),
    price: fixedSpan(3.5, { crossfade: XFADE, cues: { land: 0.5, strike: 1.4 } }),
  },
});
