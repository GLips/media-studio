// review-stills.ts: the storyboard's stills are the reviewed render's own frames, cut from the file with ffmpeg as the
// screen asks for them and kept per render hash, so a card shows exactly what the render shows.
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runFfmpegAsync } from '#lib/output/ffmpeg/engine/ffmpeg.ts';

export type ReviewStillCutter = { cut: (media: string, hash: string, frame: number, fps: number) => Promise<string> };

/**
 * Cuts a render's frame to a 640 px JPEG (a PNG for a transparent render) under `dir`, once per render and frame: the screen asks for a card's stills as
 * they scroll into view, and two asks for one frame share a cut.
 */
export function createReviewStillCutter(dir: string): ReviewStillCutter {
  const cuts = new Map<string, Promise<string>>();
  return {
    cut(media, hash, frame, fps) {
      // A WebM or .mov is a transparent render's: its stills keep their alpha, as PNGs, so the screen can show the
      // ground through them. VP9's alpha is read only by libvpx, not ffmpeg's own decoder.
      const alpha = /\.(webm|mov)$/.test(media);
      const file = join(dir, hash, `${frame}.${alpha ? 'png' : 'jpg'}`);
      const known = cuts.get(file);
      if (known) return known;
      mkdirSync(dirname(file), { recursive: true });
      // Sought to the frame's middle, as the screen seeks, so the decoder can't land on its neighbour.
      const made = runFfmpegAsync(['-v', 'error', '-y', '-ss', ((frame + 0.5) / fps).toFixed(4), ...(media.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : []), '-i', media,
        '-frames:v', '1', '-vf', 'scale=640:-2', ...(alpha ? [] : ['-q:v', '4']), file])
        .then(() => {
          // Sought past the file's end, ffmpeg can exit cleanly having written nothing.
          if (!existsSync(file)) throw new Error(`frame ${frame} is past the end of ${basename(media)}`);
          return file;
        });
      made.catch(() => cuts.delete(file));
      cuts.set(file, made);
      return made;
    },
  };
}
