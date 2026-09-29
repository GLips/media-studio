// render-browser.ts: the browser every render runs in, and the GPU backends it actually got. Node only.
//
// A render asks Chrome for the GPU (RENDER_CHROMIUM), but Chrome falls back to SwiftShader, its software GL, when it
// can't have it or its GPU process keeps crashing, and says nothing: the render just takes many times as long. So
// each render's browser is asked which renderer a WebGL context gets and which adapter WebGPU gets, before the render
// and again after, and a missing or software one fails the render. Scenes draw with both: film, previs and reel with
// WebGL, stamp paintings with WebGPU.
//
// WebGPU exists only in a secure context, so the question is asked of a page served over loopback HTTP, as Remotion
// serves a render's: about:blank has no navigator.gpu.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openBrowser, type HeadlessBrowser } from '@remotion/renderer';

/**
 * Every render's browser runs on the GPU. Three scenes (film, previs, reel) draw with WebGL, which Remotion's
 * default software renderer makes crawl; WebGPU needs no flag.
 */
export const RENDER_CHROMIUM = { gl: 'angle' } as const;

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
  if (gl === null) throw new Error(`the render's browser ${what} no WebGL: painted layers can't draw`);
  if (SOFTWARE_GL.test(gl)) {
    throw new Error(`the render's browser ${what} software GL (${gl}), which renders many times slower. Close other GPU-heavy apps, or render with fewer --workers`);
  }
  if (webgpu === null) throw new Error(`the render's browser ${what} no WebGPU adapter: stamp paintings can't draw`);
  if (webgpu.fallback) throw new Error(`the render's browser ${what} a software WebGPU adapter, which renders many times slower`);
}

/**
 * Runs `render` in a browser of its own, which it passes to Remotion as `puppeteerInstance`, and closes it after.
 * Refuses to start on software GL or WebGPU, and fails if the browser has fallen back to either by the end, since the
 * frames rendered after the fallback were. Returns what `render` did and the GPU backends it had.
 */
export async function inRenderBrowser<T>(render: (browser: HeadlessBrowser) => Promise<T>): Promise<{ result: T; gpu: string }> {
  const browser = await openBrowser('chrome', { chromiumOptions: RENDER_CHROMIUM });
  try {
    const before = await readGpuBackends(browser);
    assertHardwareGpu(before, 'before');
    const result = await render(browser);
    assertHardwareGpu(await readGpuBackends(browser), 'after');
    return { result, gpu: describeGpu(before) };
  } finally {
    await browser.close({ silent: true });
  }
}
