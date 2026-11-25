// subject-selector.ts: typed selections of a subject by semantic id (a part, a feature, a feature group, a material
// or a tag), never by index or colour. A selector names an id; resolving it against a subject finds what it reaches,
// or says the id is unknown or matches nothing. A hidden target still matches: it keeps its identity.

import { subjectError, type SubjectResult } from './subject-diagnostic.ts';
import type { SubjectIds } from './subject-id.ts';
import { findSubjectFeature, findSubjectMaterial, findSubjectPart, type Subject, type SubjectFeature, type SubjectPart } from './subject.ts';

export type PartSelector<P extends string = string> = { readonly kind: 'part'; readonly id: P };
export type FeatureSelector<F extends string = string> = { readonly kind: 'feature'; readonly id: F };
export type FeatureGroupSelector<G extends string = string> = { readonly kind: 'feature-group'; readonly id: G };
export type MaterialSelector<M extends string = string> = { readonly kind: 'material'; readonly id: M };
export type TagSelector<T extends string = string> = { readonly kind: 'tag'; readonly id: T };

/** A selection of `I`'s subject. Naming an id the subject wasn't declared with fails to compile. */
export type SubjectSelector<I extends SubjectIds = SubjectIds> =
  | PartSelector<I['part']> | FeatureSelector<I['feature']> | FeatureGroupSelector<I['group']> | MaterialSelector<I['material']> | TagSelector<I['tag']>;

/** What a replacement may take over: geometry with an owner, so parts, features and groups of features. */
export type PaintableSelector<I extends SubjectIds = SubjectIds> = PartSelector<I['part']> | FeatureSelector<I['feature']> | FeatureGroupSelector<I['group']>;

/** Selects one part by id; with a declared subject, an id it lacks fails to compile. A part owns its features. */
export const selectPart = <const P extends string>(id: P): PartSelector<P> => ({ kind: 'part', id });
/** Selects one feature (a line, region or landmark) by id. */
export const selectFeature = <const F extends string>(id: F): FeatureSelector<F> => ({ kind: 'feature', id });
/** Selects every feature in a group, as `face`: what a face replacement takes over. */
export const selectFeatureGroup = <const G extends string>(id: G): FeatureGroupSelector<G> => ({ kind: 'feature-group', id });
/** Selects every part and region wearing a material: for intents and tunes, never a replacement. */
export const selectMaterial = <const M extends string>(id: M): MaterialSelector<M> => ({ kind: 'material', id });
/** Selects every part and feature carrying a tag, as `eye` or `belly`: for intents and tunes. */
export const selectTag = <const T extends string>(id: T): TagSelector<T> => ({ kind: 'tag', id });

/** A selector as a diagnostic or report prints it: `part:belly`, `feature-group:face`. */
export const subjectSelectorText = (selector: SubjectSelector) => `${selector.kind}:${selector.id}`;

/** What a selector reaches and an intent or tune applies to: a part or a feature. */
export type SubjectTarget = SubjectPart | SubjectFeature;

/**
 * What a selector reaches. `direct`: the parts and features it names (a material's wearers, a tag's bearers).
 * `owned`: those and every feature of a part among them, which is what a replacement takes over.
 */
export type SubjectSelection = { readonly direct: readonly SubjectTarget[]; readonly owned: readonly SubjectTarget[] };

function directTargets(subject: Subject, selector: SubjectSelector): readonly SubjectTarget[] | undefined {
  const parts = [...subject.parts.values()], features = [...subject.features.values()];
  if (selector.kind === 'part') {
    const part = findSubjectPart(subject, selector.id);
    return part && [part];
  }
  if (selector.kind === 'feature') {
    const feature = findSubjectFeature(subject, selector.id);
    return feature && [feature];
  }
  if (selector.kind === 'material') {
    const material = findSubjectMaterial(subject, selector.id);
    return material && [
      ...parts.filter((part) => part.material === material.id),
      ...features.filter((feature) => feature.kind === 'region' && feature.material === material.id),
    ];
  }
  if (selector.kind === 'feature-group') return features.filter((feature) => feature.groups.some((group) => group === selector.id));
  return [...parts, ...features].filter((target) => target.tags.some((tag) => tag === selector.id));
}

const KNOWN_IDS = {
  part: (subject: Subject) => [...subject.parts.keys()],
  feature: (subject: Subject) => [...subject.features.keys()],
  material: (subject: Subject) => [...subject.materials.keys()],
  'feature-group': (subject: Subject) => [...new Set([...subject.features.values()].flatMap(({ groups }) => groups))],
  tag: (subject: Subject) => [...new Set([...subject.parts.values(), ...subject.features.values()].flatMap(({ tags }) => tags))],
} satisfies Record<SubjectSelector['kind'], (subject: Subject) => readonly string[]>;

/** What `selector` reaches in `subject`, or an `unknown-ref` (its id names nothing) or `unmatched-selector` (it reaches nothing). */
export function resolveSubjectSelector(subject: Subject, selector: SubjectSelector, address: string): SubjectResult<SubjectSelection> {
  const direct = directTargets(subject, selector);
  if (!direct) {
    return { ok: false, diagnostics: [subjectError('unknown-ref', address, `subject '${subject.id}' has no ${selector.kind} '${selector.id}'`, `select one of its ${selector.kind}s: ${KNOWN_IDS[selector.kind](subject).join(', ') || 'none'}`)] };
  }
  if (!direct.length) {
    return { ok: false, diagnostics: [subjectError('unmatched-selector', address, `${subjectSelectorText(selector)} matches nothing in subject '${subject.id}'`, `select one it has (${KNOWN_IDS[selector.kind](subject).join(', ') || 'none'}), or drop the override`)] };
  }
  const parts = new Set(direct.flatMap((target) => ('owner' in target ? [] : [target.id])));
  const owned = [...direct, ...[...subject.features.values()].filter((feature) => parts.has(feature.owner) && !direct.includes(feature))];
  return { ok: true, value: { direct, owned } };
}

/** Whether a selection's visible share is empty: everything it reaches is hidden in this view. */
export const isSubjectSelectionHidden = ({ owned }: SubjectSelection) => owned.every((target) => target.visibility.kind === 'hidden');
