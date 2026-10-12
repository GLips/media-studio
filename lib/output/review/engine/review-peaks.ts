// review-peaks.ts: a render's waveform for the dock's sound lane, computed by ffmpeg on demand through the cut queue
// and kept per render hash in out/.review/peaks/<hash>.json. Render never computes it: render doesn't import review.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import { runFfprobe, spawnFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import type { ReviewPeaks } from '../models/review-timeline-geometry.ts';
import { projectFolderNamed } from './project-media.ts';
import { reviewedVersionOf } from './review-artifact.ts';
import { runInReviewCutQueue } from './review-cut-queue.ts';

/** Slices a second: finer than a frame of a 30 fps render, so the lane holds its shape at full zoom. */
const REVIEW_PEAKS_PER_SECOND = 50;
/** The rate the sound is decoded at for peaks: a slice's loudest sample needs no more. */
const REVIEW_PEAKS_SAMPLE_RATE = 8000;
const SIGNED_16_FULL_SCALE = 32768;

/** Peaks being cut, by file: two asks for one render share a decode. */
const cutting = new Map<string, Promise<string>>();

/**
 * The peaks file of the render at `path` in `project` at the version `render` names (its archived copy once replaced),
 * or as it is now when unnamed, cut first when that hash has none yet. Throws ProjectMediaNotFound once no copy of
 * those bytes is kept.
 */
export async function reviewPeaksFileOf(project: string, path: string, render?: string): Promise<string> {
  // Resolved first: it proves `render` is a hash of this path before the hash names a file.
  const media = reviewedVersionOf(project, path, render), hash = render ?? renderFileStamp(media).hash;
  const file = join(projectFolderNamed(project), 'out', '.review', 'peaks', `${hash}.json`);
  if (existsSync(file)) return file;
  const known = cutting.get(file);
  if (known) return known;
  const made = runInReviewCutQueue(async () => {
    const peaks: ReviewPeaks = { hash, perSecond: REVIEW_PEAKS_PER_SECOND, peaks: await peaksOfMedia(media) };
    replaceFileWhole(file, JSON.stringify(peaks));
    return file;
  }).finally(() => cutting.delete(file));
  cutting.set(file, made);
  return made;
}

/** A render with no sound stream has no peaks, and the dock leaves its sound lane out. */
async function peaksOfMedia(media: string): Promise<number[]> {
  const streams = runFfprobe(['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', media], { encoding: 'utf8' });
  if (!streams.trim()) return [];
  const pcm = await decodeMono16(media);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const perSlice = REVIEW_PEAKS_SAMPLE_RATE / REVIEW_PEAKS_PER_SECOND;
  const peaks: number[] = [];
  for (let from = 0; from < samples.length; from += perSlice) {
    let loudest = 0;
    for (let i = from; i < Math.min(samples.length, from + perSlice); i++) loudest = Math.max(loudest, Math.abs(samples[i]));
    peaks.push(Math.round((loudest / SIGNED_16_FULL_SCALE) * 1000) / 1000);
  }
  return peaks;
}

/** The sound as mono 16-bit samples at the peaks' rate, read off ffmpeg's stdout without blocking the server. */
function decodeMono16(media: string): Promise<Buffer> {
  const ffmpeg = spawnFfmpeg(['-v', 'error', '-i', media, '-vn', '-ac', '1', '-ar', String(REVIEW_PEAKS_SAMPLE_RATE), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  let stderr = '';
  ffmpeg.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  ffmpeg.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  return new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg couldn't read the sound of ${media}: ${stderr.trim()}`))));
  });
}
