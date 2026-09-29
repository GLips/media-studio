// stamp-brush-sheet-page.ts: the brush fidelity sheet's browser side, run by lib/picture/stamp-paint/engine/stamp-brush-sheet.ts
// through withBrowserModulePage. It paints a brush along Procreate's preview stroke with the studio's GPU renderer,
// measures that and the brush's Procreate preview alike, and lays out a row of the sheet. Every image is one of the
// pack's files, served at /files/.

import type { StampBrush } from '../models/stamp-brush.ts';
import { measureStrokeCoverage, PROCREATE_PREVIEW_SIZE, procreatePreviewPainting, type StrokeCoverageProfile, type StrokeFidelityGrade } from '../models/procreate-preview-stroke.ts';
import { createStampPaintRenderer } from './stamp-paint-renderer.ts';

const { width: W, height: H } = PROCREATE_PREVIEW_SIZE;

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

/** A preview is white paint on transparency, so its alpha is its coverage. */
async function previewCoverage(file: string): Promise<Uint8Array> {
  const image = await loadImage(`/files/${file}`);
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

async function measureProcreatePreview(file: string): Promise<StrokeCoverageProfile | null> {
  return measureStrokeCoverage(await previewCoverage(file), W, H);
}

/** `brush` as Procreate previews it, at `diameter`: the painting as a PNG data URL, and its measure. */
async function paintOnProcreatePreviewStroke(brush: StampBrush, diameter: number, shows: 'stroke' | 'stamp'): Promise<{ png: string; profile: StrokeCoverageProfile | null }> {
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const renderer = await createStampPaintRenderer(canvas, procreatePreviewPainting(brush, diameter, shows), { color: '#ffffff' }, W, H, ({ file }) => `/files/${file}`);
  try {
    await renderer.draw(0);
    return { png: canvas.toDataURL('image/png'), profile: measureStrokeCoverage(paintedCoverage(canvas), W, H) };
  } finally {
    renderer.dispose();
  }
}

const HEADER = 98;

/**
 * One row of the sheet: a header of `lines` (the first bold), then the preview as black ink on white at the left and
 * ours at the right, each the preview's size. Returns a PNG data URL.
 */
async function drawStampBrushSheetRow({ previewFile, ours, lines, grade }: { previewFile?: string; ours: string; lines: string[]; grade?: StrokeFidelityGrade }): Promise<string> {
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
  if (previewFile) {
    // White paint on transparency, turned to black ink so it reads as ours does.
    const ink = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d')!;
    ink.drawImage(await loadImage(`/files/${previewFile}`), 0, 0, W, H);
    ink.globalCompositeOperation = 'source-in';
    ink.fillStyle = '#000000';
    ink.fillRect(0, 0, W, H);
    context.drawImage(ink.canvas, 0, HEADER);
  }
  context.drawImage(await loadImage(ours), W, HEADER);
  context.fillStyle = '#999999';
  context.fillRect(W - 1, HEADER, 2, H);
  context.font = '15px -apple-system, Helvetica, sans-serif';
  context.fillText('Procreate preview', 12, HEADER + H - 10);
  context.fillText('studio', W + 12, HEADER + H - 10);
  return canvas.toDataURL('image/png');
}

Object.assign(globalThis, { measureProcreatePreview, paintOnProcreatePreviewStroke, drawStampBrushSheetRow });
