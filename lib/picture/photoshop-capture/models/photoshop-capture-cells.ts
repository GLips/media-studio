// photoshop-capture-cells.ts: a Photoshop capture sheet read back into its cells (vid-100). A sheet is 16-bit RGBA,
// straight (not premultiplied) alpha, as Photoshop saves a transparent document's PNG; engine/photoshop-capture.ts
// decodes the PNG and hands the pixels here.
//
// Two paintings of a cell are compared on alpha and on premultiplied colour: where alpha is zero Photoshop's stored
// colour means nothing, so straight colour would count differences no one can see.

import type { PhotoshopBox, PhotoshopCellDifference } from './photoshop-capture-plan.ts';

/** 16-bit RGBA pixels, row by row. */
export type PhotoshopPixels = { width: number; height: number; rgba: Uint16Array };

export function cropPhotoshopCell(sheet: PhotoshopPixels, box: PhotoshopBox): PhotoshopPixels {
  const { x, y, width, height } = box;
  if (x < 0 || y < 0 || x + width > sheet.width || y + height > sheet.height) throw new Error(`capture cells: box ${JSON.stringify(box)} is outside the ${sheet.width}×${sheet.height} sheet`);
  const rgba = new Uint16Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * sheet.width + x) * 4;
    rgba.set(sheet.rgba.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, rgba };
}

/** How two paintings of one cell differ: alpha and premultiplied colour in 16-bit levels (0..65535). */
export function comparePhotoshopCells(a: PhotoshopPixels, b: PhotoshopPixels): PhotoshopCellDifference {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`capture cells: ${a.width}×${a.height} against ${b.width}×${b.height}`);
  let maxAlpha = 0, sumAlpha = 0, maxPremultiplied = 0, differing = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    const alphaA = a.rgba[i + 3], alphaB = b.rgba[i + 3];
    const dAlpha = Math.abs(alphaA - alphaB);
    let dColour = 0;
    for (let c = 0; c < 3; c++) dColour = Math.max(dColour, Math.abs((a.rgba[i + c] * alphaA - b.rgba[i + c] * alphaB) / 65535));
    if (dAlpha || dColour >= 0.5) differing++;
    maxAlpha = Math.max(maxAlpha, dAlpha);
    maxPremultiplied = Math.max(maxPremultiplied, dColour);
    sumAlpha += dAlpha;
  }
  return { identical: differing === 0, maxAlpha, meanAlpha: sumAlpha / (a.width * a.height), maxPremultiplied: Math.round(maxPremultiplied), differing };
}
