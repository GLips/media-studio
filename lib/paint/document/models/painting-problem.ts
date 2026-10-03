// painting-problem.ts: what a check of a painting source finds. Each problem names its owner (a document key, an
// unkeyed application as `<wash>.applications[i]`, `property <name>`, or `document`), the field within it, and the
// footprint it's about, so `studio paint check` and a failing render say where to look, by key and on the paper.

import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { AnyApplication, Wash } from './painting-document.ts';

export type PaintingProblemSeverity = 'error' | 'warning';

/**
 * Whether a list the types promise is one at run time, since a source written in JS may break the promise. Unlike
 * `Array.isArray`, it keeps a readonly list's element type rather than widening it to `any[]`.
 */
export const isPaintingList = <T>(value: readonly T[] | undefined): value is readonly T[] => Array.isArray(value);

/** An application's name in problems: its key, or `<wash>.applications[i]`. */
export const paintingApplicationOwner = (wash: Wash, application: AnyApplication, i: number) => application.key ?? `${wash.key}.applications[${i}]`;

/**
 * One problem. `path` is `<owner>.<field>`, `hill.applications[1].area.region.rings[0]`. `footprint` is the box of the
 * geometry it's about, in document px; none for a property, the document's shape or a key.
 */
export type PaintingProblem = {
  readonly severity: PaintingProblemSeverity;
  readonly owner: string;
  readonly field: string;
  readonly path: string;
  readonly message: string;
  readonly footprint?: StampBox;
};

/** A problem of `owner` at `field` (none: the owner itself), its footprint dropped when it isn't finite. */
export function paintingProblem(
  severity: PaintingProblemSeverity, owner: string, field: string, message: string, footprint?: StampBox | null,
): PaintingProblem {
  const path = field ? `${owner}.${field}` : owner;
  const box = footprint && [footprint.x0, footprint.y0, footprint.x1, footprint.y1].every(Number.isFinite) ? footprint : undefined;
  return { severity, owner, field, path, message, ...(box && { footprint: box }) };
}

export const paintingErrors = (problems: readonly PaintingProblem[]) => problems.filter(({ severity }) => severity === 'error');

/** Problems as a check stage finds them, in the order it finds them. */
export class PaintingProblemList {
  readonly problems: PaintingProblem[] = [];

  error(owner: string, field: string, message: string, footprint?: StampBox | null): void {
    this.problems.push(paintingProblem('error', owner, field, message, footprint));
  }

  warn(owner: string, field: string, message: string, footprint?: StampBox | null): void {
    this.problems.push(paintingProblem('warning', owner, field, message, footprint));
  }

  get hasErrors(): boolean {
    return this.problems.some(({ severity }) => severity === 'error');
  }
}

/** One problem as `studio paint check` prints it: `<path>: <message> [x0,y0 → x1,y1]`, a warning marked so. */
export function paintingProblemText({ severity, path, message, footprint }: PaintingProblem): string {
  const box = footprint ? ` [${Math.floor(footprint.x0)},${Math.floor(footprint.y0)} → ${Math.ceil(footprint.x1)},${Math.ceil(footprint.y1)}]` : '';
  return `${severity === 'warning' ? 'warning: ' : ''}${path}: ${message}${box}`;
}

/** The error a source fails evaluation with: every error it has, one a line, so a render fails with the whole list. */
export function paintingProblemsError(source: string, problems: readonly PaintingProblem[]): Error {
  const errors = paintingErrors(problems);
  const count = errors.length === 1 ? 'a problem' : `${errors.length} problems`;
  return new Error(`painting ${source} has ${count}:\n${errors.map((problem) => `  ${paintingProblemText(problem)}`).join('\n')}`);
}

/** The box holding both, either possibly absent. */
export function paintingBoxUnion(a: StampBox | undefined, b: StampBox | undefined): StampBox | undefined {
  if (!a || !b) return a ?? b;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
