// photoshop-reading.ts: the PhotoshopReading (photoshop-brush.ts) every Photoshop pack is read by: what vid-97's probes
// couldn't pin exactly. scatterSpan is measured (both-axes scatter at 100% reaches half a diameter) and dualScale holds
// against every dual probe; `npm run brushes:diagnose` found the held-out brushes best at both. angleJitterSpan and
// hueJitterShare are Photoshop's dialog read literally: no probe varies them, and the sheet can't tell angle jitter's
// candidates apart (a coverage sheet can't see hue at all).
import type { PhotoshopReading } from './photoshop-brush.ts';

export const PHOTOSHOP_READING: PhotoshopReading = {
  scatterSpan: 0.5,
  angleJitterSpan: Math.PI,
  hueJitterShare: 0.5,
  dualScale: 1,
};
