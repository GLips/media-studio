// brush-fidelity-style.ts: what a style keeps in git about its brushes' fidelity: a note per brush (fidelity.ts) and
// the grades its sheets last gave (fidelity-grades.json).

import type { StrokeFidelityGrade } from './stroke-measure.ts';

/**
 * A style's fidelity.ts, beside its style.ts and kept in git: `export default { … } satisfies StampPaintStyleFidelity`,
 * a note per brush, each pack's brushes by their names in the pack, on how and why it differs from its source's own
 * preview. How far it differs is the sheet's score and grade (fidelity-grades.json), not the note's to say.
 */
export type StampPaintStyleFidelity = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A style's fidelity-grades.json, which `npm run brushes:sheet` writes beside its fidelity.ts. */
export const STAMP_PAINT_FIDELITY_GRADES = 'fidelity-grades.json';

/**
 * Each pack's brushes, by name, with their score on the brush fidelity sheet (0 matches the preview) and the grade it
 * earns (stroke-measure.ts).
 */
export type StampPaintStyleGrades = Record<string, Record<string, { grade: StrokeFidelityGrade; score: number }>>;
