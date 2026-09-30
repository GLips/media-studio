// brush-fidelity-score.ts: the one way a brush is scored against its target, for the sheet, the reading fit and the
// diagnostic alike. The brush is painted by the studio's GPU renderer on the fidelity page (brush-fidelity-page.ts) as
// its target was, and both are measured and compared (stroke-measure.ts).

import { fileURLToPath } from 'node:url';
import { withBrowserModulePage, type BrowserModuleCall } from '#lib/output/render/engine/browser-module-page.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import {
  BRUSH_FIDELITY_NOTHING_PAINTED, brushFidelityDiameter, brushFidelityFitsDiameter, type BrushFidelityTarget,
} from '../models/brush-fidelity-target.ts';
import { compareStrokeProfiles, type StrokeCoverageProfile, type StrokeProfileComparison } from '../models/stroke-measure.ts';

const FIDELITY_PAGE = fileURLToPath(new URL('../studio/brush-fidelity-page.ts', import.meta.url));
/** Rounds of fitting the diameter to the preview's thickness; thickness follows diameter closely, so two land within a few percent. */
const DIAMETER_FITS = 3;

/** The fidelity page, run with the styles folder served at /files/. */
export const withBrushFidelityPage = <T>(stylesDir: string, use: (call: BrowserModuleCall) => Promise<T>) => withBrowserModulePage({ entry: FIDELITY_PAGE, filesDir: stylesDir }, use);

/** A target's measure from its image (brushFidelityTargetSrc); null when nothing in it counts as stroke. */
export const measureBrushFidelityTarget = (call: BrowserModuleCall, src: string) => call<StrokeCoverageProfile | null>('measureStrokeTarget', src);

/**
 * A brush as scored: the diameter it was painted at, its measure, the painting as a PNG data URL when asked for, and,
 * against a measured target, the comparison and its score (BRUSH_FIDELITY_NOTHING_PAINTED when it paints nothing).
 */
export type BrushFidelityScore = { diameter: number; png?: string; profile: StrokeCoverageProfile | null; comparison?: StrokeProfileComparison; score?: number };

/** `brush` painted as `target` was, at the diameter whose peak thickness matches `measured` where it's fitted, and scored. */
export async function scoreBrushFidelity(
  call: BrowserModuleCall, brush: StampBrush, target: BrushFidelityTarget, measured: StrokeCoverageProfile | null, withPng: boolean,
): Promise<BrushFidelityScore> {
  const paint = (diameter: number) => call<{ png?: string; profile: StrokeCoverageProfile | null }>('paintBrushFidelity', brush, target, diameter, withPng);
  let diameter = brushFidelityDiameter(target), painted = await paint(diameter);
  for (let fit = 0; brushFidelityFitsDiameter(target) && measured && painted.profile && fit < DIAMETER_FITS; fit++) {
    const next = Math.min(2000, Math.max(2, diameter * (measured.peakThickness / painted.profile.peakThickness)));
    if (Math.abs(next / diameter - 1) < 0.02) break;
    diameter = next;
    painted = await paint(diameter);
  }
  if (!measured) return { diameter, ...painted };
  const comparison = painted.profile ? compareStrokeProfiles(measured, painted.profile) : undefined;
  return { diameter, ...painted, ...(comparison && { comparison }), score: comparison?.score ?? BRUSH_FIDELITY_NOTHING_PAINTED };
}
