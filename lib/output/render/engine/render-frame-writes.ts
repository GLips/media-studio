// render-frame-writes.ts: frames a render's pages send (render-frame-sink.ts) written out: as stills, one image a
// frame, or in order into an encode's raw input. Node only.

import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openFfmpegInput } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import type { RenderFrame } from './render-frame-sink.ts';

/** How a still's frame is written: a PNG, exact, or a JPEG, to look at. */
export type RenderStillImage = 'png' | 'jpeg';

/** `frame`'s file in a folder of stills: `f-<frame>.png` or `.jpg`. */
const renderStillFile = (dir: string, frame: number, image: RenderStillImage) => join(dir, `f-${frame}.${image === 'png' ? 'png' : 'jpg'}`);

/** A frame's file in a folder of `f-<frame>` images. */
export function renderStillsByFrame(dir: string): (frame: number) => string {
  const byFrame = new Map(readdirSync(dir).filter((f) => /^f-\d+\.(jpe?g|png)$/.test(f)).map((f) => [Number(/f-(\d+)/.exec(f)![1]), join(dir, f)]));
  return (frame) => byFrame.get(frame)!;
}

/** ffmpeg's input arguments for frames sent as `width` × `height` RGBA, `fps` a second. */
export const rawRenderFrameInput = ({ width, height }: { width: number; height: number }, fps: number) =>
  ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', '-'];

/**
 * `frame` written as an image to `out`: a PNG keeps its alpha, straight; a JPEG at about Remotion's quality 90 lies
 * on white, as a screenshot of a clear page did.
 */
export async function writeRenderStill({ width, height, rgba }: RenderFrame, out: string, image: RenderStillImage) {
  const encode = image === 'png' ? ['-frames:v', '1', '-pix_fmt', 'rgba'] : ['-frames:v', '1', '-filter_complex', `color=white:s=${width}x${height}[w];[w][0:v]overlay=format=auto:shortest=1,format=yuvj444p`, '-q:v', '2'];
  const ffmpeg = openFfmpegInput(['-y', '-v', 'error', ...rawRenderFrameInput({ width, height }, 1), ...encode, out]);
  await ffmpeg.write(rgba);
  await ffmpeg.finish();
}

/** A draw's `take` writing each frame sent as a still in `dir`, once: a frame drawn again (a retried chunk) is dropped. */
export function renderStillsInto(dir: string, image: RenderStillImage): (frame: RenderFrame) => Promise<void> {
  mkdirSync(dir, { recursive: true });
  const written = new Set<number>();
  return async (sent) => {
    if (written.has(sent.frame)) return;
    written.add(sent.frame);
    await writeRenderStill(sent, renderStillFile(dir, sent.frame, image), image);
  };
}

/**
 * A draw's `take` handing the frames from `first` on to `write` in order, `size` each: tabs finish frames out of
 * order, so each waits until those before it are written, and one drawn again is dropped. `next` is the frame it
 * waits for, one past the last written.
 */
export function renderFramesInOrder(first: number, size: { width: number; height: number }, write: (rgba: Buffer) => Promise<void>) {
  const waiting = new Map<number, Buffer>();
  let next = first;
  const take = async ({ frame, width, height, rgba }: RenderFrame) => {
    if (width !== size.width || height !== size.height) throw new Error(`frame ${frame} came ${width}×${height}, not ${size.width}×${size.height}`);
    if (frame < next || waiting.has(frame)) return;
    waiting.set(frame, rgba);
    const ready: Buffer[] = [];
    for (; waiting.has(next); next++) {
      ready.push(waiting.get(next)!);
      waiting.delete(next);
    }
    if (ready.length > 0) await write(Buffer.concat(ready));
  };
  return { take, next: () => next };
}
