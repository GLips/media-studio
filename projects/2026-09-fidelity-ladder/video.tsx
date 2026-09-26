// The fidelity ladder's demo: each scene bound at its rung. `open` is still a title card and `sketch` a board frame;
// `price` is built. Raising one is changing its binding here; timeline.ts stays as it is.

import { bindTimeline, type TimelineSceneClock } from '../../lib/models/timeline/bind-timeline.ts';
import { boardFrameScene, defineVideo, motionCurves, sceneCueSeconds, sceneForTimelineClock, seg, Text, titleCardScene, W } from '#studio';
import sketch from './refs/buy-box-sketch.svg';
import { timeline } from './timeline.ts';

type Clock<K extends keyof typeof timeline.spec.scenes & string> = TimelineSceneClock<typeof timeline, K>;

const SALE_RED = '#b82b2b';

const price = (clock: Clock<'price'>) => sceneForTimelineClock(clock, {
  note: 'The price lands, the old one is struck through, and the sale price takes its place.',
  rung: 'final',
  render: (s) => {
    const at = sceneCueSeconds(clock);
    const strike = seg(s.t, at.strike, at.strike + 0.4, motionCurves.expressive.entrance);
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#f4f1ea' }}>
        <Text text="$824.99" x={W / 2} y={480} size={150} weight={800} color="#1c365e" align="center" k={seg(s.t, at.land, at.land + 0.6)} />
        <div style={{ position: 'absolute', left: W / 2 - 330, top: 425, width: 660 * strike, height: 14, background: SALE_RED }} />
        <Text text="$659.99" x={W / 2} y={700} size={170} weight={800} color={SALE_RED} align="center" k={seg(s.t, at.strike + 0.3, at.strike + 0.9)} />
      </div>
    );
  },
});

export default defineVideo({
  title: 'The fidelity ladder',
  voice: {},
  scenes: bindTimeline(timeline, {
    open: (clock) => titleCardScene(clock, { note: 'The sale price, and only the swatches on sale, straight from the collection page.' }),
    sketch: (clock) => boardFrameScene(clock, { note: 'The buy box as sketched.', src: sketch, caption: 'Only the sale swatches, at the sale price', move: { push: 1.12 }, over: 'push' }),
    price,
  }),
});
