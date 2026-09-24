// Defines every shot the sale-only-view walkthrough shows, from the PR #333 preview theme.
//   studio capture sale-only-view [--only=partial-picked,…]   films them (it imports the default export)
//
// Product pages use the new buy box (`view=ab-buy-box`), the arm of the buy-box A/B test this feature is built on.
// Every shot opens its own page and gets itself to its state, so any can be redone alone.
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const STORE = 'https://www.painfulpleasures.com';
const PREVIEW_THEME = '157093429302';
const COLLECTION = `${STORE}/collections/tattoo-machine-sale`;
const PARTIAL = `${STORE}/products/inkjecta-flite-x1-wireless-tattoo-machine-pick-color`;
const ALL_ON_SALE = `${STORE}/products/peak-matrix-pen-rotary-tattoo-machine-pick-color`;
const BIG_LISTING = `${STORE}/products/kwadron-cartridge-tattoo-needles-box-of-20`;

const BUY_BOX = 'view=ab-buy-box';
const VIEWPORT = { width: 1440, height: 810 };
const PDP_HEIGHT = 1200;
const PICKER = {
  card: '.buy-box__card',
  picker: 'buy-box-picker',
  price: 'product-pricing',
  swatches: ['buy-box-picker .buy-box__option--swatch label.form__label', { all: true }],
  addToCart: '.buy-box [name="add"]',
} as const;
const SALE_NOTE = { callout: '.variant-sale-only', exit: '.variant-sale-only__exit' };
const COMBO = { combo: '.buy-box__combo-input', listbox: '.buy-box__combo-listbox', price: 'product-pricing', card: '.buy-box__card' };

// Attentive's "GET 10% OFF!" SMS teaser (a fixed iframe) arrives at random, so it would flicker between states that
// crossfade.
const HIDE_POPUPS = '#attentive_overlay { display: none !important; }';

// Why a first visit: `preview_theme_id` sets a cookie, so every later URL can be the clean one a shopper would see.
const enterPreview = async (page: Page) => {
  await page.goto(`${STORE}/?preview_theme_id=${PREVIEW_THEME}&pb=0`);
  await page.getByRole('button', { name: 'I Understand' }).click();
  await page.waitForTimeout(1500);
};

const shots = captureShots({
  project: import.meta.dirname,
  viewport: VIEWPORT,
  css: HIDE_POPUPS,
  prepare: enterPreview,
});

const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
};
const settle = (page: Page, ms = 2000) => page.waitForTimeout(ms);

shots.still('home', { setup: (page) => open(page, STORE), height: 1600 });

shots.still('collection', {
  setup: (page) => open(page, `${COLLECTION}?on-sale`),
  height: 1600,
  rects: {
    partialCard: `a[href*="/products/inkjecta-flite-x1"][href*="on-sale"]`,
    allOnSaleCard: `a[href*="/products/peak-matrix-pen"][href*="on-sale"]`,
  },
});

shots.still('partial-today', { setup: (page) => open(page, `${PARTIAL}?${BUY_BOX}`), height: PDP_HEIGHT, rects: PICKER });
shots.still('partial-filtered', { setup: (page) => open(page, `${PARTIAL}?on-sale&${BUY_BOX}`), height: PDP_HEIGHT, rects: { ...PICKER, ...SALE_NOTE } });
const pickSecondSaleSwatch = async (page: Page) => {
  await open(page, `${PARTIAL}?on-sale&${BUY_BOX}`);
  await page.locator('buy-box-picker .buy-box__option--swatch label.form__label:visible').nth(1).click();
  await settle(page);
};
shots.still('partial-picked', { setup: pickSecondSaleSwatch, height: PDP_HEIGHT, rects: { ...PICKER, ...SALE_NOTE } });
shots.still('partial-show-all', {
  setup: async (page) => {
    await pickSecondSaleSwatch(page);
    await page.locator('.variant-sale-only__exit').click();
    await settle(page);
  },
  height: PDP_HEIGHT,
  rects: PICKER,
});

shots.still('all-on-sale', { setup: (page) => open(page, `${ALL_ON_SALE}?on-sale&${BUY_BOX}`), height: PDP_HEIGHT, rects: { ...PICKER, callout: '.variant-sale-only' } });

const openComboOn = async (page: Page, url: string) => {
  await open(page, url);
  await page.locator('.buy-box__combo-input').click();
  await settle(page, 800);
};
shots.still('big-today', { setup: (page) => openComboOn(page, `${BIG_LISTING}?${BUY_BOX}`), height: PDP_HEIGHT, rects: COMBO });
shots.still('big-filtered', { setup: (page) => openComboOn(page, `${BIG_LISTING}?on-sale&${BUY_BOX}`), height: PDP_HEIGHT, rects: { ...COMBO, ...SALE_NOTE } });

// The closing cards sit on a blurred checkout, so put the discounted InkJecta in the cart and photograph the cart.
shots.still('cart', {
  setup: async (page) => {
    await open(page, `${PARTIAL}?on-sale&${BUY_BOX}`);
    await page.locator('.buy-box [name="add"]').click();
    await settle(page, 3000);
    await open(page, `${STORE}/cart`);
  },
  height: 1000,
  rects: { item: 'line-item', checkout: '[name="checkout"]' },
});

export default shots;
