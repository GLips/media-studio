// picture-oracle.ts: a render's frames as its pages read them back (picture-root.tsx) held against Remotion's
// screenshot of the same page, the way every frame was captured before pages sent their own. Each frame's difference,
// channel by channel, says whether HTML-in-Canvas drew what the page shows: the guard on a Chrome upgrade. Node only.

import { renderFrames } from '@remotion/renderer';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RENDER_PAGE_OPTIONS } from '#lib/platform/browser/engine/render-browser.ts';
import { watchedRenderFrames } from '#lib/platform/browser/engine/render-watch.ts';
import { openFfmpegInput } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { decodePngRgba, type PngRgba } from '#lib/platform/raster/models/png-decode.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { RenderSession } from './render-session.ts';

/** How far one frame read back lies from its screenshot: the most any channel differs, how many px past 4, the mean. */
export type PictureOracleFrame = { readonly frame: number; readonly max: number; readonly over4: number; readonly mean: number; readonly at: { x: number; y: number } };

/** `f-<frame>` PNGs in `dir`, by frame. */
async function pngsIn(dir: string): Promise<Map<number, PngRgba>> {
  const found = readdirSync(dir).filter((f) => /^f-\d+\.png$/.test(f));
  return new Map(await Promise.all(found.map(async (f) => [Number(/\d+/.exec(f)![0]), await decodePngRgba(new Uint8Array(readFileSync(join(dir, f))), f)] as const)));
}

/** How `read` differs from `screenshot`, both the same size. */
function frameDifference(frame: number, read: PngRgba, screenshot: PngRgba): PictureOracleFrame & { readonly diff: Uint8Array } {
  if (read.w !== screenshot.w || read.h !== screenshot.h) throw new Error(`frame ${frame}: read back ${read.w}×${read.h}, screenshotted ${screenshot.w}×${screenshot.h}`);
  const diff = new Uint8Array(read.w * read.h * 4);
  let max = 0, over4 = 0, sum = 0, worst = 0;
  for (let p = 0; p < read.w * read.h; p++) {
    let most = 0;
    for (let c = 0; c < 4; c++) most = Math.max(most, Math.abs(read.data[p * 4 + c] - screenshot.data[p * 4 + c]));
    sum += most;
    if (most > 4) over4++;
    if (most > max) [max, worst] = [most, p];
    diff.set([Math.min(255, most * 8), 0, 0, 255], p * 4);
  }
  return { frame, max, over4, mean: sum / (read.w * read.h), at: { x: worst % read.w, y: Math.floor(worst / read.w) }, diff };
}

/**
 * `frames` of the session's video read back as a render sends them and screenshotted, each pair compared; with
 * `keep`, each frame's read, screenshot and difference (×8, in red) written there.
 */
export async function comparePictureToScreenshots(session: RenderSession, frames: readonly number[], { keep }: { keep?: string } = {}): Promise<PictureOracleFrame[]> {
  return withStudioTemp('picture-oracle', async (tmp) => {
    const readDir = join(tmp, 'read'), screenshotDir = join(tmp, 'screenshot');
    await session.renderStills(readDir, [...frames], { lossless: true });
    await session.inBrowser('screenshots', async (browser, watch) => {
      // No frame sink in the props: the page draws as the Studio does, and Remotion screenshots it.
      const inputProps = session.props(), composition = await session.compositionFor(inputProps, browser);
      await renderFrames({
        ...RENDER_PAGE_OPTIONS, ...watchedRenderFrames(watch), composition, serveUrl: session.serveUrl, puppeteerInstance: browser, inputProps,
        frames: [...frames], concurrency: 1, onStart: () => {}, outputDir: screenshotDir, imageFormat: 'png', imageSequencePattern: 'f-[frame].[ext]',
      });
      return { result: undefined, workers: 1 };
    });
    const [reads, screenshots] = await Promise.all([pngsIn(readDir), pngsIn(screenshotDir)]);
    return Promise.all(frames.map(async (frame) => {
      const read = reads.get(frame), screenshot = screenshots.get(frame);
      if (!read || !screenshot) throw new Error(`frame ${frame}: ${read ? 'no screenshot' : 'nothing read back'}`);
      const { diff, ...difference } = frameDifference(frame, read, screenshot);
      if (keep) {
        await Promise.all(([['read', read.data], ['screenshot', screenshot.data], ['difference', diff]] as const).map(async ([name, pixels]) => {
          const png = openFfmpegInput(['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${read.w}x${read.h}`, '-i', '-', '-frames:v', '1', join(keep, `${frame}-${name}.png`)]);
          await png.write(pixels);
          await png.finish();
        }));
      }
      return difference;
    }));
  });
}
