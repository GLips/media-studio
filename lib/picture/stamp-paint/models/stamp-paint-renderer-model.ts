// stamp-paint-renderer-model.ts: the stamp renderer's open modelling choices (studio/stamp-paint-renderer.ts), where
// how Procreate paints is still an open question. Each is a switch between the candidates, to be settled by captures
// of Procreate, not fitted; the default is the one the pack's previews have been read with.

export type StampPaintRendererModel = {
  /**
   * Where paint mixes: `srgb` on the gamma-encoded values colours are written in, as an sRGB layer stack does;
   * `linear` in linear light, each colour decoded before it mixes and the painting encoded as it's shown.
   */
  compositing: 'srgb' | 'linear';
};

export const STAMP_PAINT_RENDERER_MODEL: StampPaintRendererModel = { compositing: 'srgb' };
