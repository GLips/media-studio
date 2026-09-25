// fonts.ts: the display and mono faces for music-led pieces (teasers, reels), bundled so every machine renders the
// same letters. Archivo is variable in weight (100–900) and width (62–125%), so type can squeeze, stretch and bolden
// as it moves; JetBrains Mono is for HUD labels and readouts. Both are OFL (fonts/OFL-*.txt).
// Walkthroughs keep FONT, the system face, which reads as the product's own UI.

import { loadFont } from '@remotion/fonts';
import archivo from './fonts/Archivo.ttf';
import jetbrainsMono from './fonts/JetBrainsMono.ttf';
import { FONT } from './frame.ts';

// Loaded once per page, at import: loadFont holds the render until the face is ready.
const loads = [
  loadFont({ family: 'Archivo', url: archivo, weight: '100 900', stretch: '62% 125%', format: 'truetype' }),
  loadFont({ family: 'JetBrains Mono', url: jetbrainsMono, weight: '100 800', format: 'truetype' }),
];

let fontsSettled = false;
/**
 * Settles when both faces are in `document.fonts`. `document.fonts.ready` can settle before that: loadFont adds a
 * face only once it has loaded, so text measured in the meantime has the fallback face's widths.
 */
export const studioFontsLoaded: Promise<void> = Promise.all(loads).then(() => { fontsSettled = true; });
/** Whether `studioFontsLoaded` has settled, for a check that can't wait. */
export const areStudioFontsLoaded = () => fontsSettled;

/** Heavy display type. Set `fontStretch` (62–125%) and `fontWeight` (100–900) freely: both are continuous. */
export const DISPLAY_FONT = `"Archivo", ${FONT}`;
/** HUD labels, timecodes, readouts, typed queries. */
export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';
