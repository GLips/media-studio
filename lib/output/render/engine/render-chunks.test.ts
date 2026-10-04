// Draws render-chunks/video.tsx in chunks: its frame 2 holds until a local server says to draw, as a page whose GPU
// process hung would. The watchdog must find the stuck page, close its browser, and draw the chunk once more in a
// fresh one, failing the render only when that sticks too.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderFrames } from '@remotion/renderer';
import { renderInChunks, type RenderChunkDraw } from './render-chunks.ts';
import { openRenderSession } from './render-session.ts';
import { RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

// The server's answer to its nth ask.
let answer: (ask: number) => 'draw' | 'hang' = () => 'draw', asks = 0;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'access-control-allow-origin': '*' }).end(answer(++asks));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const askAt = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const outcomes = await withStudioTemp('render-chunks', async (studio) => {
  for (const linked of ['package.json', 'lib', 'node_modules']) symlinkSync(join(STUDIO_ROOT, linked), join(studio, linked));
  const project = join(studio, 'work', 'projects', 'render-chunks');
  mkdirSync(project, { recursive: true });
  copyFileSync(join(import.meta.dirname, 'render-chunks', 'video.tsx'), join(project, 'video.tsx'));
  const session = await openRenderSession(project), inputProps = { ...session.props(), askAt };
  const draw: RenderChunkDraw<readonly number[]> = async (browser, frames, watch) => {
    await renderFrames({
      ...RENDER_PAGE_OPTIONS, ...watch, composition: await session.compositionFor(inputProps, browser), serveUrl: session.serveUrl, puppeteerInstance: browser,
      inputProps, frames: [...frames], imageFormat: 'none', outputDir: null, concurrency: 1, onStart: () => {},
    });
    return frames;
  };
  const chunked = (frames: number[], hangs: (ask: number) => boolean) => {
    asks = 0;
    answer = (ask) => (hangs(ask) ? 'hang' : 'draw');
    return renderInChunks(frames, draw, { chunkFrames: 2, stallFloorMs: 4000 }).then(({ drawn }) => ({ drawn, asks }), (error: Error) => ({ error, asks }));
  };
  return { once: await chunked([0, 1, 2, 3], (ask) => ask === 1), always: await chunked([2, 3], () => true) };
});
server.close();

test('a chunk whose page sticks is drawn again in a fresh browser, and the render goes on', () => {
  assert.deepEqual(outcomes.once, { drawn: [[0, 1], [2, 3]], asks: 2 });
});

test('a chunk that sticks in its fresh browser too fails the render, naming the frame and the retry', () => {
  assert.ok('error' in outcomes.always, 'the render passed');
  assert.match(outcomes.always.error.message, /^frames 2–3 failed twice, each in a fresh browser: frame 2 hasn't drawn in \d+ s: its page or GPU process is stuck$/);
  assert.equal(outcomes.always.asks, 2);
});
