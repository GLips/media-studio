import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect } from 'effect';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { libraryFrameAt } from './library-frame-decoder.ts';

const dir = studioTempRoot();

// A 4 s clip at 30 fps whose frame n is a video-range grey of 16 + 6(n mod 32), so a picture says which frame it is.
const clip = join(dir, 'library-frames-clip.mp4');
runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=30:d=4', '-vf', "geq=lum='16+6*mod(N,32)':cb=128:cr=128", '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', clip]);

/** The frame a JPEG shows, mod 32, read back from its grey level: the JPEG is full range, 255/219 the video range's. */
const frameShown = (jpeg: Buffer) => {
  const grey = runFfmpeg(['-v', 'error', '-f', 'jpeg_pipe', '-i', '-', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { input: jpeg });
  return Math.round(grey[0] / (6 * 255 / 219));
};

test('a track serves the frame on screen at each time asked, in order, after a jump, and back again', async () => {
  const source = { path: clip, width: 64, fps: 30 };
  const asked = [1, 1 + 1 / 30, 1 + 2 / 30, 3, 1 + 1 / 30, 3.99];
  const shown = await Promise.all(asked.map(async (t) => frameShown(await Effect.runPromise(libraryFrameAt(source, t)))));
  // Frames 30, 31, 32 in order; 90 by a jump ahead; 31 again from the frames kept; 119, the last.
  assert.deepEqual(shown, [30, 31, 32, 90, 31, 119].map((n) => n % 32));
});
