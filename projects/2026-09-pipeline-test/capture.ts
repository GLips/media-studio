// Photographs every state the pipeline test shows, from fixture/store.html, so the captures are the same on every run.
//   node projects/2026-09-pipeline-test/capture.ts
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { openCaptureSession } from '../../lib/capture.ts';

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

const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const { page, snap } = session;
await page.goto(STORE);
const bulbs = await page.locator('#bulb option').allTextContents();

await snap('page', { height: HEIGHT, rects: RECTS, data: { bulbs } });
await page.locator('.swatch').nth(2).click();
await snap('cobalt', { height: HEIGHT, rects: RECTS });
await page.locator('.swatch').nth(1).click();
await snap('sage', { height: HEIGHT, rects: RECTS });
for (const n of [2, 3, 4]) {
  await page.locator('[name=plus]').click();
  await snap(`sage-q${n}`, { height: HEIGHT, rects: RECTS });
}

const phone = await session.openDevice({ viewport: { width: 390, height: 844 } });
await phone.page.goto(STORE);
await phone.snap('phone-top', { scrollY: 0 });
await phone.snap('phone-specs', { scrollY: 1100, rects: { bar: '.bar' } });

await session.close();
