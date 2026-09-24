// Photographs every state the sale-only-view walkthrough shows, from the PR #333 preview theme.
//   node projects/2026-09-sale-only-view/capture.mjs
//
// Product pages use the new buy box (`view=ab-buy-box`), the arm of the buy-box A/B test this feature is built on.
import { openCaptureSession } from '../../lib/capture.mjs';

const STORE = 'https://www.painfulpleasures.com';
const PREVIEW_THEME = '157093429302';
const COLLECTION = `${STORE}/collections/tattoo-machine-sale`;
const PARTIAL = `${STORE}/products/inkjecta-flite-x1-wireless-tattoo-machine-pick-color`;
const ALL_ON_SALE = `${STORE}/products/peak-matrix-pen-rotary-tattoo-machine-pick-color`;
const BIG_LISTING = `${STORE}/products/kwadron-cartridge-tattoo-needles-box-of-20`;

const BUY_BOX = 'view=ab-buy-box';
const PDP_HEIGHT = 1200;
const PICKER = {
  card: '.buy-box__card',
  picker: 'buy-box-picker',
  price: 'product-pricing',
  swatches: ['buy-box-picker .buy-box__option--swatch label.form__label', { all: true }],
  addToCart: '.buy-box [name="add"]',
};
const SALE_NOTE = { callout: '.variant-sale-only', exit: '.variant-sale-only__exit' };

// Attentive's "GET 10% OFF!" SMS teaser (a fixed iframe) arrives at random, so it would flicker between states that
// crossfade.
const HIDE_POPUPS = '#attentive_overlay { display: none !important; }';

const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }, css: HIDE_POPUPS });
const { page, snap } = session;

// Why a first visit: `preview_theme_id` sets a cookie, so every later URL can be the clean one a shopper would see.
await page.goto(`${STORE}/?preview_theme_id=${PREVIEW_THEME}&pb=0`);
await page.getByRole('button', { name: 'I Understand' }).click();
await page.waitForTimeout(2500);
await snap('home', { height: 1600 });

const open = async (url) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
};

await open(`${COLLECTION}?on-sale`);
await snap('collection', {
  height: 1600,
  rects: {
    partialCard: `a[href*="/products/inkjecta-flite-x1"][href*="on-sale"]`,
    allOnSaleCard: `a[href*="/products/peak-matrix-pen"][href*="on-sale"]`,
  },
});

await open(`${PARTIAL}?${BUY_BOX}`);
await snap('partial-today', { height: PDP_HEIGHT, rects: PICKER });

await open(`${PARTIAL}?on-sale&${BUY_BOX}`);
await snap('partial-filtered', { height: PDP_HEIGHT, rects: { ...PICKER, ...SALE_NOTE } });

await page.locator('buy-box-picker .buy-box__option--swatch label.form__label:visible').nth(1).click();
await page.waitForTimeout(2000);
await snap('partial-picked', { height: PDP_HEIGHT, rects: { ...PICKER, ...SALE_NOTE } });

await page.locator('.variant-sale-only__exit').click();
await page.waitForTimeout(2000);
await snap('partial-show-all', { height: PDP_HEIGHT, rects: PICKER });

await open(`${ALL_ON_SALE}?on-sale&${BUY_BOX}`);
await snap('all-on-sale', { height: PDP_HEIGHT, rects: { ...PICKER, callout: '.variant-sale-only' } });

const COMBO = { combo: '.buy-box__combo-input', listbox: '.buy-box__combo-listbox', price: 'product-pricing', card: '.buy-box__card' };

await open(`${BIG_LISTING}?${BUY_BOX}`);
await page.locator('.buy-box__combo-input').click();
await page.waitForTimeout(800);
await snap('big-today', { height: PDP_HEIGHT, rects: COMBO });

await open(`${BIG_LISTING}?on-sale&${BUY_BOX}`);
await page.locator('.buy-box__combo-input').click();
await page.waitForTimeout(800);
await snap('big-filtered', { height: PDP_HEIGHT, rects: { ...COMBO, ...SALE_NOTE } });

// The closing cards sit on a blurred checkout, so put the discounted InkJecta in the cart and photograph the cart.
await open(`${PARTIAL}?on-sale&${BUY_BOX}`);
await page.locator('.buy-box [name="add"]').click();
await page.waitForTimeout(3000);
await open(`${STORE}/cart`);
await snap('cart', { height: 1000, rects: { item: 'line-item', checkout: '[name="checkout"]' } });

await session.close();
