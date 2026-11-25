// subject-diagnostic.ts: what a subject check finds, as structured issues rather than prose. Each names a code a
// tool can branch on, the address of what it's about (`part:belly`, `feature:mouth.visibility.geometry.rings[1]`,
// `override[2]`), a message and a suggested fix. Subject painting extends the codes with its own
// (subject-painting-report.ts).

export type SubjectDiagnosticSeverity = 'error' | 'warning';

/** The issues a subject's own definition and its selections can have. */
export type SubjectDiagnosticCode =
  | 'invalid-id'
  | 'duplicate-id'
  | 'unknown-ref'
  | 'invalid-ownership'
  | 'invalid-geometry'
  | 'invalid-evidence'
  | 'missing-evidence'
  | 'missing-frame'
  | 'unmatched-selector';

export type SubjectDiagnostic<C extends string = SubjectDiagnosticCode> = {
  readonly code: C;
  readonly severity: SubjectDiagnosticSeverity;
  readonly address: string;
  readonly message: string;
  readonly fix: string;
};

/** A value that passed its checks, or every error found on the way. Warnings travel in the value's own report. */
export type SubjectResult<T, D extends SubjectDiagnostic<string> = SubjectDiagnostic> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly D[] };

export const subjectError = <C extends string>(code: C, address: string, message: string, fix: string): SubjectDiagnostic<C> =>
  ({ code, severity: 'error', address, message, fix });

export const subjectWarning = <C extends string>(code: C, address: string, message: string, fix: string): SubjectDiagnostic<C> =>
  ({ code, severity: 'warning', address, message, fix });

export const subjectDiagnosticErrors = <D extends SubjectDiagnostic<string>>(diagnostics: readonly D[]) =>
  diagnostics.filter(({ severity }) => severity === 'error');

/** Diagnostics one per line, as an error message or a check's output prints them. */
export const formatSubjectDiagnostics = (diagnostics: readonly SubjectDiagnostic<string>[]) =>
  diagnostics.map(({ severity, code, address, message, fix }) => `${severity} ${code} at ${address}: ${message} (fix: ${fix})`).join('\n');

/** A subject or painting refused for the errors it holds, each still structured on `diagnostics`. */
export class SubjectDiagnosticError extends Error {
  readonly diagnostics: readonly SubjectDiagnostic<string>[];
  constructor(what: string, diagnostics: readonly SubjectDiagnostic<string>[]) {
    super(`${what}:\n${formatSubjectDiagnostics(diagnostics)}`);
    this.name = 'SubjectDiagnosticError';
    this.diagnostics = diagnostics;
  }
}
