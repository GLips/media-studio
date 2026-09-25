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
