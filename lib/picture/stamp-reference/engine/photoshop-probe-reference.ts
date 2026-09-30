// photoshop-probe-reference.ts: each Photoshop probe capture against the reference renderer's render of the same probe
// (vid-97). A probe's preset goes through the importer as an .abr's would (photoshop-brush.ts), its marks are
// placed as a painting's strokes are, and the reference lays them; each cell's difference is split among the stages
// that own it (stamp-reference-score.ts).
//
// Negative space: cells on a ground (their paint's colour matters, not only its coverage), under a Brush Pose (a pose
// scales size and opacity whatever the brush says) or with simulated pressure, and every copy of a randomness probe
// but the first, are skipped and counted, not scored.

import { join } from 'node:path';
import type { PhotoshopCaptureCell, PhotoshopCaptureSheet } from '#lib/picture/photoshop-brushes/models/photoshop-capture-plan.ts';
import { cropPhotoshopCell } from '#lib/picture/photoshop-brushes/models/photoshop-capture-cells.ts';
import { PHOTOSHOP_PROBE_RAMP, PHOTOSHOP_PROBE_TIP, photoshopProbeRampValue, photoshopProbeTipPaint, type PhotoshopProbe } from '#lib/picture/photoshop-brushes/models/photoshop-probes.ts';
import { readPhotoshopSheet } from '#lib/picture/photoshop-brushes/engine/photoshop-capture.ts';
import { normalizePhotoshopBrush, PHOTOSHOP_SAMPLE_BORDER, photoshopPatternNegated, photoshopTipImage, type PhotoshopTipAsset, type PhotoshopTipImage } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import { drawPhotoshopComputedTip } from '#lib/picture/photoshop-brushes/models/photoshop-computed-tip.ts';
import type { PhotoshopKnownTip } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
import { bindStampBrushImages, type StampBrushAsset } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { STAMP_PACK_TIP_MAX } from '#lib/picture/stamp-styles/engine/stamp-paint-pack-files.ts';
import { placeStrokeStamps } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { stampReferenceMips, type StampReferenceImage } from '../models/stamp-reference-image.ts';
import { renderStampReferenceDeposit, type StampReferenceArrangement } from '../models/stamp-reference-deposit.ts';
import { scoreStampReference, type StampReferenceScore } from '../models/stamp-reference-score.ts';

const asset = (file: string): StampBrushAsset => ({ style: 'probe', pack: 'probe', file });

/** A probe tip's image, 1 where it paints: the importer's drawing of a computed tip, or the rig's sampled tip as Photoshop trims it. */
function tipImage(image: PhotoshopTipImage): StampReferenceImage {
  if (image.kind === 'round') {
    const { size, pixels } = drawPhotoshopComputedTip(image.diameter, image.hardness, image.span, STAMP_PACK_TIP_MAX);
    return { width: size, height: size, paint: Float32Array.from(pixels, (v) => 1 - v / 255) };
  }
  // Flipped into the image, inside its blank border, as the importer writes a sample.
  const { size, native } = PHOTOSHOP_PROBE_TIP, inset = (size - native) / 2, b = PHOTOSHOP_SAMPLE_BORDER, side = native + 2 * b;
  const paint = new Float32Array(side * side);
  const at = (i: number, flip: boolean) => (flip ? native - 1 - i : i) + inset;
  for (let y = 0; y < native; y++) for (let x = 0; x < native; x++) paint[(y + b) * side + x + b] = photoshopProbeTipPaint(at(x, image.flipX), at(y, image.flipY));
  return { width: side, height: side, paint };
}

/** The ramp pattern as a brush's grain reads it: its paint, which the importer negates unless the preset inverts it. */
function rampImage(negated: boolean): StampReferenceImage {
  const { width, height } = PHOTOSHOP_PROBE_RAMP, paint = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint[y * width + x] = negated ? photoshopProbeRampValue(x) : 1 - photoshopProbeRampValue(x);
  return { width, height, paint };
}

/** A probe tip's image as the importer files it; Photoshop trims the rig's sample to its paint, `native` square. */
const probeTipAsset = (tip: PhotoshopKnownTip, file: string): PhotoshopTipAsset => (tip.kind === 'sampled'
  ? { kind: 'sampled', image: asset(file), sample: { width: PHOTOSHOP_PROBE_TIP.native, height: PHOTOSHOP_PROBE_TIP.native } }
  : { kind: 'round', image: asset(file) });

/** A probe's dual tip, when it has one the studio reads. */
const probeDualTip = ({ preset }: PhotoshopProbe) => (preset.dual && preset.dual.tip.kind !== 'unsupported' ? preset.dual.tip : undefined);

/** A probe as the importer reads it, with its images. */
export function photoshopProbeReferenceBrush(probe: PhotoshopProbe) {
  const { preset } = probe, dualTip = probeDualTip(probe);
  const { brush, support } = normalizePhotoshopBrush(probe.name, {
    preset,
    tip: probeTipAsset(preset.tip, 'tip'),
    ...(dualTip && { dualTip: probeTipAsset(dualTip, 'dual-tip') }),
    ...(preset.texture && { pattern: { image: asset('ramp'), width: PHOTOSHOP_PROBE_RAMP.width } }),
  });
  // Each image drawn from the preset as the rig drew it, by the name it was given above.
  const images: Record<string, () => ReturnType<typeof stampReferenceMips>> = {
    tip: () => stampReferenceMips(tipImage(photoshopTipImage(preset.tip))),
    ...(dualTip && { 'dual-tip': () => stampReferenceMips(tipImage(photoshopTipImage(dualTip))) }),
    ramp: () => stampReferenceMips(rampImage(photoshopPatternNegated(preset))),
  };
  return { brush: bindStampBrushImages(brush, ({ file }) => images[file]()), support };
}

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
  if (cell.pressure !== undefined) return 'under a Brush Pose';
  if (cell.simulatePressure) return 'simulated pressure';
  if (randomProbe(probe)) return 'random';
  return null;
}

/** 8-bit, as Photoshop holds a tool's opacity. */
const byte = (v: number) => Math.round(v * 255) / 255;

export type PhotoshopProbeCellScore = { probe: string; cell: string; score: StampReferenceScore };

/**
 * The reference's coverage for `cell` over its box grown by `pad` pixels each side (in the cell's own pixels, so the
 * box starts at −pad), and every stage's buffer.
 */
export function renderPhotoshopProbeCell(probe: PhotoshopProbe, cell: PhotoshopCaptureCell, { arrangement, pad = 0 }: { arrangement?: StampReferenceArrangement; pad?: number } = {}) {
  const { brush } = photoshopProbeReferenceBrush(probe);
  const box = { x: -pad, y: -pad, width: cell.box.width + 2 * pad, height: cell.box.height + 2 * pad };
  const diameter = probe.preset.tip.geometry.diameter;
  // Each stroke finishes and lays over the ones before it, as separate strokes do.
  const deposits = cell.strokes.map((stroke, s) => {
    const path = stroke.map(([x, y]) => ({ x: x - cell.box.x, y: y - cell.box.y }));
    const seed = `${probe.name}|${s}`;
    return renderStampReferenceDeposit({
      brush, diameter, opacity: byte(probe.preset.tool.opacity / 100), box, arrangement,
      stamps: placeStrokeStamps(path, brush, diameter, seed),
      dualStamps: brush.dual ? placeStrokeStamps(path, brush.dual, diameter * brush.dual.scale, `${seed}|dual`) : [],
      // The pattern is fixed to the sheet, and cells start on whole tiles.
      grainOffset: { main: [0, 0], dual: [0, 0] },
    });
  });
  const over = (buffers: Float32Array[]) => buffers.reduce((under, top) => under.map((u, i) => u + top[i] * (1 - u)));
  const coverage = over(deposits.map((d) => d.coverage));
  const buffers = [
    { owner: 'build' as const, coverage: over(deposits.map((d) => d.built.main)) },
    ...deposits[0].stages.map(({ stage }, k) => ({ owner: stage, coverage: over(deposits.map((d) => d.stages[k].coverage)) })),
  ];
  return { box, coverage, buffers };
}

/** How far past its box a probe's paint can reach: a soft tip's tail runs out to about 0.85 of its diameter. */
const probeReach = (probe: PhotoshopProbe) => {
  const diameter = probe.preset.tip.geometry.diameter;
  return Math.ceil(diameter * Math.max(1, (probeDualTip(probe)?.geometry.diameter ?? 0) / diameter) * 1.2) + 2;
};

/** The rows of `buffer` (`width` wide, starting at `from` in it) that fall in `box`, as the box's own array. */
function cropBuffer(buffer: Float32Array, width: number, from: { x: number; y: number }, box: { width: number; height: number }) {
  const out = new Float32Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) out.set(buffer.subarray((from.y + y) * width + from.x, (from.y + y) * width + from.x + box.width), y * box.width);
  return out;
}

/**
 * Scores the cells of `sheets` whose probe is in `only` (default all). Every cell is painted in the rig's order (soft
 * tips spill); `probes` must hold every item the sheets name. A cell over a ground, under a pose
 * or at random is painted but not scored; so is an `untaken` probe, one Photoshop didn't set as asked.
 */
export function scorePhotoshopProbeRun({ dir, sheets, probes, untaken, only, arrangement }: {
  dir: string; sheets: readonly (PhotoshopCaptureSheet & { file: string })[]; probes: readonly PhotoshopProbe[]; untaken: ReadonlySet<string>; only?: readonly string[];
  arrangement?: StampReferenceArrangement;
}) {
  const byName = new Map(probes.map((p) => [p.name, p]));
  const scores: PhotoshopProbeCellScore[] = [];
  const skips = new Map<string, number>();
  // Repeat sheets hold the same cells again, for the rig's own repeat check.
  for (const sheet of sheets.filter((s) => s.group === 'capture')) {
    if (!sheet.cells.some((cell) => !only || only.includes(cell.item))) continue;
    const painted = new Float32Array(sheet.width * sheet.height);
    const own: { cell: PhotoshopCaptureCell; probe: PhotoshopProbe; buffers: ReturnType<typeof renderPhotoshopProbeCell>['buffers'] }[] = [];
    for (const cell of sheet.cells) {
      const probe = byName.get(cell.item);
      if (!probe) throw new Error(`stamp reference: ${sheet.name} paints ${JSON.stringify(cell.item)}, which isn't among the probes`);
      const why = skipped(cell, probe, untaken), scored = !why && (!only || only.includes(cell.item));
      if (why && (!only || only.includes(cell.item))) skips.set(why, (skips.get(why) ?? 0) + 1);
      if (cell.groundBox) {
        const g = cell.groundBox;
        for (let y = g.y; y < g.y + g.height; y++) painted.fill(1, y * sheet.width + g.x, y * sheet.width + g.x + g.width);
      }
      const pad = probeReach(probe);
      const { box, coverage, buffers } = renderPhotoshopProbeCell(probe, cell, { arrangement, pad });
      for (let y = 0; y < box.height; y++) {
        const sy = cell.box.y + box.y + y;
        if (sy < 0 || sy >= sheet.height) continue;
        for (let x = 0; x < box.width; x++) {
          const sx = cell.box.x + box.x + x;
          if (sx < 0 || sx >= sheet.width) continue;
          const at = sy * sheet.width + sx;
          painted[at] += coverage[y * box.width + x] * (1 - painted[at]);
        }
      }
      if (scored) own.push({ cell, probe, buffers: buffers.map((b) => ({ ...b, coverage: cropBuffer(b.coverage, box.width, { x: pad, y: pad }, cell.box) })) });
    }
    if (!own.length) continue;
    const pixels = readPhotoshopSheet(join(dir, sheet.file), sheet.width, sheet.height);
    for (const { cell, probe, buffers } of own) {
      const crop = cropPhotoshopCell(pixels, cell.box);
      const capture = new Float32Array(crop.width * crop.height).map((_, i) => crop.rgba[i * 4 + 3] / 65535);
      const reference = cropBuffer(painted, sheet.width, cell.box, cell.box);
      scores.push({ probe: probe.name, cell: `mark ${cell.index + 1} ${cell.mark}`, score: scoreStampReference(reference, capture, buffers) });
    }
  }
  return { scores, skipped: Object.fromEntries(skips) };
}
