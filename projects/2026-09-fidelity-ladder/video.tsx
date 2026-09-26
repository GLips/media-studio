// The fidelity ladder's demo: each scene bound at its rung. `open` is still a title card, `sketch` a board frame and
// `layout` blocked; `price` is built. Raising one is changing its binding here; timeline.ts stays as it is.

import { bindTimeline, type TimelineSceneClock } from '#models/timeline/bind-timeline.ts';
import { blockingScene, boardFrameScene, defineVideo, type FlatPiece, motionCurves, sceneCueSeconds, sceneForTimelineClock, seg, Text, titleCardScene, W } from '#studio';
import sketch from './refs/buy-box-sketch.svg';
import { timeline } from './timeline.ts';

type Clock<K extends keyof typeof timeline.spec.scenes & string> = TimelineSceneClock<typeof timeline, K>;

const SALE_RED = '#b82b2b';

// Six swatches pop in on `swatches`; on `filter` the three not on sale go and the sale ones close up, then the price lands.
const SWATCH_TINTS = ['#9fa7b3', '#b3a79f', '#a3b39f', '#b39fae', '#9fb0b3', '#b3ad9f'];
const ON_SALE = [0, 2, 3];
const swatchX = (slot: number) => 960 + slot * 120;

const layout = (clock: Clock<'layout'>) => blockingScene(clock, {
  note: 'The buy box assembles: the photo and title, every swatch, then only the sale swatches and the sale price.',
  previs: {
    prompt: 'A clean product card for a linen shirt on a warm off-white page. The photo slot is a studio photo of the shirt on a '
      + 'hanger; the title is the product name in a dark serif; each swatch is a round fabric swatch in its tint\'s colour; the price '
      + 'is set in bold red. Flat, crisp, editorial motion design.',
  },
  view: { keys: [{ at: clock.moves.settle.from, to: { cx: 1010, zoom: 1.06 }, over: clock.moves.settle.to - clock.moves.settle.from }] },
  pieces: [
    { kind: 'image', name: 'photo', color: '#a9b1bc', pose: { x: 160, y: 180, w: 700, h: 720, opacity: 0 }, keys: [{ at: clock.cues.photo, to: { opacity: 1 } }] },
    { kind: 'type', name: 'title', text: 'Linen shirt', pose: { x: 960, y: 240, w: 700, h: 80, opacity: 0 }, keys: [{ at: clock.cues.title, to: { opacity: 1, y: 220 } }] },
    ...SWATCH_TINTS.map((color, i): FlatPiece => {
      const sale = ON_SALE.indexOf(i);
      return {
        kind: 'box', name: `swatch ${i + 1}`, color, pose: { x: swatchX(i), y: 400, w: 96, h: 96, opacity: 0, scale: 0.5 },
        keys: [
          { at: clock.cues.swatches + i * 2, to: { opacity: 1, scale: 1 }, over: 9 },
          sale < 0 ? { at: clock.cues.filter, to: { opacity: 0, scale: 0.5 }, over: 8 } : { at: clock.cues.filter + 5, to: { x: swatchX(sale) } },
        ],
      };
    }),
    { kind: 'type', name: 'price', text: '$659.99', color: SALE_RED, pose: { x: 960, y: 620, w: 500, h: 110, opacity: 0 }, keys: [{ at: clock.cues.sale, to: { opacity: 1, y: 580 } }] },
  ],
});

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
    layout,
    price,
  }),
});
