// review-stills.ts: the Board's stills are the reviewed render's own frames, cut from the file with ffmpeg as the
// screen asks for them and kept per render hash, so a tile shows exactly what that render shows, even once the file
// has been replaced on disk. Every cut waits its turn in the review cut queue.
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runFfmpegAsync } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { runInReviewCutQueue } from './review-cut-queue.ts';

export type ReviewStillCutter = {
  /** The cut of render `hash`'s frame, made or under way; undefined if none was asked for. */
  cutOf: (hash: string, frame: number) => Promise<string> | undefined;
  /** Cuts frame `frame` of `media`, whose bytes are render `hash`, unless that cut is made or under way. */
  cut: (media: string, hash: string, frame: number, fps: number) => Promise<string>;
};

const keyOf = (hash: string, frame: number) => `${hash}/${frame}`;

/**
 * Cuts a render's frame to a 640 px JPEG (a PNG for a transparent render) under `dir/<hash>/`, once per render and
 * frame: the screen asks for tiles as they scroll into view, and two asks for one frame share a cut.
 */
export function createReviewStillCutter(dir: string): ReviewStillCutter {
  const cuts = new Map<string, Promise<string>>();
  return {
    cutOf: (hash, frame) => cuts.get(keyOf(hash, frame)),
    cut(media, hash, frame, fps) {
      const key = keyOf(hash, frame);
      const known = cuts.get(key);
      if (known) return known;
      // A WebM or .mov is a transparent render's: its stills keep their alpha, as PNGs, so the screen can show the
      // ground through them. VP9's alpha is read only by libvpx, not ffmpeg's own decoder.
      const alpha = /\.(webm|mov)$/.test(media);
      const file = join(dir, hash, `${frame}.${alpha ? 'png' : 'jpg'}`);
      mkdirSync(dirname(file), { recursive: true });
      const decoder = media.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : [];
      const encode = ['-vf', 'scale=640:-2', ...(alpha ? [] : ['-q:v', '4'])];
      // Sought to the frame's middle, as the screen seeks, so the decoder can't land on its neighbour.
      const cutAt = () => runFfmpegAsync(['-v', 'error', '-y', '-ss', ((frame + 0.5) / fps).toFixed(4), ...decoder, '-i', media, '-frames:v', '1', ...encode, file]);
      // The last frame's middle can lie past what the decoder gives back, and ffmpeg then fails or writes nothing:
      // decode the file's last half second instead, each frame overwriting the one before, leaving the last.
      const cutLast = () => runFfmpegAsync(['-v', 'error', '-y', '-sseof', '-0.5', ...decoder, '-i', media, ...encode, '-update', '1', file]);
      const made = runInReviewCutQueue(async () => {
        await cutAt().catch(() => undefined);
        if (!existsSync(file)) await cutLast();
        if (!existsSync(file)) throw new Error(`no frame ${frame} in ${basename(media)}`);
        return file;
      });
      made.catch(() => cuts.delete(key));
      cuts.set(key, made);
      return made;
    },
  };
}
