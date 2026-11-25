// subject-check.ts: narrowing a checked subject to what a reader requires of it, so a painter that reads normals
// types them as present rather than testing for them on every sample. defineSubject and checkSubject (subject.ts)
// validate a subject as it is built; this says whether a valid one carries the evidence a reader needs.

import { subjectError, type SubjectDiagnostic, type SubjectResult } from './subject-diagnostic.ts';
import type { SubjectEvidenceKind } from './subject-evidence.ts';
import type { SubjectIds } from './subject-id.ts';
import type { Subject } from './subject.ts';

/** A subject known to carry every evidence bundle in `E`. */
export type SubjectWithEvidence<E extends SubjectEvidenceKind, I extends SubjectIds = SubjectIds> = Subject<I> & { readonly [K in E]-?: NonNullable<Subject<I>[K]> };

const EVIDENCE_FIX: Record<SubjectEvidenceKind, string> = {
  surface: 'build the subject through a projection that samples its surface (subject-three), or paint it with a painter that needs no normals',
  illumination: 'give the subject the light it was seen under, or paint it with a painter that needs no light',
};

const hasEvidence = <E extends SubjectEvidenceKind, I extends SubjectIds>(subject: Subject<I>, kinds: readonly E[]): subject is SubjectWithEvidence<E, I> =>
  kinds.every((kind) => subject[kind] !== undefined);

/** `subject` narrowed to carry each of `kinds`, or a `missing-evidence` error for each it lacks, on behalf of `reader`. */
export function requireSubjectEvidence<E extends SubjectEvidenceKind, I extends SubjectIds>(
  subject: Subject<I>, kinds: readonly E[], reader: string,
): SubjectResult<SubjectWithEvidence<E, I>> {
  if (hasEvidence(subject, kinds)) return { ok: true, value: subject };
  const diagnostics: SubjectDiagnostic[] = kinds.filter((kind) => subject[kind] === undefined).map((kind) =>
    subjectError('missing-evidence', `subject.${kind}`, `${reader} reads ${kind} evidence, which subject '${subject.id}' doesn't carry`, EVIDENCE_FIX[kind]));
  return { ok: false, diagnostics };
}
