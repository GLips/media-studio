// subject-paint-kit.ts: the small pieces every subject painter builds its contributions from: a keyed layer of one
// wash, option checks that answer as painter reports, and how an edge intent weighs a line.

import type { Application, DirectApplication, LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { ResolvedSubjectIntent, SubjectPainterReport, SubjectPaintKey } from '../subject-painter.ts';
import { SUBJECT_LIGHT_TREATMENTS, type SubjectLightTreatment } from './subject-light-zones.ts';

export const clampSubjectPaint = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Hermite ease of `t` clamped to 0..1: flat at both ends, as a taper or a fade wants. */
export const subjectSmoothStep = (t: number) => {
  const k = clampSubjectPaint(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/** A layer of one wash in its sheet's wet history, keyed `key` and `key.wash`. */
export const wetSubjectLayer = (key: SubjectPaintKey, applications: readonly Application[]): LayerNode => ({ key, washes: [{ key: `${key}.wash`, applications }] });

/** A layer of one wash laid by the dry law, keyed `key` and `key.wash`. */
export const directSubjectLayer = (key: SubjectPaintKey, applications: readonly DirectApplication[]): LayerNode =>
  ({ key, washes: [{ key: `${key}.wash`, wetHistory: false, applications }] });

/** A problem when option `name`'s `value` lies outside `lo..hi`. */
export const subjectOptionRangeProblems = (name: string, value: number, lo: number, hi: number): SubjectPainterReport[] =>
  (value >= lo && value <= hi ? [] : [{ severity: 'error', address: name, message: `${name} is ${value}, outside ${lo}..${hi}`, fix: `give ${name} within ${lo}..${hi}` }]);

/** A problem when option `name` isn't a `#rrggbb` colour. */
export const subjectOptionHexProblems = (name: string, value: string): SubjectPainterReport[] =>
  (/^#[0-9a-f]{6}$/i.test(value) ? [] : [{ severity: 'error', address: name, message: `'${value}' isn't a #rrggbb colour`, fix: 'write it as #rrggbb' }]);

export const subjectLightOptionProblems = (light: SubjectLightTreatment): SubjectPainterReport[] =>
  (SUBJECT_LIGHT_TREATMENTS.includes(light) ? [] : [{ severity: 'error', address: 'light', message: `'${light}' isn't a light treatment`, fix: `use one of ${SUBJECT_LIGHT_TREATMENTS.join(', ')}` }]);

/** How a line's edge intent weighs its width and charge. A lost line isn't drawn. */
export const SUBJECT_LINE_EDGE_WEIGHTS: Record<NonNullable<ResolvedSubjectIntent['edge']>, { readonly width: number; readonly strength: number }> = {
  lost: { width: 0, strength: 0 },
  soft: { width: 0.7, strength: 0.7 },
  firm: { width: 1, strength: 1 },
  hard: { width: 1.4, strength: 1.3 },
};
