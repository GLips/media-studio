// Defines every shot the Format vertical video shows. Each shot opens its own page and gets itself to its state, so any
// can be redone alone.
//   studio capture format-vertical [--only=home,…]   films them (it imports the default export)
import { captureShots, type Page } from '#engine/capture/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
};

// `studio probe format-vertical <url>` shows a page as these shots will see it, with selectors for its elements.
// Each state the story needs, as a still (setup reaches it; rects are what scenes point at), e.g.
//   shots.still('detail', { setup: …, rects: { button: '.buy', options: ['.option', { all: true }] }, height: 1200 });
// or, where a cut would jump, a take that films the move, e.g.
//   shots.take('open-menu', { setup: …, perform: (rec) => rec.click('.menu', { mark: 'open', rects: { menu: '.menu' } }) });

export default shots;
