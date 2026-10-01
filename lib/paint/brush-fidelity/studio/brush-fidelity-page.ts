// brush-fidelity-page.ts: the brush fidelity page, run by lib/paint/brush-fidelity/engine/brush-fidelity-score.ts
// through withBrowserModulePage for the sheet, the reading fit and the diagnostic. It paints a brush with the studio's
// GPU renderer as its target was painted (brush-fidelity-target.ts), measures that and the target alike, and lays out a
// row of the sheet. A brush's assets are under the styles folder, served at /files/, at the URLs Node resolved
// (stamp-paint-pack-urls.ts); a target comes as a URL, a preview's under /files/ and a reference's as a data URL.

import { PROCREATE_PREVIEW_SIZE } from '#lib/paint/procreate-brushes/models/procreate-preview-stroke.ts';
import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { stampPaintPackAssetUrl, type StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { brushFidelityForeignPaint, brushFidelityPainting, type BrushFidelityTarget } from '../models/brush-fidelity-target.ts';
import { clearPhotoshopForeignPaint, type PhotoshopForeignPaint } from '../models/photoshop-reference-stroke.ts';
import { measureStrokeCoverage, type StrokeCoverageProfile, type StrokeFidelityGrade } from '../models/stroke-measure.ts';

const { width: W, height: H } = PROCREATE_PREVIEW_SIZE;

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

/** A target is paint on transparency (a preview's white, a reference's black), so its alpha is its coverage. */
async function targetCoverage(src: string): Promise<Uint8Array> {
  const image = await loadImage(src);
  const context = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d')!;
  context.drawImage(image, 0, 0, W, H);
  const rgba = context.getImageData(0, 0, W, H).data, coverage = new Uint8Array(W * H);
  for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4 + 3];
  return coverage;
}

/** Ours is black paint on white paper, so its coverage is how dark it is. */
function paintedCoverage(canvas: HTMLCanvasElement): Uint8Array {
  const context = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  const rgba = context.getImageData(0, 0, W, H).data, coverage = new Uint8Array(W * H);
  for (let i = 0; i < coverage.length; i++) coverage[i] = 255 - Math.round((rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3);
  return coverage;
}

async function measureStrokeTarget(src: string, target: BrushFidelityTarget): Promise<StrokeCoverageProfile | null> {
  return measureStrokeCoverage(clearPhotoshopForeignPaint(await targetCoverage(src), W, H, brushFidelityForeignPaint(target)), W, H);
}

async function paintAndMeasure(painting: CompiledStampPaint, foreign: PhotoshopForeignPaint, withPng: boolean, packUrls: StampPaintPackUrls): Promise<{ png?: string; profile: StrokeCoverageProfile | null }> {
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const surface = await createStampPaintSurface({ canvas, width: W, height: H }, (asset) => stampPaintPackAssetUrl(packUrls, asset));
  try {
    const renderer = await createStampPaintRenderer(surface, painting, { color: '#ffffff' }, { kind: 'flat' });
    await renderer.draw(0);
    return { ...(withPng && { png: canvas.toDataURL('image/png') }), profile: measureStrokeCoverage(clearPhotoshopForeignPaint(paintedCoverage(canvas), W, H, foreign), W, H) };
  } finally {
    surface.dispose();
  }
}

/** `brush` painted as `target` was, at `diameter`, its images from `packUrls`: its measure, and the painting as a PNG data URL when asked for. */
const paintBrushFidelity = (brush: StampBrush, target: BrushFidelityTarget, diameter: number, withPng: boolean, packUrls: StampPaintPackUrls) =>
  paintAndMeasure(brushFidelityPainting(brush, target, diameter), brushFidelityForeignPaint(target), withPng, packUrls);

const HEADER = 98;

/**
 * One row of the sheet: a header of `lines` (the first bold), then the target as black ink on white at the left,
 * labelled by what it is, and ours at the right, each the preview's size. Returns a PNG data URL.
 */
async function drawStampBrushSheetRow({ target, ours, lines, grade }: { target?: { src: string; label: string }; ours: string; lines: string[]; grade?: StrokeFidelityGrade }): Promise<string> {
  const canvas = Object.assign(document.createElement('canvas'), { width: W * 2, height: HEADER + H });
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = grade ? { close: '#d8f0d8', rough: '#f6ecc8', off: '#f4d4d4' }[grade] : '#eeeeee';
  context.fillRect(0, 0, canvas.width, HEADER);
  context.fillStyle = '#111111';
  lines.forEach((line, i) => {
    context.font = i === 0 ? 'bold 22px -apple-system, Helvetica, sans-serif' : '17px -apple-system, Helvetica, sans-serif';
    context.fillText(line, 12, 26 + i * 22, canvas.width - 24);
  });
  if (target) {
    // Paint on transparency, turned to black ink so it reads as ours does.
    const ink = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d')!;
    ink.drawImage(await loadImage(target.src), 0, 0, W, H);
    ink.globalCompositeOperation = 'source-in';
    ink.fillStyle = '#000000';
    ink.fillRect(0, 0, W, H);
    context.drawImage(ink.canvas, 0, HEADER);
  }
  context.drawImage(await loadImage(ours), W, HEADER);
  context.fillStyle = '#999999';
  context.fillRect(W - 1, HEADER, 2, H);
  context.font = '15px -apple-system, Helvetica, sans-serif';
  if (target) context.fillText(target.label, 12, HEADER + H - 10);
  context.fillText('studio', W + 12, HEADER + H - 10);
  return canvas.toDataURL('image/png');
}

Object.assign(globalThis, { measureStrokeTarget, paintBrushFidelity, drawStampBrushSheetRow });
