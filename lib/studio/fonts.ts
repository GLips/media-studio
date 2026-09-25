// fonts.ts: the display and mono faces for music-led pieces (teasers, reels), bundled so every machine renders the
// same letters. Archivo is variable in weight (100–900) and width (62–125%), so type can squeeze, stretch and bolden
// as it moves; JetBrains Mono is for HUD labels and readouts. Both are OFL (fonts/OFL-*.txt).
// Walkthroughs keep FONT, the system face, which reads as the product's own UI.

import { loadFont } from '@remotion/fonts';
import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
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

/**
 * Whether the studio's faces are in, holding the frame until they are: a word measured or painted into a canvas before
 * then keeps the fallback face's widths. Pass `needed` false when nothing this frame sets type.
 */
export function useStudioFontsReady(needed = true): boolean {
  const [ready, setReady] = useState(areStudioFontsLoaded);
  const { delayRender, continueRender } = useDelayRender();
  useLayoutEffect(() => {
    if (!needed || ready) return;
    const handle = delayRender('waiting for the studio fonts');
    let open = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    studioFontsLoaded.then(() => {
      if (!open) return;
      flushSync(() => setReady(true));
      release();
    });
    return release;
  }, [needed, ready, delayRender, continueRender]);
  return ready || !needed;
}

/** Heavy display type. Set `fontStretch` (62–125%) and `fontWeight` (100–900) freely: both are continuous. */
export const DISPLAY_FONT = `"Archivo", ${FONT}`;
/** HUD labels, timecodes, readouts, typed queries. */
export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';
/** JetBrains Mono's cap height in em (730/1000): the font size for caps `cap` px tall is cap / MONO_CAP_EM. */
export const MONO_CAP_EM = 0.73;
/** JetBrains Mono's advance in em (600/1000), every glyph's: a line of n characters is n × 0.6 em wide. */
export const MONO_ADVANCE_EM = 0.6;
