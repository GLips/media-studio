// loudness.ts: EBU R128 loudness of an audio or video file, via ffmpeg's ebur128 filter. Node only.
import { measureWithFfmpeg } from './ffmpeg.ts';

export type Loudness = { lufs: number; truePeak: number };

/**
 * Measured as the file plays in the mix: a mono file (a voice line) comes out of both speakers there, which reads
 * 3 LU louder than the lone channel does. `dualmono` counts it that way; stereo files are unaffected.
 */
export function measureLoudness(file: string): Loudness {
  // ebur128 prints its summary on stderr.
  const { stderr: out, status } = measureWithFfmpeg(['-nostats', '-hide_banner', '-i', file, '-af', 'ebur128=peak=true:dualmono=true', '-f', 'null', '-']);
  if (status !== 0) throw new Error(`ffmpeg couldn't measure ${file}: ${out.trim().split('\n').at(-1)}`);
  const summary = out.slice(out.lastIndexOf('Summary:'));
  const lufs = Number(/I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1]);
  const truePeak = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(truePeak)) throw new Error(`couldn't read the loudness of ${file}`);
  return { lufs, truePeak };
}
