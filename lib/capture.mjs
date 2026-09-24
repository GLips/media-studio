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
  await context.addInitScript(injectStyle, baseCss);
  const index = {};
  const { page, snap } = snapperFor(await context.newPage(), viewport, scale);

  /**
   * A second device in the same session, e.g. a phone next to the desktop, whose snaps land in the same index.
   * `mobile` turns on touch and the mobile user agent, so the site serves what a phone gets.
   */
  async function openDevice({ viewport: deviceViewport, scale: deviceScale = 3, mobile = true }) {
    const deviceContext = await browser.newContext({
      viewport: deviceViewport,
      deviceScaleFactor: deviceScale,
      isMobile: mobile,
      hasTouch: mobile,
      ...(mobile && { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }),
    });
    await deviceContext.addInitScript(injectStyle, baseCss);
    return snapperFor(await deviceContext.newPage(), deviceViewport, deviceScale);
  }

  function snapperFor(target, size, dpr) {
    /**
     * Saves `captures/<name>.png` and records it, with its rects, in the index.
     *
     * @param {string} name
     * @param {object} [options]
     * @param {Object<string, string | [string, {all?: boolean, text?: string, scrolls?: boolean}]>} [options.rects] -
     *   Selectors to measure, in capture CSS pixels. `[selector, { all: true }]` measures every visible match as an
     *   array. `text` (a regex source) keeps matches whose text fits, innermost first, for elements with no class of
     *   their own to find them by, like a "Sale" badge. `scrolls` keeps matches that scroll inside themselves.
     *   `optional` leaves the key out when nothing matches, for specs shared by products that differ; a scene that
     *   asks for a missing rect still fails, by name.
     * @param {object} [options.data] - Anything else a scene needs from the page, e.g. the names in a native menu that
     *   can't be photographed open. Stored as-is beside the rects.
     * @param {number} [options.height] - Page height to capture from the top. Defaults to the viewport.
     * @param {number} [options.scrollY] - Capture just the viewport, scrolled to here, instead of the page from the
     *   top: the way to photograph fixed bars (a sticky add-to-cart) where a visitor actually sees them.
     */
    async function snapPage(name, { rects = {}, height = size.height, scrollY, data } = {}) {
      const viewportOnly = scrollY !== undefined;
      // A full-page screenshot paints sticky headers wherever the page is scrolled to, so a state reached by clicking
      // lower down would get a header across its middle. Page-mode rects are page coordinates, so scrolling doesn't
      // move them; viewport-mode rects are relative to the viewport, like the image.
      await target.evaluate((y) => window.scrollTo(0, y), viewportOnly ? scrollY : 0);
      await target.waitForTimeout(viewportOnly ? 900 : 400);
      await target.evaluate(() => document.fonts.ready);
      const measured = await target.evaluate(([specs, relative]) => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return relative ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
        };
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const scrollsInside = (el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4;
        const out = {};
        for (const [key, spec] of Object.entries(specs)) {
          const [selector, opts] = Array.isArray(spec) ? spec : [spec, {}];
          let els = [...document.querySelectorAll(selector)].filter(visible);
          if (opts.text) {
            const re = new RegExp(opts.text, 'i');
            els = els.filter((el) => re.test((el.innerText ?? el.textContent).trim()));
            els = els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
          }
          if (opts.scrolls) els = els.filter(scrollsInside);
          if (!els.length && opts.optional) continue;
          if (!els.length) throw new Error(`capture: nothing visible matches ${key} → ${selector}`);
          out[key] = opts.all ? els.map(box) : box(els[0]);
        }
        return out;
      }, [rects, viewportOnly]);

      const path = join(dir, `${name}.png`);
      if (viewportOnly) await target.screenshot({ path });
      else await target.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: size.width, height } });
      index[name] = { src: `captures/${name}.png`, w: size.width, h: viewportOnly ? size.height : height, scale: dpr, rects: measured, ...(data && { data }) };
      console.log(`captured ${name}  (${Object.keys(measured).join(', ') || 'no rects'})`);
    }
    return { page: target, snap: snapPage };
  }

  async function close() {
    writeFileSync(join(dir, 'index.js'), `window.CAPTURES = ${JSON.stringify(index, null, 2)};\n`);
    await browser.close();
  }

  return { page, context, snap, openDevice, close };
}

function injectStyle(style) {
  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('style');
    tag.textContent = style;
    document.head.appendChild(tag);
  });
}
