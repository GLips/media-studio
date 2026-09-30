// brush-fidelity-score.ts: the one way a brush is scored against its target, for the sheet, the reading fit and the
// diagnostic alike. The brush is painted by the studio's GPU renderer on the fidelity page (brush-fidelity-page.ts) as
// its target was, and both are measured and compared (stroke-measure.ts).

import { fileURLToPath } from 'node:url';
import { withBrowserModulePage, type BrowserModuleCall } from '#lib/output/render/engine/browser-module-page.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import {
  BRUSH_FIDELITY_NOTHING_PAINTED, brushFidelityDiameter, brushFidelityFitsDiameter, type BrushFidelityTarget,
} from '../models/brush-fidelity-target.ts';
import type { BrushFidelityOutcome } from '../models/brush-fidelity-report.ts';
import { compareStrokeProfiles, type StrokeCoverageProfile, type StrokeProfileComparison } from '../models/stroke-measure.ts';
import type { BrushFidelityPackUrls } from '../models/brush-fidelity-pack-urls.ts';

const FIDELITY_PAGE = fileURLToPath(new URL('../studio/brush-fidelity-page.ts', import.meta.url));
/** Rounds of fitting the diameter to the preview's thickness; thickness follows diameter closely, so two land within a few percent. */
const DIAMETER_FITS = 3;

/** The fidelity page, run with the styles folder served at /files/. */
export const withBrushFidelityPage = <T>(stylesDir: string, use: (call: BrowserModuleCall) => Promise<T>) => withBrowserModulePage({ entry: FIDELITY_PAGE, filesDir: stylesDir }, use);

/** A target's measure from its image (brushFidelityTargetSrc); null when nothing in it counts as stroke. */
export const measureBrushFidelityTarget = (call: BrowserModuleCall, src: string) => call<StrokeCoverageProfile | null>('measureStrokeTarget', src);

/**
 * A brush as scored: the diameter it was painted at, the painting as a PNG data URL when asked for, its measure (null
 * when nothing it painted counts as stroke), and how it fared against its target (BrushFidelityOutcome).
 */
export type BrushFidelityScore = { diameter: number; png?: string } & (
  | { kind: 'scored'; profile: StrokeCoverageProfile; comparison: StrokeProfileComparison; score: number }
  | { kind: 'emptyRender'; profile: null; score: typeof BRUSH_FIDELITY_NOTHING_PAINTED }
  | { kind: 'unmeasurableTarget' | 'unscored'; profile: StrokeCoverageProfile | null }
);

/** The outcome alone, as a report keeps it. */
export function brushFidelityOutcome(scored: BrushFidelityScore): BrushFidelityOutcome {
  switch (scored.kind) {
    case 'scored': return { kind: 'scored', comparison: scored.comparison, score: scored.score };
    case 'emptyRender': return { kind: 'emptyRender', score: scored.score };
    case 'unmeasurableTarget': case 'unscored': return { kind: scored.kind };
  }
}

/**
 * `brush` painted as `target` was, at the diameter whose peak thickness matches `measured` where it's fitted, and scored;
 * its images loaded from `packUrls`, every pack it paints from resolved.
 */
export async function scoreBrushFidelity(
  call: BrowserModuleCall, brush: StampBrush, target: BrushFidelityTarget, measured: StrokeCoverageProfile | null, withPng: boolean, packUrls: BrushFidelityPackUrls,
): Promise<BrushFidelityScore> {
  const paint = (diameter: number) => call<{ png?: string; profile: StrokeCoverageProfile | null }>('paintBrushFidelity', brush, target, diameter, withPng, packUrls);
  let diameter = brushFidelityDiameter(target), painted = await paint(diameter);
  for (let fit = 0; brushFidelityFitsDiameter(target) && measured && painted.profile && fit < DIAMETER_FITS; fit++) {
    const next = Math.min(2000, Math.max(2, diameter * (measured.peakThickness / painted.profile.peakThickness)));
    if (Math.abs(next / diameter - 1) < 0.02) break;
    diameter = next;
    painted = await paint(diameter);
  }
  const { png, profile } = painted, shown = { diameter, ...(png !== undefined && { png }) };
  if (target.kind === 'none') return { ...shown, kind: 'unscored', profile };
  if (!measured) return { ...shown, kind: 'unmeasurableTarget', profile };
  if (!profile) return { ...shown, kind: 'emptyRender', profile, score: BRUSH_FIDELITY_NOTHING_PAINTED };
  const comparison = compareStrokeProfiles(measured, profile);
  return { ...shown, kind: 'scored', profile, comparison, score: comparison.score };
}
