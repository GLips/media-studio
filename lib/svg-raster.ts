// svg-raster.ts: SVG drawings (graphs, plots) to PNG files, through the Chromium Playwright already installs.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Rasterizes each drawing to its `out` PNG at 1× in one browser session. */
export async function rasterizeSvgs(drawings: readonly { svg: string; width: number; height: number; out: string }[]) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    for (const { svg, width, height, out } of drawings) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
      mkdirSync(dirname(out), { recursive: true });
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
