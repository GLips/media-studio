// capture.mjs: photographs a site's states for a project's studio to animate.
//
// A walkthrough is built from stills, not screen recordings: each state is a high-DPI full-page screenshot plus the
// page-space rectangles of the elements a scene will point at. The studio then pans, zooms and moves a cursor over
// them, so every frame stays a pure function of time and the footage is as sharp as the capture.
//
//   const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
//   await session.page.goto(url);
//   await session.snap('pdp', { rects: { callout: '.note', swatches: ['.swatch', { all: true }] }, height: 1600 });
//   await session.close();   // writes captures/index.js for studio.html
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {object} options
 * @param {string} options.project - The project directory; captures land in `<project>/captures`.
 * @param {{width: number, height: number}} options.viewport - CSS pixels. Keep it 16:9 so a zoom of 1 fills the frame.
 * @param {number} [options.scale=2] - Device pixel ratio, i.e. how far the studio can zoom before text softens.
 * @param {string} [options.css] - Injected into every page, for hiding scrollbars and other capture noise.
 */
export async function openCaptureSession({ project, viewport, scale = 2, css = '' }) {
  const dir = join(project, 'captures');
  mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  const baseCss = `::-webkit-scrollbar { display: none !important; } html { scrollbar-width: none !important; } ${css}`;
  await context.addInitScript((style) => {
    document.addEventListener('DOMContentLoaded', () => {
      const tag = document.createElement('style');
      tag.textContent = style;
      document.head.appendChild(tag);
    });
  }, baseCss);
  const page = await context.newPage();
  const index = {};

  /**
   * Saves `captures/<name>.png` and records it, with its rects, in the index.
   *
   * @param {string} name
   * @param {object} [options]
   * @param {Object<string, string | [string, {all?: boolean}]>} [options.rects] - Selectors to measure, in page CSS
   *   pixels. `[selector, { all: true }]` measures every visible match as an array.
   * @param {number} [options.height] - Page height to capture from the top. Defaults to the viewport.
   */
  async function snap(name, { rects = {}, height = viewport.height } = {}) {
    // A full-page screenshot paints sticky headers wherever the page is scrolled to, so a state reached by clicking
    // lower down would get a header across its middle. The rects are page coordinates, so scrolling doesn't move them.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.evaluate(() => document.fonts.ready);
    const measured = await page.evaluate((specs) => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
      };
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const out = {};
      for (const [key, spec] of Object.entries(specs)) {
        const [selector, opts] = Array.isArray(spec) ? spec : [spec, {}];
        const els = [...document.querySelectorAll(selector)].filter(visible);
        if (!els.length) throw new Error(`capture: nothing visible matches ${key} → ${selector}`);
        out[key] = opts.all ? els.map(box) : box(els[0]);
      }
      return out;
    }, rects);

    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height } });
    index[name] = { src: `captures/${name}.png`, w: viewport.width, h: height, scale, rects: measured };
    console.log(`captured ${name}  (${Object.keys(measured).join(', ') || 'no rects'})`);
  }

  async function close() {
    writeFileSync(join(dir, 'index.js'), `window.CAPTURES = ${JSON.stringify(index, null, 2)};\n`);
    await browser.close();
  }

  return { page, context, snap, close };
}
