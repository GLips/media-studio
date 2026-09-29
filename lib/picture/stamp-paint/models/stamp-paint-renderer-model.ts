// stamp-paint-renderer-model.ts: the stamp renderer's open modelling choices (studio/stamp-paint-renderer.ts), where
// how Procreate paints is still an open question. Each is a switch between the candidates, to be settled by captures
// of Procreate, not fitted; the default is the one the pack's previews have been read with.

export type StampPaintRendererModel = {
  /**
   * Where paint mixes: `srgb` on the gamma-encoded values colours are written in, as an sRGB layer stack does;
   * `linear` in linear light, each colour decoded before it mixes and the painting encoded as it's shown.
   */
  compositing: 'srgb' | 'linear';
  /**
   * When a texturized grain (fixed to the canvas) cuts into the paint: `afterBuild`, into the stroke's coverage once
   * its stamps have built up; `perStamp`, into each stamp before it builds, so overlapping stamps deepen the grain's
   * shallows. A rolling grain moves with its stamp, so it always cuts each stamp.
   */
  texturizedGrain: 'afterBuild' | 'perStamp';
};

export const STAMP_PAINT_RENDERER_MODEL: StampPaintRendererModel = { compositing: 'srgb', texturizedGrain: 'afterBuild' };
