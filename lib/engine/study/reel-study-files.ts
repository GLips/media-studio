// reel-study-files.ts: `studio study`, the imperative shell around lib/models/music/reel-study.ts. Decodes a reference video and
// its audio with ffmpeg, measures them, and writes the study: an overview plot, per section a dense strip, a sheet,
// the encoder's motion vectors drawn on frames and a per-frame plot, and index.md tying them together.
//
// Rerunnable: the output directory is cleared and rewritten, so a study always matches its video and sections.

import { rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tileLabelledImages } from '../ffmpeg/contact-sheet.ts';
import {
  beatLabel, buildStudyPlot, detectStudyCuts, formatStudyIndex, measureStudyFrames, parseStudySections, sectionsFromCuts,
  studyBeatGrid, studyPalette, type StudyFrame, type StudyReport, type StudySection,
} from '#models/music/reel-study.ts';
import { rasterizeSvgs } from '../capture/html-raster.ts';
import { runFfmpeg, runFfprobe } from '../ffmpeg/ffmpeg.ts';
import { withStudioTemp } from '../temp/studio-temp.ts';

// Measured small: enough pixels for energy, cuts and colour, few enough to hold a whole reel in memory.
const MEASURE_W = 96, MEASURE_H = 54;
const AUDIO_RATE = 22050;

export type ReelStudyOptions = {
  /** The stretch to study, in seconds (default: all of it). Its audio alone sets the beat grid. */
  at?: readonly [number, number];
  /** Sections as "0:2.5,2.5:5"; by default, the stretches between cuts. */
  sections?: string;
  /** A tempo to lay the grid at, phased to the detected beats; by default the detected one. */
  bpm?: number;
  /** Strip frames per second (15: every 4th frame of a 60 fps video). */
  stripFps: number;
  out: string;
};

export async function studyReel(video: string, { at: stretch, sections: sectionSpec, bpm, stripFps, out }: ReelStudyOptions) {
  const { fps, duration, width, height } = probeVideo(video);
  console.error(`${basename(video)}: ${duration.toFixed(2)} s, ${width}×${height} at ${fps} fps`);
  const frames = decodeFrames(video);
  const measures = measureStudyFrames(frames);
  const samples = decodeAudio(video);
  const at = stretch ?? [0, duration] as const;
  if (!(at[0] >= 0 && at[1] <= duration + 0.05 && at[0] < at[1])) throw new Error(`--at must lie inside 0:${duration.toFixed(2)}`);
  // A reel of reels changes track between them, so only the studied stretch's audio sets the grid.
  const grid = studyBeatGrid(samples.subarray(Math.round(at[0] * AUDIO_RATE), Math.round(at[1] * AUDIO_RATE)), AUDIO_RATE, bpm, at[0]);
  const loudness = loudnessPerFrame(samples, fps, frames.length);
  const cuts = detectStudyCuts(measures, fps).filter((f) => f / fps > at[0] && f / fps < at[1]);
  const sections = sectionSpec ? parseStudySections(sectionSpec, at) : sectionsFromCuts(cuts, fps, at);
  console.error(`${cuts.length} cuts, ${sections.length} sections, grid ${grid.bpm} BPM (tracker read ${grid.detectedBpm})`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const report: StudyReport = {
    video: basename(video), fps, at, grid, cuts,
    sections: sections.map((s) => {
      const f0 = Math.round(s.start * fps), f1 = Math.min(frames.length, Math.round(s.end * fps));
      const inside = measures.slice(f0, f1);
      return {
        ...s,
        palette: studyPalette(frames.slice(f0, f1)),
        meanEnergy: inside.reduce((sum, m) => sum + m.energy, 0) / Math.max(1, inside.length),
        cuts: cuts.filter((f) => f > f0 && f < f1).length,
      };
    }),
  };

  const plots: { svg: string; width: number; height: number; out: string }[] = [];
  const overview = join(out, 'overview.png');
  plots.push({ ...buildStudyPlot({ measures, fps, loudness, grid, cuts, sections, from: at[0], to: at[1] }), out: overview });
  const sectionFiles = sections.map((s) => {
    const dir = join(out, `${String(s.index + 1).padStart(2, '0')}-${s.start.toFixed(2)}-${s.end.toFixed(2)}`);
    const files = { strip: join(dir, 'strip.jpg'), sheet: join(dir, 'sheet.jpg'), vectors: join(dir, 'vectors.jpg'), plot: join(dir, 'plot.png') };
    plots.push({ ...buildStudyPlot({ measures, fps, loudness, grid, cuts, sections, from: s.start, to: s.end }), out: files.plot });
    renderStrip(video, s, fps, grid, { step: Math.max(1, Math.round(fps / stripFps)), w: 320, cols: 6 }, files.strip);
    renderStrip(video, s, fps, grid, { step: Math.max(1, Math.round((s.end - s.start) * fps / 12)), w: 640, cols: 3 }, files.sheet);
    renderStrip(video, s, fps, grid, { step: Math.max(1, Math.round(fps / stripFps) * 2), w: 480, cols: 4, vectors: true }, files.vectors);
    console.error(`section ${s.index + 1}/${sections.length} ${s.label}`);
    return files;
  });
  await rasterizeSvgs(plots);
  const index = join(out, 'index.md');
  writeFileSync(index, `${formatStudyIndex(report, { overview, sections: sectionFiles })}\n`);
  writeFileSync(join(out, 'study.json'), JSON.stringify({ ...report, grid: { ...report.grid, detectedBeats: report.grid.detectedBeats }, measures }, null, 0));
  return index;
}

function probeVideo(video: string) {
  const probe = JSON.parse(runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', video]).toString());
  const [num, den] = String(probe.streams[0].r_frame_rate).split('/').map(Number);
  return { fps: num / (den || 1), duration: Number(probe.format.duration), width: probe.streams[0].width as number, height: probe.streams[0].height as number };
}

function decodeFrames(video: string): StudyFrame[] {
  const raw = runFfmpeg(['-v', 'error', '-i', video, '-vf', `scale=${MEASURE_W}:${MEASURE_H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const size = MEASURE_W * MEASURE_H * 3, frames: StudyFrame[] = [];
  for (let o = 0; o + size <= raw.length; o += size) frames.push({ rgb: new Uint8Array(raw.buffer, raw.byteOffset + o, size) });
  return frames;
}

function decodeAudio(video: string): Float32Array {
  const raw = runFfmpeg(['-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', String(AUDIO_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 4)));
}

/** RMS per video frame on a −60…0 dBFS scale, 0..1. */
function loudnessPerFrame(samples: Float32Array, fps: number, count: number): number[] {
  return Array.from({ length: count }, (_, f) => {
    const a = Math.floor((f / fps) * AUDIO_RATE), b = Math.min(samples.length, Math.floor(((f + 1) / fps) * AUDIO_RATE));
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    const db = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12);
    return Math.max(0, Math.min(1, (db + 60) / 60));
  });
}

/**
 * Every `step`th frame of a section, tiled with each frame's time and bar.beat. With `vectors`, the encoder's motion
 * vectors are drawn on the frames (ffmpeg codecview): where things move, and which way, without an optical-flow pass.
 */
function renderStrip(video: string, s: StudySection, fps: number, grid: ReturnType<typeof studyBeatGrid>, { step, w, cols, vectors = false }: { step: number; w: number; cols: number; vectors?: boolean }, out: string) {
  withStudioTemp('reel-study', (dir) => {
    const first = Math.round(s.start * fps), count = Math.max(1, Math.round((s.end - s.start) * fps));
    const filters = [...(vectors ? ['codecview=mv=pf+bf+bb'] : []), `select=not(mod(n\\,${step}))`, `scale=${w}:-2`];
    // Seek half a frame early: a seek to first/fps rounded up (1/60 s → 0.0167) skips the first frame and labels every
    // frame after it one early.
    runFfmpeg(['-v', 'error', ...(vectors ? ['-flags2', '+export_mvs'] : []), '-ss', (Math.max(0, first - 0.5) / fps).toFixed(4), '-i', video,
      '-frames:v', String(Math.ceil(count / step)), '-vf', filters.join(','), '-fps_mode', 'vfr', '-q:v', '3', join(dir, '%04d.jpg')]);
    const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
    const h = 2 * Math.round((w * 9) / 16 / 2);
    tileLabelledImages(files.map((file, k) => {
      const t = (first + k * step) / fps;
      return { file: join(dir, file), label: `${t.toFixed(3)}s  ${beatLabel(grid, t)}` };
    }), out, { cols, w, h });
  });
}
