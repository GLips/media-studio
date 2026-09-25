// reel-study.ts: measurements of a reference video (someone else's reel, not one of ours), for studying how it's cut
// and how it moves. Pure: lib/engine/study/reel-study-files.ts decodes the video and audio and draws what this computes.
//
// Every frame is measured small (a thumbnail's worth of pixels): how much it changed from the last (motion energy),
// whether that change is a cut, and its mean colour. The audio gives a beat grid, and every cut is placed on it.

import { detectMusicBeats } from './music-beats.ts';

/** One decoded frame, downscaled: packed RGB bytes. */
export type StudyFrame = { rgb: Uint8Array };

export type FrameMeasure = {
  /** Mean absolute difference from the previous frame, 0–100, as ffmpeg's scdet `mafd`. */
  energy: number;
  /** How sudden that difference is, 0–100, as scdet's `score`: a cut scores high, steady fast motion doesn't. */
  cutScore: number;
  /** Mean colour, as "#rrggbb". */
  mean: string;
};

export function measureStudyFrames(frames: readonly StudyFrame[]): FrameMeasure[] {
  const out: FrameMeasure[] = [];
  let prevEnergy = 0;
  for (let f = 0; f < frames.length; f++) {
    const { rgb } = frames[f];
    let diff = 0;
    if (f > 0) {
      const prev = frames[f - 1].rgb;
      for (let i = 0; i < rgb.length; i++) diff += Math.abs(rgb[i] - prev[i]);
    }
    const energy = f > 0 ? (100 * diff) / (rgb.length * 255) : 0;
    // scdet's rule: the change must be large and unlike the frame before's, so a long fast pan doesn't read as cuts.
    const cutScore = Math.min(energy, Math.abs(energy - prevEnergy));
    prevEnergy = energy;
    const sum = [0, 0, 0];
    for (let i = 0; i < rgb.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += rgb[i + c];
    out.push({ energy, cutScore, mean: hexOf(sum.map((v) => v / (rgb.length / 3))) });
  }
  return out;
}

/** Frames where a cut lands: cut scores over `threshold`, at most one per `minGap` seconds (the strongest). */
export function detectStudyCuts(measures: readonly FrameMeasure[], fps: number, { threshold = 6, minGap = 0.15 } = {}): number[] {
  const candidates = measures.map((m, f) => ({ f, s: m.cutScore })).filter((c) => c.s >= threshold).sort((a, b) => b.s - a.s);
  const cuts: number[] = [];
  for (const c of candidates) if (cuts.every((f) => Math.abs(f - c.f) / fps >= minGap)) cuts.push(c.f);
  return cuts.sort((a, b) => a - b);
}

/**
 * A fixed beat grid: beat `n` falls at `phase + n * 60 / bpm`. Detected from the audio, or at a tempo you give, phased
 * to the detected beats (a reel's HUD may claim a tempo the tracker reads as half or double).
 */
export type BeatGrid = { bpm: number; phase: number; detectedBpm: number; detectedBeats: number[] };

export function studyBeatGrid(samples: Float32Array, rate: number, bpm?: number, offset = 0): BeatGrid {
  const found = detectMusicBeats(samples, rate);
  const detected = { ...found, beats: found.beats.map((b) => b + offset) };
  const tempo = bpm ?? detected.bpm, period = 60 / tempo;
  // The phase is the circular mean of the detected beats modulo the period, so no single late beat drags it.
  let x = 0, y = 0;
  for (const b of detected.beats) {
    const a = ((b % period) / period) * 2 * Math.PI;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  const phase = (((Math.atan2(y, x) / (2 * Math.PI)) * period) % period + period) % period;
  return { bpm: tempo, phase, detectedBpm: detected.bpm, detectedBeats: detected.beats };
}

/** Where time `t` sits on the grid, in beats (beat 0 is the grid's first at or after 0 s). */
export const beatPosition = (grid: BeatGrid, t: number) => ((t - grid.phase) * grid.bpm) / 60;

/** How far a moment is from its nearest beat, in frames (negative: early). */
export function offBeatFrames(grid: BeatGrid, t: number, fps: number) {
  const b = beatPosition(grid, t), nearest = Math.round(b);
  return { beat: nearest, frames: Math.round(((b - nearest) * 60 * fps) / grid.bpm) };
}

/** "beat 12.50 (bar 4·1 +2)" style label: 4/4 bars from beat 0, with the offset in eighths of a beat. */
export function beatLabel(grid: BeatGrid, t: number) {
  const b = beatPosition(grid, t), whole = Math.floor(b), sixteenth = Math.round((b - whole) * 4);
  const beat = whole + Math.floor(sixteenth / 4), sub = sixteenth % 4;
  const bar = Math.floor(beat / 4) + 1, inBar = (((beat % 4) + 4) % 4) + 1;
  return `${bar}.${inBar}${sub ? `+${sub}/4` : ''}`;
}

export type StudySection = { index: number; start: number; end: number; label: string };

/** Sections of [from, to] between cuts, the short ones merged into the one before, so none is under `minLength` seconds. */
export function sectionsFromCuts(cuts: readonly number[], fps: number, [from, to]: readonly [number, number], minLength = 1.2): StudySection[] {
  const bounds = [from, ...cuts.map((f) => f / fps).filter((t) => t > from && t < to), to];
  const spans: [number, number][] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const span: [number, number] = [bounds[i], bounds[i + 1]];
    if (spans.length && span[1] - span[0] < minLength) spans[spans.length - 1][1] = span[1];
    else spans.push(span);
  }
  if (spans.length > 1 && spans[0][1] - spans[0][0] < minLength) spans.splice(0, 2, [spans[0][0], spans[1][1]]);
  return spans.map(([start, end], index) => ({ index, start, end, label: `${fmt(start)}–${fmt(end)}` }));
}

/** Sections as given on the command line, "0:2.5,2.5:5". */
export function parseStudySections(spec: string, [from, to]: readonly [number, number]): StudySection[] {
  return spec.split(',').map((part, index) => {
    const [start, end] = part.split(':').map(Number);
    if (!(Number.isFinite(start) && Number.isFinite(end) && start < end && start >= from - 0.05 && end <= to + 0.05)) {
      throw new Error(`a section is a stretch of seconds inside ${fmt(from)}:${fmt(to)} like 2.5:5, not "${part}"`);
    }
    return { index, start: Math.max(start, from), end: Math.min(end, to), label: `${fmt(start)}–${fmt(end)}` };
  });
}

export type PaletteColour = { hex: string; share: number };

/**
 * The colours covering most of a stretch's frames, by share of pixels: 4-bit-per-channel bins, each reported as the
 * mean of the pixels in it, then bins closer than `merge` (RGB distance) folded together.
 */
export function studyPalette(frames: readonly StudyFrame[], { top = 6, merge = 48 } = {}): PaletteColour[] {
  const count = new Float64Array(4096), sums = new Float64Array(4096 * 3);
  let total = 0;
  for (const { rgb } of frames) {
    for (let i = 0; i < rgb.length; i += 3) {
      const bin = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
      count[bin]++;
      sums[bin * 3] += rgb[i];
      sums[bin * 3 + 1] += rgb[i + 1];
      sums[bin * 3 + 2] += rgb[i + 2];
      total++;
    }
  }
  const bins = [...count.keys()].filter((b) => count[b] > 0).sort((a, b) => count[b] - count[a])
    .map((b) => ({ n: count[b], rgb: [0, 1, 2].map((c) => sums[b * 3 + c] / count[b]) }));
  const merged: { n: number; rgb: number[] }[] = [];
  for (const bin of bins) {
    const near = merged.find((m) => Math.hypot(...m.rgb.map((v, c) => v - bin.rgb[c])) < merge);
    if (near) {
      near.rgb = near.rgb.map((v, c) => (v * near.n + bin.rgb[c] * bin.n) / (near.n + bin.n));
      near.n += bin.n;
    } else merged.push({ ...bin });
  }
  return merged.sort((a, b) => b.n - a.n).slice(0, top).map((m) => ({ hex: hexOf(m.rgb), share: m.n / total }));
}

export type StudyReport = {
  video: string;
  fps: number;
  /** The stretch studied, in seconds of the video. */
  at: readonly [number, number];
  grid: BeatGrid;
  cuts: number[];
  sections: (StudySection & { palette: PaletteColour[]; meanEnergy: number; cuts: number })[];
};

/** The study's index: tempo, every cut against the beat, and each section's palette and energy. Markdown. */
export function formatStudyIndex(report: StudyReport, files: { overview: string; sections: { strip: string; sheet: string; vectors: string; plot: string }[] }): string {
  const { grid, fps } = report;
  const cutRows = report.cuts.map((f) => {
    const t = f / fps, off = offBeatFrames(grid, t, fps);
    return `| ${t.toFixed(3)} | ${f} | ${beatLabel(grid, t)} | ${off.frames >= 0 ? '+' : ''}${off.frames} |`;
  });
  const onBeat = report.cuts.filter((f) => Math.abs(offBeatFrames(grid, f / fps, fps).frames) <= 2).length;
  const halfBeat = report.cuts.filter((f) => {
    const b = beatPosition(grid, f / fps);
    return Math.abs(b * 2 - Math.round(b * 2)) * (30 * fps) / grid.bpm <= 2;
  }).length;
  return [
    `# Study of ${report.video}`,
    '',
    `${fmt(report.at[0])}–${fmt(report.at[1])} s at ${fps} fps. Beat grid ${grid.bpm} BPM (a beat every ${(60 / grid.bpm).toFixed(3)} s, ${((60 / grid.bpm) * fps).toFixed(1)} frames), phase ${grid.phase.toFixed(3)} s; the tracker alone read ${grid.detectedBpm} BPM.`,
    `Positions are bar.beat in 4/4 from the grid's beat 0, +n/4 for sixteenths.`,
    '',
    `Overview (motion energy, cut scores, mean colour, audio loudness, beat grid): ${files.overview}`,
    '',
    `## Cuts (${report.cuts.length}: ${onBeat} within 2 frames of a beat, ${halfBeat} within 2 frames of a beat or half-beat)`,
    '',
    '| s | frame | bar.beat | frames off the nearest beat |',
    '|---|---|---|---|',
    ...cutRows,
    '',
    '## Sections',
    '',
    ...report.sections.flatMap((s, i) => [
      `### ${String(s.index + 1).padStart(2, '0')} · ${s.label} s (${(s.end - s.start).toFixed(2)} s, ${((s.end - s.start) * grid.bpm / 60).toFixed(1)} beats, ${s.cuts} cuts inside)`,
      '',
      `Mean motion energy ${s.meanEnergy.toFixed(1)}. Palette: ${s.palette.map((p) => `${p.hex} ${(p.share * 100).toFixed(0)}%`).join(', ')}`,
      '',
      `- strip (every frame of the strip step, labelled s and bar.beat): ${files.sections[i].strip}`,
      `- sheet (fewer, larger frames): ${files.sections[i].sheet}`,
      `- motion vectors (the encoder's, drawn on the frames): ${files.sections[i].vectors}`,
      `- plot (this section's energy, cuts and beats, per frame): ${files.sections[i].plot}`,
      '',
    ]),
  ].join('\n');
}

// ---------- the plot ----------

export type StudyPlotInput = {
  measures: readonly FrameMeasure[];
  fps: number;
  /** Audio loudness per video frame, 0..1. */
  loudness: readonly number[];
  grid: BeatGrid;
  cuts: readonly number[];
  sections: readonly StudySection[];
  /** The stretch drawn, in seconds. */
  from: number;
  to: number;
  width?: number;
};

/** Mean colour, motion energy, cut scores and loudness over time, on the beat grid, with cuts and sections marked. SVG. */
export function buildStudyPlot({ measures, fps, loudness, grid, cuts, sections, from, to, width = 1920 }: StudyPlotInput): { svg: string; width: number; height: number } {
  const left = 70, right = 20, plotW = width - left - right;
  const bands = [
    { name: 'colour', h: 60 },
    { name: 'motion energy', h: 200 },
    { name: 'cut score', h: 110 },
    { name: 'loudness', h: 90 },
  ];
  const top = 40, gap = 14, height = top + bands.reduce((s, b) => s + b.h + gap, 0) + 40;
  const x = (t: number) => left + ((t - from) / (to - from)) * plotW;
  const f0 = Math.max(0, Math.floor(from * fps)), f1 = Math.min(measures.length - 1, Math.ceil(to * fps));
  const parts: string[] = [`<rect width="${width}" height="${height}" fill="#111"/>`];
  let y = top;
  const bandY: Record<string, { y: number; h: number }> = {};
  for (const b of bands) {
    bandY[b.name] = { y, h: b.h };
    parts.push(`<rect x="${left}" y="${y}" width="${plotW}" height="${b.h}" fill="#1b1b1b"/>`,
      `<text x="${left - 8}" y="${y + 14}" fill="#999" font-size="12" text-anchor="end" font-family="Menlo">${b.name}</text>`);
    y += b.h + gap;
  }
  // Sections behind everything, labelled along the top.
  sections.filter((s) => s.end > from && s.start < to).forEach((s, i) => {
    const a = x(Math.max(from, s.start)), b = x(Math.min(to, s.end));
    parts.push(`<rect x="${a}" y="${top}" width="${b - a}" height="${y - top - gap}" fill="${i % 2 ? '#ffffff08' : '#ffffff00'}"/>`,
      `<text x="${a + 4}" y="${top - 8}" fill="#ddd" font-size="13" font-family="Menlo">${String(s.index + 1).padStart(2, '0')} ${s.label}</text>`);
  });
  // The beat grid: every beat faint, every bar (4 beats) stronger and numbered.
  const firstBeat = Math.ceil(beatPosition(grid, from)), lastBeat = Math.floor(beatPosition(grid, to));
  for (let n = firstBeat; n <= lastBeat; n++) {
    const t = grid.phase + (n * 60) / grid.bpm, bx = x(t), bar = n % 4 === 0;
    parts.push(`<line x1="${bx}" y1="${top}" x2="${bx}" y2="${y - gap}" stroke="${bar ? '#5a7' : '#2f4a38'}" stroke-width="${bar ? 1.5 : 1}"/>`);
    if (bar) parts.push(`<text x="${bx + 3}" y="${y + 4}" fill="#5a7" font-size="12" font-family="Menlo">bar ${n / 4 + 1}</text>`);
  }
  // Mean colour per frame.
  const colour = bandY['colour'], step = Math.max(1, Math.floor((f1 - f0) / plotW));
  for (let f = f0; f <= f1; f += step) {
    const a = x(f / fps), b = x((f + step) / fps);
    parts.push(`<rect x="${a}" y="${colour.y}" width="${Math.max(0.5, b - a + 0.3)}" height="${colour.h}" fill="${measures[f].mean}"/>`);
  }
  const line = (band: { y: number; h: number }, values: (f: number) => number, max: number, stroke: string, fill: string) => {
    const pts: string[] = [];
    for (let f = f0; f <= f1; f++) pts.push(`${x(f / fps).toFixed(1)},${(band.y + band.h - (Math.min(max, values(f)) / max) * band.h).toFixed(1)}`);
    parts.push(`<polygon points="${x(f0 / fps)},${band.y + band.h} ${pts.join(' ')} ${x(f1 / fps)},${band.y + band.h}" fill="${fill}"/>`,
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`);
  };
  const maxEnergy = Math.max(10, ...measures.slice(f0, f1 + 1).map((m) => m.energy));
  line(bandY['motion energy'], (f) => measures[f].energy, maxEnergy, '#e8e8e8', '#e8e8e822');
  line(bandY['cut score'], (f) => measures[f].cutScore, 40, '#f5a623', '#f5a62333');
  line(bandY['loudness'], (f) => loudness[f] ?? 0, 1, '#6ab0ff', '#6ab0ff33');
  // Cuts through every band, with their offset from the nearest beat.
  for (const f of cuts) {
    const t = f / fps;
    if (t < from || t > to) continue;
    const off = offBeatFrames(grid, t, fps);
    parts.push(`<line x1="${x(t)}" y1="${top}" x2="${x(t)}" y2="${y - gap}" stroke="#ff4040" stroke-width="1.5" stroke-dasharray="4 3"/>`,
      `<text x="${x(t) + 3}" y="${bandY['cut score'].y + 14}" fill="#ff6060" font-size="11" font-family="Menlo">${off.frames >= 0 ? '+' : ''}${off.frames}f</text>`);
  }
  // Seconds along the bottom.
  const span = to - from, tick = span > 20 ? 1 : span > 6 ? 0.5 : span > 2 ? 0.25 : 0.1;
  for (let t = Math.ceil(from / tick) * tick; t <= to + 1e-9; t += tick) {
    parts.push(`<text x="${x(t)}" y="${height - 12}" fill="#aaa" font-size="12" text-anchor="middle" font-family="Menlo">${fmt(t)}</text>`);
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`, width, height };
}

const fmt = (t: number) => (Math.round(t * 100) / 100).toString();
const hexOf = (rgb: readonly number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
