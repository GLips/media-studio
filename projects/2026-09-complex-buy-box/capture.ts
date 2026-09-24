// Films every shot the Complex buy box video shows. Each shot opens its own page and gets itself to its state, so any
// can be redone alone.
//   node projects/2026-09-complex-buy-box/capture.ts [--only=home,…]
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
};

shots.still('home', { setup: (page) => open(page, 'https://www.painfulpleasures.com'), height: 1600 });

await shots.run();
