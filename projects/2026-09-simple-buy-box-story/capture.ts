// Defines every shot the simple-buy-box walkthrough shows, from the "Flourish Commerce - Dev Theme", which carries the
// build both buy-box arms launch from (the "[FLO] PDP buy box rebuild" theme holds an older simple arm).
//   studio capture simple-buy-box-story [--only=kw-new-browse,…]   films them (it imports the default export)
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
const KWADRON = `${STORE}/products/kwadron-cartridge-tattoo-needles-box-of-20`;
const KWADRON_SHEET = '15f292c5';
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
// Native dropdowns can't be photographed open, so their option names are recorded for the studio to draw.
const optionNames = (page: Page, select: string) => page.locator(select).first().evaluate((s: HTMLSelectElement) => [...s.options].map((o) => o.text.trim()));

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
// The flip-through: pink, then every colour, then both batteries. Each state is its clicks from a fresh page.
const solNewPicks: [string, ((page: Page) => Promise<void>)[]][] = [];
const swatch = (n: number) => (page: Page) => page.locator('.buy-box label[class*="color-swatch"]').nth(n).click();
const pink = (page: Page) => page.locator('.buy-box label.color-swatch--pink').click();
const doubleBattery = (page: Page) => page.locator('label.buy-box__pill', { hasText: 'Double Battery' }).click();
solNewPicks.push(['sol-new-pink', [pink]], ['sol-new-grey', [swatch(2)]], ['sol-new-grey-double', [swatch(2), doubleBattery]], ['sol-new-black-double', [swatch(2), doubleBattery, swatch(0)]]);
for (const [name, picks] of solNewPicks) {
  shots.still(name, {
    setup: async (page) => {
      await open(page, withView(SOLICE));
      for (const pick of picks) {
        await pick(page);
        await settle(page, 600);
      }
    },
    rects: solNew,
    height: PDP_HEIGHT,
  });
}

// Kwadron's ninth photo is a spec sheet, so small text shows the soft control image best. Only the gallery is in
// shot, so it's fine that this compound product is the complex arm's territory.
const kwSheet = { sheet: `.product__media img[src*="${KWADRON_SHEET}"]` };
const thumb = (page: Page, n: number) => page.locator('.thumbnail-list li').nth(n);
const openKwadronSpecSheet = async (page: Page, url: string) => {
  await open(page, url);
  await thumb(page, 8).click();
  await settle(page, 1500);
};
shots.still('kw-control', { setup: (page) => openKwadronSpecSheet(page, KWADRON), rects: kwSheet, height: PDP_HEIGHT });
shots.still('kw-new', { setup: (page) => openKwadronSpecSheet(page, withView(KWADRON)), rects: kwSheet, height: PDP_HEIGHT });

// The same, filmed: a shopper picks the spec sheet's thumbnail and the gallery changes to it. Off camera, the strip is
// slid along so the ninth thumbnail shows and the page scrolled so it's in view; on camera, the page then rises to
// the sheet.
for (const [name, url] of [['kw-control-browse', KWADRON], ['kw-new-browse', withView(KWADRON)]] as const) {
  shots.take(name, {
    setup: async (page) => {
      await open(page, url);
      // The gallery lazy-loads, so the photo would blank for a moment when picked: a load the story isn't about.
      await page.locator(`${GALLERY}, .thumbnail-list img`).evaluateAll((imgs) => Promise.all(imgs.map((img) => {
        (img as HTMLImageElement).loading = 'eager';
        return (img as HTMLImageElement).decode().catch(() => {});
      })));
      await thumb(page, 8).evaluate((li) => li.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      // The thumbnail at 60% down the viewport: lower and, framed in a split panel, the click lands under the caption.
      const thumbTop = await thumb(page, 8).evaluate((li) => li.getBoundingClientRect().top + window.scrollY);
      await page.evaluate((y) => window.scrollTo(0, y), thumbTop - page.viewportSize()!.height * 0.6);
      await settle(page, 1200);
    },
    perform: async (rec) => {
      await rec.wait(0.6);
      await rec.click(thumb(rec.page, 8), { mark: 'pick', rects: { gallery: GALLERY, thumb: '.thumbnail-list li:nth-child(9)' } });
      await rec.wait(0.9);
      await rec.scrollTo(GALLERY, { margin: 70 });
      await rec.wait(0.5);
      await rec.mark('shown', { rects: { ...kwSheet, gallery: GALLERY } });
      await rec.wait(0.6);
    },
  });
}

// ---------- 2 · What's available: flare plugs ----------

// Amber Purple is out of stock at 2mm; Cobalt isn't made at 2.5mm. Picking an out-of-stock colour swaps quantity and
// Add to Cart for the back-in-stock signup, so only what every state has is measured. Today's page gives no sign that
// Amber Purple is out of stock at 2mm until it's picked.
const flareControl = { box: 'tab-group', price: 'product-pricing', gallery: GALLERY, amber: 'tab-group label.color-swatch--amber-purple', gauge: 'tab-group select', addToCart: ['tab-group [name="add"]', { optional: true }] } as const;
shots.still('flare-control', { setup: (page) => open(page, FLARE), rects: flareControl, height: PDP_HEIGHT, data: async (page) => ({ gauge: await optionNames(page, 'tab-group select') }) });
shots.still('flare-control-oos', {
  setup: async (page) => {
    await open(page, FLARE);
    await page.locator('tab-group label.color-swatch--amber-purple').click();
    await settle(page, 5000);
  },
  rects: flareControl,
  height: PDP_HEIGHT,
});
// Today's answer to a combination that isn't made (2.5mm + Cobalt): a disabled "Unavailable" button, and no price.
shots.still('flare-control-clash', {
  setup: async (page) => {
    await open(page, FLARE);
    await page.locator('tab-group select').first().selectOption({ label: '2.5mm ~ 10g' });
    await settle(page, 5000);
    await page.locator('tab-group label.color-swatch--cobalt').click();
    await settle(page, 5000);
  },
  rects: { ...flareControl, addToCart: 'tab-group [name="add"]' },
  height: PDP_HEIGHT,
});

const flareRects = { card: '.buy-box__card', price: 'product-pricing', gallery: GALLERY, swatches: ['.buy-box label[class*="color-swatch"]', { all: true }], legends: ['.buy-box legend', { all: true }], gauge: '.buy-box select' } as const;
shots.still('flare-new', {
  setup: (page) => open(page, withView(FLARE)),
  rects: { ...flareRects, amber: '.buy-box label.color-swatch--amber-purple' },
  height: PDP_HEIGHT,
  data: async (page) => ({ gauge: await optionNames(page, '.buy-box select') }),
});
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
  data: async (page) => ({ names: await optionNames(page, 'tab-group select') }),
});
const inkRects = { ...BUY_BOX, combo: '.buy-box__combo' };
const combo = (page: Page) => page.locator('.buy-box input[role="combobox"]').first();
const typeBlue = async (page: Page) => {
  await open(page, withView(INK));
  await combo(page).click();
  await combo(page).fill('blue');
  await settle(page, 1000);
};
shots.still('ink-new', { setup: (page) => open(page, withView(INK)), rects: inkRects, height: PDP_HEIGHT });
shots.still('ink-typed', {
  setup: typeBlue,
  rects: { ...inkRects, listbox: '.buy-box [role="listbox"]', options: ['.buy-box [role="option"]', { all: true }], matches: ['.buy-box *', { text: '^\\d+ of \\d+ choices$' }] },
  height: PDP_HEIGHT,
});
shots.still('ink-picked', {
  setup: async (page) => {
    await typeBlue(page);
    await page.locator('.buy-box [role="option"]', { hasText: /^Baby Blue$/ }).click();
    await settle(page, 1500);
  },
  rects: inkRects,
  height: PDP_HEIGHT,
});
const openInkBulk = async (page: Page) => {
  await open(page, withView(INK));
  await page.locator('.buy-box__invite').click();
  await settle(page, 1500);
};
shots.still('ink-bulk', { setup: openInkBulk, rects: BULK, height: PDP_HEIGHT });

// A dozen bottles across three colours, so reset has an order at stake. Many colours stock only two or three, and
// both arms clamp a quantity to stock, so rows that clamp are zeroed and skipped. Returns the rows typed into.
const INK_ORDER = [4, 2, 6];
const typeInkOrder = async (page: Page, inputs: ReturnType<Page['locator']>) => {
  const typed: number[] = [];
  for (let i = 0; typed.length < INK_ORDER.length; i++) {
    const want = String(INK_ORDER[typed.length]);
    await inputs.nth(i).fill(want);
    await inputs.nth(i).press('Tab');
    await page.waitForTimeout(400);
    if ((await inputs.nth(i).inputValue()) === want) typed.push(i);
    else {
      await inputs.nth(i).fill('0');
      await inputs.nth(i).press('Tab');
    }
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Typing scrolled the list inside its box, and the page with it, which raises the sticky bar. Put the first typed
  // row at the top of the list and the page back at the top.
  await inputs.nth(typed[0]).evaluate((input) => {
    let list = input.parentElement;
    while (list && list.scrollHeight <= list.clientHeight + 1) list = list.parentElement;
    if (list && list !== document.scrollingElement) list.scrollTop += input.getBoundingClientRect().top - list.getBoundingClientRect().top - 50;
    window.scrollTo(0, 0);
  });
  await settle(page, 2500);
  return typed;
};
shots.still('ink-bulk-typed', {
  setup: async (page) => {
    await openInkBulk(page);
    const typed = await typeInkOrder(page, page.locator('bulk-order input.js-bulk-quantity:visible'));
    // The sticky bar is fixed to an 810px viewport's bottom edge, so a 1800px-tall shot would float it mid-page.
    await page.addStyleTag({ content: 'buy-box-sticky-atc { display: none !important; }' });
    return typed;
  },
  rects: { ...BULK, receipt: '.bulk-order__receipt' },
  height: 1800,
  data: async (_page, typed) => ({ typed }),
});
const openInkControlBulk = async (page: Page) => {
  await open(page, INK);
  await page.getByRole('tab', { name: 'Multiple Items' }).click();
  await settle(page, 1500);
};
const inkControlBulk = { box: 'tab-group', reset: ['tab-group button', { text: '^reset$' }], addAll: ['tab-group button', { text: '^add all to cart$' }] } as const;
shots.still('ink-control-bulk', { setup: openInkControlBulk, rects: inkControlBulk, height: 1800 });
shots.still('ink-control-bulk-typed', {
  setup: async (page) => {
    await openInkControlBulk(page);
    await typeInkOrder(page, page.locator('tab-group input.js-bulk-quantity:visible'));
  },
  rects: inkControlBulk,
  height: 1800,
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
const facet = (page: Page) => page.locator('.bulk-order__facet-value', { hasText: /^3mm/ });
shots.still('tilum-bulk', { setup: openTilumBulk, rects: { ...BULK, facet: ['.bulk-order__facet-value', { text: '^3mm' }] }, height: PDP_HEIGHT });
shots.still('tilum-bulk-facet', {
  setup: async (page) => {
    await openTilumBulk(page);
    await facet(page).click();
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

// ---------- Sticky buy button ----------

// Desktop scrolled past the buy box, then a phone. Solice, because it has no required pick, so the bar offers Add to
// Cart rather than Choose Options.
shots.still('desk-sticky-new', { setup: (page) => open(page, withView(SOLICE)), scrollY: 1600, rects: { bar: 'buy-box-sticky-atc' } });
shots.still('phone-top', { device: 'phone', setup: (page) => open(page, withView(SOLICE)), scrollY: 0 });
shots.still('phone-bar', { device: 'phone', setup: (page) => open(page, withView(SOLICE)), scrollY: 2000, rects: { bar: 'buy-box-sticky-atc' } });

export default shots;
