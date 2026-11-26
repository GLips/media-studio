// subject-showing-only.ts: a subject with all but some of its parts hidden, for paint of one piece of a figure alone:
// a waving hand painted apart from its body, so an effect can read the hand and leave the body be. What shows of each
// kept part is what showed in the whole view, so a part another covered keeps that edge.

import type { SubjectResult } from './subject-diagnostic.ts';
import { subjectAreasUnion } from './subject-area-union.ts';
import { SUBJECT_HIDDEN, type SubjectArea } from './subject-geometry.ts';
import type { PartId, SubjectIds } from './subject-id.ts';
import { resolveSubjectSelector, type SubjectSelector } from './subject-selector.ts';
import type { Subject, SubjectPart } from './subject.ts';

/**
 * `subject` showing only the parts `selectors` reach (a feature's selector reaches its owner part) and their
 * features; every other part, its features and its frames are hidden, and the silhouette is the kept parts' areas.
 * An `unknown-ref` or `unmatched-selector` for a selector that reaches nothing.
 */
export function subjectShowingOnly<I extends SubjectIds>(subject: Subject<I>, selectors: readonly SubjectSelector<I>[]): SubjectResult<Subject<I>> {
  const kept = new Set<PartId>();
  for (const [i, selector] of selectors.entries()) {
    const resolved = resolveSubjectSelector(subject, selector, `selectors[${i}]`);
    if (!resolved.ok) return resolved;
    for (const target of resolved.value.direct) kept.add('owner' in target ? target.owner : target.id);
  }
  const parts = new Map([...subject.parts].map(([id, part]): [PartId, SubjectPart] => [id, kept.has(id) ? part : { ...part, visibility: SUBJECT_HIDDEN }]));
  const features = new Map([...subject.features].map(([id, feature]) => [id, kept.has(feature.owner) ? feature : { ...feature, visibility: SUBJECT_HIDDEN }]));
  const frames = new Map([...subject.frames].map(([id, frame]) => [id, kept.has(frame.owner) ? frame : { ...frame, status: { kind: 'unavailable', reason: `its part '${frame.owner}' is hidden` } as const }]));
  const areas = [...parts.values()].flatMap(({ visibility }): SubjectArea[] => (visibility.kind === 'visible' ? [visibility.geometry] : []));
  const silhouette = areas.length ? subjectAreasUnion([areas[0], ...areas.slice(1)]) : SUBJECT_HIDDEN;
  return { ok: true, value: { ...subject, parts, features, frames, silhouette } };
}
