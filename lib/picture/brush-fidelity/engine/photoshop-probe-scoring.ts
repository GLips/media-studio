// photoshop-probe-scoring.ts: each Photoshop probe capture against the GPU renderer's trace of the same probe (vid-97,
// vid-116). Every sheet is painted as the rig painted it (models/photoshop-probe-painting.ts) and traced cell by cell
// in the browser (studio/photoshop-probe-page.ts); each cell's coverage lays over the sheet so far, as soft tips spill
// into their neighbours, and each scored cell's difference from its capture is split among the stages that own it
// (models/photoshop-probe-score.ts).
//
// Negative space: cells on a ground (their paint's colour matters, not only its coverage), and randomness probes (and
// every further copy), are skipped and counted, not scored.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage, type BrowserModuleCall } from '#lib/output/render/engine/browser-module-page.ts';
import { readPhotoshopSheet } from '#lib/picture/photoshop-brushes/engine/photoshop-capture.ts';
import { cropPhotoshopCell } from '#lib/picture/photoshop-brushes/models/photoshop-capture-cells.ts';
import type { PhotoshopCaptureCell, PhotoshopCaptureSheet } from '#lib/picture/photoshop-brushes/models/photoshop-capture-plan.ts';
import type { PhotoshopProbe } from '#lib/picture/photoshop-brushes/models/photoshop-probes.ts';
import type { StampResolveStage } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import { STAMP_PACK_TIP_MAX } from '#lib/picture/stamp-styles/engine/stamp-paint-pack-files.ts';
import { photoshopProbeCrop, photoshopProbeReach, type PhotoshopProbeCellRequest, type PhotoshopProbeCellTrace, type PhotoshopProbeOpacity, type PhotoshopProbePlane } from '../models/photoshop-probe-painting.ts';
import { scorePhotoshopProbe, type PhotoshopProbeScore, type PhotoshopProbeStageOwner } from '../models/photoshop-probe-score.ts';

const PROBE_PAGE = fileURLToPath(new URL('../studio/photoshop-probe-page.ts', import.meta.url));

/**
 * The most crop pixels one trace records: each takes five f32 slots on the GPU (build, three stages, coverage), so a
 * batch stays under the 128 MiB a storage binding holds by default.
 */
const TRACE_BATCH_PIXELS = 4_000_000;

/** A rearrangement to try against the captures; what's left out is as the GPU renderer paints it. */
export type PhotoshopProbeArrangement = {
  /** Every stage after the build, in order; each brush's plan's by default. */
  order?: readonly StampResolveStage[];
  /** Where the deposit's opacity applies: `last` by default. */
  opacity?: PhotoshopProbeOpacity;
};

export type PhotoshopProbeCellScore = { probe: string; cell: string; score: PhotoshopProbeScore };

/**
 * Whether a probe paints at random: a shape jitter, the dual's scatter, or Scatter on at all, which a count needs
 * even with no scatter (those count probes are compared by statistics as the random ones are).
 */
function randomProbe({ preset }: PhotoshopProbe): boolean {
  const shape = preset.tipDynamics;
  return preset.scatter !== undefined || [shape?.size, shape?.angle, shape?.roundness].some((d) => (d?.jitter ?? 0) > 0) || (preset.dual?.scatter.scatter.jitter ?? 0) > 0;
}

/** Why a cell isn't scored, or null when it is. */
function skipped(cell: PhotoshopCaptureCell, probe: PhotoshopProbe, untaken: ReadonlySet<string>): string | null {
  if (untaken.has(probe.name)) return 'painted from another preset';
  if (cell.copy > 1) return 'a further copy';
  if (cell.ground !== 'clear') return 'on a ground';
  if (randomProbe(probe)) return 'random';
  return null;
}

const plane = (base64: PhotoshopProbePlane) => {
  const bytes = Buffer.from(base64, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

/** `planes` laid each over the ones before. */
const over = (planes: readonly PhotoshopProbePlane[]) => planes.map(plane).reduce((under, top) => under.map((u, i) => u + top[i] * (1 - u)));

/** The rows of `buffer` (`width` wide) that fall in `box`, as the box's own array. */
function cropBuffer(buffer: Float32Array, width: number, box: { x: number; y: number; width: number; height: number }) {
  const out = new Float32Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) out.set(buffer.subarray((box.y + y) * width + box.x, (box.y + y) * width + box.x + box.width), y * box.width);
  return out;
}

/** `requests` split into runs of at most TRACE_BATCH_PIXELS crop pixels, a cell's strokes counted each; a larger cell runs alone. */
function traceBatches(requests: readonly PhotoshopProbeCellRequest[], strokes: (cell: number) => number) {
  const batches: PhotoshopProbeCellRequest[][] = [];
  let pixels = Infinity;
  for (const request of requests) {
    const size = request.crop.w * request.crop.h * strokes(request.cell);
    if (pixels + size > TRACE_BATCH_PIXELS) {
      batches.push([]);
      pixels = 0;
    }
    batches.at(-1)!.push(request);
    pixels += size;
  }
  return batches;
}

/** One capture sheet painted and traced, its scored cells scored against `dir`'s capture of it. */
async function scorePhotoshopProbeSheet(call: BrowserModuleCall, dir: string, sheet: PhotoshopCaptureSheet & { file: string }, probes: ReadonlyMap<string, PhotoshopProbe>, scored: ReadonlySet<number>, arrangement: PhotoshopProbeArrangement) {
  await call('openPhotoshopProbeSheet', { sheet, opacity: arrangement.opacity ?? 'last', order: arrangement.order, tipMax: STAMP_PACK_TIP_MAX });
  const painted = new Float32Array(sheet.width * sheet.height);
  const buffers = new Map<number, { owner: PhotoshopProbeStageOwner; coverage: Float32Array }[]>();
  try {
    const requests = sheet.cells.map((cell, c): PhotoshopProbeCellRequest => ({
      cell: c, crop: photoshopProbeCrop(cell.box, photoshopProbeReach(probes.get(cell.item)!), sheet.width, sheet.height), stages: scored.has(c),
    }));
    // Every cell is painted in the rig's order: a ground covers what's under it, and each cell's paint lays over it.
    await traceBatches(requests, (c) => sheet.cells[c].strokes.length).reduce(async (done, batch) => {
      await done;
      const traces = await call<PhotoshopProbeCellTrace[]>('tracePhotoshopProbeCells', batch);
      batch.forEach(({ cell: c, crop }, r) => {
        const cell = sheet.cells[c], trace = traces[r];
        if (cell.groundBox) {
          const g = cell.groundBox;
          for (let y = g.y; y < g.y + g.height; y++) painted.fill(1, y * sheet.width + g.x, y * sheet.width + g.x + g.width);
        }
        const coverage = over(trace.coverage);
        for (let y = 0; y < crop.h; y++) {
          for (let x = 0; x < crop.w; x++) {
            const at = (crop.y + y) * sheet.width + crop.x + x;
            painted[at] += coverage[y * crop.w + x] * (1 - painted[at]);
          }
        }
        if (trace.stages) buffers.set(c, [{ owner: 'build', coverage: over(trace.stages.built) }, ...trace.stages.stages.map(({ stage, coverage: planes }) => ({ owner: stage, coverage: over(planes) }))]);
      });
    }, Promise.resolve());
  } finally {
    await call('closePhotoshopProbeSheet');
  }
  const pixels = readPhotoshopSheet(join(dir, sheet.file), sheet.width, sheet.height);
  return [...buffers].map(([c, cellBuffers]): PhotoshopProbeCellScore => {
    const cell = sheet.cells[c], crop = cropPhotoshopCell(pixels, cell.box);
    const capture = new Float32Array(crop.width * crop.height).map((_, i) => crop.rgba[i * 4 + 3] / 65535);
    return { probe: cell.item, cell: `mark ${cell.index + 1} ${cell.mark}`, score: scorePhotoshopProbe(cropBuffer(painted, sheet.width, cell.box), capture, cellBuffers) };
  });
}

/**
 * Scores the cells of `sheets` whose probe is in `only` (default all), in one browser session. Every cell of a sheet
 * is painted in the rig's order, since soft tips spill; a cell over a ground, a further copy or at random, or an
 * `untaken` probe, is painted but not scored.
 */
export async function scorePhotoshopProbeRun({ dir, sheets, probes, untaken, only, arrangement = {} }: {
  dir: string; sheets: readonly (PhotoshopCaptureSheet & { file: string })[]; probes: readonly PhotoshopProbe[]; untaken: ReadonlySet<string>; only?: readonly string[];
  arrangement?: PhotoshopProbeArrangement;
}) {
  const byName = new Map(probes.map((p) => [p.name, p]));
  const skips = new Map<string, number>();
  const asked = (cell: PhotoshopCaptureCell) => !only || only.includes(cell.item);
  // Repeat sheets hold the same cells again, for the rig's own repeat check.
  const work = sheets.filter((s) => s.group === 'capture' && s.cells.some(asked)).map((sheet) => {
    const scored = new Set<number>();
    sheet.cells.forEach((cell, c) => {
      const probe = byName.get(cell.item);
      if (!probe) throw new Error(`photoshop probes: ${sheet.name} paints ${JSON.stringify(cell.item)}, which isn't among the probes`);
      if (!asked(cell)) return;
      const why = skipped(cell, probe, untaken);
      if (why) skips.set(why, (skips.get(why) ?? 0) + 1);
      else scored.add(c);
    });
    return { sheet, scored };
  }).filter(({ scored }) => scored.size);
  const scores = await withBrowserModulePage({ entry: PROBE_PAGE, filesDir: dirname(PROBE_PAGE) }, async (call) => {
    // One sheet at a time: each holds the GPU for its painting.
    return work.reduce<Promise<PhotoshopProbeCellScore[]>>(async (done, { sheet, scored }) => {
      const all = await done;
      return [...all, ...await scorePhotoshopProbeSheet(call, dir, sheet, byName, scored, arrangement)];
    }, Promise.resolve([]));
  });
  return { scores, skipped: Object.fromEntries(skips) };
}
