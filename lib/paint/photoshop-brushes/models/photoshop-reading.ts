// photoshop-reading.ts: the PhotoshopReading (photoshop-brush.ts) every Photoshop pack is read by: what vid-97's probes
// couldn't pin exactly. scatterSpan is measured (both-axes scatter at 100% reaches half a diameter) and dualScale holds
// against every dual probe; `npm run brushes:diagnose` found the held-out brushes best at both. angleJitterSpan is a
// floor: 25% already turns a stamp anywhere in a half-turn, so 100% reaches at least a whole turn each way.
// hueJitterShare is Photoshop's dialog read literally (a coverage sheet can't see hue).
import type { PhotoshopReading } from './photoshop-brush.ts';

export const PHOTOSHOP_READING: PhotoshopReading = {
  scatterSpan: 0.5,
  angleJitterSpan: 2 * Math.PI,
  hueJitterShare: 0.5,
  dualScale: 1,
};
