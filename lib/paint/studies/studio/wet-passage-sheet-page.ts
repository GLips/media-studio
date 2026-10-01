// wet-passage-sheet-page.ts: the passage sheet's browser side, run by engine/wet-passage-sheet.ts through
// withBrowserModulePage. It paints each reference passage (models/wet-passages.ts) in one medium, each as a painting of
// its own on the style's paper, so a passage the renderer refuses leaves the others painted, and each animation check's
// frames (models/wet-animations.ts). Images are served at /files/ (stamp-paint-pack-urls.ts).

import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { createStampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { stampPaintPackAssetUrl } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
import { WET_ANIMATION_FPS, WET_ANIMATIONS, type WetAnimation, type WetAnimationPainted } from '../models/wet-animations.ts';
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
    const surface = await createStampPaintSurface({ canvas, width, height }, (asset) => stampPaintPackAssetUrl(packUrls, asset));
    // Copied before the surface is disposed, which unconfigures its canvas and clears it.
    try {
      const renderer = await createStampPaintRenderer(surface, painting, paper, mixing);
      await renderer.draw(SHOWN);
      copy.getContext('2d')!.drawImage(canvas, 0, 0);
    } finally {
      surface.dispose();
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

/** `animation`'s frames in one medium, each take on a renderer of its own, or why it couldn't be painted. */
async function drawWetAnimation(animation: WetAnimation, { brushes, paper, mixing, packUrls }: WetPassageSheetMedium): Promise<WetAnimationPainted> {
  const { width, height } = WET_PASSAGE_CELL;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const surface = await createStampPaintSurface({ canvas, width, height }, (asset) => stampPaintPackAssetUrl(packUrls, asset));
  try {
    const takes = animation.takes({ brushes, pigments: mixing.pigments });
    const frames = await takes.reduce<Promise<{ caption: string; png: string }[]>>(async (done, { recipe, frames: shown }) => {
      const before = await done;
      const renderer = await createStampPaintRenderer(surface, compileStampPaintRecipe(recipe), paper, mixing);
      try {
        return [...before, ...await shown.reduce<Promise<{ caption: string; png: string }[]>>(async (drawn, { frame, caption }) => {
          const earlier = await drawn;
          await renderer.draw(frame / WET_ANIMATION_FPS);
          await renderer.finish();
          const copy = Object.assign(document.createElement('canvas'), { width, height });
          copy.getContext('2d')!.drawImage(canvas, 0, 0);
          return [...earlier, { caption, png: copy.toDataURL('image/png') }];
        }, Promise.resolve([]))];
      } finally {
        renderer.dispose();
      }
    }, Promise.resolve([]));
    return { animation: animation.id, frames };
  } catch (error) {
    // As a passage's: a refusal is the sheet's to show.
    return { animation: animation.id, refused: error instanceof Error ? error.message : String(error) };
  } finally {
    surface.dispose();
  }
}

/** Every animation in one medium, one at a time. */
const drawWetAnimations = (medium: WetPassageSheetMedium) => WET_ANIMATIONS.reduce<Promise<WetAnimationPainted[]>>(async (done, animation) => {
  const before = await done;
  return [...before, await drawWetAnimation(animation, medium)];
}, Promise.resolve([]));

Object.assign(globalThis, { drawWetPassages, drawWetAnimations });
