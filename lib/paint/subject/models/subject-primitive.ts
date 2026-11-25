// subject-primitive.ts: a posed primitive figure as a subject. The figure says what its parts are made of; a small
// binding the caller supplies says what they mean: materials, tags, which figure parts are features of another (an eye
// on a head), landmarks at its anchors, and frames. Each view is projected analytically (posedFigureProjection), never
// meshed: areas come from the ray-traced fields, surface evidence from the primitives' own normals.
//
// Ids are the figure's names: a part keeps its figure part's name, so the one name works in a pose, a binding and a
// selector. Every figure part also owns a path feature `<part>-edge`, the lines where it lies in front of another.

import {
  posedFigureProjection, type PaintFigurePose, type PaintFigureView, type PosedPrimitiveFigure,
} from '#lib/paint/animation/models/figure/posed-primitive-figure.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { SubjectDiagnosticError, subjectError, type SubjectDiagnostic } from './subject-diagnostic.ts';
import type { IlluminationEvidence, SurfaceEvidence } from './subject-evidence.ts';
import { subjectFrameStatusOf, type SubjectFrameStatus } from './subject-frame.ts';
import { SUBJECT_HIDDEN, subjectAreaVisibility, subjectPathVisibility, subjectVisible } from './subject-geometry.ts';
import { isSubjectIdText, subjectIdGrammarMessage } from './subject-id.ts';
import { defineSubject, type SubjectFeatureInput, type SubjectMaterialInput, type SubjectPartInput } from './subject.ts';

/** A figure part that stays a part: what it wears (the binding's `material` by default) and what it is. */
export type PrimitivePartBinding<M extends string, T extends string> = { readonly material?: M; readonly tags?: readonly T[] };

/**
 * A figure part that is a region feature of `owner` instead, such as an eye ball on a head. Its area is what of it
 * shows, and its owner's area takes it in, as every subject's region lies on its owner: a painter lays it on the
 * owner's wash or keeps it clear.
 */
export type PrimitiveRegionBinding<O extends string, M extends string, G extends string, T extends string> = {
  readonly owner: O;
  readonly material?: M;
  readonly groups?: readonly G[];
  readonly tags?: readonly T[];
};

/**
 * A landmark at one of the figure's anchors. It shows when its owner part shows and the anchor lies in the near half
 * of whatever is nearest along its line of sight, so set the anchor on or just under the surface it marks.
 */
export type PrimitiveLandmarkBinding<A extends string, O extends string, G extends string, T extends string> = {
  readonly anchor: A;
  readonly owner: O;
  readonly groups?: readonly G[];
  readonly tags?: readonly T[];
};

/**
 * A frame on three of the figure's anchors: local (0, 0) at `origin`, (1, 0) at `x`, (0, 1) at `y`. Choose them so
 * that, seen from the front, x runs right and y down the page. It is unavailable when the view is edge-on to it, or
 * sees it from behind, where its projection comes out mirrored.
 */
export type PrimitiveFrameBinding<O extends string, A extends string> = { readonly owner: O; readonly origin: A; readonly x: A; readonly y: A };

/**
 * What a figure's parts mean. `P` and `A` are the figure's part and anchor names; `R` names the parts listed in
 * `regions`, which become features, so they can't also be listed in `parts` or own anything. Tags and groups are
 * declared once, as materials are, so a misspelt one doesn't compile.
 */
export type PrimitiveSubjectBinding<P extends string, A extends string, M extends string, R extends P, L extends string, F extends string, G extends string, T extends string> = {
  readonly id: string;
  readonly materials: readonly SubjectMaterialInput<M>[];
  /** What a part wears when `parts` gives it no material. */
  readonly material: NoInfer<M>;
  readonly tags?: readonly T[];
  readonly groups?: readonly G[];
  readonly parts?: { readonly [K in Exclude<P, R>]?: PrimitivePartBinding<NoInfer<M>, NoInfer<T>> };
  readonly regions?: { readonly [K in R]: PrimitiveRegionBinding<Exclude<P, R>, NoInfer<M>, NoInfer<G>, NoInfer<T>> };
  readonly landmarks?: { readonly [K in L]: PrimitiveLandmarkBinding<A, Exclude<P, R>, NoInfer<G>, NoInfer<T>> };
  readonly frames?: { readonly [K in F]: PrimitiveFrameBinding<Exclude<P, R>, A> };
};

/** One view of a bound figure: its pose (rest by default), the view, and the light it is seen under, if any. */
export type PrimitiveSubjectView<J extends string, P extends string> = {
  readonly pose?: PaintFigurePose<J, P>;
  readonly view: PaintFigureView;
  readonly illumination?: IlluminationEvidence;
};

/** The id of the path feature holding the lines a figure part draws where it lies in front of another. */
export const primitiveSubjectEdgeId = <P extends string>(part: P): `${P}-edge` => `${part}-edge`;

const entriesOf = <K extends string, V>(record: { readonly [key in K]?: V } | undefined): [K, V][] =>
  // The guard asserts the keys are K, which a record typed by K holds; undefined values are optional entries left out.
  Object.entries(record ?? {}).filter((entry): entry is [K, V] => entry[1] !== undefined);

/** A frame's basis from its anchors as projected, unavailable when edge-on or mirrored (seen from behind). */
function anchorFrameStatus<A extends string>(anchors: Readonly<Record<A, { readonly at: StampPoint }>>, frame: PrimitiveFrameBinding<string, A>): SubjectFrameStatus {
  const origin = anchors[frame.origin].at, x = anchors[frame.x].at, y = anchors[frame.y].at;
  const xAxis = { x: x.x - origin.x, y: x.y - origin.y }, yAxis = { x: y.x - origin.x, y: y.y - origin.y };
  const status = subjectFrameStatusOf({ origin, xAxis, yAxis });
  if (status.kind === 'available' && xAxis.x * yAxis.y - xAxis.y * yAxis.x < 0) return { kind: 'unavailable', reason: 'the view sees it from behind' };
  return status;
}

/** Names the subject takes verbatim that aren't ids, each with its address: caught at binding, not at the first frame. */
function bindingNameProblems(names: readonly [string, string][]): SubjectDiagnostic[] {
  return names.flatMap(([address, name]) => (isSubjectIdText(name) ? [] : [subjectError('invalid-id', address, subjectIdGrammarMessage(name), 'rename it in kebab-case in the figure or binding, as `leg-far`')]));
}

/**
 * Binds `figure` to its meaning, returning the subject of any pose and view. Throws a SubjectDiagnosticError at
 * once for names that aren't ids, and per view for anything else checkSubject refuses, such as a feature showing
 * while its owner is hidden. The subject carries surface evidence always, and illumination when the view gives a light.
 */
export function definePrimitiveSubject<
  J extends string, P extends string, A extends string,
  const M extends string, const R extends P = never, const L extends string = never, const F extends string = never, const G extends string = never, const T extends string = never,
>(figure: PosedPrimitiveFigure<J, P, A>, binding: PrimitiveSubjectBinding<P, A, M, R, L, F, G, T>) {
  // SAFETY: the keys of a Record<P, …> are P.
  const figureParts = Object.keys(figure.parts) as P[];
  const regions = entriesOf<R, PrimitiveRegionBinding<Exclude<P, R>, M, G, T>>(binding.regions);
  const regionNames = new Set<string>(regions.map(([name]) => name));
  const landmarks = entriesOf<L, PrimitiveLandmarkBinding<A, Exclude<P, R>, G, T>>(binding.landmarks);
  const frames = entriesOf<F, PrimitiveFrameBinding<Exclude<P, R>, A>>(binding.frames);
  const problems = bindingNameProblems([
    ...figureParts.map((name): [string, string] => [`figure.parts.${name}`, name]),
    ...landmarks.map(([name]): [string, string] => [`binding.landmarks.${name}`, name]),
    ...frames.map(([name]): [string, string] => [`binding.frames.${name}`, name]),
  ]);
  if (problems.length) throw new SubjectDiagnosticError(`primitive subject '${binding.id}' can't be bound`, problems);
  const partNames = figureParts.filter((name): name is Exclude<P, R> => !regionNames.has(name));
  // Every figure part's lines, a region's owned by the part it is a feature of.
  const edgeOwners: [P, Exclude<P, R>][] = [...partNames.map((name): [P, Exclude<P, R>] => [name, name]), ...regions.map(([name, { owner }]): [P, Exclude<P, R>] => [name, owner])];

  return ({ pose = {}, view, illumination }: PrimitiveSubjectView<J, P>) => {
    const projection = posedFigureProjection(figure, pose, view);
    // Areas tile: a part's meets its neighbours' without crossing, so a painter may lay several as one region.
    const areaOf = (names: readonly P[]) => {
      const { outers, holes } = projection.traceArea(names);
      return subjectAreaVisibility([...outers, ...holes]);
    };
    const partAreaOf = (name: Exclude<P, R>) => areaOf([name, ...regions.flatMap(([region, bound]) => (bound.owner === name ? [region] : []))]);
    const parts = partNames.map((name): SubjectPartInput<Exclude<P, R>, M, T> => {
      const bound: PrimitivePartBinding<M, T> | undefined = binding.parts?.[name];
      return { id: name, material: bound?.material ?? binding.material, tags: bound?.tags ?? [], side: projection.sides[name], visibility: partAreaOf(name) };
    });
    const shows = new Map(parts.map(({ id, visibility }) => [id, visibility.kind === 'visible']));
    const regionFeatures = regions.map(([name, { owner, material, groups = [], tags = [] }]): SubjectFeatureInput<R | L | `${P}-edge`, Exclude<P, R>, M, G, T> => {
      const visibility = areaOf([name]);
      return material === undefined
        ? { kind: 'region', id: name, owner, groups, tags, visibility }
        : { kind: 'region', id: name, owner, material, groups, tags, visibility };
    });
    const edgeFeatures = edgeOwners.map(([name, owner]): SubjectFeatureInput<R | L | `${P}-edge`, Exclude<P, R>, M, G, T> => ({
      kind: 'path', id: primitiveSubjectEdgeId(name), owner, line: 'occluding-edge',
      visibility: subjectPathVisibility(projection.trace.parts[name].lines.map((points) => ({ points, closed: false }))),
    }));
    const landmarkFeatures = landmarks.map(([name, bound]): SubjectFeatureInput<R | L | `${P}-edge`, Exclude<P, R>, M, G, T> => {
      const { at, sight } = projection.anchors[bound.anchor];
      const seen = shows.get(bound.owner) === true && (sight.kind === 'open' || sight.nearSide);
      return { kind: 'landmark', id: name, owner: bound.owner, groups: bound.groups ?? [], tags: bound.tags ?? [], visibility: seen ? subjectVisible({ at }) : SUBJECT_HIDDEN };
    });
    const { sampling, coverage, normals, depth } = projection.surface;
    const surface: SurfaceEvidence = { convention: 'view-x-right-y-down-z-toward-viewer', layout: sampling, coverage, normals, depth };
    return defineSubject({
      id: binding.id,
      materials: binding.materials,
      parts,
      features: [...regionFeatures, ...edgeFeatures, ...landmarkFeatures],
      frames: frames.map(([name, frame]) => ({ id: name, owner: frame.owner, from: { kind: 'projected', status: anchorFrameStatus(projection.anchors, frame) } })),
      silhouette: areaOf(figureParts),
      surface,
      ...(illumination && { illumination }),
    });
  };
}
