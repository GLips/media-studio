// procreate-reading.ts: the fitted ProcreateReading (procreate-brush.ts), written by `npm run brushes:fit`
// (lib/picture/stamp-paint/engine/stamp-brush-fit.ts) against watercolor/vvds. Edit by fitting again, not by hand:
// each value was chosen with the others, against every brush the fit was given.
import type { ProcreateReading } from './procreate-brush.ts';

export const PROCREATE_READING: ProcreateReading = {
  taperShare: 0.4,
  edgeWidth: 0.0589,
  rimSharpness: 16,
  wetRim: 0.1682,
  grainTile: 2.1023,
  grainBrightness: 0.6,
  grainDepthCurve: 1,
  glazeFlowCurve: 0.5,
  blendingFlowCurve: 1.1889,
  dualScale: 2,
  spacingPower: 0.95,
  lateralJitterScale: 0.3536,
  lateralJitterPower: 0.875,
  glazeBuildLight: 1,
  glazeBuildUniform: 0.4375,
  glazeBuildIntense: 0.5,
  glazeBuildHeavy: 0.25,
};
