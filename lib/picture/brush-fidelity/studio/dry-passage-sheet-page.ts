// dry-passage-sheet-page.ts: the dry passage sheet's browser side, run by engine/dry-passage-sheet.ts through
// withBrowserModulePage. It draws each dry passage (models/dry-passages.ts) in one dry style, each as a painting of its
// own on the style's paper, so a passage the renderer refuses leaves the others drawn. Images are served at /files/
// (brush-fidelity-pack-urls.ts).

import { compileStampPaintRecipe } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import { brushFidelityAssetUrl } from '../models/brush-fidelity-pack-urls.ts';
import { DRY_PASSAGE_CELL, DRY_PASSAGES, type DryPassage, type DryPassagePainted, type DryPassageSheetMedium } from '../models/dry-passages.ts';

/** `passage` drawn in one style, or why it couldn't be. None reveals over time, so it's drawn at any scene time. */
async function drawDryPassage(passage: DryPassage, { brushes, paper, mixing, packUrls }: DryPassageSheetMedium): Promise<DryPassagePainted> {
  const { width, height } = DRY_PASSAGE_CELL;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  try {
    const painting = compileStampPaintRecipe(passage.recipe({ brushes, pigments: mixing.pigments }));
    const renderer = await createStampPaintRenderer(canvas, painting, paper, mixing, width, height, (asset) => brushFidelityAssetUrl(packUrls, asset));
    // Copied before the renderer's disposed, which unconfigures its canvas and clears it.
    try {
      await renderer.draw(1);
      copy.getContext('2d')!.drawImage(canvas, 0, 0);
    } finally {
      renderer.dispose();
    }
    return { passage: passage.id, png: copy.toDataURL('image/png') };
  } catch (error) {
    return { passage: passage.id, refused: error instanceof Error ? error.message : String(error) };
  }
}

/** Every passage in one style, one at a time: each holds the GPU for its painting. */
const drawDryPassages = (medium: DryPassageSheetMedium) => DRY_PASSAGES.reduce<Promise<DryPassagePainted[]>>(async (done, passage) => {
  const before = await done;
  return [...before, await drawDryPassage(passage, medium)];
}, Promise.resolve([]));

Object.assign(globalThis, { drawDryPassages });
