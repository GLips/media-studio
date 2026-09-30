// capture.ts: films a site for a project's video to animate, as named shots: stills and takes.
//
// A still is a high-DPI screenshot plus page-space rects of what a scene will point at. A take records the site in
// use, where a cut between stills would jump, logging mouse, keys and named marks for scenes to redraw and fit.
//
// Every shot rebuilds its starting point in `setup` on a fresh page, so any shot can be redone alone:
//
//   const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
//   shots.still('pdp', { setup: (page) => page.goto(url), rects: { callout: '.note' } });
//   shots.take('open-menu', { setup: (page) => page.goto(url), perform: (rec) => rec.click('.menu', { mark: 'open' }) });
//   export default shots;   // `studio capture <p> [--only=pdp,menu]` runs them, writing captures/index.ts
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gitState, linkedProjectHost, type GitState, type ProjectHostSpec } from '#lib/platform/host/engine/hosts.ts';
import { STUDIO_ROOT, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { isStudioWorkspaceRepo } from '#lib/platform/project/engine/studio-workspace.ts';

// A shot's setup is handed playwright's Page. Projects take the type from here, so playwright keeps one importer.
export type { Page };

type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
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
type RectSpec = string | readonly [string, RectOptions];
type RectSpecs = Readonly<Record<string, RectSpec>>;

type Device = { viewport: Size; scale: number; mobile: boolean };

type StillOptions<T = unknown> = {
  /** Gets the fresh page to the state to photograph. What it returns is passed to `data`. */
  setup: (page: Page) => Promise<T>;
  /** Selectors to measure, in capture CSS pixels. */
  rects?: RectSpecs;
  /** Anything else a scene needs from the page, e.g. the names in a native menu that can't be photographed open. */
  data?: (page: Page, fromSetup: T) => Promise<unknown>;
  /** Page height to capture from the top. Defaults to the viewport. */
  height?: number;
  /**
   * Capture just the viewport, scrolled to here, instead of the page from the top: the way to photograph fixed bars
   * (a sticky add-to-cart) where a visitor actually sees them. A function measures it once `setup` is done.
   */
  scrollY?: number | ((page: Page, fromSetup: T) => Promise<number>);
  /** One of the session's `devices`; the main viewport otherwise. */
  device?: string;
};

type TakeOptions = {
  /** Gets the fresh page to where the take starts, off camera. */
  setup: (page: Page) => Promise<unknown>;
  /** What's filmed: the recorder's actions, from the take's first frame. */
  perform: (rec: Recorder) => Promise<unknown>;
  /** Where the (drawn) cursor rests when the take starts, in viewport pixels. Defaults to low right of centre. */
  mouse?: Point;
  device?: string;
};

type Shot = { name: string; kind: 'still'; options: StillOptions } | { name: string; kind: 'take'; options: TakeOptions };

type StillEntry = { kind: 'still'; file: string; w: number; h: number; scale: number; rects: Record<string, Rect | Rect[]>; data?: unknown };
type TakeMark = { t: number; scrollY: number; rects: Record<string, Rect | Rect[]> };
type TakeEntry = {
  kind: 'take';
  w: number;
  h: number;
  scale: number;
  duration: number;
  frames: { file: string; t: number; scrollY: number }[];
  marks: Record<string, TakeMark>;
  /** [t, x, y, click]: the cursor's waypoints in viewport pixels; `click` 1 where it clicked. */
  mouse: [number, number, number, 0 | 1][];
  keys: number[];
};
type Entry = StillEntry | TakeEntry;

// Stills load and settle in parallel; takes run alone, since they're filmed in real time and a busy machine drops
// their frames.
const STILL_CONCURRENCY = 4;

export function captureShots({ project, viewport, scale = 2, css = '', prepare, devices = {}, clock }: {
  /** The project directory; shots land in `<project>/captures`. */
  project: string;
  /** CSS pixels. Keep it 16:9 so a zoom of 1 fills the frame. */
  viewport: Size;
  /** Device pixel ratio, i.e. how far a camera can zoom before text softens. */
  scale?: number;
  /** Injected into every page, for hiding scrollbars and other capture noise. */
  css?: string;
  /**
   * Runs once per device before any shot, for what a visit keeps (a preview cookie). Each shot starts from its cookies
   * and storage in a context of its own, so what one shot does (adding to a cart) never shows in another.
   */
  prepare?: (page: Page) => Promise<unknown>;
  /** Other devices shots can ask for by name, e.g. a phone next to the desktop. */
  devices?: Record<string, { viewport: Size; scale?: number; mobile?: boolean }>;
  /**
   * Pins what `Date` says in every page (`prepare`'s too), e.g. '2026-09-08T12:00:00' (local time unless it names a
   * zone), so "5 minutes ago" reads the same on every capture. Timers and animations still run.
   */
  clock?: string;
}) {
  if (clock !== undefined && Number.isNaN(new Date(clock).getTime())) throw new Error(`capture: clock "${clock}" isn't a date`);
  const dir = join(project, 'captures');
  const shots: Shot[] = [];
  const pages: PageSetup = { css: `::-webkit-scrollbar { display: none !important; } html { scrollbar-width: none !important; } ${css}`, clock };
  const deviceFor = (name?: string): Device => {
    if (!name) return { viewport, scale, mobile: false };
    const d = devices[name];
    if (!d) throw new Error(`capture: no device "${name}"; the session has ${Object.keys(devices).join(', ') || 'none'}`);
    return { viewport: d.viewport, scale: d.scale ?? 3, mobile: d.mobile ?? true };
  };
  const add = (shot: Shot) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(shot.name)) throw new Error(`capture: shot names are lowercase words joined by dashes, not "${shot.name}"`);
    if (shot.name === 'provenance') throw new Error('capture: "provenance" names the provenance file; pick another shot name');
    if (shots.some((s) => s.name === shot.name)) throw new Error(`capture: two shots are named "${shot.name}"`);
    shots.push(shot);
  };

  /**
   * Films every shot, or just those named in `only`, and rebuilds captures/index.ts from every shot that has a
   * capture of its kind. Returns the shots the index leaves out for want of one.
   */
  async function run({ only }: { only?: readonly string[] } = {}): Promise<UncapturedShot[]> {
    const unknown = only?.filter((n) => !shots.some((s) => s.name === n)) ?? [];
    if (unknown.length) throw new Error(`capture: no shot named ${unknown.join(', ')}`);
    mkdirSync(dir, { recursive: true });
    // The studio's code and the workspace's (the project's own files) are two repositories, so each gets its state.
    const madeFrom = { studio: gitState(STUDIO_ROOT), workspace: isStudioWorkspaceRepo() ? gitState(STUDIO_WORKSPACE_DIR) : null, host: linkedProjectHost(project) };

    const browser = await chromium.launch();
    const prepared = new Map<string, Promise<PreparedDevice>>();
    const preparedStateFor = async (device?: string) => {
      const key = device ?? '';
      if (!prepared.has(key)) prepared.set(key, prepareDevice(browser, deviceFor(device), pages, prepare));
      return (await prepared.get(key)!).storageState;
    };
    const onFreshPage = async (device: string | undefined, work: (page: Page) => Promise<Entry>, name: string) => {
      const context = await openContext(browser, deviceFor(device), pages, await preparedStateFor(device));
      try {
        const page = await context.newPage();
        writeEntry(dir, name, await work(page));
        writeShotProvenance(dir, name, { url: page.url(), capturedAt: new Date().toISOString(), ...madeFrom });
      } finally {
        await context.close();
      }
    };
    const chosen = shots.filter((s) => !only || only.includes(s.name));
    try {
      await inPool(chosen.filter((s) => s.kind === 'still'), STILL_CONCURRENCY, (shot) => onFreshPage(shot.options.device, async (page) => {
        const fromSetup = await shot.options.setup(page);
        return snapStill(page, dir, shot.name, deviceFor(shot.options.device), shot.options, fromSetup);
      }, shot.name));
      for (const shot of chosen) {
        if (shot.kind !== 'take') continue;
        await onFreshPage(shot.options.device, async (page) => {
          await shot.options.setup(page);
          return filmTake(page, dir, shot.name, deviceFor(shot.options.device), shot.options);
        }, shot.name);
      }
    } catch (error) {
      // Shots that finished have replaced their files (a take's frames among them), which the old index may name.
      await browser.close();
      writeIndex(dir, shots);
      throw error;
    }
    await browser.close();
    return writeIndex(dir, shots);
  }

  /**
   * Opens `url` the way a shot's page starts (after `prepare`, with the css and device), for looking at a page before
   * writing its shots. A URL path (`/inbox`) is taken from where `prepare` left off. Close the browser when done.
   */
  async function openPreparedPage(url: string, { device }: { device?: string } = {}) {
    const browser = await chromium.launch();
    try {
      const { storageState, url: preparedUrl } = await prepareDevice(browser, deviceFor(device), pages, prepare);
      if (url.startsWith('/') && !preparedUrl) throw new Error(`capture: ${url} is a path, and there's no prepare step to take the site from; give a whole URL`);
      const page = await (await openContext(browser, deviceFor(device), pages, storageState)).newPage();
      await page.goto(url.startsWith('/') ? new URL(url, preparedUrl).href : url, { waitUntil: 'load' });
      return { page, browser };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  return {
    still: <T>(name: string, options: StillOptions<T>) => add({ name, kind: 'still', options: options as StillOptions }),
    take: (name: string, options: TakeOptions) => add({ name, kind: 'take', options }),
    run,
    openPreparedPage,
  };
}

/**
 * Waits until React has hydrated the element `selector` matches. Before then a server-rendered form takes typed text
 * but drops the submit, so a filled field proves nothing. React-specific: it tags each node it owns with a
 * `__reactProps$…` key, which is what its event dispatch reads handlers from.
 */
export async function waitForHydration(page: Page, selector: string, { timeout = 15_000 }: { timeout?: number } = {}) {
  try {
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((key) => key.startsWith('__reactProps$'));
    }, selector, { timeout });
  } catch (error) {
    if ((error as Error).name !== 'TimeoutError') throw error;
    throw new Error(`capture: React didn't hydrate ${selector} on ${page.url()} within ${timeout / 1000}s (is it on the page, and is the site React?)`, { cause: error });
  }
}

/** A shot capture.ts makes that captures/index.ts leaves out, and why. */
export type UncapturedShot = { name: string; reason: string };

/** What a project's capture.ts default-exports. */
export type CaptureShots = ReturnType<typeof captureShots>;

/** The captureShots session a project's capture.ts default-exports. */
export async function importProjectCaptureShots(project: string): Promise<CaptureShots> {
  const script = join(project, 'capture.ts');
  const shots = (await import(pathToFileURL(script).href)).default as CaptureShots | undefined;
  if (typeof shots?.run !== 'function') throw new Error(`${script} must end with \`export default shots;\` (the captureShots session)`);
  return shots;
}

/**
 * Films the shots the project's capture.ts defines (just `only`, if given). Returns its captures/index.ts and the
 * shots the index leaves out.
 */
export async function captureStudioProject(project: string, { only }: { only?: readonly string[] } = {}) {
  const uncaptured = await (await importProjectCaptureShots(project)).run({ only });
  return { index: join(project, 'captures', 'index.ts'), uncaptured };
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

type PreparedDevice = { storageState?: StorageState; url?: string };

async function prepareDevice(browser: Browser, device: Device, pages: PageSetup, prepare?: (page: Page) => Promise<unknown>): Promise<PreparedDevice> {
  if (!prepare) return {};
  const context = await openContext(browser, device, pages, undefined);
  try {
    const page = await context.newPage();
    await prepare(page);
    return { storageState: await context.storageState(), url: page.url() };
  } finally {
    await context.close();
  }
}

/** What every page a session opens starts with: its css, and its clock. */
type PageSetup = { css: string; clock?: string };

async function openContext(browser: Browser, device: Device, { css, clock }: PageSetup, storageState: StorageState | undefined) {
  const context = await browser.newContext({
    storageState,
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    ...(device.mobile && { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }),
  });
  await context.addInitScript(injectStyle, css);
  // Fixed, not installed: Date stops, but timers, requestAnimationFrame and animations keep real time.
  if (clock !== undefined) await context.clock.setFixedTime(clock);
  return context;
}

async function inPool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }));
}

// ---------- stills ----------

async function snapStill(page: Page, dir: string, name: string, device: Device, { rects = {}, height = device.viewport.height, scrollY: scrollTo, data }: StillOptions, fromSetup: unknown): Promise<StillEntry> {
  const viewportOnly = scrollTo !== undefined;
  const scrollY = typeof scrollTo === 'function' ? await scrollTo(page, fromSetup) : scrollTo;
  // A full-page screenshot paints sticky headers wherever the page is scrolled to, so a state reached by clicking
  // lower down would get a header across its middle. Page-mode rects are page coordinates, so scrolling doesn't
  // move them; viewport-mode rects are relative to the viewport, like the image.
  await page.evaluate((y) => window.scrollTo(0, y), scrollY ?? 0);
  await page.waitForTimeout(viewportOnly ? 900 : 400);
  await page.evaluate(() => document.fonts.ready);
  const measured = await measureRects(page, name, rects, viewportOnly);
  const file = `${name}.png`;
  const path = join(dir, file);
  // A page shorter than `height` screenshots at its own height; recording `height` would stretch the image.
  const h = viewportOnly ? device.viewport.height : Math.min(height, await page.evaluate(() => document.documentElement.scrollHeight));
  if (viewportOnly) await page.screenshot({ path });
  else await page.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: device.viewport.width, height: h } });
  const extra = data ? await data(page, fromSetup) : undefined;
  console.error(`captured ${name}  (${Object.keys(measured).join(', ') || 'no rects'})`);
  return { kind: 'still', file, w: device.viewport.width, h, scale: device.scale, rects: measured, ...(extra !== undefined && { data: extra }) };
}

function measureRects(page: Page, shot: string, specs: RectSpecs, relative: boolean): Promise<Record<string, Rect | Rect[]>> {
  return page.evaluate(([specs, relative, shot]) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return relative ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    };
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const scrollsInside = (el: Element) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4;
    const out: Record<string, { x: number; y: number; w: number; h: number } | { x: number; y: number; w: number; h: number }[]> = {};
    for (const [key, spec] of Object.entries(specs)) {
      const [selector, opts] = typeof spec === 'string' ? [spec, {} as RectOptions] : spec;
      let els = [...document.querySelectorAll(selector)].filter(visible);
      if (opts.text) {
        const re = new RegExp(opts.text, 'i');
        els = els.filter((el) => re.test(((el as HTMLElement).innerText ?? el.textContent).trim()));
        els = els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
      }
      if (opts.scrolls) els = els.filter(scrollsInside);
      if (!els.length && opts.optional) continue;
      if (!els.length) throw new Error(`capture ${shot}: nothing visible matches ${key} → ${selector}`);
      out[key] = opts.all ? els.map(box) : box(els[0]);
    }
    return out;
  }, [specs, relative, shot] as const);
}

// ---------- takes ----------

type Target = string | Locator | Point;

/** What a take's `perform` drives the page with. Every action is logged, so the studio can redraw and retime it. */
export type Recorder = {
  page: Page;
  /** Names this moment, measuring `rects` (page pixels) as they are now: what scenes anchor to and ring. */
  mark(name: string, options?: { rects?: RectSpecs }): Promise<void>;
  /** Glides the cursor to a target's centre (or a viewport point), so hovers fire on the way. The mark is arrival. */
  moveTo(target: Target, options?: { mark?: string; rects?: RectSpecs }): Promise<void>;
  /** Glides to a target and clicks it. The mark is the click. */
  click(target: Target, options?: { mark?: string; rects?: RectSpecs }): Promise<void>;
  /** Types into the focused element a key at a time. The mark is the first key. */
  type(text: string, options?: { mark?: string; rects?: RectSpecs; perKey?: number }): Promise<void>;
  /** Scrolls the page smoothly to `y`, or to put an element `margin` below the top. The mark is the start. */
  scrollTo(to: number | string | Locator, options?: { mark?: string; rects?: RectSpecs; seconds?: number; margin?: number }): Promise<void>;
  wait(seconds: number): Promise<void>;
};

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

async function filmTake(page: Page, dir: string, name: string, device: Device, { perform, mouse: start }: TakeOptions): Promise<TakeEntry> {
  const { width, height } = device.viewport;
  await page.evaluate(() => document.fonts.ready);

  const cdp = await page.context().newCDPSession(page);
  const raw: { data: string; t: number; scrollY: number }[] = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    raw.push({ data, t: metadata.timestamp ?? Date.now() / 1000, scrollY: metadata.scrollOffsetY });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  // Chrome sends a frame only when the page repaints (and one straight away), so a still stretch costs nothing. Its
  // timestamps are wall-clock seconds, the same clock as the log's.
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: width * device.scale, maxHeight: height * device.scale });
  await page.waitForTimeout(500);

  const t0 = Date.now() / 1000;
  const now = () => Date.now() / 1000 - t0;
  const mouse: TakeEntry['mouse'] = [];
  const keys: number[] = [];
  const marks: Record<string, TakeMark> = {};
  let at = start ?? { x: width * 0.62, y: height * 0.78 };
  await page.mouse.move(at.x, at.y);
  mouse.push([0, at.x, at.y, 0]);

  // Stamped once measuring is done, so the time is when the page looked like its rects, and an action right after
  // the mark (a click) lands on it rather than after a measuring delay.
  const mark = async (label: string | undefined, rects: RectSpecs = {}) => {
    if (!label) return;
    if (marks[label]) throw new Error(`capture ${name}: two marks are named "${label}"`);
    const scrollY = await page.evaluate(() => window.scrollY), measured = await measureRects(page, name, rects, false);
    marks[label] = { t: now(), scrollY, rects: measured };
  };
  const locatorOf = (target: string | Locator) => (typeof target === 'string' ? page.locator(target).first() : target);
  const pointOf = async (target: Target): Promise<Point> => {
    if (typeof target === 'object' && 'x' in target) return target;
    const box = await locatorOf(target).boundingBox();
    if (!box) throw new Error(`capture ${name}: ${String(target)} isn't on the page`);
    const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) throw new Error(`capture ${name}: ${String(target)} is out of view at ${Math.round(p.x)},${Math.round(p.y)}; scroll to it first`);
    return p;
  };
  // A hand's pace: longer moves take longer, but not proportionally. Only the ends are logged; the studio draws the
  // path between them its own way, and the steps here are for the page's hover effects.
  const glide = async (to: Point) => {
    const seconds = Math.min(1.1, 0.35 + Math.hypot(to.x - at.x, to.y - at.y) / 1400);
    const steps = Math.max(8, Math.round(seconds * 60));
    const from = at, begin = now();
    for (let i = 1; i <= steps; i++) {
      const e = easeInOut(i / steps);
      await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      await page.waitForTimeout((seconds * 1000) / steps);
    }
    mouse.push([begin, from.x, from.y, 0], [now(), to.x, to.y, 0]);
    at = to;
  };

  const rec: Recorder = {
    page,
    mark: (label, { rects } = {}) => mark(label, rects),
    async moveTo(target, { mark: label, rects } = {}) {
      await glide(await pointOf(target));
      await mark(label, rects);
    },
    async click(target, { mark: label, rects } = {}) {
      await glide(await pointOf(target));
      await mark(label, rects);
      mouse.push([label ? marks[label].t : now(), at.x, at.y, 1]);
      await page.mouse.click(at.x, at.y);
    },
    async type(text, { mark: label, rects, perKey = 0.13 } = {}) {
      await mark(label, rects);
      for (const ch of text) {
        keys.push(now());
        await page.keyboard.type(ch);
        await page.waitForTimeout(perKey * 1000);
      }
    },
    async scrollTo(to, { mark: label, rects, seconds = 0.9, margin = 40 } = {}) {
      const y = typeof to === 'number' ? to : await locatorOf(to).evaluate((el, m) => el.getBoundingClientRect().top + window.scrollY - m, margin);
      await mark(label, rects);
      await page.evaluate(([target, ms]) => new Promise<void>((done) => {
        const from = window.scrollY, begin = performance.now();
        const step = (time: number) => {
          const k = Math.min(1, (time - begin) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          window.scrollTo(0, from + (target - from) * e);
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }), [y, seconds * 1000] as const);
    },
    wait: (seconds) => page.waitForTimeout(seconds * 1000),
  };
  await perform(rec);
  const duration = now() + 0.4;
  await page.waitForTimeout(400);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();

  // Frames from before the take began are its opening picture: the latest of them stands at 0.
  const opening = raw.filter((f) => f.t < t0).slice(-1).map((f) => ({ ...f, t: t0 }));
  const kept = [...opening, ...raw.filter((f) => f.t >= t0)];
  if (!kept.length) throw new Error(`capture ${name}: the screencast sent no frames`);
  const takeDir = join(dir, name);
  rmSync(takeDir, { recursive: true, force: true });
  mkdirSync(takeDir, { recursive: true });
  const frames = kept.map((f, i) => {
    const file = `${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(takeDir, file), Buffer.from(f.data, 'base64'));
    return { file, t: round3(f.t - t0), scrollY: f.scrollY };
  });
  const markList = Object.entries(marks).map(([label, m]) => `${label} ${m.t.toFixed(1)}s`).join(', ') || 'none';
  console.error(`filmed ${name}  (${frames.length} frames over ${duration.toFixed(1)}s — Chrome sends frames only on repaint; marks: ${markList})`);
  return {
    kind: 'take', w: width, h: height, scale: device.scale, duration: round3(duration), frames,
    marks: Object.fromEntries(Object.entries(marks).map(([k, m]) => [k, { ...m, t: round3(m.t) }])),
    mouse: mouse.map(([t, x, y, c]) => [round3(t), Math.round(x), Math.round(y), c]),
    keys: keys.map(round3),
  };
}

// ---------- the index ----------

const entryPath = (dir: string, name: string) => join(dir, `${name}.json`);

// What each shot was made from, so a video can be traced back to the studio and host commits (and URL) behind it
// without keeping the media. Per shot, since --only redoes some shots against newer commits than the rest.
type ShotProvenance = { url: string; capturedAt: string; studio: GitState; workspace: GitState | null; host: (ProjectHostSpec & GitState) | null };
const provenancePath = (dir: string) => join(dir, 'provenance.json');
const readProvenance = (dir: string): Record<string, ShotProvenance> => (existsSync(provenancePath(dir)) ? JSON.parse(readFileSync(provenancePath(dir), 'utf8')) : {});

function writeShotProvenance(dir: string, name: string, provenance: ShotProvenance) {
  writeFileSync(provenancePath(dir), JSON.stringify({ ...readProvenance(dir), [name]: provenance }, null, 2));
}

function writeEntry(dir: string, name: string, entry: Entry) {
  writeFileSync(entryPath(dir, name), JSON.stringify(entry));
}

// Rebuilt from every shot's own entry, so redoing some shots keeps the rest. A shot without a capture of its kind is
// left out, so a scene using it fails to compile by name. What no shot owns any more is deleted, so a renamed shot
// doesn't leave its old files behind.
function writeIndex(dir: string, shots: readonly Shot[]): UncapturedShot[] {
  const uncaptured: UncapturedShot[] = [];
  const entries: (readonly [Shot, Entry])[] = [];
  for (const s of shots) {
    const entry = existsSync(entryPath(dir, s.name)) ? (JSON.parse(readFileSync(entryPath(dir, s.name), 'utf8')) as Entry) : null;
    if (!entry) uncaptured.push({ name: s.name, reason: 'never captured' });
    else if (entry.kind !== s.kind) uncaptured.push({ name: s.name, reason: `captured as a ${entry.kind}, but capture.ts makes it a ${s.kind}` });
    else entries.push([s, entry]);
  }
  const names = new Set(shots.map((s) => s.name));
  writeFileSync(provenancePath(dir), JSON.stringify(Object.fromEntries(Object.entries(readProvenance(dir)).filter(([name]) => names.has(name))), null, 2));
  for (const file of readdirSync(dir)) {
    if (file !== 'index.ts' && file !== 'provenance.json' && !names.has(file.replace(/\.(png|json)$/, ''))) rmSync(join(dir, file), { recursive: true, force: true });
  }
  writeFileSync(join(dir, 'index.ts'), indexModule(entries.map(([s, entry]) => [s.name, entry] as const)));
  return uncaptured;
}

// The index is a module rather than JSON so the video imports each image (the bundler hashes and serves it) and rect
// and mark names are types: a scene asking for one the capture never measured fails to compile. A take's frames and
// mouse are cast to their plain types, so hundreds of frames aren't hundreds of literal types.
function indexModule(entries: readonly (readonly [string, Entry])[]) {
  const imports: string[] = [];
  const src = (path: string) => {
    imports.push(`import i${imports.length} from './${path}';`);
    return `i${imports.length - 1}`;
  };
  const stills: string[] = [], takes: string[] = [];
  for (const [name, entry] of entries) {
    if (entry.kind === 'still') {
      const { kind: _, file, ...rest } = entry;
      stills.push(`  ${JSON.stringify(name)}: { src: ${src(file)}, ${JSON.stringify(rest).slice(1)},`);
    } else {
      const { kind: _, frames, mouse, keys, ...rest } = entry;
      const frameList = frames.map((f) => `{ src: ${src(`${name}/${f.file}`)}, t: ${f.t}, scrollY: ${f.scrollY} }`).join(', ');
      takes.push(`  ${JSON.stringify(name)}: { ${JSON.stringify(rest).slice(1, -1)}, frames: [${frameList}] as readonly TakeFrame[], mouse: ${JSON.stringify(mouse)} as readonly TakeMouse[], keys: ${JSON.stringify(keys)} as readonly number[] },`);
    }
  }
  return `// Written by \`studio capture\` (lib/footage/capture/engine/capture.ts). Edits here are lost on the next capture.
import type { Shot } from '#lib/picture/camera/models/camera.ts';
import type { Take, TakeFrame, TakeMouse } from '#lib/footage/capture/studio/take.ts';
${imports.join('\n')}

export const captures = {
${stills.join('\n')}
} as const satisfies Record<string, Shot>;

export const takes = {
${takes.join('\n')}
} as const satisfies Record<string, Take>;
`;
}

function injectStyle(style: string) {
  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('style');
    tag.textContent = style;
    document.head.appendChild(tag);
  });
}
