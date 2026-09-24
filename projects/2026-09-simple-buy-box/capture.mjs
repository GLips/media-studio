// Photographs every state the simple-buy-box walkthrough shows, from the "Flourish Commerce - Dev Theme", which carries
// the build both buy-box arms launch from (the "[FLO] PDP buy box rebuild" theme holds an older simple arm).
//   node projects/2026-09-simple-buy-box/capture.mjs
//
// Control is the plain product URL; the new buy box is the same URL with `view=ab-buy-box`. Products and what each
// proves come from the theme repo's docs/demos/2026-09-18-simple-buy-box-loom.md; storyboard.md records what was
// checked against the theme.
import { openCaptureSession } from '../../lib/capture.mjs';

const STORE = 'https://www.painfulpleasures.com';
const PREVIEW_THEME = '147758514230';
const SOLICE = `${STORE}/products/peak-solice-pro-3-wireless-machine`;
const FLARE = `${STORE}/products/color-front-double-flare-plugs-wholesale-glass-body-jewelry-price-per-1`;
const INK = `${STORE}/products/1-bottle-of-intenze-tattoo-ink-1oz-pick-your-color`;
const BALL = `${STORE}/products/black-8g-internal-replacement-ball-internally-threaded-ball`;
const TILUM = `${STORE}/products/18g-16g-internally-threaded-titanium-jewel-ball-top-1`;
const withView = (url) => `${url}${url.includes('?') ? '&' : '?'}view=ab-buy-box`;
const PDP_HEIGHT = 1400;

// Attentive's "GET 10% OFF!" SMS teaser (a fixed iframe) arrives at random, so it would flicker between states that
// crossfade.
const HIDE_POPUPS = '#attentive_overlay { display: none !important; }';

const GALLERY = '.product__media img';
const CONTROL = {
  price: 'product-pricing',
  box: 'tab-group',
  tabs: ['tab-group [role="tab"]', { all: true }],
  plus: 'tab-group button[name="plus"]',
  stepper: 'tab-group quantity-input',
  gallery: GALLERY,
};
const BUY_BOX = {
  card: '.buy-box__card',
  price: 'product-pricing',
  quantity: '.buy-box__quantity',
  stepper: '.buy-box quantity-input',
  plus: '.buy-box button[name="plus"]',
  addToCart: '.buy-box [name="add"]',
  invite: '.buy-box__invite',
  gallery: GALLERY,
};
const PILLS = ['label.buy-box__pill', { all: true }];
// Only products with volume pricing (or a markdown that beats it) draw the tier list.
const WITH_TIERS = { ...BUY_BOX, pills: PILLS, tiers: '.buy-box__tiers' };
const BULK = {
  card: '.buy-box__card',
  back: '.buy-box__back',
  // Facets need two varying options, and the filters need a long enough list.
  facets: ['.bulk-order__facets', { optional: true }],
  filter: ['.bulk-order__filter-input', { optional: true }],
  count: ['.bulk-order__count', { optional: true }],
  onSale: ['.bulk-order__toggle', { text: 'on sale', optional: true }],
  footer: '.bulk-order__footer',
  reset: '.bulk-order__reset',
  lines: ['bulk-order bulk-line', { all: true }],
};

const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }, css: HIDE_POPUPS });
const { page, snap } = session;

// Why a first visit: `preview_theme_id` sets a cookie, so every later URL can be the clean one a shopper would see.
const enterPreview = async (p) => {
  await p.goto(`${STORE}/?preview_theme_id=${PREVIEW_THEME}&pb=0`);
  await p.getByRole('button', { name: 'I Understand' }).click();
  await p.waitForTimeout(1500);
};
const openOn = (p) => async (url) => {
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(3500);
};
const open = openOn(page);
const settle = (ms = 2000) => page.waitForTimeout(ms);
const stepUp = async (plus, times) => {
  for (let i = 0; i < times; i++) await page.locator(plus).first().click();
  await settle(2200);
};
// Tilum's anodized colour is required, so pick High Polish first or Add to Cart stays disabled.
const pickFinish = async (p = page) => {
  await p.locator('label.anodization-label:visible').first().click();
  await p.waitForTimeout(1200);
};
const variantId = async (url, title) => {
  const product = await (await page.request.get(`${url}.js`)).json();
  return product.variants.find((v) => v.title === title).id;
};

await enterPreview(page);

// 1 · Images and speed: Peak Solice. On every option change the control puts up the full-page `body.loader-active`
// spinner while it refetches the whole product page for its tier ladder (global.js getTieredPrices). That fetch is
// held open long enough to photograph the spinner.
await open(SOLICE);
const solControl = { ...CONTROL, swatches: ['tab-group label[class*="color-swatch"]', { all: true }] };
await snap('sol-control', { height: PDP_HEIGHT, rects: solControl });
const holdPageRefetch = async (route) => {
  if (route.request().resourceType() !== 'fetch') return route.continue();
  await new Promise((resolve) => setTimeout(resolve, 8000));
  await route.continue();
};
await page.route(`${SOLICE}*`, holdPageRefetch);
await page.locator('tab-group label.color-swatch--pink').click({ noWaitAfter: true });
await page.waitForSelector('body.loader-active', { state: 'attached' });
await settle(400);
await snap('sol-control-spin', { height: PDP_HEIGHT, rects: solControl });
await settle(9000);
await page.unroute(`${SOLICE}*`, holdPageRefetch);

await open(withView(SOLICE));
const solNew = { ...BUY_BOX, pills: PILLS, swatches: ['.buy-box label[class*="color-swatch"]', { all: true }] };
await snap('sol-new', { height: PDP_HEIGHT, rects: solNew });
await page.locator('.buy-box label.color-swatch--pink').click();
await settle(600);
await snap('sol-new-pink', { height: PDP_HEIGHT, rects: solNew });

// 2 · What's available: flare plugs. Amber Purple is out of stock at 2mm; Cobalt isn't made at 2.5mm.
// Picking an out-of-stock colour swaps quantity and Add to Cart for the back-in-stock signup, so only what every
// state has is measured.
const flareRects = { card: '.buy-box__card', price: 'product-pricing', gallery: GALLERY, swatches: ['.buy-box label[class*="color-swatch"]', { all: true }], legends: ['.buy-box legend', { all: true }] };
await open(withView(FLARE));
await snap('flare-new', { height: PDP_HEIGHT, rects: { ...flareRects, amber: '.buy-box label.color-swatch--amber-purple' } });
await page.locator('.buy-box label.color-swatch--amber-purple').click();
await settle(1500);
await snap('flare-oos', { height: PDP_HEIGHT, rects: { ...flareRects, notify: ['.buy-box *', { text: '^notify me when available$' }] } });
await open(withView(`${FLARE}?variant=${await variantId(FLARE, '2.5mm ~ 10g / Agave')}`));
await snap('flare-25', { height: PDP_HEIGHT, rects: { ...flareRects, cobalt: '.buy-box label.color-swatch--cobalt' } });
await page.locator('.buy-box label.color-swatch--cobalt').click();
await settle(1500);
await snap('flare-clash', { height: PDP_HEIGHT, rects: { ...flareRects, note: '.buy-box__picker-note' } });

// 3 · Finding a colour: Intenze. The control's colour list is a native menu, which a screenshot can't show open, so
// its names are recorded for the studio to draw.
await open(INK);
const inkNames = await page.locator('tab-group select').first().evaluate((s) => [...s.options].map((o) => o.text.trim()));
await snap('ink-control', { height: PDP_HEIGHT, rects: { ...CONTROL, select: 'tab-group select' }, data: { names: inkNames } });
await open(withView(INK));
const inkRects = { ...BUY_BOX, combo: '.buy-box__combo' };
await snap('ink-new', { height: PDP_HEIGHT, rects: inkRects });
const combo = page.locator('.buy-box input[role="combobox"]').first();
await combo.click();
await combo.fill('blue');
await settle(1000);
await snap('ink-typed', { height: PDP_HEIGHT, rects: { ...inkRects, listbox: '.buy-box [role="listbox"]', options: ['.buy-box [role="option"]', { all: true }], matches: ['.buy-box *', { text: '^\\d+ of \\d+ choices$' }] } });
await page.locator('.buy-box [role="option"]', { hasText: /^Baby Blue$/ }).click();
await settle(1500);
await snap('ink-picked', { height: PDP_HEIGHT, rects: inkRects });
await page.locator('.buy-box__invite').click();
await settle(1500);
await snap('ink-bulk', { height: PDP_HEIGHT, rects: BULK });

// 4 · Sales and volume pricing: the 8g ball's sizes carry different markdowns (8mm none, 10mm 29%, 11mm 30%) and
// 16mm has a volume ladder; then Tilum at quantity 5 in both arms.
await open(BALL);
await snap('ball-control', { height: PDP_HEIGHT, rects: { ...CONTROL, sale: ['main *', { text: '^sale$' }] } });
await open(withView(BALL));
await snap('ball-8', { height: PDP_HEIGHT, rects: WITH_TIERS });
for (const [name, index] of [['ball-10', 1], ['ball-11', 2], ['ball-16', 4]]) {
  await page.locator('label.buy-box__pill:visible').nth(index).click();
  await settle(2500);
  await snap(name, { height: PDP_HEIGHT, rects: WITH_TIERS });
}

await open(TILUM);
await pickFinish();
await snap('tilum-control', { height: PDP_HEIGHT, rects: CONTROL });
await stepUp(CONTROL.plus, 4);
await snap('tilum-control-q5', { height: PDP_HEIGHT, rects: CONTROL });
await open(withView(TILUM));
await pickFinish();
await snap('tilum-new', { height: PDP_HEIGHT, rects: WITH_TIERS });
await stepUp(BUY_BOX.plus, 4);
await snap('tilum-new-q5', { height: PDP_HEIGHT, rects: WITH_TIERS });

// 5 · Bulk ordering, Tilum. Control's Multiple Items tab first; then the new grid: a facet, search and on-sale-only,
// each cleared before quantities go in (a filtered-out quantity still counts, which reads as a bug on camera).
await open(TILUM);
await page.getByRole('tab', { name: 'Multiple Items' }).click();
await settle(1500);
await snap('tilum-control-bulk', { height: 1800, rects: { box: 'tab-group', reset: ['tab-group button', { text: '^reset$' }] } });
await open(withView(TILUM));
await page.locator('.buy-box__invite').click();
await settle(1500);
const facet = page.locator('.bulk-order__facet-value', { hasText: /^3mm/ });
await snap('tilum-bulk', { height: PDP_HEIGHT, rects: { ...BULK, facet: ['.bulk-order__facet-value', { text: '^3mm' }] } });
await facet.click();
await settle(1200);
await snap('tilum-bulk-facet', { height: PDP_HEIGHT, rects: BULK });
await facet.click();
await page.locator('.bulk-order__filter-input').fill('blue');
await settle(1200);
await snap('tilum-bulk-search', { height: PDP_HEIGHT, rects: BULK });
await page.locator('.bulk-order__filter-input').fill('');
const onSale = page.locator('.bulk-order__toggle', { hasText: /on sale/i });
await onSale.click();
await settle(1200);
await snap('tilum-bulk-sale', { height: PDP_HEIGHT, rects: BULK });
await onSale.click();
await settle(1000);
const rowQuantity = (...words) => words.reduce((row, w) => row.filter({ hasText: w }), page.locator('bulk-order bulk-line')).first().locator('input.js-bulk-quantity');
await rowQuantity('AB', '2mm').fill('10');
await rowQuantity('AB', '2mm').press('Tab');
await rowQuantity('Aqua', '3mm').fill('6');
await rowQuantity('Aqua', '3mm').press('Tab');
await page.evaluate(() => document.activeElement.blur());
await settle(2500);
await snap('tilum-bulk-typed', { height: 1800, rects: { ...BULK, receipt: '.bulk-order__receipt' } });

// 6 · Phones: the sticky bar once the buy box is out of view, the new bulk grid under its pinned total, and the
// control's bulk list boxed into its own scroller.
const phone = await session.openDevice({ viewport: { width: 390, height: 844 } });
await enterPreview(phone.page);
const openPhone = openOn(phone.page);
await openPhone(withView(TILUM));
await pickFinish(phone.page);
await phone.snap('phone-top', { scrollY: 0 });
await phone.snap('phone-bar', { scrollY: 2000, rects: { bar: 'buy-box-sticky-atc' } });
await phone.page.locator('.buy-box__invite').click();
await phone.page.waitForTimeout(1500);
const phoneQty = phone.page.locator('bulk-order input.js-bulk-quantity:visible');
await phoneQty.nth(0).fill('4');
await phoneQty.nth(0).press('Tab');
await phone.page.evaluate(() => document.activeElement.blur());
await phone.page.waitForTimeout(2000);
const rowsTop = await phone.page.locator('bulk-order bulk-line').first().evaluate((el) => el.getBoundingClientRect().top + scrollY);
await phone.snap('phone-bulk', { scrollY: rowsTop - 160, rects: { footer: '.bulk-order__footer' } });
await openPhone(TILUM);
await pickFinish(phone.page);
await phone.page.getByRole('tab', { name: 'Multiple Items' }).click();
await phone.page.waitForTimeout(1500);
const tabsTop = await phone.page.locator('tab-group').evaluate((el) => el.getBoundingClientRect().top + scrollY);
await phone.snap('phone-control-bulk', { scrollY: tabsTop - 40, rects: { scroller: ['tab-group *', { scrolls: true }] } });

await session.close();
