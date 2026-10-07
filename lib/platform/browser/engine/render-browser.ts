// render-browser.ts: the browser every render runs in, and the GPU backends it actually got. Node only.
//
// Chrome silently falls back to SwiftShader, its software GL, when it can't have the GPU, and renders many times
// slower. So each render's browser is asked which renderer WebGL gets and which adapter WebGPU gets, before the render
// and after; a missing or software one fails it (painting draws with WebGPU, but software GL composites the page in
// software). The page asked is served over loopback HTTP, as Remotion's are: WebGPU needs a secure context.
//
// Under a browser keeper (kept-render-browsers.ts, a remote-render container) a render borrows the keeper's browsers
// and takes no GPU lease: they are the machine's GPU.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HeadlessBrowser } from '@remotion/renderer';
import { acquireStudioGpuLease } from '#lib/platform/gpu/engine/gpu-lease.ts';
import { isRenderBrowserFailure, renderBrowserFailureText } from '../models/render-browser-failure.ts';
import { renderPageLogText, renderPageWarningText } from '../models/render-page-log.ts';
import { wholeBrowserPageError } from './browser-page-error.ts';
import { borrowKeptRenderBrowser, KEPT_RENDER_BROWSERS_ENV, type KeptRenderBrowserLoan } from './kept-render-browsers.ts';
import { openRenderBrowser, RENDER_CHROME_MODE, RENDER_CHROMIUM } from './render-browser-launch.ts';
import type { TraceCollector } from '#lib/platform/trace/engine/trace-collector.ts';

/**
 * The one wall-clock ceiling of a render's page: each delayRender (a painted shot's load and warm, or one frame), each
 * seek and each page call. Only a backstop for a page making progress forever: a render fails when its progress stops,
 * as a painted shot's watch (shot-watch.ts) and every render browser's (render-watch.ts) see it.
 */
export const RENDER_TIMEOUT_MS = 2 * 60 * 60_000;

/** The warnings printed so far: a command renders in a process of its own, its tabs, chunks and passes all here. */
const renderPageWarningsPrinted = new Set<string>();

/**
 * Prints a render page's lines for the terminal (render-page-log.ts) on stderr, each distinct warning once however
 * many tabs and chunks log it: Remotion's `onBrowserLog`.
 */
export function printRenderPageLog({ text }: { readonly text: string }): void {
  const warning = renderPageWarningText(text);
  if (warning !== null && !renderPageWarningsPrinted.has(warning)) process.stderr.write(`  ${warning}\n`);
  if (warning !== null) renderPageWarningsPrinted.add(warning);
  const line = renderPageLogText(text);
  if (line !== null) process.stderr.write(`  ${line}\n`);
}

/**
 * What every Remotion call that opens a render page takes: the GPU, the one ceiling, and the page's lines printed.
 * Spread first, so a call that watches the page's lines passes its own `onBrowserLog`.
 */
export const RENDER_PAGE_OPTIONS = {
  chromiumOptions: RENDER_CHROMIUM, chromeMode: RENDER_CHROME_MODE, timeoutInMilliseconds: RENDER_TIMEOUT_MS, onBrowserLog: printRenderPageLog,
} as const;

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

/** The error `text`, marked as its browser's failure when `lostGpu`: a fresh browser may not meet it. */
const gpuBackendError = (text: string, lostGpu: boolean) => new Error(lostGpu ? renderBrowserFailureText(text) : text);

/**
 * Refuses a browser with no GL or WebGPU, or a software one. One that had them and fell back by the end, or has no GL
 * at all, lost its GPU process.
 */
function assertHardwareGpu({ gl, webgpu }: GpuBackends, when: 'before' | 'after') {
  const what = when === 'before' ? 'has' : 'fell back to', fellBack = when === 'after';
  if (gl === null) throw gpuBackendError(`the render's browser ${what} no GL backend: its GPU process is gone`, true);
  if (SOFTWARE_GL.test(gl)) {
    throw gpuBackendError(`the render's browser ${what} software GL (${gl}), which renders many times slower. Close other GPU-heavy apps, or render with fewer --workers`, fellBack);
  }
  if (webgpu === null) throw gpuBackendError(`the render's browser ${what} no WebGPU adapter: stamp paintings can't draw`, fellBack);
  if (webgpu.fallback) throw gpuBackendError(`the render's browser ${what} a software WebGPU adapter, which renders many times slower`, fellBack);
}

/** Where a render browser's opening is timed: in `trace`, under span `parent`. */
export type RenderBrowserTrace = { readonly trace: TraceCollector; readonly parent: string };

/** `work` as span `name` in `traced`, or untimed when the render isn't traced. */
const tracedStep = <T,>(traced: RenderBrowserTrace | undefined, name: string, work: () => Promise<T>) =>
  (traced ? traced.trace.run(name, work, { parent: traced.parent }) : work());

/**
 * A browser of this process's own, opened once it holds the GPU lease (gpu-lease.ts), and closed when given back; its
 * launch timed in `traced`.
 */
async function openOwnRenderBrowser(traced?: RenderBrowserTrace): Promise<KeptRenderBrowserLoan> {
  const waited = await acquireStudioGpuLease();
  const browser = await tracedStep(traced, 'browser launch', openRenderBrowser);
  return { browser, waited, giveBack: () => browser.close({ silent: true }) };
}

/**
 * Rejects as its browser's failure once `browser`'s connection closes, crashed or killed. A call sent into a closed
 * connection never settles, so a check that might meet one races this.
 */
function renderBrowserClosed(browser: HeadlessBrowser): Promise<never> {
  const closed = new Promise<never>((_, reject) => browser.connection.transport.websocket.addEventListener('close', () => {
    reject(new Error(renderBrowserFailureText("the render's browser closed: it crashed, or something killed it")));
  }));
  // Rejects whenever the browser closes, its own close after the work included: only a race awaits it.
  closed.catch(() => {});
  return closed;
}

/**
 * Runs `render` in a browser of its own or a keeper's (KEPT_RENDER_BROWSERS_ENV), told its GPU backends, and closes or
 * gives it back after; `waited` is the seconds it queued. Refuses software GL or WebGPU, before and after. A page's
 * error keeps its whole message. Launch and GPU probes are timed in `traced`, when given.
 */
export async function inRenderBrowser<T>(render: (browser: HeadlessBrowser, gpu: string) => Promise<T>, traced?: RenderBrowserTrace): Promise<{ result: T; gpu: string; waited: number }> {
  const keeper = process.env[KEPT_RENDER_BROWSERS_ENV];
  const { browser, waited, giveBack } = keeper ? await borrowKeptRenderBrowser(keeper) : await openOwnRenderBrowser(traced);
  const closed = renderBrowserClosed(browser);
  const probe = (name: string) => tracedStep(traced, name, () => Promise.race([readGpuBackends(browser), closed]));
  let broken = false;
  try {
    const before = await probe('GPU probe');
    assertHardwareGpu(before, 'before');
    const result = await render(browser, describeGpu(before)).catch((error: Error) => Promise.reject(wholeBrowserPageError(error)));
    assertHardwareGpu(await probe('GPU probe after'), 'after');
    return { result, gpu: describeGpu(before), waited };
  } catch (error) {
    broken = error instanceof Error && isRenderBrowserFailure(error.message);
    throw error;
  } finally {
    await giveBack(broken);
  }
}
