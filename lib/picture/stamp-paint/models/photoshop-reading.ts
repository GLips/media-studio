// photoshop-reading.ts: the PhotoshopReading (photoshop-brush.ts) every Photoshop pack is read by. These are first
// guesses from Photoshop's dialog and manual, not yet fitted: vid-97 fits them against Photoshop's own renders, as
// procreate-reading.ts was fitted against Procreate's previews, and writes them back here.
import type { PhotoshopReading } from './photoshop-brush.ts';

export const PHOTOSHOP_READING: PhotoshopReading = {
  scatterSpan: 0.5,
  angleJitterSpan: Math.PI,
  hueJitterShare: 0.5,
  grainBrightness: 0.5,
  grainContrast: 2.5,
  grainDepthCurve: 1,
  wetEdgeWidth: 0.06,
  wetEdgeRim: 0.3,
  wetEdgeSharpness: 16,
  wetEdgeBody: 0.5,
  dualScale: 1,
};
