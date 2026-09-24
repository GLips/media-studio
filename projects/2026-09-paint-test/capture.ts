// Films every shot the Painted video shows.
//   node projects/2026-09-paint-test/capture.ts [--only=home,…]
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }, css: '#_evidon_banner, #attentive_overlay { display: none !important; }' });
const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
};

shots.still('home', {
  setup: (page) => open(page, 'https://www.painfulpleasures.com/products/peak-solice-pro-3-wireless-machine'),
  rects: { price: 'product-pricing span.font-bold', gallery: '.product__media img' },
  height: 1600,
});

await shots.run();
