// browser-module-page.ts: runs a browser module of the studio's (a `studio` file that sets functions on globalThis)
// in the render browser, outside any Remotion bundle, for a tool that needs the browser's GPU or canvas but not a
// composition. The module is bundled with esbuild, served beside a folder of the caller's
// files over loopback HTTP (a secure context, which WebGPU needs, and images untainted), and each call evaluates one
// of its functions, which may ask for a screenshot of its page (studio/browser-module-screenshot.ts).
//
// Negative space: no React and no delayRender; a function that waits returns a promise, which the call awaits.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname, join, normalize, sep } from 'node:path';
import { build } from 'esbuild';
import type { HeadlessBrowser } from '@remotion/renderer';
import { BROWSER_MODULE_SCREENSHOT_ANSWER, BROWSER_MODULE_SCREENSHOT_BINDING, type BrowserModuleScreenshotAnswer, type BrowserModuleScreenshotRequest } from '../models/browser-module-screenshot.ts';
import { isRenderTargetClosed } from '../models/render-browser-failure.ts';
import { inRenderBrowser } from './render-browser.ts';

/** Fonts and sounds a module imports (through `#studio`, say), inlined: nothing serves them. */
const INLINED_ASSETS = { '.ttf': 'dataurl', '.wav': 'dataurl' } as const;
const CONTENT_TYPES: Readonly<Record<string, string>> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

/** Calls the module's `globalThis[name](...args)` in the page, and resolves with what it returns (serialized). */
export type BrowserModuleCall = <T>(name: string, ...args: unknown[]) => Promise<T>;

/** What a module page runs on: the GPU backends its browser has (render-browser.ts), and its bundle's sha256. */
export type BrowserModulePageRun = { gpu: string; bundle: string };

type BrowserModulePage = Awaited<ReturnType<HeadlessBrowser['newPage']>>;

/** The protocol's Runtime.addBinding, through a session's send: its answer is empty, only its size read. */
type BrowserModuleAddBinding = (method: 'Runtime.addBinding', params: { readonly name: string }) => Promise<{ readonly size: number }>;

/** Answers `page`'s screenshot requests (studio/browser-module-screenshot.ts), each as it comes, from now on. */
async function answerBrowserModuleScreenshots(page: BrowserModulePage) {
  const client = page._client();
  // SAFETY: Remotion's session types only the commands Remotion sends; Runtime.addBinding is the protocol's, taking a name.
  const addBinding = client.send.bind(client) as BrowserModuleAddBinding;
  await addBinding('Runtime.addBinding', { name: BROWSER_MODULE_SCREENSHOT_BINDING });
  client.on('Runtime.bindingCalled', ({ name, payload }: { name: string; payload: string }) => {
    if (name !== BROWSER_MODULE_SCREENSHOT_BINDING) return;
    // SAFETY: the binding is called only by browserModuleScreenshot, with a request as JSON.
    const { id, box } = JSON.parse(payload) as BrowserModuleScreenshotRequest;
    const answer = (png: string | null, error: string | null) => page.evaluate(
      // SAFETY: browserModuleScreenshot sets the answer on globalThis before it calls the binding.
      (fn: string, ...args: Parameters<BrowserModuleScreenshotAnswer>) => (globalThis as typeof globalThis & Record<string, BrowserModuleScreenshotAnswer>)[fn](...args),
      BROWSER_MODULE_SCREENSHOT_ANSWER, id, png, error,
    );
    void client.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 }, fromSurface: true, captureBeyondViewport: false })
      .then(({ value }) => answer(value.data, null), (error: Error) => answer(null, error.message));
  });
}

/**
 * The files under `root` that `entry` imports, itself among them, bundled for `platform` as the studio bundles it, as
 * paths from `root`. Packages aren't followed: only source files are listed.
 */
export async function bundledSourceFiles(root: string, entry: string, platform: 'node' | 'browser'): Promise<string[]> {
  const bundled = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, metafile: true, logLevel: 'silent', platform,
    ...(platform === 'node' ? { format: 'esm', packages: 'external' } : { format: 'iife', target: 'chrome120' }),
  });
  return Object.keys(bundled.metafile.inputs).filter((file) => !file.startsWith('node_modules/') && !file.includes(':')).map((file) => file.split(sep).join('/'));
}

/**
 * Opens `entry` (bundled for the browser) in `pages` pages of the render browser, `filesDir` served at `/files/`, and
 * hands `use` a call into what the module put on globalThis, and what it runs on. Calls run on the first page free,
 * at once when issued together, so none may rely on another's state. `alias`: bare imports the bundle resolves.
 */
export async function withBrowserModulePage<T>(
  { entry, filesDir, alias, pages = 1 }: { entry: string; filesDir: string; alias?: Readonly<Record<string, string>>; pages?: number },
  use: (call: BrowserModuleCall, run: BrowserModulePageRun) => Promise<T>,
): Promise<T> {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120', logLevel: 'silent', loader: INLINED_ASSETS, ...(alias && { alias: { ...alias } }) });
  const script = bundled.outputFiles[0].contents, bundle = createHash('sha256').update(script).digest('hex');
  const root = normalize(filesDir) + sep;
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === '/') return response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><body><script src="/module.js"></script></body>');
    if (path === '/module.js') return response.writeHead(200, { 'content-type': 'text/javascript' }).end(script);
    const file = normalize(join(root, path.replace(/^\/files\//, '')));
    if (!path.startsWith('/files/') || !file.startsWith(root)) return response.writeHead(404).end();
    // Read before the head is written: a file gone since (its pack re-imported) answers 404 rather than throwing here.
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      return response.writeHead(404).end();
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const inModuleBrowser = () => inRenderBrowser(async (browser, gpu) => {
    const opened = await Promise.all(Array.from({ length: pages }, () => browser.newPage({ context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => {} })));
    // A crashed page (its renderer out of memory) never settles a pending evaluate: each call races its page's crash.
    const crashes = new Map(opened.map((page) => {
      const crashed = new Promise<never>((_, reject) => page.on('error', reject));
      crashed.catch(() => {});
      return [page, crashed] as const;
    }));
    try {
      await Promise.all(opened.map(async (page) => {
        await answerBrowserModuleScreenshots(page);
        await page.goto({ url: `${origin}/`, timeout: 30_000 });
      }));
      // The free pages, and the calls waiting for one, first come first served.
      const free = [...opened], waiting: ((page: BrowserModulePage) => void)[] = [];
      const release = (page: BrowserModulePage) => (waiting.length ? waiting.shift()!(page) : free.push(page));
      return await use(async <R>(name: string, ...args: unknown[]) => {
        const page = free.pop() ?? await new Promise<BrowserModulePage>((resolve) => waiting.push(resolve));
        try {
          // SAFETY: the caller names what the module's function returns; evaluate hands back its serialized value.
          return await Promise.race([page.evaluate(
            (fn: string, list: unknown[]) => (globalThis as unknown as Record<string, (...a: unknown[]) => unknown>)[fn](...list),
            name, args as never,
          ) as Promise<R>, crashes.get(page)!]);
        } finally {
          release(page);
        }
      }, { gpu, bundle });
    } finally {
      await Promise.all(opened.map((page) => page.close()));
    }
  });
  try {
    // A target closed under the module is a transient most often seen with the adapter shared: `use` runs once more,
    // whole, in a fresh browser. Its calls hold no page state, so running them again only repeats work. A crashed page
    // isn't run again: its renderer ran out of memory, as it would again.
    const { result } = await inModuleBrowser().catch((error: Error) => {
      if (!isRenderTargetClosed(error.message)) throw error;
      process.stderr.write(`  ${basename(entry)}: ${error.message}\n  running it once more in a fresh browser\n`);
      return inModuleBrowser();
    });
    return result;
  } finally {
    server.close();
  }
}
