// fonts.ts: the display and mono faces for music-led pieces (teasers, reels) and stills, bundled so every machine renders the
// same letters. Archivo is variable in weight (100–900) and width (62–125%), so type can squeeze, stretch and bolden
// as it moves; JetBrains Mono is for HUD labels and readouts. Both are OFL (fonts/OFL-*.txt).
// Walkthroughs keep FONT, the system face, which reads as the product's own UI. A brand kit's faces load here too.

import { loadFont } from '@remotion/fonts';
import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import archivo from './fonts/Archivo.ttf';
import jetbrainsMono from './fonts/JetBrainsMono.ttf';
import { FONT } from './frame.ts';

/** A font file for loadStudioFaces: loadFont's fields, the URL a bundle import. */
export type StudioFontFile = { family: string; url: string; weight: string; style?: 'normal' | 'italic'; stretch?: string };

// Loaded once per page, at import: loadFont holds the render until each face is ready. A brand kit's faces join as
// its module loads (lib/studio/brand.tsx), which is before anything renders.
const loads: Promise<unknown>[] = [];
let settledLoads = 0;

/** Loads faces into the page. The studio's fonts gate (useStudioFontsReady, whenStudioFontsLoaded) waits for them too. */
export function loadStudioFaces(files: readonly StudioFontFile[]) {
  for (const { url, ...face } of files) {
    const format = url.endsWith('.otf') ? 'opentype' : url.endsWith('.woff2') ? 'woff2' : url.endsWith('.woff') ? 'woff' : 'truetype';
    loads.push(loadFont({ ...face, url, format }).then(() => { settledLoads++; }));
  }
}

loadStudioFaces([
  { family: 'Archivo', url: archivo, weight: '100 900', stretch: '62% 125%' },
  { family: 'JetBrains Mono', url: jetbrainsMono, weight: '100 800' },
]);

/**
 * Settles when every loaded face is in `document.fonts`. `document.fonts.ready` can settle before that: loadFont adds a
 * face only once it has loaded, so text measured in the meantime has the fallback face's widths.
 */
export async function whenStudioFontsLoaded(): Promise<void> {
  // Again if a face joined while waiting.
  for (let n = -1; n !== loads.length;) {
    n = loads.length;
    await Promise.all(loads);
  }
}
/** Whether every face has loaded, for a check that can't wait. */
export const areStudioFontsLoaded = () => settledLoads === loads.length;

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
    whenStudioFontsLoaded().then(() => {
      if (!open) return;
      flushSync(() => setReady(true));
      release();
    });
    return release;
  }, [needed, ready, delayRender, continueRender]);
  return ready || !needed;
}

/**
 * A face as FitText and a brand kit name it: its CSS family list, and the range of its width axis when it has one,
 * which FitText narrows within. Without one, FitText only shrinks.
 */
export type StudioFace = { family: string; stretch?: readonly [number, number] };

/** Heavy display type. Set `fontStretch` (62–125%) and `fontWeight` (100–900) freely: both are continuous. */
export const DISPLAY_FONT = `"Archivo", ${FONT}`;
/** Archivo as a StudioFace: FitText's face unless it's given another. */
export const ARCHIVO_FACE: StudioFace = { family: DISPLAY_FONT, stretch: [62, 125] };
/** HUD labels, timecodes, readouts, typed queries. */
export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';
/** JetBrains Mono's cap height in em (730/1000): the font size for caps `cap` px tall is cap / MONO_CAP_EM. */
export const MONO_CAP_EM = 0.73;
/** JetBrains Mono's advance in em (600/1000), every glyph's: a line of n characters is n × 0.6 em wide. */
export const MONO_ADVANCE_EM = 0.6;
