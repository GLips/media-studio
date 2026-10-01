// browser-module-page.ts: runs a browser module of the studio's (a `studio` file that sets functions on globalThis)
// in the render browser, outside any Remotion bundle, for a tool that needs the browser's GPU or canvas but not a
// composition. The module is bundled with esbuild, served beside a folder of the caller's
// files over loopback HTTP (a secure context, which WebGPU needs, and images untainted), and each call evaluates one
// of its functions.
//
// Negative space: no React and no delayRender; a function that waits returns a promise, which the call awaits.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { build } from 'esbuild';
import { inRenderBrowser } from './render-browser.ts';

const CONTENT_TYPES: Readonly<Record<string, string>> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

/** Calls the module's `globalThis[name](...args)` in the page, and resolves with what it returns (serialized). */
export type BrowserModuleCall = <T>(name: string, ...args: unknown[]) => Promise<T>;

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
 * Opens `entry` (bundled for the browser) in a page of the render browser, with `filesDir` served at `/files/`, and
 * hands `use` a way to call what the module put on globalThis. The page, server and browser close when `use` settles.
 */
export async function withBrowserModulePage<T>({ entry, filesDir }: { entry: string; filesDir: string }, use: (call: BrowserModuleCall) => Promise<T>): Promise<T> {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120', logLevel: 'silent' });
  const script = bundled.outputFiles[0].contents;
  const root = normalize(filesDir) + sep;
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === '/') return response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><body><script src="/module.js"></script></body>');
    if (path === '/module.js') return response.writeHead(200, { 'content-type': 'text/javascript' }).end(script);
    const file = normalize(join(root, path.replace(/^\/files\//, '')));
    if (!path.startsWith('/files/') || !file.startsWith(root)) return response.writeHead(404).end();
    try {
      response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { result } = await inRenderBrowser(async (browser) => {
      const page = await browser.newPage({ context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => {} });
      try {
        await page.goto({ url: `${origin}/`, timeout: 30_000 });
        return await use(<R>(name: string, ...args: unknown[]) => page.evaluate(
          (fn: string, list: unknown[]) => (globalThis as unknown as Record<string, (...a: unknown[]) => unknown>)[fn](...list),
          name, args as never,
        ) as Promise<R>);
      } finally {
        await page.close();
      }
    });
    return result;
  } finally {
    server.close();
  }
}
