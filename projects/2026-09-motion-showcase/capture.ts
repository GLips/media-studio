// The motion showcase's shots: the new buy box on the "Flourish Commerce - Dev Theme", the same pages the
// simple-buy-box walkthrough films (see its capture.ts for what each product proves). Filmed at 3× device pixels, since
// this piece crops single controls (a swatch row, a price) to fill the frame.
//   studio capture motion-showcase [--only=sol,…]
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const STORE = 'https://www.painfulpleasures.com';
const PREVIEW_THEME = '147758514230';
const SOLICE = `${STORE}/products/peak-solice-pro-3-wireless-machine`;
const INK = `${STORE}/products/1-bottle-of-intenze-tattoo-ink-1oz-pick-your-color`;
const withView = (url: string) => `${url}${url.includes('?') ? '&' : '?'}view=ab-buy-box`;
const PDP_HEIGHT = 1400;

// Attentive's SMS teaser arrives at random; the sticky bar floats mid-page on a tall shot.
const CSS = '#attentive_overlay, buy-box-sticky-atc { display: none !important; }';

const BUY_BOX = {
  card: '.buy-box__card',
  price: 'product-pricing',
  quantity: '.buy-box__quantity',
  stepper: '.buy-box quantity-input',
  plus: '.buy-box button[name="plus"]',
  addToCart: '.buy-box [name="add"]',
  invite: '.buy-box__invite',
  gallery: '.product__media img',
} as const;

// `preview_theme_id` sets a cookie, so later URLs can be the clean ones a shopper sees.
const enterPreview = async (page: Page) => {
  await page.goto(`${STORE}/?preview_theme_id=${PREVIEW_THEME}&pb=0`);
  await page.getByRole('button', { name: 'I Understand' }).click();
  await page.waitForTimeout(1500);
};

// The Solice stills are filmed on a narrower desktop. At 1100 px the product name sets on one line in the compact
// column's smaller type (381 px) over swatches still 42 px, so a frame that holds the whole name shows them 30% larger
// than at 1440, where the layout stops growing.
const COMPACT_DESKTOP = { viewport: { width: 1100, height: 619 }, scale: 3, mobile: false };
// The desktop at 6×: bar 5 fills the frame with the search list, its rows at up to 7 frame px per page px, which a 3×
// capture could only upscale soft. The same 1440 layout, so the list's page-px rects don't move.
const CLOSE_DESKTOP = { viewport: { width: 1440, height: 810 }, scale: 6, mobile: false };

const shots = captureShots({
  project: import.meta.dirname, viewport: { width: 1440, height: 810 }, scale: 3, css: CSS, prepare: enterPreview,
  devices: { 'compact-desktop': COMPACT_DESKTOP, 'close-desktop': CLOSE_DESKTOP },
});

const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
};
const settle = (page: Page, ms = 2000) => page.waitForTimeout(ms);

// ---------- instant swatches: Peak Solice ----------

// The title sits outside the buy-box element, as the only h1.h3 on the page.
const sol = {
  ...BUY_BOX, title: 'h1.h3', klarna: 'klarna-placement', legend: '.product-option--color legend',
  pills: ['label.buy-box__pill', { all: true }], swatches: ['.buy-box label[class*="color-swatch"]', { all: true }],
} as const;
const swatch = (n: number) => (page: Page) => page.locator('.buy-box label[class*="color-swatch"]').nth(n).click();
// Bar 3 films this page edge to edge, so what its card's edges would cut to fragments goes, the layout kept: the site
// header and breadcrumb above the title, the gallery's arrow buttons beside the swatches, and the closed cart drawer's
// shadow, a grey strip down the right edge where the bar runs the page on in white.
const SOL_CLEAN_EDGES = [
  '.shopify-section-group-header-group, nav.breadcrumbs, .image-arrows { visibility: hidden !important; }',
  'aside:has(#shopify-section-cart-form) { box-shadow: none !important; }',
].join(' ');
shots.still('sol', {
  device: 'compact-desktop',
  setup: async (page) => {
    await open(page, withView(SOLICE));
    await page.addStyleTag({ content: SOL_CLEAN_EDGES });
  },
  rects: sol,
  height: PDP_HEIGHT,
});
// Bar 3 sets each colour's name in the options panel under the swatches, so these pages clear the battery and quantity
// rows there, their layout kept: the panel's lower half is blank for the word.
const SOL_WORD_BAND = `${SOL_CLEAN_EDGES} .buy-box__option--pill, .buy-box__group { visibility: hidden !important; }`;
for (const [name, picks] of [['sol-pink-word', [swatch(1)]], ['sol-grey-word', [swatch(2)]], ['sol-black-word', []]] as const) {
  shots.still(name, {
    device: 'compact-desktop',
    setup: async (page) => {
      await open(page, withView(SOLICE));
      await page.addStyleTag({ content: SOL_WORD_BAND });
      for (const pick of picks) {
        await pick(page);
        await settle(page, 800);
      }
    },
    rects: sol,
    height: PDP_HEIGHT,
  });
}

// ---------- 174 inks, searched: Intenze ----------

const combo = (page: Page) => page.locator('.buy-box input[role="combobox"]').first();
const inkRects = { ...BUY_BOX, combo: '.buy-box__combo' };
// Bar 5 dives into "blue" typed in the search and scrolls the page up through its card, about four rows: filmed down
// to the listbox's foot (967 px, seven rows) so the rows that scroll in have pixels, and no further, since the page
// below would be thousands of rows of pixels at 6× that no frame shows.
shots.still('ink-blue-list', {
  device: 'close-desktop',
  setup: async (page) => {
    await open(page, withView(INK));
    await combo(page).click();
    await combo(page).fill('blue');
    await settle(page, 1000);
  },
  rects: { ...inkRects, listbox: '.buy-box [role="listbox"]', options: ['.buy-box [role="option"]', { all: true }] },
  height: 1000,
});

export default shots;
