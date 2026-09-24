// capture.ts: photographs a site's states for a project's video to animate.
//
// A walkthrough is built from stills, not screen recordings: each state is a high-DPI full-page screenshot plus the
// page-space rectangles of the elements a scene will point at. Scenes then pan, zoom and move a cursor over them, so
// every frame stays a pure function of time and the footage is as sharp as the capture.
//
//   const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
//   await session.page.goto(url);
//   await session.snap('pdp', { rects: { callout: '.note', swatches: ['.swatch', { all: true }] }, height: 1600 });
//   await session.close();   // writes captures/index.ts, which the project's video.tsx imports
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Size = { width: number; height: number };
type RectOptions = {
  /** Measure every visible match, as an array. */
  all?: boolean;
  /** A regex source: keep matches whose text fits, innermost first, for elements with no class to find them by. */
  text?: string;
  /** Keep matches that scroll inside themselves. */
  scrolls?: boolean;
  /** Leave the key out when nothing matches, for specs shared by products that differ. */
  optional?: boolean;
};
type RectSpec = string | [string, RectOptions];
type Rect = { x: number; y: number; w: number; h: number };

type SnapOptions = {
  /** Selectors to measure, in capture CSS pixels. */
  rects?: Record<string, RectSpec>;
  /** Anything else a scene needs from the page, e.g. the names in a native menu that can't be photographed open. */
  data?: unknown;
  /** Page height to capture from the top. Defaults to the viewport. */
  height?: number;
  /**
   * Capture just the viewport, scrolled to here, instead of the page from the top: the way to photograph fixed bars
   * (a sticky add-to-cart) where a visitor actually sees them.
   */
  scrollY?: number;
};

type Entry = { file: string; w: number; h: number; scale: number; rects: Record<string, Rect | Rect[]>; data?: unknown };

/**
 * @param project The project directory; captures land in `<project>/captures`.
 * @param viewport CSS pixels. Keep it 16:9 so a zoom of 1 fills the frame.
 * @param scale Device pixel ratio, i.e. how far a camera can zoom before text softens.
 * @param css Injected into every page, for hiding scrollbars and other capture noise.
 */
export async function openCaptureSession({ project, viewport, scale = 2, css = '' }: { project: string; viewport: Size; scale?: number; css?: string }) {
  const dir = join(project, 'captures');
  mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  const baseCss = `::-webkit-scrollbar { display: none !important; } html { scrollbar-width: none !important; } ${css}`;
  await context.addInitScript(injectStyle, baseCss);
  const index: Record<string, Entry> = {};
  const { page, snap } = snapperFor(await context.newPage(), viewport, scale);

  /**
   * A second device in the same session, e.g. a phone next to the desktop, whose snaps land in the same index.
   * `mobile` turns on touch and the mobile user agent, so the site serves what a phone gets.
   */
  async function openDevice({ viewport: deviceViewport, scale: deviceScale = 3, mobile = true }: { viewport: Size; scale?: number; mobile?: boolean }) {
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

  function snapperFor(target: Page, size: Size, dpr: number) {
    /** Saves `captures/<name>.png` and records it, with its rects, in the index. */
    async function snap(name: string, { rects = {}, height = size.height, scrollY, data }: SnapOptions = {}) {
      const viewportOnly = scrollY !== undefined;
      // A full-page screenshot paints sticky headers wherever the page is scrolled to, so a state reached by clicking
      // lower down would get a header across its middle. Page-mode rects are page coordinates, so scrolling doesn't
      // move them; viewport-mode rects are relative to the viewport, like the image.
      await target.evaluate((y) => window.scrollTo(0, y), viewportOnly ? scrollY : 0);
      await target.waitForTimeout(viewportOnly ? 900 : 400);
      await target.evaluate(() => document.fonts.ready);
      const measured = await target.evaluate(([specs, relative]) => {
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return relative ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
        };
        const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const scrollsInside = (el: Element) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4;
        const out: Record<string, Rect | Rect[]> = {};
        for (const [key, spec] of Object.entries(specs)) {
          const [selector, opts] = Array.isArray(spec) ? spec : [spec, {} as RectOptions];
          let els = [...document.querySelectorAll(selector)].filter(visible);
          if (opts.text) {
            const re = new RegExp(opts.text, 'i');
            els = els.filter((el) => re.test(((el as HTMLElement).innerText ?? el.textContent).trim()));
            els = els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
          }
          if (opts.scrolls) els = els.filter(scrollsInside);
          if (!els.length && opts.optional) continue;
          if (!els.length) throw new Error(`capture: nothing visible matches ${key} → ${selector}`);
          out[key] = opts.all ? els.map(box) : box(els[0]);
        }
        return out;
      }, [rects, viewportOnly] as const);

      const file = `${name}.png`;
      const path = join(dir, file);
      if (viewportOnly) await target.screenshot({ path });
      else await target.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: size.width, height } });
      index[name] = { file, w: size.width, h: viewportOnly ? size.height : height, scale: dpr, rects: measured, ...(data !== undefined && { data }) };
      console.log(`captured ${name}  (${Object.keys(measured).join(', ') || 'no rects'})`);
    }
    return { page: target, snap };
  }

  async function close() {
    writeFileSync(join(dir, 'index.ts'), captureModule(index));
    await browser.close();
  }

  return { page, context, snap, openDevice, close };
}

// The index is a module rather than JSON so the video imports each PNG (the bundler hashes and serves it) and rect keys
// are types: a scene asking for a rect the capture never measured fails to compile.
function captureModule(index: Record<string, Entry>) {
  const names = Object.keys(index);
  const ident = (i: number) => `png${i}`;
  const imports = names.map((name, i) => `import ${ident(i)} from './${index[name].file}';`).join('\n');
  const entries = names.map((name, i) => {
    const { file, ...rest } = index[name];
    return `  ${JSON.stringify(name)}: { src: ${ident(i)}, ${JSON.stringify(rest).slice(1)},`;
  }).join('\n');
  return `// Written by lib/capture.ts when the project's capture.ts runs. Edits here are lost on the next capture.
import type { Shot } from '../../../lib/studio/camera.ts';
${imports}

export const captures = {
${entries}
} as const satisfies Record<string, Shot>;
`;
}

function injectStyle(style: string) {
  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('style');
    tag.textContent = style;
    document.head.appendChild(tag);
  });
}
