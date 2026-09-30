// wet-passage-sheet-page.ts: the passage sheet's browser side, run by engine/wet-passage-sheet.ts through
// withBrowserModulePage. It paints each reference passage (models/wet-passages.ts) in one medium, each as a painting of
// its own on the style's paper, so a passage the renderer refuses leaves the others painted. Images are served at
// /files/ (brush-fidelity-pack-urls.ts).

import { compileStampPaintRecipe } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { createStampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import { brushFidelityAssetUrl } from '../models/brush-fidelity-pack-urls.ts';
import { WET_PASSAGE_CELL, WET_PASSAGES, type WetPassage, type WetPassagePainted, type WetPassageSheetMedium } from '../models/wet-passages.ts';

/** The scene time every passage is drawn at: none reveals over time, so any would do. */
const SHOWN = 1;

/** `passage` painted in one medium, or why it couldn't be. */
async function drawWetPassage(passage: WetPassage, { brushes, paper, mixing, packUrls }: WetPassageSheetMedium): Promise<WetPassagePainted> {
  const { width, height } = WET_PASSAGE_CELL;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  try {
    const painting = compileStampPaintRecipe(passage.recipe({ brushes, pigments: mixing.pigments }));
    const renderer = await createStampPaintRenderer(canvas, painting, paper, mixing, width, height, (asset) => brushFidelityAssetUrl(packUrls, asset));
    // Copied before the renderer's disposed, which unconfigures its canvas and clears it.
    try {
      await renderer.draw(SHOWN);
      copy.getContext('2d')!.drawImage(canvas, 0, 0);
    } finally {
      renderer.dispose();
    }
    return { passage: passage.id, png: copy.toDataURL('image/png') };
  } catch (error) {
    // A refusal is the sheet's to show: the passage names what the engine can't paint yet.
    return { passage: passage.id, refused: error instanceof Error ? error.message : String(error) };
  }
}

/** Every passage in one medium, one at a time: each holds the GPU for its painting. */
const drawWetPassages = (medium: WetPassageSheetMedium) => WET_PASSAGES.reduce<Promise<WetPassagePainted[]>>(async (done, passage) => {
  const before = await done;
  return [...before, await drawWetPassage(passage, medium)];
}, Promise.resolve([]));

Object.assign(globalThis, { drawWetPassages });
