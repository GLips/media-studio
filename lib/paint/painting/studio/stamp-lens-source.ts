// stamp-lens-source.ts: a plane the stamp renderer doesn't paint but lays among its painted ones through the lens: a
// source rendered for each frame, and for each exposure of a reference frame. A three source (paint/three-layers)
// renders through the camera, so the lens only defocuses it. A picture source renders its plane's picture in the
// stage's texels, as a painted plane's is, and the renderer lays it where the camera puts the plane. The renderer
// asks each source to render before it draws, one at a time.

import type { LensExposure } from '#lib/picture/lens/models/lens-exposures.ts';
import type { StampStageTexels } from '../models/stamp-stage.ts';

/** The exposure of a reference frame a source renders for: its `index`, its moment `at`, its point on the aperture. */
export type StampLensSourceExposure = { readonly index: number; readonly at: number; readonly aperture: LensExposure['aperture'] };

/** The exposure a source renders a paint frame for: its `exposure`'s, or none for a frame of one. */
export const stampLensSourceExposureOf = (exposure: StampLensSourceExposure | undefined): StampLensSourceExposure | null =>
  (exposure ? { index: exposure.index, at: exposure.at, aperture: exposure.aperture } : null);

/**
 * Where a three source renders, the same textures every frame. `texture`: rgba16float premultiplied linear colour.
 * `motion`: the lens's motion layer (lens-passes.ts): travel over the shutter, frame px; distance, setting defocus;
 * cover. Both one layer, TEXTURE_BINDING and COPY_SRC. `at`: their first texel's frame px, whole, at or before the
 * frame's corner, so a blur reads past its edge.
 */
export type StampLensSourcePicture = { readonly texture: GPUTexture; readonly motion: GPUTexture; readonly at: { readonly x: number; readonly y: number } };

/**
 * A picture source's picture: `texture`, rgba16float premultiplied linear colour, one layer, TEXTURE_BINDING, its first
 * texel at `box`'s corner, at least `box`'s size and clear past it; `box`, where its texels lie on the stage. The
 * source's own, read until the draw is submitted.
 */
export type StampLensPicture = { readonly texture: GPUTexture; readonly box: StampStageTexels };

/**
 * A three source. `render` fills its picture at frame time `t`: through the lens as it moves over the frame's shutter
 * (`exposure` null), or as `exposure` sees it. It resolves with whether anything in it moved; a source that didn't
 * leaves its motion layer still.
 */
export type StampThreeLensSource = {
  readonly kind: 'three';
  readonly picture: StampLensSourcePicture;
  readonly render: (t: number, exposure: StampLensSourceExposure | null) => Promise<{ readonly moved: boolean }>;
};

/**
 * A picture source. `render` resolves with its plane's picture at frame time `t`, or at `exposure`'s moment within
 * that frame, or null for nothing to show. Negative space: it gives no motion of its own, so a fast frame blurs it
 * only as its plane moves; a reference frame renders it at each exposure's moment.
 */
export type StampPictureLensSource = {
  readonly kind: 'picture';
  readonly render: (t: number, exposure: StampLensSourceExposure | null) => Promise<StampLensPicture | null>;
};

/** A source plane's source. Warning: settle each render before the next and before the draw that reads it. */
export type StampLensSource = StampThreeLensSource | StampPictureLensSource;
