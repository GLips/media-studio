// subject-painting-report.ts: what painting a subject found and did. Problems are structured diagnostics with codes;
// success carries a report of what each override matched, which targets were hidden, the controls applied, the
// replacements drawn and every generated key with the contribution it came from, so a solve failure on a document key
// traces back to the parts it paints. Targets print as ref keys (`part:belly`), so the report reads as JSON.

import type { LayerNode } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { subjectError, type SubjectDiagnostic, type SubjectDiagnosticCode } from '#lib/paint/subject/models/subject-diagnostic.ts';

export type SubjectPaintingDiagnosticCode =
  | SubjectDiagnosticCode
  | 'invalid-painter'
  | 'invalid-options'
  | 'invalid-override'
  | 'unsupported-control'
  | 'unsupported-slot'
  | 'unsupported-intent'
  | 'overlapping-replacements'
  | 'replaced-target-painted'
  | 'hidden-target-painted'
  | 'duplicate-key'
  | 'painter-report'
  | 'solve-failure';

/** A subject painting's problem: any subject diagnostic, or one about the painter, its options, an override, or a key. */
export type SubjectPaintingDiagnostic = SubjectDiagnostic<SubjectPaintingDiagnosticCode>;

/** What one override reached. `hidden`: the targets it matched that don't show in this view, so drew nothing. */
export type SubjectOverrideMatch = {
  readonly override: number;
  readonly kind: 'intent' | 'replace';
  readonly selector: string;
  readonly targets: readonly string[];
  readonly hidden: readonly string[];
};

/** An intent override as applied: the intent fields it set and the painter controls it tuned, on its direct targets. */
export type SubjectAppliedIntent = {
  readonly override: number;
  readonly intents: readonly string[];
  readonly controls: readonly string[];
  readonly targets: readonly string[];
};

/** A replacement: what it took over, in which slot, where it sits (`at`), and the document keys it drew. */
export type SubjectAppliedReplacement = {
  readonly override: number;
  readonly selector: string;
  readonly slot: string;
  readonly at: string;
  readonly targets: readonly string[];
  readonly documentKeys: readonly string[];
};

/** A painter's contribution: its key, slot, targets, and the document keys of its layers. */
export type SubjectContributionEntry = { readonly key: string; readonly slot: string; readonly targets: readonly string[]; readonly documentKeys: readonly string[] };

/** Where a document key came from: a painter contribution by key, or a replacement by override index. */
export type SubjectKeyProvenance = {
  readonly documentKey: string;
  readonly source: { readonly kind: 'painter'; readonly contribution: string } | { readonly kind: 'replacement'; readonly override: number };
  readonly targets: readonly string[];
};

/**
 * What a painting did, targets as `part:belly`: what overrides matched, which were hidden, each target's intent, the
 * replacements, every contribution in order, and `provenance` from each document key back to the contribution and
 * targets that made it; warnings too.
 */
export type SubjectPaintingReport = {
  readonly subject: string;
  readonly painter: string;
  readonly matched: readonly SubjectOverrideMatch[];
  readonly hidden: readonly string[];
  readonly intents: readonly SubjectAppliedIntent[];
  readonly replacements: readonly SubjectAppliedReplacement[];
  readonly contributions: readonly SubjectContributionEntry[];
  readonly provenance: readonly SubjectKeyProvenance[];
  readonly warnings: readonly SubjectPaintingDiagnostic[];
};

/** Every key in `layers`, in tree order: groups', layers', washes' and keyed applications'. */
export function subjectLayerDocumentKeys(layers: readonly LayerNode[]): string[] {
  return layers.flatMap((node): string[] => (node.children
    ? [node.key, ...subjectLayerDocumentKeys(node.children)]
    : [node.key, ...node.washes.flatMap((wash) => [wash.key, ...wash.applications.flatMap(({ key }) => (key === undefined ? [] : [key]))])]));
}

/** The provenance of a document key, or of the wash an unkeyed application (`<wash>.applications[i]`) sits in. */
export function subjectKeyProvenance(report: SubjectPaintingReport, owner: string): SubjectKeyProvenance | undefined {
  const key = owner.replace(/\.applications\[\d+\]$/, '');
  return report.provenance.find(({ documentKey }) => documentKey === key);
}

/**
 * A painting check's problems traced to what the subject painting made: one `solve-failure` per problem whose owner
 * the painting generated, addressed to its contribution or replacement and naming its targets.
 */
export function traceSubjectPaintingProblems(report: SubjectPaintingReport, problems: readonly PaintingProblem[]): SubjectPaintingDiagnostic[] {
  return problems.flatMap((problem) => {
    const provenance = subjectKeyProvenance(report, problem.owner);
    if (!provenance) return [];
    const address = provenance.source.kind === 'painter' ? `contribution:${provenance.source.contribution}` : `override[${provenance.source.override}]`;
    const fix = provenance.source.kind === 'painter'
      ? `the painter '${report.painter}' planned it: retune its targets, or replace them`
      : 'the replacement drew it: fix its paint function';
    return [{ ...subjectError<SubjectPaintingDiagnosticCode>('solve-failure', address, `${problem.path}: ${problem.message} (targets ${provenance.targets.join(', ')})`, fix), severity: problem.severity }];
  });
}
