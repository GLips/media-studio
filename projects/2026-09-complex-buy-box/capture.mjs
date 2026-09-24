// Photographs every state the Complex buy box video shows.
//   node projects/2026-09-complex-buy-box/capture.mjs
import { openCaptureSession } from '../../lib/capture.mjs';

const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const { page, snap } = session;

await page.goto("https://www.painfulpleasures.com", { waitUntil: 'load' });
await page.waitForTimeout(2500);
await snap('home', { height: 1600 });

// Each state the story needs: reach it, then snap it with the rects scenes will point at, e.g.
//   await snap('detail', { rects: { button: '.buy', options: ['.option', { all: true }] }, height: 1200 });

await session.close();
