// render-browser.ts: the browser every render runs in, and the GPU backends it actually got. Node only.
//
// Chrome silently falls back to SwiftShader, its software GL, when it can't have the GPU or its GPU process keeps
// crashing: the render just takes many times as long. So each render's browser is asked which renderer a WebGL
// context gets and which adapter WebGPU gets, before the render and after; a missing or software one fails it.
// Everything three.js and painted draws with WebGPU; software GL still means the page composites in software.
//
// WebGPU exists only in a secure context, so the question is asked of a page served over loopback HTTP, as Remotion
// serves a render's: about:blank has no navigator.gpu.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openBrowser, type HeadlessBrowser } from '@remotion/renderer';
import { acquireStudioGpuLease } from '#lib/platform/gpu/engine/gpu-lease.ts';
import { renderPageLogText } from '../models/render-page-log.ts';
import { wholeBrowserPageError } from './browser-page-error.ts';

/**
 * Every render's browser runs on the GPU: Chrome's compositing goes through its GL backend, which Remotion's default
 * software renderer makes crawl; WebGPU needs no flag.
 */
const RENDER_CHROMIUM = { gl: 'angle' } as const;

/**
 * The one wall-clock ceiling of a render's page: each delayRender, each seek and each page call. A backstop far past
 * any frame's work, so wall time isn't the budget: a render fails sooner only when its progress stops, as a painted
 * shot's watchdog (shot-watch.ts) and a chunked render's (render-chunks.ts) see it.
 */
export const RENDER_TIMEOUT_MS = 15 * 60_000;

/** Prints a render page's lines for the terminal (render-page-log.ts) on stderr: Remotion's `onBrowserLog`. */
export function printRenderPageLog({ text }: { readonly text: string }): void {
  const line = renderPageLogText(text);
  if (line !== null) process.stderr.write(`  ${line}\n`);
}

/**
 * What every Remotion call that opens a render page takes: the GPU, the one ceiling, and the page's lines printed.
 * Spread first, so a call that watches the page's lines passes its own `onBrowserLog`.
 */
export const RENDER_PAGE_OPTIONS = { chromiumOptions: RENDER_CHROMIUM, timeoutInMilliseconds: RENDER_TIMEOUT_MS, onBrowserLog: printRenderPageLog } as const;

// SwiftShader is Chrome's own; llvmpipe and softpipe are Mesa's, on a Linux machine with no GPU driver.
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;

/** What a page in the render browser draws with: WebGL's renderer, and WebGPU's adapter. Null for one it lacks. */
type GpuBackends = { gl: string | null; webgpu: { vendor: string; architecture: string; fallback: boolean } | null };

async function readGpuBackends(browser: HeadlessBrowser): Promise<GpuBackends> {
  const server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>gpu</title>'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const page = await browser.newPage({ context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => {} });
    try {
      await page.goto({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, timeout: 30_000 });
      return await page.mainFrame().evaluate(async (): Promise<GpuBackends> => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
        let renderer: string | null = null;
        if (gl) {
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
        const webgpu = adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, fallback: adapter.info.isFallbackAdapter } : null;
        return { gl: renderer, webgpu };
      });
    } finally {
      await page.close();
    }
  } finally {
    server.close();
  }
}

/** The backends as a render records them, one line: another GPU rounds a painted frame differently. */
const describeGpu = ({ gl, webgpu }: GpuBackends) => `${gl}; WebGPU ${webgpu!.vendor} ${webgpu!.architecture}`;

function assertHardwareGpu({ gl, webgpu }: GpuBackends, when: 'before' | 'after') {
  const what = when === 'before' ? 'has' : 'fell back to';
  if (gl === null) throw new Error(`the render's browser ${what} no GL backend: its GPU process is gone`);
  if (SOFTWARE_GL.test(gl)) {
    throw new Error(`the render's browser ${what} software GL (${gl}), which renders many times slower. Close other GPU-heavy apps, or render with fewer --workers`);
  }
  if (webgpu === null) throw new Error(`the render's browser ${what} no WebGPU adapter: stamp paintings can't draw`);
  if (webgpu.fallback) throw new Error(`the render's browser ${what} a software WebGPU adapter, which renders many times slower`);
}

/**
 * Runs `render` in a browser of its own, told its GPU backends, and closes it after. The browser opens once the process
 * holds the GPU lease (gpu-lease.ts); `waited` is the seconds this call queued. Refuses software GL or WebGPU, and
 * fails if the browser falls back to either by the end. A page's error keeps its whole message.
 */
export async function inRenderBrowser<T>(render: (browser: HeadlessBrowser, gpu: string) => Promise<T>): Promise<{ result: T; gpu: string; waited: number }> {
  const waited = await acquireStudioGpuLease();
  const browser = await openBrowser('chrome', { chromiumOptions: RENDER_CHROMIUM });
  try {
    const before = await readGpuBackends(browser);
    assertHardwareGpu(before, 'before');
    const result = await render(browser, describeGpu(before)).catch((error: Error) => Promise.reject(wholeBrowserPageError(error)));
    assertHardwareGpu(await readGpuBackends(browser), 'after');
    return { result, gpu: describeGpu(before), waited };
  } finally {
    await browser.close({ silent: true });
  }
}
