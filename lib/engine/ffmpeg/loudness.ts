// loudness.ts: EBU R128 loudness of an audio or video file, via ffmpeg's ebur128 filter. Node only.
import { measureWithFfmpeg } from './ffmpeg.ts';

/** Silence measures -Infinity for both. */
export type Loudness = { lufs: number; truePeak: number };

const ABSOLUTE_GATE_LUFS = -70;

/**
 * Measured as the file plays in the mix: a mono file (a voice line) comes out of both speakers there, which reads
 * 3 LU louder than the lone channel does. `dualmono` counts it that way; stereo files are unaffected.
 */
export function measureLoudness(file: string): Loudness {
  // ebur128 prints its summary on stderr.
  const { stderr: out, status } = measureWithFfmpeg(['-nostats', '-hide_banner', '-i', file, '-af', 'ebur128=peak=true:dualmono=true', '-f', 'null', '-']);
  if (status !== 0) throw new Error(`ffmpeg couldn't measure ${file}: ${out.trim().split('\n').at(-1)}`);
  const summary = out.slice(out.lastIndexOf('Summary:'));
  const level = (match: RegExpExecArray | null) => (match?.[1] === '-inf' ? -Infinity : Number(match?.[1]));
  // Nothing passes R128's absolute gate in silence, which ebur128 prints as the gate, -70.
  const gated = level(/I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)), lufs = gated <= ABSOLUTE_GATE_LUFS ? -Infinity : gated;
  const truePeak = level(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary));
  if (Number.isNaN(lufs) || Number.isNaN(truePeak)) throw new Error(`couldn't read the loudness of ${file}`);
  return { lufs, truePeak };
}

/** The loudness of a file that is levelled by it (a voice line, a music track), which fails on silence. */
export function measureAudibleLoudness(file: string): Loudness {
  const loudness = measureLoudness(file);
  if (loudness.lufs === -Infinity) throw new Error(`${file} is silent, so it has no loudness to level it by`);
  return loudness;
}
