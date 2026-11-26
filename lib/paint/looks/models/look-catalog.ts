// look-catalog.ts: the looks a character can be drawn in, as data: each one's palettes and how often it redraws. A
// score names a look and a palette from its catalog; whoever draws the character pairs each look with a renderer
// (a three.js stage, a painted shot, a canvas). The catalog holds no renderer, so plain Node can check a score.

import { checkDrawingRate, type DrawingCadence } from '#lib/timing/drawings/models/drawing-schedule.ts';

/**
 * How a look redraws. `'live'`: a new drawing every video frame, as a toon or a hologram eases. `{ fps: 12 }`: each
 * drawing holds 1/12 s, as a painted look is redrawn on twos at 24, and the character's pose steps with it.
 */
export type LookSampling = 'live' | { readonly fps: number };

/** One look: its palettes by name, the first being the one it takes unless a cue names another. */
export type LookDescription<Palette extends string = string> = {
  readonly palettes: readonly [Palette, ...Palette[]];
  readonly sampling: LookSampling;
};

export type LookCatalog = { readonly [look: string]: LookDescription };

/** The palettes of look `L` in catalog `C`. */
export type LookPaletteOf<C extends LookCatalog, L extends keyof C> = C[L]['palettes'][number];

/** The cadence look `look` redraws at, as a score's drawing schedule takes it: a live one at the video's `videoFps`. */
export const lookCadence = (look: LookDescription, videoFps: number): DrawingCadence =>
  look.sampling === 'live' ? { live: videoFps } : { fps: look.sampling.fps };

/** A catalog, its look and palette names kept literal so a score's cues are checked against them. Each rate is checked as a schedule checks it. */
export const defineLookCatalog = <const C extends LookCatalog>(catalog: C): C => {
  for (const [name, look] of Object.entries(catalog)) {
    if (look.sampling !== 'live') checkDrawingRate(look.sampling.fps, `look ${name}`);
  }
  return catalog;
};
