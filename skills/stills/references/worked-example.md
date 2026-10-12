# Worked example: a product page's share images

A product page's share images in a brand kit: one design at every preset, two axes. A full-bleed field in the
product's own colour holds the real page on a tilted card, one swatch lifted off it and ringed, beside (wide) or over
(tall) the kit's navy, where the headline is set as big as it fits.

The capture names the rects the design crops to; `{ all: true }` gives every match, so `swatches` is a list:

```ts
shots.still('home', {
  setup: async (page) => { await page.goto(PRODUCT_URL, { waitUntil: 'load' }); },
  rects: {
    title: 'h1.h3',
    card: '.buy-box__card',
    swatches: ['.buy-box label[class*="color-swatch"]', { all: true }],
  },
  height: 900,
});
```

`stills.tsx`:

```tsx
import brand from '@brand';
import { BrandLogo, FitText, StillCard, StillHud, defineStills, stillDesign, union, useStillFrame } from '#studio';
import { captures as C } from './captures/index.ts';

const PAGE = C.home;
const NAVY = brand.colors.primary;
// The swatch's colour as the page draws it: the product's own, so the field is the product's.
const FIELD = '#FF00C2';
// The product in the gallery photo, found as its dark pixels (the photo is on white).
const PRODUCT = { x: 274, y: 268, w: 107, h: 428 };
const PAPER = 'rgba(255, 255, 255, 0.85)';
const FOCUS = {
  page: union(PRODUCT, PAGE.rects.title, PAGE.rects.card), // the product beside its buy box
  box: PAGE.rects.card, // the buy box's options alone, larger
};

function BuyBoxStill({ headline, focus }: { headline: string; focus: keyof typeof FOCUS }) {
  const { w, h, u, wide, safe } = useStillFrame();
  const m = 5 * u;
  // Wide: the navy column takes the left 46%, the field the rest. Tall: the copy takes the bottom of the safe area,
  // as much height as a two-line headline needs, and the field everything above it.
  const copyH = 0.42 * w;
  const field = wide ? { x: 0.46 * w, y: 0, w: 0.54 * w, h } : { x: 0, y: 0, w, h: safe.y + safe.h - copyH };
  const column = wide
    ? { x: m, y: m + 4 * u, w: field.x - 1.6 * m, h: h - 2 * m - 4 * u }
    : { x: m, y: field.h + 0.9 * m, w: w - 2 * m, h: safe.y + safe.h - field.h - 1.9 * m };
  const cardTop = Math.max(field.y + 1.2 * m, safe.y + 1.2 * m);
  // The card runs off the right edge: the field is too small for the page's shape at a size that makes it the hero,
  // and the bleed says there's more of it.
  const card = { x: field.x + 1.1 * m, y: cardTop, w: field.w + 0.12 * w, h: field.y + field.h - cardTop - 1.2 * m };
  const logo = { x: column.x, y: column.y, w: column.w * 0.6, h: 4.2 * u };
  const rule = { x: column.x, y: logo.y + logo.h + 2.2 * u, w: 9 * u, h: 1.1 * u };
  const headlineBox = { x: column.x, y: rule.y + rule.h + 2.2 * u, w: column.w, h: column.y + column.h - (rule.y + rule.h + 2.2 * u) };
  return (
    <div style={{ position: 'absolute', inset: 0, background: NAVY }}>
      <div style={{ position: 'absolute', left: field.x, top: field.y, width: field.w, height: field.h, background: FIELD }} />
      <StillCard image={PAGE} room={card} focus={FOCUS[focus]} lift={PAGE.rects.swatches[1]} ring={NAVY} />
      {/* Tall, the HUD's top is on the field, where white reads under 4.5:1 and black at 6:1. */}
      <StillHud ink={wide ? PAPER : { top: '#000000', bottom: PAPER }} left="THE NEW BUY BOX" />
      <BrandLogo brand={brand} ground={NAVY} box={logo} />
      <div style={{ position: 'absolute', left: rule.x, top: rule.y, width: rule.w, height: rule.h, background: brand.colors.accent }} />
      <FitText
        name="headline" text={headline} box={headlineBox} max={(wide ? 24 : 30) * u} min={6 * u} align="center"
        face={brand.fonts.display} style={{ fontWeight: 900, lineHeight: 0.92, letterSpacing: '-0.02em', textTransform: 'uppercase', color: brand.colors.light }}
      />
    </div>
  );
}

const HEADLINES = { 'one-box': 'One box.', 'every-colour': 'Every colour. One box.' };

export default defineStills({
  'buy-box': stillDesign({
    component: BuyBoxStill,
    presets: ['og', 'youtube', 'square', 'portrait', 'story'],
    axes: { headline: ['one-box', 'every-colour'], focus: ['page', 'box'] },
    props: ({ headline, focus }) => ({ headline: HEADLINES[headline], focus }),
  }),
});
```

What to copy from it:

- **One component, two branches.** `wide` puts the copy column beside the field; tall puts two lines of copy in the
  bottom of `safe` and the field above. Every size is in `u`.
- **The colours carry the contrast.** Navy ground for the type, the product's magenta for the hero; the HUD's ink
  flips to black where it crosses the magenta.
- **The axes are real choices.** Two headlines and two crops make four variants; the crops differ at feed size
  because `box` is far tighter than `page`.
