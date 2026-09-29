// html-raster.ts: drawings and pages the studio makes (graphs, plots, still sheets) to PNG files, through the Chromium
// Playwright already installs.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where an element sits on a screenshotted page, as fractions of the whole page. */
export type HtmlShotRect = { x: number; y: number; w: number; h: number };

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

/**
 * Screenshots each HTML file whole to its `out` PNG, once its fonts load, in one browser session. Returns, per page,
 * the value of `attribute` and the rect of every element carrying it.
 */
export async function rasterizeHtmlPages(pages: readonly { html: string; out: string }[], attribute: string): Promise<{ key: string; rect: HtmlShotRect }[][]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const measured: { key: string; rect: HtmlShotRect }[][] = [];
  try {
    for (const { html, out } of pages) {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(html).href);
      await page.evaluate(() => document.fonts.ready);
      mkdirSync(dirname(out), { recursive: true });
      await page.screenshot({ path: out, fullPage: true });
      measured.push(await page.$$eval(`[${attribute}]`, (els, name) => {
        const { scrollWidth: w, scrollHeight: h } = document.documentElement;
        return els.map((el) => {
          const r = el.getBoundingClientRect();
          return { key: el.getAttribute(name)!, rect: { x: r.x / w, y: r.y / h, w: r.width / w, h: r.height / h } };
        });
      }, attribute));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return measured;
}
