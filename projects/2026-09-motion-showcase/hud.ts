// The HUD every bar is drawn under (reel.tsx), as its text and geometry: where its parts sit on a frame, for a bar
// judging its ground and a scene model's pieces keeping clear of it. Pure, so a model reads it with no render.

import { FPS } from '#models/frame/frame.ts';
import { reelHudBoxes } from '#models/reel/hud.ts';
import { P } from './look.ts';
import { timeline } from './timeline.ts';

/** The HUD's section labels, one per bar. */
const SECTION_TITLES = [
  'SQUASH & STRETCH', 'KINETIC TYPE', 'DEPTH / UI', 'INK × 174', 'FILTER', 'TYPE AS TEXTURE', '3D / DEPTH OF FIELD', 'ODOMETER',
  'EDIT / RHYTHM',
] as const;

/** The HUD as every bar wears it, but for its tones and plates: what tools/hud-legibility.ts renders alone. */
export const SHOWCASE_HUD = {
  size: 20, title: 'PAINFUL PLEASURES', subtitle: 'THE NEW BUY BOX', readout: '120 BPM   30 FPS   1920×1080',
  // The first label decodes with the rest of the HUD at boot, not on bar 1's downbeat, so the pickup's HUD is whole.
  sections: SECTION_TITLES.map((title, i) => ({ at: timeline.scenes[i].from / FPS, title })),
  palette: { ink: P.ink, paper: P.cream, accent: P.red },
  beatOf: (t: number) => timeline.beatAtFrame(t * FPS),
  duration: timeline.end / FPS,
};

/** Each HUD part's box on video frame `f`: what a scene model's pieces keep clear of. */
export const showcaseHudBoxesAt = (f: number) => reelHudBoxes(SHOWCASE_HUD, f / FPS);
