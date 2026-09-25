// The new buy box's share images (an OG image, a YouTube thumbnail and the IG sizes) as one design in Painful Pleasures'
// kit (brands/painful-pleasures), and the stills skill's worked example (skills/stills). It is a frame of the motion
// showcase held still: a full-bleed field in the machine's magenta with the real page on a tilted card, one swatch
// lifted off it and ringed, beside (wide) or over (tall) the kit's navy, where the headline is set as big as it fits.
//   studio still buy-box-stills [--preset=og,youtube] [--variant=one-box-page] [--sheet]

import brand from '@brand';
import { BrandLogo, FitText, StillCard, StillHud, defineStills, stillDesign, union, useStillFrame } from '../../lib/studio/api.ts';
import { captures as C } from './captures/index.ts';

const PAGE = C.solice;
const NAVY = brand.colors.primary;
// The magenta swatch as the page draws it (#FF00C2): the product's own colour, so the field is the product's.
const MAGENTA = '#FF00C2';
// The machine's body, found as the dark pixels in the gallery (its photo is on white).
const MACHINE = { x: 274, y: 268, w: 107, h: 428 };
const PAPER = 'rgba(255, 255, 255, 0.85)';
const INK = '#000000';
const SWATCH = PAGE.rects.swatches[1];
const FOCUS = {
  // The machine beside its buy box: the product and what's new about the page, the reel's 03 frame.
  page: union(MACHINE, PAGE.rects.title, PAGE.rects.card),
  // The buy box's options alone, larger: the swatches you tap, the battery and quantity.
  box: PAGE.rects.card,
};

type BuyBoxProps = { headline: string; focus: keyof typeof FOCUS };

function BuyBoxStill({ headline, focus }: BuyBoxProps) {
  const { w, h, u, wide, safe } = useStillFrame();
  const m = 5 * u;
  // Wide: the navy column takes the left 46%, the field the rest. Tall: the copy takes the bottom of the safe area, as
  // much height as a two-line headline needs across the width, and the field everything above it.
  const copyH = 0.42 * w;
  const field = wide ? { x: 0.46 * w, y: 0, w: 0.54 * w, h } : { x: 0, y: 0, w, h: safe.y + safe.h - copyH };
  const column = wide
    ? { x: m, y: m + 4 * u, w: field.x - 1.6 * m, h: h - 2 * m - 4 * u }
    : { x: m, y: field.h + 0.9 * m, w: w - 2 * m, h: safe.y + safe.h - field.h - 1.9 * m };
  // The card fills its field inside a margin; on a story it clears the top bar, which it could run under, for the look.
  const cardTop = Math.max(field.y + 1.2 * m, safe.y + 1.2 * m);
  const card = { x: field.x + 1.1 * m, y: cardTop, w: field.w - 2.2 * m, h: field.y + field.h - cardTop - 1.2 * m };
  const logo = { x: column.x, y: column.y, w: column.w * 0.6, h: 4.2 * u };
  const rule = { x: column.x, y: logo.y + logo.h + 2.2 * u, w: 9 * u, h: 1.1 * u };
  const headlineBox = { x: column.x, y: rule.y + rule.h + 2.2 * u, w: column.w, h: column.y + column.h - (rule.y + rule.h + 2.2 * u) };
  return (
    <div style={{ position: 'absolute', inset: 0, background: NAVY }}>
      <div style={{ position: 'absolute', left: field.x, top: field.y, width: field.w, height: field.h, background: MAGENTA }} />
      <StillCard image={PAGE} box={card} focus={FOCUS[focus]} lift={SWATCH} ring={NAVY} />
      {/* Tall, the top of the HUD is on the field, where white reads under 4.5:1 and black at 6:1 (less under the card's shadow). */}
      <StillHud ink={wide ? PAPER : { top: INK, bottom: PAPER }} left="THE NEW BUY BOX" />
      <BrandLogo brand={brand} ground={NAVY} box={logo} />
      <div style={{ position: 'absolute', left: rule.x, top: rule.y, width: rule.w, height: rule.h, background: brand.colors.accent }} />
      <FitText
        name="headline" text={headline} box={headlineBox} max={(wide ? 24 : 30) * u} min={6 * u} align="center"
        face={brand.fonts.display} style={{ fontWeight: 900, lineHeight: 0.92, letterSpacing: '-0.02em', textTransform: 'uppercase', color: brand.colors.light }}
      />
    </div>
  );
}

const HEADLINES = {
  'one-box': 'One box.',
  'every-colour': 'Every colour. One box.',
};

export default defineStills({
  'buy-box': stillDesign({
    component: BuyBoxStill,
    presets: ['og', 'youtube', 'square', 'portrait', 'story'],
    axes: { headline: ['one-box', 'every-colour'], focus: ['page', 'box'] },
    props: ({ headline, focus }) => ({ headline: HEADLINES[headline], focus }),
  }),
});
