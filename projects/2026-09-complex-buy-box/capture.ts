// Defines every shot the Complex buy box video shows. Each shot opens its own page and gets itself to its state, so any
// can be redone alone.
//   studio capture complex-buy-box [--only=home,…]   films them (it imports the default export)
import { captureShots, type Page } from '#engine/capture/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
};

shots.still('home', { setup: (page) => open(page, 'https://www.painfulpleasures.com'), height: 1600 });

export default shots;
