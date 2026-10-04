// Draws render-chunks/video.tsx in chunks: its frame 2 holds until a local server says to draw, as a page whose GPU
// process hung would. The watchdog must find the stuck page, close its browser, and draw the chunk once more in a
// fresh one, failing the render only when that sticks too. A chunk is drawn again only when it failed as its browser
// did, which the errors written elsewhere (a lost device, a painted shot's stall) mark.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderFrames } from '@remotion/renderer';
import { renderInChunks, type RenderChunkDraw } from './render-chunks.ts';
import { openRenderSession } from './render-session.ts';
import { withFixtureStudioProject } from './fixture-studio-project.ts';
import { RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { watchedRenderFrames } from '#lib/platform/browser/engine/render-watch.ts';
import { isRenderBrowserFailure } from '#lib/platform/browser/models/render-browser-failure.ts';
import { gpuDeviceLostText } from '#lib/platform/gpu/models/gpu-device-lost.ts';

// The server's answer to its nth ask.
let answer: (ask: number) => 'draw' | 'hang' = () => 'draw', asks = 0;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'access-control-allow-origin': '*' }).end(answer(++asks));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const askAt = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const outcomes = await withFixtureStudioProject('render-chunks', join(import.meta.dirname, 'render-chunks'), async (project) => {
  const session = await openRenderSession(project), inputProps = { ...session.props(), askAt };
  const draw: RenderChunkDraw<readonly number[]> = async (browser, frames, watch) => {
    await renderFrames({
      ...RENDER_PAGE_OPTIONS, ...watchedRenderFrames(watch), composition: await session.compositionFor(inputProps, browser), serveUrl: session.serveUrl,
      puppeteerInstance: browser, inputProps, frames: [...frames], imageFormat: 'none', outputDir: null, concurrency: 1, onStart: () => {},
    });
    return frames;
  };
  const chunked = (frames: number[], hangs: (ask: number) => boolean) => {
    asks = 0;
    answer = (ask) => (hangs(ask) ? 'hang' : 'draw');
    // Long enough for a browser to open and load its page while other tests render beside it.
    return renderInChunks(frames, draw, { chunkFrames: 2, stallFloorMs: 15_000 }).then(({ drawn }) => ({ drawn, asks }), (error: Error) => ({ error, asks }));
  };
  return { once: await chunked([0, 1, 2, 3], (ask) => ask === 1), always: await chunked([2, 3], () => true) };
});
server.close();

test('a chunk whose page sticks is drawn again in a fresh browser, and the render goes on', () => {
  assert.deepEqual(outcomes.once, { drawn: [[0, 1], [2, 3]], asks: 2 });
});

test('a chunk that sticks in its fresh browser too fails the render, naming the frame and the retry', () => {
  assert.ok('error' in outcomes.always, 'the render passed');
  assert.match(outcomes.always.error.message, /^frames 2–3 failed twice, each in a fresh browser: frame 2 hasn't drawn in \d+ s: its page or GPU process is stuck \[/);
  assert.equal(outcomes.always.asks, 2);
});

test("a lost device is its browser's failure, drawn again; a frame's own error isn't", () => {
  assert.ok(isRenderBrowserFailure(gpuDeviceLostText('the GPU process exited')));
  assert.ok(!isRenderBrowserFailure("shot: plane sky's source names no layer clouds"));
});
