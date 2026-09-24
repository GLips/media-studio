// Defines every shot the pipeline test shows, from fixture/store.html, so the captures are the same on every run.
//   studio capture pipeline-test   films them (it imports the default export)
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { captureShots } from '../../lib/capture.ts';

const STORE = pathToFileURL(join(import.meta.dirname, 'fixture', 'store.html')).href;
const RECTS = {
  gallery: '.gallery',
  title: 'h1',
  price: '.price',
  now: '.price .now',
  total: '#total',
  swatches: ['.swatch', { all: true }],
  stock: '#stock',
  select: '#bulb',
  stepper: '.stepper',
  plus: '[name=plus]',
  add: '[name=add]',
  note: '#note',
  clear: '#clear',
  specs: '.specs',
  rows: ['.specs tr', { all: true }],
} as const;
const HEIGHT = 1600;

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }, devices: { phone: { viewport: { width: 390, height: 844 } } } });
const open = (page: Page) => page.goto(STORE);
const clicks = (...steps: ((page: Page) => Promise<void>)[]) => async (page: Page) => {
  await open(page);
  for (const step of steps) await step(page);
};
const swatch = (n: number) => (page: Page) => page.locator('.swatch').nth(n).click();
const plus = (page: Page) => page.locator('[name=plus]').click();

shots.still('page', { setup: open, height: HEIGHT, rects: RECTS, data: async (page) => ({ bulbs: await page.locator('#bulb option').allTextContents() }) });
shots.still('cobalt', { setup: clicks(swatch(2)), height: HEIGHT, rects: RECTS });
shots.still('sage', { setup: clicks(swatch(2), swatch(1)), height: HEIGHT, rects: RECTS });
for (const n of [2, 3, 4]) {
  shots.still(`sage-q${n}`, { setup: clicks(swatch(2), swatch(1), ...Array<typeof plus>(n - 1).fill(plus)), height: HEIGHT, rects: RECTS });
}
shots.still('phone-top', { device: 'phone', setup: open, scrollY: 0 });
shots.still('phone-specs', { device: 'phone', setup: open, scrollY: 1100, rects: { bar: '.bar' } });

export default shots;
