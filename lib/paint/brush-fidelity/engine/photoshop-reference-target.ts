// photoshop-reference-target.ts: a pack's Photoshop reference captures (`npm run photoshop -- references`, vid-100, in
// brushes/<pack>/reference/) as what the brush fidelity sheet measures a brush against where the pack has no
// Procreate preview. The reference's S-curve mark is Photoshop painting the brush along the preview's stroke, scaled to
// its cell, so the cell cropped to the preview's frame and downsized to its size is measured as a preview is: its
// alpha is the brush's coverage.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import type { PhotoshopAppliedOptions, PhotoshopBox, PhotoshopCaptureManifest } from '#lib/paint/photoshop-brushes/models/photoshop-capture-plan.ts';
import { PROCREATE_PREVIEW_SIZE } from '#lib/paint/procreate-brushes/models/procreate-preview-stroke.ts';
import { photoshopReferenceForeignStrokes, type PhotoshopReferenceStroke } from '../models/photoshop-reference-stroke.ts';

/** The folder of a pack's Photoshop reference captures, which an import leaves be. */
export const PHOTOSHOP_REFERENCE_DIR = 'reference';

/**
 * Each captured brush's S-curve in `packDir`'s reference/, by preset name; empty without a reference run. `reachOf`:
 * how far a captured item's paint lands from its path, in its diameters (stampBrushPaintReach), for the neighbours whose
 * paint may lie in an S-curve's frame.
 */
export function readPhotoshopReferenceStrokes(packDir: string, reachOf: (item: string) => number): Map<string, PhotoshopReferenceStroke> {
  const dir = join(packDir, PHOTOSHOP_REFERENCE_DIR), manifestFile = join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) return new Map();
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as PhotoshopCaptureManifest;
  const diameterOf = (item: string) => manifest.items[item].preset!.diameter;
  return new Map(manifest.sheets.flatMap((sheet) => sheet.cells.flatMap((cell, index) => {
    if (cell.mark !== 'sCurve') return [];
    const diameter = (diameterOf(cell.item) * PROCREATE_PREVIEW_SIZE.width) / cell.box.width;
    return [[cell.item, {
      sheet: join(dir, sheet.file), box: cell.box, diameter,
      pressure: { lingeringPose: sheet.cells.slice(0, index).some((before) => before.item === cell.item && before.pressure !== undefined) },
      opacity: photoshopAppliedOpacity(manifest.items[cell.item].applied),
      foreign: {
        strokes: photoshopReferenceForeignStrokes(sheet.cells, cell.box, photoshopReferenceFrame(cell.box), diameterOf, reachOf),
        ownCore: Math.SQRT1_2 * diameter,
      },
    }] as const];
  })));
}

/** The part of an S-curve's `box` its preview frame crops: the box's width, centred down it at the preview's proportions. */
function photoshopReferenceFrame(box: PhotoshopBox) {
  const { width: W, height: H } = PROCREATE_PREVIEW_SIZE, height = Math.round((box.width * H) / W);
  return { x: box.x, y: Math.round(box.y + (box.height - height) / 2), width: box.width, height };
}

/**
 * The tool opacity Photoshop painted at, 0..1 in its 255ths, as read back: a tool preset sets its own over the rig's
 * 100%. A smudge preset's read-back has none; it paints at full strength.
 */
function photoshopAppliedOpacity({ opacity }: PhotoshopAppliedOptions): number {
  return isPercent(opacity) ? Math.round((opacity / 100) * 255) / 255 : 1;
}

const isPercent = (value: unknown): value is number => typeof value === 'number';

/** A brush's S-curve cropped to the preview's frame at its size, as a PNG data URL of black ink on transparency. */
export function photoshopReferenceStrokePng({ sheet, box }: PhotoshopReferenceStroke): string {
  const { width: W, height: H } = PROCREATE_PREVIEW_SIZE;
  // The mark scales the preview's path by the box's width over the preview's, centred on the box's middle.
  const frame = photoshopReferenceFrame(box);
  const png = runFfmpeg(['-nostdin', '-v', 'error', '-i', sheet, '-vf', `crop=${frame.width}:${frame.height}:${frame.x}:${frame.y},scale=${W}:${H}:flags=area,format=rgba`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: W * H * 4 + 65536 });
  return `data:image/png;base64,${png.toString('base64')}`;
}
