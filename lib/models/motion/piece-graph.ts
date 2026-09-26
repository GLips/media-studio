// piece-graph.ts: sampled piece tracks (piece-tracks.ts) drawn for review: a map of the frame with each piece's path
// and the boxes it keeps clear of, then each channel over the frames (x, y, each value, the clearance), with the beats
// marked. Pure: lib/engine/look/piece-look.ts rasterizes the SVG this returns.

import type { Rect } from '#models/camera/camera.ts';
import type { FrameSize } from '#models/frame/frame.ts';
import type { SampledPiece } from './piece-tracks.ts';

const WIDTH = 1280, PAD = 24, MAP_SCALE = 0.5, PANEL_H = 120, PANEL_GAP = 34, LABEL_W = 150;
const PALETTE = ['#ee4c23', '#3fa7f5', '#f5c542', '#7bd88f', '#c792ea', '#ff8fb1'];
const INK = '#e8e5df', DIM = '#6b6b70', GROUND = '#111114';

type Panel = { piece: SampledPiece; color: string; label: string; unit: string; values: (number | null)[]; zero?: boolean };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x: number, y: number, s: string, { size = 13, fill = INK, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-family="ui-monospace, Menlo, monospace">${esc(s)}</text>`;
const rect = (r: Rect, k: number, attrs: string) => `<rect x="${r.x * k}" y="${r.y * k}" width="${r.w * k}" height="${r.h * k}" ${attrs}/>`;

/** The channels a piece plots: x and y, each value its model gives, and its clearance where it has a box. */
function panelsOf(piece: SampledPiece, color: string): Panel[] {
  const keys = [...new Set(piece.rows.flatMap((r) => Object.keys(r.sample?.values ?? {})))];
  const of = (label: string, unit: string, get: (r: SampledPiece['rows'][number]) => number | null | undefined, zero = false): Panel =>
    ({ piece, color, label, unit, values: piece.rows.map((r) => get(r) ?? null), zero });
  return [
    of('x', 'px', (r) => r.sample?.x),
    of('y', 'px', (r) => r.sample?.y),
    ...keys.map((k) => of(k, '', (r) => r.sample?.values?.[k])),
    ...(piece.rows.some((r) => r.clearance) ? [of('clearance', 'px', (r) => r.clearance?.margin, true)] : []),
  ];
}

/** One channel over the frames, its range labelled, the beats as ticks; a clearance panel marks 0, where boxes touch. */
function drawPanel(panel: Panel, top: number, frames: readonly number[], beatFrames: readonly number[]): string {
  const left = PAD + LABEL_W, width = WIDTH - left - PAD;
  const present = panel.values.filter((v): v is number => v !== null);
  let lo = Math.min(...present, ...(panel.zero ? [0] : [])), hi = Math.max(...present, ...(panel.zero ? [0] : []));
  if (!present.length) lo = hi = 0;
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const first = frames[0], last = frames.at(-1)!, span = Math.max(1, last - first);
  const xOf = (f: number) => left + ((f - first) / span) * width;
  const yOf = (v: number) => top + PANEL_H - ((v - lo) / (hi - lo)) * PANEL_H;
  const parts = [
    `<rect x="${left}" y="${top}" width="${width}" height="${PANEL_H}" fill="#18181c"/>`,
    ...beatFrames.filter((b) => b >= first && b <= last).map((b) => `<line x1="${xOf(b)}" x2="${xOf(b)}" y1="${top}" y2="${top + PANEL_H}" stroke="#34343a"/>`),
    ...(panel.zero ? [`<line x1="${left}" x2="${left + width}" y1="${yOf(0)}" y2="${yOf(0)}" stroke="#ff5a4a" stroke-dasharray="4 3"/>`] : []),
    text(PAD, top + 16, `${panel.piece.id}`, { size: 12, fill: DIM }),
    text(PAD, top + 36, `${panel.label}${panel.unit ? ` (${panel.unit})` : ''}`, { size: 15, fill: panel.color }),
    text(left - 6, top + 12, hi.toFixed(1), { size: 11, fill: DIM, anchor: 'end' }),
    text(left - 6, top + PANEL_H, lo.toFixed(1), { size: 11, fill: DIM, anchor: 'end' }),
  ];
  // A run of frames the piece is in shot is one line; out of shot breaks it.
  let run: string[] = [];
  const runs: string[][] = [];
  panel.values.forEach((v, i) => {
    if (v === null) { if (run.length) runs.push(run); run = []; return; }
    run.push(`${xOf(frames[i]).toFixed(1)},${yOf(v).toFixed(1)}`);
  });
  if (run.length) runs.push(run);
  for (const points of runs) {
    parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${panel.color}" stroke-width="2"/>`);
    for (const p of points) parts.push(`<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2" fill="${panel.color}"/>`);
  }
  if (panel.zero) {
    const tight = panel.values.reduce<{ i: number; v: number } | null>((best, v, i) => (v !== null && (!best || v < best.v) ? { i, v } : best), null);
    if (tight) {
      const x = xOf(frames[tight.i]), right = x > left + width / 2;
      parts.push(text(right ? x - 6 : x + 6, yOf(tight.v) - 6, `${tight.v.toFixed(1)} px, frame ${frames[tight.i]}`, { size: 12, fill: tight.v < 0 ? '#ff5a4a' : INK, anchor: right ? 'end' : 'start' }));
    }
  }
  return parts.join('');
}

/**
 * The graph of `pieces` over `frames`: the frame map (each path, the kept-clear boxes on the first frame, a boxed
 * piece's box on its tightest frame) over one panel per channel. `frameSize` is the video's, which the map draws;
 * `keepClearAt` is what the pieces keep clear of.
 */
export function buildPieceGraph(pieces: readonly SampledPiece[], {
  frames, beatFrames, title, frameSize, keepClearAt,
}: { frames: readonly number[]; beatFrames: readonly number[]; title: string; frameSize: FrameSize; keepClearAt?: (frame: number) => Readonly<Record<string, Rect>> }) {
  const colors = new Map(pieces.map((p, i) => [p.id, PALETTE[i % PALETTE.length]]));
  const mapTop = PAD + 40, mapW = frameSize.width * MAP_SCALE, mapH = frameSize.height * MAP_SCALE;
  const map: string[] = [`<rect x="0" y="0" width="${mapW}" height="${mapH}" fill="${GROUND}" stroke="#34343a"/>`];
  for (const box of Object.values(keepClearAt?.(frames[0]) ?? {})) map.push(rect(box, MAP_SCALE, `fill="#ffffff14" stroke="${DIM}"`));
  for (const piece of pieces) {
    const color = colors.get(piece.id)!;
    const shown = piece.rows.filter((r) => r.sample);
    map.push(`<polyline points="${shown.map((r) => `${r.sample!.x * MAP_SCALE},${r.sample!.y * MAP_SCALE}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`);
    for (const r of shown) map.push(`<circle cx="${r.sample!.x * MAP_SCALE}" cy="${r.sample!.y * MAP_SCALE}" r="2.5" fill="${color}"/>`);
    const tight = piece.rows.filter((r) => r.clearance && r.sample?.box).sort((a, b) => a.clearance!.margin - b.clearance!.margin)[0];
    if (tight) map.push(rect(tight.sample!.box!, MAP_SCALE, `fill="none" stroke="${color}" stroke-dasharray="5 3"`));
  }
  const legend = pieces.map((p, i) => text(mapW + 24, 20 + i * 22, `● ${p.id}`, { size: 14, fill: colors.get(p.id)! }));
  const legendNote = [
    text(mapW + 24, 20 + pieces.length * 22 + 14, 'dots: one per frame, frame px ÷ 2', { size: 12, fill: DIM }),
    ...(keepClearAt ? [text(mapW + 24, 20 + pieces.length * 22 + 32, 'grey: kept clear of (first frame)', { size: 12, fill: DIM }),
      text(mapW + 24, 20 + pieces.length * 22 + 50, 'dashed: a box on its tightest frame', { size: 12, fill: DIM })] : []),
  ];
  const panels = pieces.flatMap((p) => panelsOf(p, colors.get(p.id)!));
  const panelsTop = mapTop + mapH + PANEL_GAP;
  const height = panelsTop + panels.length * (PANEL_H + PANEL_GAP) + PAD;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
    `<rect width="${WIDTH}" height="${height}" fill="#0b0b0d"/>`,
    text(PAD, PAD + 16, title, { size: 17 }),
    text(PAD, PAD + 34, `frames ${frames[0]}–${frames.at(-1)}; beats are the vertical lines. Read from each piece's model: nothing rendered.`, { size: 12, fill: DIM }),
    `<g transform="translate(${PAD} ${mapTop})">${map.join('')}${legend.join('')}${legendNote.join('')}</g>`,
    ...panels.map((panel, i) => drawPanel(panel, panelsTop + i * (PANEL_H + PANEL_GAP), frames, beatFrames)),
    '</svg>',
  ].join('');
  return { svg, width: WIDTH, height };
}
