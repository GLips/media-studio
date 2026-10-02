// lens-mode.ts: how a render draws the lens. `fast` draws each frame once: a plane's defocus is a gaussian of its
// circle of confusion, a three.js source's is one per pixel from its depth, and motion is gathered along the frame's
// motion vectors. `reference` averages exposures over the shutter and aperture, each frame drawn as the lens sees it
// at that moment and point: slow, and the truth the fast path is measured against.

export const LENS_MODES = ['fast', 'reference'] as const;

export type LensMode = (typeof LENS_MODES)[number];

/**
 * A reference frame's exposures: a smear up to about 24 px reads as a blur rather than copies; a longer one strobes.
 */
export const LENS_REFERENCE_EXPOSURES = 24;

const isLensMode = (mode: string): mode is LensMode => LENS_MODES.some((known) => known === mode);

/** `mode` as a lens mode, checked: a command's --lens. */
export function lensModeChecked(mode: string): LensMode {
  if (!isLensMode(mode)) throw new Error(`--lens is ${mode}: give ${LENS_MODES.join(' or ')}`);
  return mode;
}
