// Films every shot the simple-buy-box walkthrough shows, from the "Flourish Commerce - Dev Theme", which carries
// the build both buy-box arms launch from (the "[FLO] PDP buy box rebuild" theme holds an older simple arm).
//   node projects/2026-09-simple-buy-box/capture.ts [--only=flare-oos,…]
//
// Control is the plain product URL; the new buy box is the same URL with `view=ab-buy-box`. Products and what each
// proves come from the theme repo's docs/demos/2026-09-18-simple-buy-box-loom.md; storyboard.md records what was
// checked against the theme. Every shot opens its own page and gets itself to its state, so any can be redone alone.
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const STORE = 'https://www.painfulpleasures.com';
const PREVIEW_THEME = '147758514230';
const SOLICE = `${STORE}/products/peak-solice-pro-3-wireless-machine`;
const FLARE = `${STORE}/products/color-front-double-flare-plugs-wholesale-glass-body-jewelry-price-per-1`;
const INK = `${STORE}/products/1-bottle-of-intenze-tattoo-ink-1oz-pick-your-color`;
const BALL = `${STORE}/products/black-8g-internal-replacement-ball-internally-threaded-ball`;
const TILUM = `${STORE}/products/18g-16g-internally-threaded-titanium-jewel-ball-top-1`;
const withView = (url: string) => `${url}${url.includes('?') ? '&' : '?'}view=ab-buy-box`;
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
} as const;
const BUY_BOX = {
  card: '.buy-box__card',
  price: 'product-pricing',
  quantity: '.buy-box__quantity',
  stepper: '.buy-box quantity-input',
  plus: '.buy-box button[name="plus"]',
  addToCart: '.buy-box [name="add"]',
  invite: '.buy-box__invite',
  gallery: GALLERY,
} as const;
const PILLS = ['label.buy-box__pill', { all: true }] as const;
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
} as const;

// Why a first visit: `preview_theme_id` sets a cookie, so every later URL can be the clean one a shopper would see.
const enterPreview = async (page: Page) => {
  await page.goto(`${STORE}/?preview_theme_id=${PREVIEW_THEME}&pb=0`);
  await page.getByRole('button', { name: 'I Understand' }).click();
  await page.waitForTimeout(1500);
};

const shots = captureShots({
  project: import.meta.dirname,
  viewport: { width: 1440, height: 810 },
  css: HIDE_POPUPS,
  prepare: enterPreview,
  devices: { phone: { viewport: { width: 390, height: 844 } } },
});

const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
};
const settle = (page: Page, ms = 2000) => page.waitForTimeout(ms);
const stepUp = async (page: Page, plus: string, times: number) => {
  for (let i = 0; i < times; i++) await page.locator(plus).first().click();
  await settle(page, 2200);
};
// Tilum's anodized colour is required, so pick High Polish first or Add to Cart stays disabled.
const pickFinish = async (page: Page) => {
  await page.locator('label.anodization-label:visible').first().click();
  await page.waitForTimeout(1200);
};
const variantId = async (page: Page, url: string, title: string) => {
  const product = await (await page.request.get(`${url}.js`)).json();
  return product.variants.find((v: { title: string }) => v.title === title).id;
};
const pageTop = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

// ---------- 1 · Images and speed: Peak Solice ----------

// On every option change the control puts up the full-page `body.loader-active` spinner while it refetches the whole
// product page for its tier ladder (global.js getTieredPrices). That fetch is held open long enough to photograph it.
const solControl = { ...CONTROL, swatches: ['tab-group label[class*="color-swatch"]', { all: true }] } as const;
shots.still('sol-control', { setup: (page) => open(page, SOLICE), rects: solControl, height: PDP_HEIGHT });
shots.still('sol-control-spin', {
  setup: async (page) => {
    await open(page, SOLICE);
    await page.route(`${SOLICE}*`, async (route) => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 8000));
      await route.continue().catch(() => {});
    });
    await page.locator('tab-group label.color-swatch--pink').click({ noWaitAfter: true });
    await page.waitForSelector('body.loader-active', { state: 'attached' });
    await settle(page, 400);
  },
  rects: solControl,
  height: PDP_HEIGHT,
});

const solNew = { ...BUY_BOX, pills: PILLS, swatches: ['.buy-box label[class*="color-swatch"]', { all: true }] } as const;
shots.still('sol-new', { setup: (page) => open(page, withView(SOLICE)), rects: solNew, height: PDP_HEIGHT });
shots.still('sol-new-pink', {
  setup: async (page) => {
    await open(page, withView(SOLICE));
    await page.locator('.buy-box label.color-swatch--pink').click();
    await settle(page, 600);
  },
  rects: solNew,
  height: PDP_HEIGHT,
});

// ---------- 2 · What's available: flare plugs ----------

// Amber Purple is out of stock at 2mm; Cobalt isn't made at 2.5mm. Picking an out-of-stock colour swaps quantity and
// Add to Cart for the back-in-stock signup, so only what every state has is measured.
const flareRects = { card: '.buy-box__card', price: 'product-pricing', gallery: GALLERY, swatches: ['.buy-box label[class*="color-swatch"]', { all: true }], legends: ['.buy-box legend', { all: true }] } as const;
shots.still('flare-new', { setup: (page) => open(page, withView(FLARE)), rects: { ...flareRects, amber: '.buy-box label.color-swatch--amber-purple' }, height: PDP_HEIGHT });
shots.still('flare-oos', {
  setup: async (page) => {
    await open(page, withView(FLARE));
    await page.locator('.buy-box label.color-swatch--amber-purple').click();
    await settle(page, 1500);
  },
  rects: { ...flareRects, notify: ['.buy-box *', { text: '^notify me when available$' }] },
  height: PDP_HEIGHT,
});
const openFlare25 = async (page: Page) => open(page, withView(`${FLARE}?variant=${await variantId(page, FLARE, '2.5mm ~ 10g / Agave')}`));
shots.still('flare-25', { setup: openFlare25, rects: { ...flareRects, cobalt: '.buy-box label.color-swatch--cobalt' }, height: PDP_HEIGHT });
shots.still('flare-clash', {
  setup: async (page) => {
    await openFlare25(page);
    await page.locator('.buy-box label.color-swatch--cobalt').click();
    await settle(page, 1500);
  },
  rects: { ...flareRects, note: '.buy-box__picker-note' },
  height: PDP_HEIGHT,
});

// ---------- 3 · Finding a colour: Intenze ----------

// The control's colour list is a native menu, which a screenshot can't show open, so its names are recorded for the
// studio to draw.
shots.still('ink-control', {
  setup: (page) => open(page, INK),
  rects: { ...CONTROL, select: 'tab-group select' },
  height: PDP_HEIGHT,
  data: async (page) => ({ names: await page.locator('tab-group select').first().evaluate((s: HTMLSelectElement) => [...s.options].map((o) => o.text.trim())) }),
});
const inkRects = { ...BUY_BOX, combo: '.buy-box__combo' };
const combo = (page: Page) => page.locator('.buy-box input[role="combobox"]').first();
const typeBlue = async (page: Page) => {
  await open(page, withView(INK));
  await combo(page).click();
  await combo(page).fill('blue');
  await settle(page, 1000);
};
const pickBabyBlue = async (page: Page) => {
  await typeBlue(page);
  await page.locator('.buy-box [role="option"]', { hasText: /^Baby Blue$/ }).click();
  await settle(page, 1500);
};
shots.still('ink-new', { setup: (page) => open(page, withView(INK)), rects: inkRects, height: PDP_HEIGHT });
shots.still('ink-typed', {
  setup: typeBlue,
  rects: { ...inkRects, listbox: '.buy-box [role="listbox"]', options: ['.buy-box [role="option"]', { all: true }], matches: ['.buy-box *', { text: '^\\d+ of \\d+ choices$' }] },
  height: PDP_HEIGHT,
});
shots.still('ink-picked', { setup: pickBabyBlue, rects: inkRects, height: PDP_HEIGHT });
shots.still('ink-bulk', {
  setup: async (page) => {
    await pickBabyBlue(page);
    await page.locator('.buy-box__invite').click();
    await settle(page, 1500);
  },
  rects: BULK,
  height: PDP_HEIGHT,
});

// ---------- 4 · Sales and volume pricing ----------

// The 8g ball's sizes carry different markdowns (8mm none, 10mm 29%, 11mm 30%) and 16mm has a volume ladder; then
// Tilum at quantity 5 in both arms.
shots.still('ball-control', { setup: (page) => open(page, BALL), rects: { ...CONTROL, sale: ['main *', { text: '^sale$' }] }, height: PDP_HEIGHT });
shots.still('ball-8', { setup: (page) => open(page, withView(BALL)), rects: WITH_TIERS, height: PDP_HEIGHT });
for (const [name, index] of [['ball-10', 1], ['ball-11', 2], ['ball-16', 4]] as const) {
  shots.still(name, {
    setup: async (page) => {
      await open(page, withView(BALL));
      await page.locator('label.buy-box__pill:visible').nth(index).click();
      await settle(page, 2500);
    },
    rects: WITH_TIERS,
    height: PDP_HEIGHT,
  });
}

const openTilum = async (page: Page, url: string) => {
  await open(page, url);
  await pickFinish(page);
};
shots.still('tilum-control', { setup: (page) => openTilum(page, TILUM), rects: CONTROL, height: PDP_HEIGHT });
shots.still('tilum-control-q5', {
  setup: async (page) => {
    await openTilum(page, TILUM);
    await stepUp(page, CONTROL.plus, 4);
  },
  rects: CONTROL,
  height: PDP_HEIGHT,
});
shots.still('tilum-new', { setup: (page) => openTilum(page, withView(TILUM)), rects: WITH_TIERS, height: PDP_HEIGHT });
shots.still('tilum-new-q5', {
  setup: async (page) => {
    await openTilum(page, withView(TILUM));
    await stepUp(page, BUY_BOX.plus, 4);
  },
  rects: WITH_TIERS,
  height: PDP_HEIGHT,
});

// ---------- 5 · Bulk ordering, Tilum ----------

// Control's Multiple Items tab first; then the new grid: a facet, search and on-sale-only, each from a clear grid (a
// filtered-out quantity still counts, which reads as a bug on camera).
shots.still('tilum-control-bulk', {
  setup: async (page) => {
    await open(page, TILUM);
    await page.getByRole('tab', { name: 'Multiple Items' }).click();
    await settle(page, 1500);
  },
  rects: { box: 'tab-group', reset: ['tab-group button', { text: '^reset$' }] },
  height: 1800,
});
const openTilumBulk = async (page: Page) => {
  await open(page, withView(TILUM));
  await page.locator('.buy-box__invite').click();
  await settle(page, 1500);
};
shots.still('tilum-bulk', { setup: openTilumBulk, rects: { ...BULK, facet: ['.bulk-order__facet-value', { text: '^3mm' }] }, height: PDP_HEIGHT });
shots.still('tilum-bulk-facet', {
  setup: async (page) => {
    await openTilumBulk(page);
    await page.locator('.bulk-order__facet-value', { hasText: /^3mm/ }).click();
    await settle(page, 1200);
  },
  rects: BULK,
  height: PDP_HEIGHT,
});
shots.still('tilum-bulk-search', {
  setup: async (page) => {
    await openTilumBulk(page);
    await page.locator('.bulk-order__filter-input').fill('blue');
    await settle(page, 1200);
  },
  rects: BULK,
  height: PDP_HEIGHT,
});
shots.still('tilum-bulk-sale', {
  setup: async (page) => {
    await openTilumBulk(page);
    await page.locator('.bulk-order__toggle', { hasText: /on sale/i }).click();
    await settle(page, 1200);
  },
  rects: BULK,
  height: PDP_HEIGHT,
});
shots.still('tilum-bulk-typed', {
  setup: async (page) => {
    await openTilumBulk(page);
    const rowQuantity = (...words: string[]) => words.reduce((row, w) => row.filter({ hasText: w }), page.locator('bulk-order bulk-line')).first().locator('input.js-bulk-quantity');
    await rowQuantity('AB', '2mm').fill('10');
    await rowQuantity('AB', '2mm').press('Tab');
    await rowQuantity('Aqua', '3mm').fill('6');
    await rowQuantity('Aqua', '3mm').press('Tab');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await settle(page, 2500);
  },
  rects: { ...BULK, receipt: '.bulk-order__receipt' },
  height: 1800,
});

// ---------- 6 · Phones ----------

// The sticky bar once the buy box is out of view, the new bulk grid under its pinned total, and the control's bulk
// list boxed into its own scroller.
shots.still('phone-top', { device: 'phone', setup: (page) => openTilum(page, withView(TILUM)), scrollY: 0 });
shots.still('phone-bar', { device: 'phone', setup: (page) => openTilum(page, withView(TILUM)), scrollY: 2000, rects: { bar: 'buy-box-sticky-atc' } });

shots.still('phone-bulk', {
  device: 'phone',
  setup: async (page) => {
    await openTilum(page, withView(TILUM));
    await page.locator('.buy-box__invite').click();
    await settle(page, 1500);
    const quantities = page.locator('bulk-order input.js-bulk-quantity:visible');
    await quantities.nth(0).fill('4');
    await quantities.nth(0).press('Tab');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await settle(page);
  },
  scrollY: async (page) => (await pageTop(page, 'bulk-order bulk-line')) - 160,
  rects: { footer: '.bulk-order__footer' },
});
shots.still('phone-control-bulk', {
  device: 'phone',
  setup: async (page) => {
    await openTilum(page, TILUM);
    await page.getByRole('tab', { name: 'Multiple Items' }).click();
    await settle(page, 1500);
  },
  scrollY: async (page) => (await pageTop(page, 'tab-group')) - 40,
  rects: { scroller: ['tab-group *', { scrolls: true }] as const },
});

await shots.run();
