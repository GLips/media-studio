// photoshop-probe-page.ts: probe scoring's browser side, run by engine/photoshop-probe-scoring.ts through
// withBrowserModulePage. It builds a probe sheet's painting itself (models/photoshop-probe-painting.ts), as a compiled
// painting's typed arrays don't survive the trip from Node, and traces its cells with the studio's GPU renderer, a
// batch at a time, handing each plane back as base64 of its f32 bytes.
//
// One sheet is open at a time: its renderer holds the painting on the GPU between batches.

import { photoshopProbes } from '#lib/paint/photoshop-brushes/models/photoshop-probes.ts';
import type { PhotoshopCaptureSheet } from '#lib/paint/photoshop-brushes/models/photoshop-capture-plan.ts';
import type { StampResolveStage } from '#lib/paint/painting/models/stamp-deposit-stages.ts';
import type { CompiledStampDeposit } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { photoshopProbeSheetPainting, type PhotoshopProbeCellRequest, type PhotoshopProbeCellTrace, type PhotoshopProbeGrayImage, type PhotoshopProbeOpacity, type PhotoshopProbePlane } from '../models/photoshop-probe-painting.ts';

let open: { sheet: PhotoshopCaptureSheet; cells: CompiledStampDeposit[][]; surface: StampPaintSurface; renderer: StampPaintRenderer; order?: readonly StampResolveStage[] } | null = null;

/** A grey image as a PNG data URL, lossless, so the GPU samples the bytes the importer would have written. */
function grayImageUrl({ width, height, pixels }: PhotoshopProbeGrayImage): string {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d')!, image = context.createImageData(width, height);
  pixels.forEach((v, i) => image.data.set([v, v, v, 255], i * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

// The render browser's Chrome encodes natively, about a hundred times faster than btoa over char codes.
// SAFETY: Chrome has had Uint8Array.prototype.toBase64 since 140; the ES2023 lib the studio types against lacks it.
const planeBase64 = (plane: Float32Array): PhotoshopProbePlane => (new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength) as Uint8Array & { toBase64: () => string }).toBase64();

/**
 * Opens `sheet` for tracing, its stages run in `order` (each brush's plan's if left out) and its opacity applied where
 * `opacity` says; tips drawn at most `tipMax` square, as a pack's are. Closes any sheet open before.
 */
async function openPhotoshopProbeSheet({ sheet, opacity, order, tipMax }: { sheet: PhotoshopCaptureSheet; opacity: PhotoshopProbeOpacity; order?: readonly StampResolveStage[]; tipMax: number }) {
  closePhotoshopProbeSheet();
  const { painting, images, cells } = photoshopProbeSheetPainting({ sheet, probes: photoshopProbes(), opacity, tipMax });
  const urls = new Map([...images].map(([file, image]) => [file, grayImageUrl(image)]));
  const canvas = Object.assign(document.createElement('canvas'), { width: sheet.width, height: sheet.height });
  const surface = await createStampPaintSurface({ canvas, width: sheet.width, height: sheet.height }, ({ file }) => urls.get(file)!);
  open = { sheet, cells, surface, renderer: await createStampPaintRenderer(surface, painting, { color: '#ffffff' }, { kind: 'flat' }), order };
}

/** `plane` (`crop.w` wide) over `box`, both in sheet pixels. */
function cropPlane(plane: Float32Array, crop: { x: number; y: number; w: number }, box: { x: number; y: number; width: number; height: number }) {
  const out = new Float32Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) {
    const from = (box.y - crop.y + y) * crop.w + box.x - crop.x;
    out.set(plane.subarray(from, from + box.width), y * box.width);
  }
  return out;
}

/**
 * The open sheet's cells `requests` name (by index), traced over their crops in one frame; their stages only where
 * `stages` asks.
 */
async function tracePhotoshopProbeCells(requests: readonly PhotoshopProbeCellRequest[]): Promise<PhotoshopProbeCellTrace[]> {
  const { sheet, cells, renderer, order } = open!;
  const traces = await renderer.trace(0, requests.flatMap(({ cell, crop }) => cells[cell].map((deposit) => ({ deposit, crop, ...(order && { order }) }))));
  let next = 0;
  return requests.map(({ cell, stages }) => {
    const own = traces.slice(next, next += cells[cell].length), { box } = sheet.cells[cell];
    return {
      coverage: own.map((t) => planeBase64(t.coverage)),
      ...(stages && { stages: {
        built: own.map((t) => planeBase64(cropPlane(t.built, t.crop, box))),
        stages: own[0].stages.map(({ stage }, k) => ({ stage, coverage: own.map((t) => planeBase64(cropPlane(t.stages[k].coverage, t.crop, box))) })),
      } }),
    };
  });
}

function closePhotoshopProbeSheet() {
  open?.surface.dispose();
  open = null;
}

Object.assign(globalThis, { openPhotoshopProbeSheet, tracePhotoshopProbeCells, closePhotoshopProbeSheet });
