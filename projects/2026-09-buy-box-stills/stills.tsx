// The new buy box's share images: an OG image, a YouTube thumbnail and the IG sizes, from one design. The captured
// Solice page (the machine beside the buy box's swatches) fills a panel; the copy sits beside it on a wide frame and
// under it on a tall one. Three copy lengths prove the headline fits at every size; two crops pick between the machine
// beside the card and the card alone.
//   studio still buy-box-stills [--preset=og,youtube] [--variant=short-whole] [--sheet]

import { CoverImage, DISPLAY_FONT, FitText, MONO_FONT, defineStills, stillDesign, useStillFrame, union } from '../../lib/studio/api.ts';
import { captures as C } from './captures/index.ts';

const GROUND = '#0d0d0f';
const RED = '#ff3b3b';
const PAGE = C.solice;
// The machine's body and the card's title, price and swatches, with a margin: what every crop keeps whole.
const PAD = 24;
const CORE = union({ x: PAGE.rects.gallery.x + 190, y: PAGE.rects.gallery.y + 40, w: 1, h: 1 }, PAGE.rects.title, PAGE.rects.card);
const padded = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x - PAD, y: r.y - PAD, w: r.w + 2 * PAD, h: r.h + 2 * PAD });
const CROPS = {
  whole: padded(CORE),
  // The title, price and swatches, larger: what changes as you tap.
  card: padded(union(PAGE.rects.title, PAGE.rects.card)),
};

type BuyBoxCopy = { eyebrow: string; headline: string; cta: string; crop: keyof typeof CROPS };

function BuyBoxCard({ eyebrow, headline, cta, crop }: BuyBoxCopy) {
  const { w, h, u, wide } = useStillFrame();
  const m = 6 * u;
  // Wide: the page fills the right 56%. Tall: it fills the top, leaving the copy at least 45% of the width in height.
  const panel = wide ? { x: w * 0.44, y: 0, w: w * 0.56, h } : { x: 0, y: 0, w, h: h - Math.max(w * 0.45, h * 0.42) };
  const column = wide ? { x: m, y: m, w: panel.x - 2 * m, h: h - 2 * m } : { x: m, y: panel.h + m * 0.8, w: w - 2 * m, h: h - panel.h - 1.8 * m };
  const label = 2.4 * u;
  const headlineBox = { x: column.x, y: column.y + label * 2.6, w: column.w, h: column.h - label * 2.6 - label * 3 };
  return (
    <div style={{ position: 'absolute', inset: 0, background: GROUND }}>
      <CoverImage image={PAGE} box={panel} focus={CROPS[crop]} />
      <div style={{ position: 'absolute', background: RED, ...(wide ? { left: panel.x, top: 0, width: 0.8 * u, height: h } : { left: 0, top: panel.h, width: w, height: 0.8 * u }) }} />
      <div style={{ position: 'absolute', left: column.x, top: column.y, fontFamily: MONO_FONT, fontSize: label, fontWeight: 600, letterSpacing: '0.12em', color: RED }}>{eyebrow}</div>
      <FitText
        name="headline" text={headline} box={headlineBox} max={(wide ? 13 : 12) * u} min={4 * u} align={wide ? 'center' : 'start'}
        // No negative tracking: condensed, it closes the word spaces.
        style={{ fontWeight: 800, lineHeight: 0.96, color: '#fff' }}
      />
      <div style={{ position: 'absolute', left: column.x, top: column.y + column.h - label * 1.3, fontFamily: DISPLAY_FONT, fontSize: label * 1.3, fontWeight: 500, lineHeight: 1, color: 'rgba(255,255,255,0.72)' }}>{cta}</div>
    </div>
  );
}

const HEADLINES = {
  short: 'Instant swatches.',
  long: 'Tap a colour and the whole page changes with it',
  huge: 'Every colour, battery and bundle on one card, priced as you tap, with nothing reloading under your thumb while you choose',
};

export default defineStills({
  'buy-box': stillDesign({
    component: BuyBoxCard,
    presets: ['og', 'youtube', 'square', 'portrait', 'story'],
    axes: { headline: ['short', 'long', 'huge'], crop: ['whole', 'card'] },
    props: ({ headline, crop }) => ({ eyebrow: 'PAINFUL PLEASURES · NEW BUY BOX', cta: 'painfulpleasures.com', headline: HEADLINES[headline], crop }),
  }),
});
