// painted-three-paper.ts: the paper look for three.js sheets, its pure side: the papercraft recipe's numbers and how
// bright its lights are. A sheet's geometry and folds are painted-three-sheet.ts's; this is the material preset on top:
// a print never relit past 1.05, a kraft back, an inked cut edge with a lip toward the light, warm shadows.

import { paintWorldLightDirection } from '#lib/paint/animation/models/paint-camera-world.ts';
import type { PaintLight } from '#lib/paint/painting/models/stamp-form.ts';

/**
 * The papercraft recipe's numbers. Colours are sRGB hex. Widths in screen px. `leak` is per channel the share of the
 * key a shadow keeps (the recipe's day leak #a0602c read as shares), so a shadow warms and never goes black.
 */
export const PAINTED_THREE_PAPER_LOOK = {
  /** Wrap lighting: a face lit by clamp((n·l + wrap) / (1 + wrap)). */
  wrap: 0.3,
  /** The most a face shows of its print: pigment is never relit brighter. */
  printLightMost: 1.05,
  edge: { px: 2, ink: '#3a1e0a', strength: 0.6 },
  /** Its width a share of the edge's, just inside it, on edges facing the light alone. */
  lip: { share: 0.7, colour: '#fff3d8', strength: 0.5 },
  side: { shade: 0.52, cream: '#f2e9da', towardCream: 0.08 },
  kraft: '#e8d3ac',
  /** Darkening within `reach` of the sheet's height from the edge it stands on, toward `tint`. */
  contact: { reach: 0.11, strength: 0.12, tint: '#5a3214' },
  leak: [0.63, 0.38, 0.17],
} as const;

/** Linear rgb shares of the key a shadow keeps, PAINTED_THREE_PAPER_LOOK.leak when left out; black for a key-only view. */
export type PaintedThreePaperLeak = readonly [number, number, number];

/**
 * How bright paper's lights are: `fill` frontal from the camera and `sky` a hemisphere over it, as shares of the key
 * (the recipe's 1 : 0.27 : 0.14). A key-only view sets both 0.
 */
export type PaintedThreePaperLightShares = { readonly fill: number; readonly sky: number };
export const PAINTED_THREE_PAPER_LIGHT_SHARES: PaintedThreePaperLightShares = { fill: 0.27, sky: 0.14 };
/** The sky's ground side, a share of its sky side: a face turned down catches less. */
export const PAINTED_THREE_PAPER_SKY_GROUND = 0.6;

/** A face's light from a light along `cosine` (n·l), wrapped (PAINTED_THREE_PAPER_LOOK.wrap). */
const paintedThreePaperWrapped = (cosine: number) => Math.min(1, Math.max(0, (cosine + PAINTED_THREE_PAPER_LOOK.wrap) / (1 + PAINTED_THREE_PAPER_LOOK.wrap)));

/**
 * The key's, fill's and sky's intensities under `light`, scaled so a face squarely facing the camera, lit by all
 * three, shows its print as painted: what makes "never relit" hold. A face turned toward the key shows more, up to
 * PAINTED_THREE_PAPER_LOOK.printLightMost. Refuses lights that leave a camera-facing face dark.
 */
export function paintedThreePaperLightStrengths(light: PaintLight, { fill, sky }: PaintedThreePaperLightShares): { key: number; fill: number; sky: number } {
  // Facing the camera: the key at its angle to the view, the fill square on, the sky edge-on (half sky, half ground).
  const facing = paintedThreePaperWrapped(paintWorldLightDirection(light).z) + fill + (sky * (1 + PAINTED_THREE_PAPER_SKY_GROUND)) / 2;
  if (!(facing > 0)) throw new Error(`painted three paper: a light at elevation ${light.elevation} with no fill or sky leaves a face toward the camera dark`);
  return { key: 1 / facing, fill: fill / facing, sky: sky / facing };
}
