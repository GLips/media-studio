// Draws render-chunks/video.tsx in chunks: its frame 2 asks a local server whether to draw, and the server answers
// draw, hang (as a page whose GPU process hung would) or crash, crashing the whole browser over CDP first. A piece that
// failed as its browser did is drawn again in halves, each in a fresh browser, and a frame that fails again alone
// fails the render, named by its scene. A browser crashing under renderFrames fails its piece at once: Remotion never
// draws the frame again in a browser it opens itself, outside the watch.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderFrames, type HeadlessBrowser } from '@remotion/renderer';
import { renderInChunks, type RenderChunkDraw } from './render-chunks.ts';
import { openRenderSession } from './render-session.ts';
import { withFixtureStudioProject } from './fixture-studio-project.ts';
import { RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { watchedRenderFrames } from '#lib/platform/browser/engine/render-watch.ts';
import { isRenderBrowserFailure } from '#lib/platform/browser/models/render-browser-failure.ts';
import { gpuDeviceLostText } from '#lib/platform/gpu/models/gpu-device-lost.ts';
import { timelineFrameText } from '#lib/picture/video/models/timeline-report.ts';

/** The protocol's Browser.crash, through a connection's send, which Remotion types only for its own commands. */
type BrowserCrashSend = (method: 'Browser.crash') => Promise<{ readonly size: number }>;

type ServerAnswer = 'draw' | 'hang' | 'crash';

// The server's answer to its nth ask, and the browser drawing now, which a crash takes down.
let answer: (ask: number) => ServerAnswer = () => 'draw', asks = 0, drawing: HeadlessBrowser | null = null;
const server = createServer((_request, response) => {
  const said = answer(++asks);
  if (said === 'crash') {
    // SAFETY: Browser.crash takes no parameters; the browser dies before it answers, so its send rejects.
    void (drawing!.connection.send.bind(drawing!.connection) as BrowserCrashSend)('Browser.crash').catch(() => {});
  }
  response.writeHead(200, { 'access-control-allow-origin': '*' }).end(said);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const askAt = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const outcomes = await withFixtureStudioProject('render-chunks', join(import.meta.dirname, 'render-chunks'), async (project) => {
  const session = await openRenderSession(project), inputProps = { ...session.props(), askAt }, timeline = await session.readTimeline();
  const draw: RenderChunkDraw<readonly number[]> = async (browser, frames, watch) => {
    drawing = browser;
    await renderFrames({
      ...RENDER_PAGE_OPTIONS, ...watchedRenderFrames(watch), composition: await session.compositionFor(inputProps, browser), serveUrl: session.serveUrl,
      puppeteerInstance: browser, inputProps, frames: [...frames], imageFormat: 'none', outputDir: null, concurrency: 1, onStart: () => {},
    });
    return frames;
  };
  const chunked = (frames: number[], chunkFrames: number, says: (ask: number) => ServerAnswer) => {
    asks = 0;
    answer = says;
    // Long enough for a browser to open and load its page while other tests render beside it.
    return renderInChunks(frames, draw, { chunkFrames, stallMs: 15_000, describeFrame: async (frame) => timelineFrameText(timeline, frame) })
      .then(({ drawn }) => ({ drawn: drawn.map(({ result }) => result), asks }), (error: Error) => ({ error, asks }));
  };
  return {
    crashedOnce: await chunked([0, 1, 2, 3], 4, (ask) => (ask === 1 ? 'crash' : 'draw')),
    stuckAlways: await chunked([2, 3], 2, () => 'hang'),
  };
});
server.close();

test('a piece whose browser crashes is drawn again in halves, each in a fresh browser, and the render goes on', () => {
  assert.deepEqual(outcomes.crashedOnce, { drawn: [[0, 1], [2, 3]], asks: 2 });
});

test('a frame stuck again alone fails the render, named by its scene', () => {
  assert.ok('error' in outcomes.stuckAlways, 'the render passed');
  assert.match(outcomes.stuckAlways.error.message, /^frame 2 \(0\.07 s, scene grey\) failed again, drawn alone in a fresh browser: frame 2 hasn't drawn in \d+ s: its page or GPU process is stuck$/);
  assert.equal(outcomes.stuckAlways.asks, 2);
});

test("a lost device is its browser's failure, drawn again; a frame's own error isn't", () => {
  assert.ok(isRenderBrowserFailure(gpuDeviceLostText('the GPU process exited')));
  assert.ok(!isRenderBrowserFailure("shot: plane sky's source names no layer clouds"));
});
