// render-browser.ts: the browser every render runs in, and the GL backend it actually got. Node only.
//
// A render asks Chrome for the GPU (RENDER_CHROMIUM), but Chrome falls back to SwiftShader, its software GL, when it
// can't have it or its GPU process keeps crashing, and says nothing: the render just takes many times as long. So
// each render's browser is asked which renderer a WebGL context gets, before the render and again after, and a
// software one fails the render.
import { openBrowser, type HeadlessBrowser } from '@remotion/renderer';

/**
 * Every render's browser runs on the GPU. Painted layers (lib/paint) draw with WebGL, which Remotion's default
 * software renderer makes crawl.
 */
export const RENDER_CHROMIUM = { gl: 'angle' } as const;

// SwiftShader is Chrome's own; llvmpipe and softpipe are Mesa's, on a Linux machine with no GPU driver.
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;

/** The renderer a WebGL context in `browser` gets, as WEBGL_debug_renderer_info names it, or null with no WebGL at all. */
async function readGlBackend(browser: HeadlessBrowser): Promise<string | null> {
  const page = await browser.newPage({ context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => {} });
  try {
    return await page.mainFrame().evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return renderer;
    });
  } finally {
    await page.close();
  }
}

function assertHardwareGl(backend: string | null, when: 'before' | 'after') {
  const what = when === 'before' ? 'has' : 'fell back to';
  if (backend === null) throw new Error(`the render's browser ${what} no WebGL: painted layers can't draw`);
  if (SOFTWARE_GL.test(backend)) {
    throw new Error(`the render's browser ${what} software GL (${backend}), which renders many times slower. Close other GPU-heavy apps, or render with fewer --workers`);
  }
}

/**
 * Runs `render` in a browser of its own, which it passes to Remotion as `puppeteerInstance`, and closes it after.
 * Refuses to start on software GL, and fails if the browser has fallen back to it by the end, since the frames
 * rendered after the fallback were. Returns what `render` did and the GL backend it had.
 */
export async function inRenderBrowser<T>(render: (browser: HeadlessBrowser) => Promise<T>): Promise<{ result: T; gl: string }> {
  const browser = await openBrowser('chrome', { chromiumOptions: RENDER_CHROMIUM });
  try {
    const gl = await readGlBackend(browser);
    assertHardwareGl(gl, 'before');
    const result = await render(browser);
    assertHardwareGl(await readGlBackend(browser), 'after');
    return { result, gl: gl! };
  } finally {
    await browser.close({ silent: true });
  }
}
