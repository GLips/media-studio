// photoshop-reference-target.ts: a pack's Photoshop reference captures (`npm run photoshop -- references`, vid-100, in
// brushes/<pack>/reference/) as what the brush fidelity sheet measures a brush against where the pack has no
// Procreate preview. The reference's S-curve mark is Photoshop painting the brush along the preview's stroke, scaled to
// its cell, so the cell cropped to the preview's frame and downsized to its size is measured as a preview is: its
// alpha is the brush's coverage.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import type { PhotoshopAppliedOptions, PhotoshopCaptureManifest } from '#lib/picture/photoshop-brushes/models/photoshop-capture-plan.ts';
import { PROCREATE_PREVIEW_SIZE } from '#lib/picture/procreate-brushes/models/procreate-preview-stroke.ts';
import type { PhotoshopReferenceStroke } from '../models/photoshop-reference-stroke.ts';

/** The folder of a pack's Photoshop reference captures, which an import leaves be. */
export const PHOTOSHOP_REFERENCE_DIR = 'reference';

/** Each captured brush's S-curve in `packDir`'s reference/, by preset name; empty without a reference run. */
export function readPhotoshopReferenceStrokes(packDir: string): Map<string, PhotoshopReferenceStroke> {
  const dir = join(packDir, PHOTOSHOP_REFERENCE_DIR), manifestFile = join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) return new Map();
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as PhotoshopCaptureManifest;
  return new Map(manifest.sheets.flatMap((sheet) => sheet.cells.flatMap((cell, index) => (cell.mark !== 'sCurve' ? [] : [[cell.item, {
    sheet: join(dir, sheet.file), box: cell.box, diameter: (manifest.items[cell.item].preset!.diameter * PROCREATE_PREVIEW_SIZE.width) / cell.box.width,
    pressure: { lingeringPose: sheet.cells.slice(0, index).some((before) => before.item === cell.item && before.pressure !== undefined) },
    opacity: photoshopAppliedOpacity(manifest.items[cell.item].applied),
  }] as const]))));
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
  const height = Math.round((box.width * H) / W), y = Math.round(box.y + (box.height - height) / 2);
  const png = runFfmpeg(['-nostdin', '-v', 'error', '-i', sheet, '-vf', `crop=${box.width}:${height}:${box.x}:${y},scale=${W}:${H}:flags=area,format=rgba`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: W * H * 4 + 65536 });
  return `data:image/png;base64,${png.toString('base64')}`;
}
