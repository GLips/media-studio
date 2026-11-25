// subject.ts: what a subject is and what of it shows, never how it is painted. Parts carry semantic tags and a
// material; features (lines, regions, landmarks) belong to a part and may join groups such as `face`; materials hold
// the local colour; frames place local coordinates. A projection (a mesh, a primitive figure) or an author builds one
// with defineSubject, which refuses what the types can't rule out: unknown refs, duplicate ids, bad geometry.
//
// The role enum it replaces split three ways: anatomy became tags and groups, facts of the view (hidden, far side)
// come from projection, and artistic choices belong to the painter and to intent.

import { subjectDiagnosticErrors, SubjectDiagnosticError, subjectError, type SubjectDiagnostic, type SubjectResult } from './subject-diagnostic.ts';
import { illuminationEvidenceProblems, surfaceEvidenceProblems, type IlluminationEvidence, type SurfaceEvidence } from './subject-evidence.ts';
import { subjectFrameFromLandmarks, subjectFrameStatusOf, type SubjectFrame, type SubjectFrameSource } from './subject-frame.ts';
import {
  subjectAreaProblems, subjectLandmarkProblems, subjectPathProblems, subjectVisibilityProblems,
  type SubjectArea, type SubjectLandmarkPoint, type SubjectPath, type Visibility,
} from './subject-geometry.ts';
import {
  isSubjectIdText, subjectIdFromChecked, subjectIdGrammarMessage,
  type FeatureGroupId, type FeatureId, type FrameId, type MaterialId, type PartId, type SubjectId, type SubjectIdKind, type SubjectIdOf, type SubjectIds, type SubjectTag,
} from './subject-id.ts';

/** A colour as `#rrggbb`, the form a painting document writes. */
export type SubjectHex = `#${string}`;

export type PartRef = { readonly kind: 'part'; readonly id: PartId };
export type FeatureRef = { readonly kind: 'feature'; readonly id: FeatureId };
export type MaterialRef = { readonly kind: 'material'; readonly id: MaterialId };
export type SubjectRef = PartRef | FeatureRef | MaterialRef;
/** What paint is laid for: a part or a feature. A material is painted through the parts that wear it. */
export type PaintableRef = PartRef | FeatureRef;

/** A ref as one string, `part:belly`: a map key, a diagnostic's address and a segment of generated keys. */
export const subjectRefKey = (ref: SubjectRef) => `${ref.kind}:${ref.id}`;

/**
 * `preserveLocalColor`: the colour is a brand's, laid at full strength in every style, never muted or thinned into a
 * painter's colour treatment, while texture, light and edges stay the painter's.
 */
export type SubjectMaterial = { readonly id: MaterialId; readonly ref: MaterialRef; readonly localColor: SubjectHex; readonly preserveLocalColor: boolean };

/** `far`: the projection found the part on the far side of the figure, turned from the viewer. */
export type SubjectPartSide = 'near' | 'far';

export type SubjectPart = {
  readonly id: PartId;
  readonly ref: PartRef;
  readonly tags: readonly SubjectTag[];
  readonly material: MaterialId;
  readonly side: SubjectPartSide;
  readonly visibility: Visibility<SubjectArea>;
};

/** Where a line comes from: drawn by the design, where materials meet, where a form turns past an occluder, or a crease. */
export type SubjectLineKind = 'authored' | 'material-boundary' | 'occluding-edge' | 'crease';

type SubjectFeatureCommon = {
  readonly id: FeatureId;
  readonly ref: FeatureRef;
  readonly owner: PartId;
  readonly groups: readonly FeatureGroupId[];
  readonly tags: readonly SubjectTag[];
};

export type SubjectPathFeature = SubjectFeatureCommon & { readonly kind: 'path'; readonly line: SubjectLineKind; readonly visibility: Visibility<SubjectPath> };
/** A region on its owner part, such as a pupil or a mouth. `material` when it wears its own; its owner's otherwise. */
export type SubjectRegionFeature = SubjectFeatureCommon & { readonly kind: 'region'; readonly material?: MaterialId; readonly visibility: Visibility<SubjectArea> };
export type SubjectLandmarkFeature = SubjectFeatureCommon & { readonly kind: 'landmark'; readonly visibility: Visibility<SubjectLandmarkPoint> };
export type SubjectFeature = SubjectPathFeature | SubjectRegionFeature | SubjectLandmarkFeature;

declare const subjectDeclaredIds: unique symbol;

/**
 * A subject in one view. Maps keep declaration order. `silhouette` is everything visible as one area, hidden when no
 * part shows. `I` holds the literal ids it was declared with (type-level only), so overrides naming others don't compile.
 */
export type Subject<I extends SubjectIds = SubjectIds> = {
  readonly id: SubjectId;
  readonly parts: ReadonlyMap<PartId, SubjectPart>;
  readonly features: ReadonlyMap<FeatureId, SubjectFeature>;
  readonly materials: ReadonlyMap<MaterialId, SubjectMaterial>;
  readonly frames: ReadonlyMap<FrameId, SubjectFrame>;
  readonly silhouette: Visibility<SubjectArea>;
  readonly surface?: SurfaceEvidence;
  readonly illumination?: IlluminationEvidence;
  readonly [subjectDeclaredIds]?: I;
};

export type SubjectMaterialInput<M extends string> = { readonly id: M; readonly localColor: SubjectHex; readonly preserveLocalColor?: boolean };

export type SubjectPartInput<P extends string, M extends string, T extends string> = {
  readonly id: P;
  readonly material: M;
  readonly tags?: readonly T[];
  readonly side?: SubjectPartSide;
  readonly visibility: Visibility<SubjectArea>;
};

type SubjectFeatureInputCommon<F extends string, P extends string, G extends string, T extends string> = {
  readonly id: F;
  readonly owner: P;
  readonly groups?: readonly G[];
  readonly tags?: readonly T[];
};

export type SubjectFeatureInput<F extends string, P extends string, M extends string, G extends string, T extends string> =
  | (SubjectFeatureInputCommon<F, P, G, T> & { readonly kind: 'path'; readonly line: SubjectLineKind; readonly visibility: Visibility<SubjectPath> })
  | (SubjectFeatureInputCommon<F, P, G, T> & { readonly kind: 'region'; readonly material?: M; readonly visibility: Visibility<SubjectArea> })
  | (SubjectFeatureInputCommon<F, P, G, T> & { readonly kind: 'landmark'; readonly visibility: Visibility<SubjectLandmarkPoint> });

export type SubjectFrameInput<R extends string, P extends string, F extends string> = { readonly id: R; readonly owner: P; readonly from: SubjectFrameSource<F> };

/** What defineSubject takes. Refs (a part's material, a feature's owner) must name ids declared alongside. */
export type SubjectInput<P extends string, M extends string, F extends string, R extends string, G extends string, T extends string> = {
  readonly id: string;
  readonly materials: readonly SubjectMaterialInput<M>[];
  readonly parts: readonly SubjectPartInput<P, NoInfer<M>, T>[];
  readonly features?: readonly SubjectFeatureInput<F, NoInfer<P>, NoInfer<M>, G, T>[];
  readonly frames?: readonly SubjectFrameInput<R, NoInfer<P>, NoInfer<F>>[];
  readonly silhouette: Visibility<SubjectArea>;
  readonly surface?: SurfaceEvidence;
  readonly illumination?: IlluminationEvidence;
};

type DeclaredIds<P extends string, M extends string, F extends string, R extends string, G extends string, T extends string> =
  { readonly part: P; readonly material: M; readonly feature: F; readonly frame: R; readonly group: G; readonly tag: T };

const isSubjectHex = (text: string) => /^#[0-9a-f]{6}$/i.test(text);

/** Branded ids for `texts`, with a diagnostic for each bad or repeated one. */
function checkedIds<K extends SubjectIdKind>(kind: K, texts: readonly string[], address: (i: number) => string, problems: SubjectDiagnostic[]): SubjectIdOf<K>[] {
  const seen = new Set<string>();
  texts.forEach((text, i) => {
    if (!isSubjectIdText(text)) problems.push(subjectError('invalid-id', address(i), subjectIdGrammarMessage(text), 'rename it in kebab-case, as `left-eye`'));
    else if (seen.has(text)) problems.push(subjectError('duplicate-id', address(i), `'${text}' is declared twice`, 'give each its own id; a piece split off by occlusion is a ring of the same area, not a new part'));
    seen.add(text);
  });
  return texts.map((text) => subjectIdFromChecked(kind, text));
}

/** Entries by id, a repeated id (already reported) keeping its first declaration so later checks see one of each. */
function firstOfEachId<K, V>(entries: readonly (readonly [K, V])[]): Map<K, V> {
  const map = new Map<K, V>();
  for (const [key, value] of entries) if (!map.has(key)) map.set(key, value);
  return map;
}

/** `labels` (tags or groups) as ids, a bad one reported at `address`. */
function checkedLabels<K extends 'tag' | 'feature-group'>(kind: K, labels: readonly string[] | undefined, address: string, problems: SubjectDiagnostic[]): SubjectIdOf<K>[] {
  const unique = [...new Set(labels ?? [])];
  for (const label of unique) if (!isSubjectIdText(label)) problems.push(subjectError('invalid-id', address, subjectIdGrammarMessage(label), 'rename it in kebab-case'));
  return unique.map((label) => subjectIdFromChecked(kind, label));
}

/** The subject `input` declares, or every problem found in it. */
export function checkSubject<P extends string, M extends string, F extends string, R extends string, G extends string, T extends string>(
  input: SubjectInput<P, M, F, R, G, T>,
): SubjectResult<Subject<DeclaredIds<P, M, F, R, G, T>>> {
  const problems: SubjectDiagnostic[] = [];
  const featureInputs = input.features ?? [], frameInputs = input.frames ?? [];
  if (!isSubjectIdText(input.id)) problems.push(subjectError('invalid-id', 'subject', subjectIdGrammarMessage(input.id), 'rename it in kebab-case'));
  const subjectId = subjectIdFromChecked('subject', input.id);

  const materialIds = checkedIds('material', input.materials.map(({ id }) => id), (i) => `materials[${i}]`, problems);
  const materials = firstOfEachId(input.materials.map((material, i): [MaterialId, SubjectMaterial] => {
    if (!isSubjectHex(material.localColor)) problems.push(subjectError('invalid-geometry', `material:${material.id}.localColor`, `'${material.localColor}' isn't a #rrggbb colour`, 'write it as #rrggbb'));
    const id = materialIds[i];
    return [id, { id, ref: { kind: 'material', id }, localColor: material.localColor, preserveLocalColor: material.preserveLocalColor ?? false }];
  }));
  const knownMaterial = (id: string, address: string) => {
    if (!materials.has(subjectIdFromChecked('material', id))) problems.push(subjectError('unknown-ref', address, `no material '${id}'`, `declare it in materials, or name one of: ${[...materials.keys()].join(', ')}`));
  };

  const partIds = checkedIds('part', input.parts.map(({ id }) => id), (i) => `parts[${i}]`, problems);
  const parts = firstOfEachId(input.parts.map((part, i): [PartId, SubjectPart] => {
    const id = partIds[i], address = `part:${part.id}`;
    knownMaterial(part.material, `${address}.material`);
    problems.push(...subjectVisibilityProblems(part.visibility, address, subjectAreaProblems));
    return [id, {
      id, ref: { kind: 'part', id }, tags: checkedLabels('tag', part.tags, `${address}.tags`, problems),
      material: subjectIdFromChecked('material', part.material), side: part.side ?? 'near', visibility: part.visibility,
    }];
  }));
  const ownerOf = (owner: string, address: string) => {
    const found = parts.get(subjectIdFromChecked('part', owner));
    if (!found) problems.push(subjectError('unknown-ref', `${address}.owner`, `no part '${owner}'`, `own it by one of: ${[...parts.keys()].join(', ')}`));
    return found;
  };

  const featureIds = checkedIds('feature', featureInputs.map(({ id }) => id), (i) => `features[${i}]`, problems);
  const features = firstOfEachId(featureInputs.map((feature, i): [FeatureId, SubjectFeature] => {
    const id = featureIds[i], address = `feature:${feature.id}`;
    const owner = ownerOf(feature.owner, address);
    if (owner?.visibility.kind === 'hidden' && feature.visibility.kind === 'visible') {
      problems.push(subjectError('invalid-ownership', address, `it is visible while its owner part '${feature.owner}' is hidden`, 'hide the feature with its part, or own it by the part it shows on'));
    }
    const common: SubjectFeatureCommon = {
      id, ref: { kind: 'feature', id }, owner: subjectIdFromChecked('part', feature.owner),
      groups: checkedLabels('feature-group', feature.groups, `${address}.groups`, problems), tags: checkedLabels('tag', feature.tags, `${address}.tags`, problems),
    };
    if (feature.kind === 'path') {
      problems.push(...subjectVisibilityProblems(feature.visibility, address, subjectPathProblems));
      return [id, { ...common, kind: 'path', line: feature.line, visibility: feature.visibility }];
    }
    if (feature.kind === 'landmark') {
      problems.push(...subjectVisibilityProblems(feature.visibility, address, subjectLandmarkProblems));
      return [id, { ...common, kind: 'landmark', visibility: feature.visibility }];
    }
    problems.push(...subjectVisibilityProblems(feature.visibility, address, subjectAreaProblems));
    if (feature.material === undefined) return [id, { ...common, kind: 'region', visibility: feature.visibility }];
    knownMaterial(feature.material, `${address}.material`);
    return [id, { ...common, kind: 'region', material: subjectIdFromChecked('material', feature.material), visibility: feature.visibility }];
  }));

  const frameIds = checkedIds('frame', frameInputs.map(({ id }) => id), (i) => `frames[${i}]`, problems);
  const frames = firstOfEachId(frameInputs.map((frame, i): [FrameId, SubjectFrame] => {
    const id = frameIds[i], address = `frame:${frame.id}`;
    const owner = ownerOf(frame.owner, address);
    const frameOwner = subjectIdFromChecked('part', frame.owner);
    if (frame.from.kind === 'projected') {
      const status = frame.from.status.kind === 'available' ? subjectFrameStatusOf(frame.from.status.basis) : frame.from.status;
      return [id, { id, owner: frameOwner, status: owner?.visibility.kind === 'hidden' ? { kind: 'unavailable', reason: `its part '${frame.owner}' is hidden` } : status }];
    }
    const { left, right, down } = frame.from;
    const landmarks = [left, right, ...(down === undefined ? [] : [down])].map((name) => [name, features.get(subjectIdFromChecked('feature', name))] as const);
    const missing = landmarks.filter(([, found]) => found?.kind !== 'landmark');
    for (const [name] of missing) problems.push(subjectError('unknown-ref', `${address}.from`, `no landmark feature '${name}'`, 'name a feature of kind landmark'));
    if (missing.length) return [id, { id, owner: frameOwner, status: { kind: 'unavailable', reason: 'its landmarks are unknown' } }];
    const status = subjectFrameFromLandmarks(frame.from, (name) => {
      const found = features.get(subjectIdFromChecked('feature', name));
      return found?.kind === 'landmark' ? found.visibility : { kind: 'hidden' };
    });
    return [id, { id, owner: frameOwner, status }];
  }));

  problems.push(...subjectVisibilityProblems(input.silhouette, 'subject.silhouette', subjectAreaProblems));
  const anyShown = [...parts.values()].some(({ visibility }) => visibility.kind === 'visible');
  if (anyShown !== (input.silhouette.kind === 'visible')) {
    problems.push(subjectError('invalid-geometry', 'subject.silhouette', anyShown ? 'it is hidden while some part shows' : 'it shows while every part is hidden', 'project the silhouette from the same view as the parts'));
  }
  if (input.surface) problems.push(...surfaceEvidenceProblems(input.surface, 'subject.surface'));
  if (input.illumination) problems.push(...illuminationEvidenceProblems(input.illumination, 'subject.illumination'));

  const errors = subjectDiagnosticErrors(problems);
  if (errors.length) return { ok: false, diagnostics: errors };
  return {
    ok: true,
    value: {
      id: subjectId, parts, features, materials, frames, silhouette: input.silhouette,
      ...(input.surface && { surface: input.surface }), ...(input.illumination && { illumination: input.illumination }),
    },
  };
}

/**
 * The subject `input` declares, its literal ids kept on its type. Throws a SubjectDiagnosticError listing every
 * problem, each with its code, address and fix; checkSubject returns them instead.
 */
export function defineSubject<
  const P extends string, const M extends string, const F extends string = never, const R extends string = never, const G extends string = never, const T extends string = never,
>(input: SubjectInput<P, M, F, R, G, T>): Subject<DeclaredIds<P, M, F, R, G, T>> {
  const checked = checkSubject(input);
  if (!checked.ok) throw new SubjectDiagnosticError(`subject '${input.id}' is invalid`, checked.diagnostics);
  return checked.value;
}

/** The part named `id`, or undefined. Takes a plain string, as a selector or a binding's data holds one. */
export const findSubjectPart = (subject: Subject, id: string) => subject.parts.get(subjectIdFromChecked('part', id));
export const findSubjectFeature = (subject: Subject, id: string) => subject.features.get(subjectIdFromChecked('feature', id));
export const findSubjectMaterial = (subject: Subject, id: string) => subject.materials.get(subjectIdFromChecked('material', id));
export const findSubjectFrame = (subject: Subject, id: string) => subject.frames.get(subjectIdFromChecked('frame', id));

/** The material a part or feature wears: a region feature's own, else its owner part's. */
export function subjectMaterialOf(subject: Subject, target: SubjectPart | SubjectFeature): SubjectMaterial {
  const id = 'owner' in target ? featureMaterialId(subject, target) : target.material;
  const material = id === undefined ? undefined : subject.materials.get(id);
  if (!material) throw new Error(`subject '${subject.id}': ${subjectRefKey(target.ref)} wears no known material, which checkSubject rules out`);
  return material;
}

const featureMaterialId = (subject: Subject, feature: SubjectFeature) =>
  (feature.kind === 'region' && feature.material !== undefined ? feature.material : subject.parts.get(feature.owner)?.material);
