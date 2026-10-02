// stamp-lens-source.ts: a plane the stamp renderer doesn't paint but lays among its painted ones through the lens: a
// source rendered for each frame, and for each exposure of a reference frame. three.js is one (paint/three-layers);
// a picture plane (vid-149) is another. The renderer asks each source to render before it draws, one at a time.

import type { LensExposure } from '#lib/picture/lens/models/lens-exposures.ts';

/** The exposure of a reference frame a source renders for: its `index`, its moment `at`, its point on the aperture. */
export type StampLensSourceExposure = { readonly index: number; readonly at: number; readonly aperture: LensExposure['aperture'] };

/**
 * Where a source renders, the same textures every frame. `texture`: rgba16float premultiplied linear colour.
 * `motion`: the lens's motion layer (lens-passes.ts): travel over the shutter, frame px; distance, setting its
 * defocus; cover. Both one layer, TEXTURE_BINDING and COPY_SRC. `at`: the frame px of their first texel, whole and at
 * or before the frame's corner, so a blur reads past its edge.
 */
export type StampLensSourcePicture = { readonly texture: GPUTexture; readonly motion: GPUTexture; readonly at: { readonly x: number; readonly y: number } };

/**
 * A source plane. `render` fills its picture at frame time `t`: through the lens as it moves over the frame's shutter
 * (`exposure` null), or as `exposure` sees it. It resolves with whether anything in it moved; a source that didn't
 * leaves its motion layer still. Warning: settle each render before the next and before the draw that reads it.
 */
export type StampLensSource = {
  readonly picture: StampLensSourcePicture;
  readonly render: (t: number, exposure: StampLensSourceExposure | null) => Promise<{ readonly moved: boolean }>;
};
