// The fidelity ladder's demo: three silent scenes at three rungs, one composition. `open` is a title card, `sketch` a
// board frame pushing into a sketch, `price` built. Each rises in place, and none of this timing moves when it does.

import { defineTimeline, fixedSpan } from '../../lib/models/timeline/timeline.ts';

const XFADE = 0.5;

export const timeline = defineTimeline({
  scenes: {
    open: fixedSpan(3, { cues: { name: 0.6, promise: 1.6 } }),
    sketch: fixedSpan(3.5, { crossfade: XFADE, moves: { push: { from: 0.3, to: 3.3 } } }),
    price: fixedSpan(3.5, { crossfade: XFADE, cues: { land: 0.5, strike: 1.4 } }),
  },
});
