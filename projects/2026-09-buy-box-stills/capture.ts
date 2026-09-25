// The buy-box stills' one shot: the Peak Solice page with the new buy box, on the "Flourish Commerce - Dev Theme"
// (see simple-buy-box-story's capture.ts), the product photo beside a card of instant swatches. Filmed at 3× device
// pixels, since a story crop fills 1080 px with about 430 page px.
//   studio capture buy-box-stills
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const STORE = 'https://www.painfulpleasures.com';
const PREVIEW_THEME = '147758514230';
const SOLICE = `${STORE}/products/peak-solice-pro-3-wireless-machine?view=ab-buy-box`;

// Attentive's SMS teaser arrives at random, and the sticky bar floats mid-page. A still crops into the page, so the
// header, breadcrumb, gallery thumbnails and arrow and the closed cart drawer's shadow go, the layout kept.
const CSS = [
  '#attentive_overlay, buy-box-sticky-atc { display: none !important; }',
  '.shopify-section-group-header-group, nav.breadcrumbs, slider-component.thumbnail-slider, button:has(.nav-arrow-icon-right) { visibility: hidden !important; }',
  'aside:has(#shopify-section-cart-form) { box-shadow: none !important; }',
].join(' ');

// `preview_theme_id` sets a cookie, so later URLs can be the clean ones a shopper sees.
const enterPreview = async (page: Page) => {
  await page.goto(`${STORE}/?preview_theme_id=${PREVIEW_THEME}&pb=0`);
  await page.getByRole('button', { name: 'I Understand' }).click();
  await page.waitForTimeout(1500);
};

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1100, height: 619 }, scale: 3, css: CSS, prepare: enterPreview });

shots.still('solice', {
  setup: async (page) => {
    await page.goto(SOLICE, { waitUntil: 'load' });
    await page.waitForTimeout(3500);
  },
  rects: {
    gallery: '.product__media img',
    title: 'h1.h3',
    price: 'product-pricing',
    card: '.buy-box__card',
    swatches: ['.buy-box label[class*="color-swatch"]', { all: true }],
    addToCart: '.buy-box [name="add"]',
  },
  height: 900,
});

export default shots;
