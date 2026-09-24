// Photographs every state the Painted video shows.
//   node projects/2026-09-paint-test/capture.ts
import { openCaptureSession } from '../../lib/capture.ts';

const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }, css: '#_evidon_banner, #attentive_overlay { display: none !important; }' });
const { page, snap } = session;

await page.goto("https://www.painfulpleasures.com/products/peak-solice-pro-3-wireless-machine", { waitUntil: 'load' });
await page.waitForTimeout(2500);
await snap('home', { rects: { price: 'product-pricing span.font-bold', gallery: '.product__media img' }, height: 1600 });

// Each state the story needs: reach it, then snap it with the rects scenes will point at, e.g.
//   await snap('detail', { rects: { button: '.buy', options: ['.option', { all: true }] }, height: 1200 });

await session.close();
