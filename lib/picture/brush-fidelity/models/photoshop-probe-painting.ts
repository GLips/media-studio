// photoshop-probe-painting.ts: a Photoshop probe sheet's cells as a painting for the GPU renderer, so probe scoring
// (engine/photoshop-probe-scoring.ts) can trace each cell stage by stage. A probe's preset goes through the importer
// as an .abr's would (photoshop-brush.ts), its marks are placed as a painting's strokes are, and its images are drawn
// as the importer writes a pack's: grey, 8-bit, dark where it paints.
//
// A cell is painted at the pressure Photoshop painted it at (photoshop-stroke-pressure.ts), its brush read as the pen
// drove it: a pose's overrides hold in its own cell and linger in the item's later cells on the sheet. Every cell is
// painted in sheet pixels, where Photoshop's pattern is fixed, so a grain lies where the capture's does.

import type { PhotoshopBox, PhotoshopCaptureCell, PhotoshopCaptureSheet } from '#lib/picture/photoshop-brushes/models/photoshop-capture-plan.ts';
import { PHOTOSHOP_PROBE_RAMP, PHOTOSHOP_PROBE_SAMPLES, photoshopProbeRampValue, type PhotoshopProbe } from '#lib/picture/photoshop-brushes/models/photoshop-probes.ts';
import { photoshopPressuredPath, type PhotoshopStrokePressure } from '#lib/picture/photoshop-brushes/models/photoshop-stroke-pressure.ts';
import { drawPhotoshopErodibleTip } from '#lib/picture/photoshop-brushes/models/photoshop-erodible.ts';
import { drawPhotoshopTipImage, normalizePhotoshopBrush, PHOTOSHOP_SAMPLE_BORDER, type PhotoshopPressureContext, photoshopPatternNegated, photoshopTipImage, type PhotoshopTipAsset, type PhotoshopTipImage } from '#lib/picture/photoshop-brushes/models/photoshop-brush.ts';
import type { PhotoshopKnownTip } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
import type { StampPixelBox } from '#lib/picture/stamp-paint/models/stamp-blur-region.ts';
import type { StampResolveStage } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import type { StampBrushAsset } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { CompiledStampDeposit, CompiledStampPaint } from '#lib/picture/stamp-paint/models/stamp-paint-recipe-compile.ts';
import type { CompiledStampPaintAction } from '#lib/picture/stamp-paint/models/stamp-paint-action.ts';
import { placeStrokeStamps } from '#lib/picture/stamp-paint/models/stamp-placement.ts';

/** A probe image as a pack holds it: grey, row by row, dark where it paints. */
export type PhotoshopProbeGrayImage = { width: number; height: number; pixels: Uint8Array };

/**
 * Where a deposit's opacity applies: to its finished coverage (`last`, as the renderer lays it) or to each stamp as
 * it builds (`inBuild`, a diagnosis's alternative).
 */
export type PhotoshopProbeOpacity = 'last' | 'inBuild';

/** A traced plane, base64 of its f32 bytes, row by row. */
export type PhotoshopProbePlane = string;

/** A cell to trace by its index on the sheet, over `crop` (photoshopProbeCrop), and whether to trace its stages too. */
export type PhotoshopProbeCellRequest = { cell: number; crop: StampPixelBox; stages: boolean };

/**
 * A cell's trace, a plane per stroke: its coverage over its request's crop, and, when asked for, its build and each
 * stage's coverage over the cell's own box.
 */
export type PhotoshopProbeCellTrace = {
  coverage: PhotoshopProbePlane[];
  stages?: { built: PhotoshopProbePlane[]; stages: { stage: StampResolveStage; coverage: PhotoshopProbePlane[] }[] };
};

/** Each probe's images are filed under its name, so one painting holds every probe on a sheet. */
const probeAsset = (probe: string, file: string): StampBrushAsset => ({ style: 'probe', pack: 'probes', file: `${probe}/${file}` });

/** A rig sample by the id a probe names. */
function probeSample(id: string) {
  const found = Object.entries(PHOTOSHOP_PROBE_SAMPLES).find(([name]) => name === id);
  if (!found) throw new Error(`photoshop probes: no rig sample ${JSON.stringify(id)}`);
  return found[1];
}

/** An image's paint (0..1) as the importer writes it: grey, dark where it paints. */
const grayOfPaint = (width: number, height: number, paint: (x: number, y: number) => number): PhotoshopProbeGrayImage => {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = Math.round(255 * (1 - paint(x, y)));
  return { width, height, pixels };
};

/** Texel `i` of a sample `n` wide trimmed from an image `size` wide, flipped or not. */
const sampleTexel = (i: number, n: number, size: number, flip: boolean) => (flip ? n - 1 - i : i) + (size - n) / 2;

/** A probe tip's image: the importer's drawing of a computed tip, or the rig's sampled tip as Photoshop trims it. */
function tipImage(image: PhotoshopTipImage, tipMax: number): PhotoshopProbeGrayImage {
  if (image.kind !== 'sampled') {
    const { size, pixels } = drawPhotoshopTipImage(image, tipMax);
    return { width: size, height: size, pixels };
  }
  // Flipped into the image, inside its blank border, as the importer writes a sample.
  const sample = probeSample(image.id), [nw, nh] = sample.native, b = PHOTOSHOP_SAMPLE_BORDER;
  return grayOfPaint(nw + 2 * b, nh + 2 * b, (x, y) => (x < b || y < b || x >= nw + b || y >= nh + b
    ? 0
    : sample.paint(sampleTexel(x - b, nw, sample.width, image.flipX), sampleTexel(y - b, nh, sample.height, image.flipY))));
}

/** A probe tip's image as the importer files it; Photoshop trims the rig's sample to its paint, `native` square. */
function probeTipAsset(probe: string, tip: PhotoshopKnownTip, file: string): PhotoshopTipAsset {
  if (tip.kind === 'sampled') {
    const [width, height] = probeSample(tip.sample).native;
    return { kind: 'sampled', image: probeAsset(probe, file), sample: { width, height } };
  }
  if (tip.kind === 'erodible') return { kind: 'erodible', image: probeAsset(probe, file), contact: probeAsset(probe, `${file}-contact`), heightMap: probeAsset(probe, `${file}-heights`) };
  if (tip.kind === 'bristle') return { kind: 'bristle' };
  return { kind: 'round', image: probeAsset(probe, file) };
}

/** A probe tip's images by file: an erodible one pressed from Photoshop's default heights. A bristle tip is drawn as it's bound. */
function probeTipImages(tip: PhotoshopKnownTip, file: string, tipMax: number) {
  if (tip.kind === 'bristle') return {};
  if (tip.kind !== 'erodible') return { [file]: tipImage(photoshopTipImage(tip), tipMax) };
  const { size, image, contact } = drawPhotoshopErodibleTip(tip, null, tipMax);
  return { [file]: { width: size, height: size, pixels: image }, [`${file}-contact`]: { width: size, height: size, pixels: contact } };
}

/** A probe's dual tip, when it has one the studio reads. */
const probeDualTip = ({ preset }: PhotoshopProbe) => (preset.dual && preset.dual.tip.kind !== 'unsupported' ? preset.dual.tip : undefined);

/** A probe as the importer reads it under `context`. */
function photoshopProbeBrush(probe: PhotoshopProbe, context: PhotoshopPressureContext) {
  const { preset } = probe, dualTip = probeDualTip(probe);
  return normalizePhotoshopBrush(probe.name, {
    preset,
    tip: probeTipAsset(probe.name, preset.tip, 'tip'),
    ...(dualTip && { dualTip: probeTipAsset(probe.name, dualTip, 'dual-tip') }),
    ...(preset.texture && { pattern: { image: probeAsset(probe.name, 'ramp'), width: PHOTOSHOP_PROBE_RAMP.width } }),
  }, undefined, context).brush;
}

/** A probe's images by their assets' files, drawn from its preset as the rig drew them; tips at most `tipMax` square. */
function photoshopProbeImages(probe: PhotoshopProbe, tipMax: number): [string, PhotoshopProbeGrayImage][] {
  const { preset } = probe, dualTip = probeDualTip(probe);
  // The ramp as a brush's grain reads it: its paint, which the importer negates unless the preset inverts it.
  const negated = photoshopPatternNegated(preset), ramp = (x: number) => (negated ? photoshopProbeRampValue(x) : 1 - photoshopProbeRampValue(x));
  const images = {
    ...probeTipImages(preset.tip, 'tip', tipMax),
    ...(dualTip && probeTipImages(dualTip, 'dual-tip', tipMax)),
    ...(preset.texture && { ramp: grayOfPaint(PHOTOSHOP_PROBE_RAMP.width, PHOTOSHOP_PROBE_RAMP.height, ramp) }),
  };
  return Object.entries(images).map(([file, image]) => [probeAsset(probe.name, file).file, image]);
}

/** How far past its box a probe's paint can reach: a soft tip's tail runs out to about 0.85 of its diameter. */
export function photoshopProbeReach(probe: PhotoshopProbe): number {
  const diameter = probe.preset.tip.geometry.diameter;
  return Math.ceil(diameter * Math.max(1, (probeDualTip(probe)?.geometry.diameter ?? 0) / diameter) * 1.2) + 2;
}

/** `box` grown by `pad` each side, kept on a `width` × `height` sheet. */
export function photoshopProbeCrop(box: PhotoshopBox, pad: number, width: number, height: number): StampPixelBox {
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  return { x, y, w: Math.min(width, box.x + box.width + pad) - x, h: Math.min(height, box.y + box.height + pad) - y };
}

/** 8-bit, as Photoshop holds a tool's opacity. */
const byte = (v: number) => Math.round(v * 255) / 255;

/** The pressure Photoshop painted `cell` at. */
const cellPressure = (cell: PhotoshopCaptureCell): PhotoshopStrokePressure => {
  if (cell.pressure !== undefined) return { kind: 'posed', pressure: cell.pressure };
  return cell.simulatePressure ? { kind: 'simulated' } : { kind: 'none' };
};

/**
 * `sheet` as a painting: one glaze of black, each cell's strokes a deposit of its own in the rig's order, with the
 * images its probes' brushes name (by asset file). `probes` must hold every item the sheet names. `cells[i]` are
 * `sheet.cells[i]`'s deposits.
 */
export function photoshopProbeSheetPainting({ sheet, probes, opacity, tipMax }: {
  sheet: PhotoshopCaptureSheet; probes: readonly PhotoshopProbe[]; opacity: PhotoshopProbeOpacity; tipMax: number;
}): { painting: CompiledStampPaint; images: Map<string, PhotoshopProbeGrayImage>; cells: CompiledStampDeposit<CompiledStampPaintAction>[][] } {
  const byName = new Map(probes.map((p) => [p.name, p]));
  const images = new Map<string, PhotoshopProbeGrayImage>(), drawn = new Set<string>();
  // Items posed on this sheet so far, whose overrides linger until the next sheet applies them afresh.
  const posed = new Set<string>();
  const cells = sheet.cells.map((cell, c) => {
    const probe = byName.get(cell.item);
    if (!probe) throw new Error(`photoshop probes: ${sheet.name} paints ${JSON.stringify(cell.item)}, which isn't among the probes`);
    if (!drawn.has(probe.name)) for (const [file, image] of photoshopProbeImages(probe, tipMax)) images.set(file, image);
    drawn.add(probe.name);
    if (cell.pressure !== undefined) posed.add(cell.item);
    const brush = photoshopProbeBrush(probe, { lingeringPose: posed.has(cell.item) });
    const diameter = probe.preset.tip.geometry.diameter, pressure = cellPressure(cell), toolOpacity = byte(probe.preset.tool.opacity / 100);
    // Each stroke finishes and lays over the ones before it, as separate strokes do.
    return cell.strokes.map((stroke, s): CompiledStampDeposit<CompiledStampPaintAction> => {
      const path = photoshopPressuredPath(stroke, pressure), seed = `${probe.name}|${s}`;
      const stamps = placeStrokeStamps(path, brush, diameter, seed);
      // In the build, each stamp's opacity carries the deposit's, which then lays at full. The stamps are this
      // stroke's own, fresh from placement.
      if (opacity === 'inBuild') for (const stamp of stamps) stamp.opacity *= toolOpacity;
      return {
        kind: 'stroke', id: `probes/cells/${c}-${s}`, brush, action: { kind: 'paint', material: { kind: 'constant', value: { kind: 'color', color: '#000000' } }, burnish: false }, diameter, blend: brush.blend, mask: null,
        opacity: opacity === 'last' ? toolOpacity : 1,
        stamps,
        dualStamps: brush.dual ? placeStrokeStamps(path, brush.dual, diameter * brush.dual.scale, `${seed}|dual`) : [],
        // The pattern is fixed to the sheet, whose pixels these are.
        grainOffset: { main: [0, 0], dual: [0, 0] },
      };
    });
  });
  return { painting: { groups: [{ id: 'probes', composite: 'glaze', opacity: 1, paper: 'ground', passes: [{ id: 'probes/cells', kind: 'dry', within: null, deposits: cells.flat() }] }] }, images, cells };
}
