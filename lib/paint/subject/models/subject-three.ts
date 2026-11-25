// subject-three.ts: a subject projected from annotated three.js meshes, seen through a ShotCamera. Pure, plain Node:
// it reads the scene and writes nothing to it, computing world matrices itself.
//
// Nothing is inferred. A binding annotates each mesh, or a group for all beneath it: a part's surface, a region
// feature lying on its owner (a decal: it occludes nothing), a path feature drawn along a given centreline, or
// unpainted (an outline hull). Every surface occludes everything behind it, outlines included. A part that declares
// an `outline` gets a path feature tracing each of its meshes' edges where that mesh stands in front of another
// surface, as a toon's inverted hull draws; the hull against the background is the subject's silhouette.

import { BackSide, DoubleSide, Matrix4, Vector3 } from 'three';
import type { BufferGeometry, InstancedMesh, Material, Mesh, Object3D, SkinnedMesh } from 'three';
import { shotCameraAxes, shotCameraFocalPx, shotCameraProject, type ShotCamera, type ShotPoint } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { SubjectDiagnosticError, subjectError, type SubjectDiagnostic, type SubjectDiagnosticCode, type SubjectResult } from './subject-diagnostic.ts';
import type { IlluminationEvidence, SubjectSampleLayout, SubjectVector3, SurfaceEvidence } from './subject-evidence.ts';
import { SUBJECT_HIDDEN, subjectAreaVisibility, subjectPathVisibility, subjectVisible, type SubjectPathRun } from './subject-geometry.ts';
import {
  nearestSubjectRaster, rasterSubjectUnit, subjectMaskSignedDistance, subjectRasterDepthAt, subjectSampleAt, subjectVisibleRuns,
  traceSubjectMaskEdgeRuns, traceSubjectMaskRings, type SubjectRasterTriangles,
} from './subject-three-raster.ts';
import {
  checkSubject, type SubjectFeatureInput, type SubjectFrameInput, type SubjectInput, type SubjectLineKind, type SubjectMaterialInput, type Subject,
} from './subject.ts';

/** What a mesh's surface is: a part (occluding; `outline: false` keeps this mesh out of its part's outline), a decal, or nothing. */
export type SubjectThreeSurfaceAnnotation<P extends string = string, F extends string = string> =
  | { readonly kind: 'part'; readonly part: P; readonly outline?: boolean }
  | { readonly kind: 'region'; readonly feature: F }
  | { readonly kind: 'unpainted' };

/** A line in the annotated object's own space; it shows where no surface stands in front of it. */
export type SubjectThreeCenterline = { readonly points: readonly ShotPoint[]; readonly closed: boolean };

/**
 * What an object is in the subject, for it and everything beneath it until another annotation. `by-material`: one
 * per material slot of a multi-material mesh. `path`: the object draws a line, so its meshes are never surface.
 */
export type SubjectThreeAnnotation<P extends string = string, F extends string = string> =
  | SubjectThreeSurfaceAnnotation<P, F>
  | { readonly kind: 'by-material'; readonly slots: readonly SubjectThreeSurfaceAnnotation<P, F>[] }
  | { readonly kind: 'path'; readonly feature: F; readonly centerline: SubjectThreeCenterline };

/** A part as declared; `outline` names the path feature its meshes' edges trace into. */
export type SubjectThreePartInput<P extends string, M extends string, F extends string, T extends string> = {
  readonly id: P; readonly material: M; readonly tags?: readonly T[]; readonly outline?: F;
};

type FeatureCommon<F extends string, P extends string, G extends string, T extends string> = {
  readonly id: F; readonly owner: P; readonly groups?: readonly G[]; readonly tags?: readonly T[];
};

/** A feature as declared. Regions and paths take their geometry from annotated meshes; a landmark is a point on an object. */
export type SubjectThreeFeatureInput<F extends string, P extends string, M extends string, G extends string, T extends string> =
  | (FeatureCommon<F, P, G, T> & { readonly kind: 'region'; readonly material?: M })
  | (FeatureCommon<F, P, G, T> & { readonly kind: 'path'; readonly line: SubjectLineKind })
  | (FeatureCommon<F, P, G, T> & { readonly kind: 'landmark'; readonly at: { readonly object: Object3D; readonly point: ShotPoint } });

/** A light by its world direction toward it (three's y up), turned into the evidence's view convention. */
export type SubjectThreeLight = { readonly direction: ShotPoint; readonly intensity?: number };

/**
 * What projectSubjectFromThree reads: the scene (`root`) seen through `camera`, sampled every `cellPx`, each mesh
 * annotated; the materials, parts (with an optional `outline` path feature), features and frames it declares; the
 * light in world space; `mirrorPairs` of parts, the deeper of each made far.
 */
export type SubjectThreeInput<P extends string, M extends string, F extends string, R extends string, G extends string, T extends string> = {
  readonly id: string;
  /** The top object; its own parent's transform is not read. */
  readonly root: Object3D;
  readonly camera: ShotCamera;
  /** Sample spacing on the page, px: what areas are traced and evidence sampled at. */
  readonly cellPx: number;
  readonly annotations: ReadonlyMap<Object3D, SubjectThreeAnnotation<NoInfer<P>, NoInfer<F>>>;
  readonly materials: readonly SubjectMaterialInput<M>[];
  readonly parts: readonly SubjectThreePartInput<P, NoInfer<M>, F, T>[];
  readonly features?: readonly SubjectThreeFeatureInput<F, NoInfer<P>, NoInfer<M>, G, T>[];
  readonly frames?: readonly SubjectFrameInput<R, NoInfer<P>, NoInfer<F>>[];
  readonly illumination?: { readonly key: SubjectThreeLight; readonly fills?: readonly SubjectThreeLight[]; readonly terminator?: number };
  /**
   * How far, in scene units, a decal, line or landmark may sit behind the surface in front of it and still show:
   * what keeps a line laid on a surface from being hidden by it. Default 1% of the scene's size.
   */
  readonly surfaceTolerance?: number;
  /**
   * Parts that mirror each other, as a left and a right leg: of each pair, the one whose seen middle stands deeper by
   * more than 2% of the scene's size is on the far side. Every other part is near.
   */
  readonly mirrorPairs?: readonly (readonly [NoInfer<P>, NoInfer<P>])[];
};

export type SubjectThreeDiagnosticCode = SubjectDiagnosticCode | 'unannotated-mesh' | 'invalid-annotation' | 'behind-camera' | 'deformed-mesh';
/**
 * A projection problem: any subject diagnostic, or a mesh left unannotated, an annotation that doesn't fit, a scene
 * behind the camera, or a mesh the GPU deforms (skinned, morphed or instanced), whose drawn shape isn't its geometry.
 */
export type SubjectThreeDiagnostic = SubjectDiagnostic<SubjectThreeDiagnosticCode>;

type SubjectThreeIds<P, M, F, R, G, T> = { readonly part: P; readonly material: M; readonly feature: F; readonly frame: R; readonly group: G; readonly tag: T };

/** One mesh's range drawn under one material, with what it is. */
type DrawUnit = { readonly mesh: number; readonly address: string; readonly annotation: SubjectThreeSurfaceAnnotation; readonly triangles: SubjectRasterTriangles };
type PathSource = { readonly feature: string; readonly world: Matrix4; readonly centerline: SubjectThreeCenterline };
type WalkedMesh = { readonly mesh: Mesh; readonly world: Matrix4; readonly address: string; readonly annotation: Exclude<SubjectThreeAnnotation, { kind: 'path' }> };

const isThreeMesh = (object: Object3D): object is Mesh => 'isMesh' in object && object.isMesh === true;
const isSkinned = (mesh: Mesh): mesh is SkinnedMesh => 'isSkinnedMesh' in mesh && mesh.isSkinnedMesh === true;
const isInstanced = (mesh: Mesh): mesh is InstancedMesh => 'isInstancedMesh' in mesh && mesh.isInstancedMesh === true;

/**
 * How the GPU moves `mesh`'s vertices off its geometry, or undefined when it draws them where they lie. The projector
 * reads geometry only, so a deformed mesh is refused rather than projected in its rest shape.
 */
function threeMeshDeformation(mesh: Mesh): string | undefined {
  if (isSkinned(mesh)) return 'it is skinned to a skeleton';
  if (isInstanced(mesh)) return `it is instanced ${mesh.count} times`;
  if (Object.keys(mesh.geometry.morphAttributes).length && mesh.morphTargetInfluences?.some((weight) => weight !== 0)) return 'its morph targets are weighted';
  return undefined;
}

/** What an annotation says a mesh is, for a diagnostic. */
const describeSubjectThreeAnnotation = (annotation: WalkedMesh['annotation']): string => {
  if (annotation.kind === 'part') return `part '${annotation.part}'`;
  if (annotation.kind === 'region') return `region '${annotation.feature}'`;
  if (annotation.kind === 'unpainted') return 'unpainted';
  return `by material (${annotation.slots.map(describeSubjectThreeAnnotation).join(', ')})`;
};
const localMatrixOf = (object: Object3D) =>
  (object.matrixAutoUpdate ? new Matrix4().compose(object.position, object.quaternion, object.scale) : object.matrix.clone());

/** Every visible mesh with its world matrix and annotation, and every path an annotation draws, or why one isn't known. */
function walkSubjectThree(root: Object3D, annotations: ReadonlyMap<Object3D, SubjectThreeAnnotation>, problems: SubjectThreeDiagnostic[]) {
  const meshes: WalkedMesh[] = [], paths: PathSource[] = [];
  const visit = (object: Object3D, parent: Matrix4, inherited: SubjectThreeAnnotation | 'path-drawn' | undefined, address: string) => {
    if (!object.visible) return;
    const world = parent.clone().multiply(localMatrixOf(object));
    const own = annotations.get(object);
    if (own?.kind === 'path') paths.push({ feature: own.feature, world, centerline: own.centerline });
    const annotation = own?.kind === 'path' ? 'path-drawn' : own ?? inherited;
    if (isThreeMesh(object) && annotation !== 'path-drawn') {
      if (annotation === undefined) problems.push(subjectError('unannotated-mesh', address, 'no annotation says what this mesh is', 'annotate it, or a group above it, as a part, a region, a path or unpainted'));
      else if (annotation.kind !== 'path') meshes.push({ mesh: object, world, address, annotation });
    }
    object.children.forEach((child, i) => visit(child, world, annotation, `${address}/${child.name || `[${i}]`}`));
  };
  visit(root, new Matrix4(), undefined, root.name || 'root');
  return { meshes, paths };
}

/** The camera's axes as view-convention readers: x right, y down, z toward the viewer. */
function viewReader(camera: ShotCamera) {
  const { right, up, forward } = shotCameraAxes(camera);
  return (v: Vector3): SubjectVector3 => ({ x: v.dot(right), y: -v.dot(up), z: -v.dot(forward) });
}

/** The material ranges of `mesh`, each with its slot: three draws groups only under an array of materials. */
function materialRanges(mesh: Mesh): { slot: number; material: Material; start: number; count: number }[] {
  const { geometry } = mesh, total = (geometry.index ?? geometry.getAttribute('position')).count;
  const drawStart = geometry.drawRange.start, drawEnd = Math.min(total, drawStart + geometry.drawRange.count);
  if (!Array.isArray(mesh.material)) return [{ slot: 0, material: mesh.material, start: drawStart, count: drawEnd - drawStart }];
  const slots: readonly Material[] = mesh.material;
  return geometry.groups.flatMap(({ start, count, materialIndex = 0 }) => {
    const material = slots[materialIndex], from = Math.max(start, drawStart), to = Math.min(start + count, drawEnd);
    return material && to > from ? [{ slot: materialIndex, material, start: from, count: to - from }] : [];
  });
}

/** `geometry`'s normals, made smooth from its faces when it carries none. */
const normalsOf = (geometry: BufferGeometry) => {
  const own = geometry.getAttribute('normal');
  if (own) return own;
  const made = geometry.clone();
  made.computeVertexNormals();
  return made.getAttribute('normal');
};

/** A mesh's units, projected; diagnostics for a slot list that doesn't fit or a vertex behind the camera. */
function projectMesh(walked: WalkedMesh, index: number, camera: ShotCamera, problems: SubjectThreeDiagnostic[]): DrawUnit[] {
  const { mesh, world, address, annotation } = walked, { geometry } = mesh;
  const slotCount = Array.isArray(mesh.material) ? mesh.material.length : 1;
  if (annotation.kind === 'by-material' && annotation.slots.length !== slotCount) {
    problems.push(subjectError('invalid-annotation', address, `it annotates ${annotation.slots.length} material slots; the mesh has ${slotCount}`, 'give one annotation per material, in the mesh\'s order'));
    return [];
  }
  const ranges = materialRanges(mesh).flatMap((range) => {
    const surface = annotation.kind === 'by-material' ? annotation.slots[range.slot] : annotation;
    return surface.kind === 'unpainted' || !range.material.visible ? [] : [{ ...range, surface }];
  });
  if (!ranges.length) return [];
  const deformation = threeMeshDeformation(mesh);
  if (deformation) {
    problems.push(subjectError('deformed-mesh', address, `the mesh annotated ${describeSubjectThreeAnnotation(annotation)} can't be projected: ${deformation}, and only its undeformed geometry could be read`, 'bake the pose into a plain Mesh\'s geometry (or one Mesh per instance) before projecting it'));
    return [];
  }
  const position = geometry.getAttribute('position'), count = position.count;
  const screen = new Float64Array(2 * count), depth = new Float64Array(count), v = new Vector3();
  for (let i = 0; i < count; i++) {
    const seen = shotCameraProject(camera, v.fromBufferAttribute(position, i).applyMatrix4(world));
    if (!seen) {
      problems.push(subjectError('behind-camera', address, 'the mesh reaches behind the camera', 'frame the subject wholly in front of the camera'));
      return [];
    }
    screen[2 * i] = seen.x; screen[2 * i + 1] = seen.y; depth[i] = seen.depth;
  }
  // The inverse transpose's upper 3 × 3 turns normals; transformDirection reads only that and renormalises.
  const view = viewReader(camera), turn = world.clone().invert().transpose(), sourceNormals = normalsOf(geometry);
  const normals = new Float32Array(3 * count);
  for (let i = 0; i < count; i++) {
    const n = view(v.fromBufferAttribute(sourceNormals, i).transformDirection(turn));
    normals[3 * i] = n.x; normals[3 * i + 1] = n.y; normals[3 * i + 2] = n.z;
  }
  // three's front faces wind counter-clockwise with y up: clockwise on a y-down page, unless a mirror turns them.
  const mirrored = world.determinant() < 0 !== camera.shear.xx * camera.shear.yy - camera.shear.xy * camera.shear.yx < 0;
  const frontSign: 1 | -1 = mirrored ? 1 : -1;
  return ranges.map(({ start, count: length, material, surface }) => {
    const corners = new Uint32Array(length);
    for (let k = 0; k < length; k++) corners[k] = geometry.index ? geometry.index.getX(start + k) : start + k;
    const faces = { front: material.side !== BackSide, back: material.side === BackSide || material.side === DoubleSide };
    return { mesh: index, address, annotation: surface, triangles: { screen, depth, corners, frontSign, faces, ...(surface.kind === 'part' && { normals }) } };
  });
}

/** Points along a projected polyline no further apart than a cell, split in the scene so perspective holds. */
function projectedCenterline(source: PathSource, camera: ShotCamera, cell: number) {
  const points = source.centerline.points.map((p) => new Vector3(...p).applyMatrix4(source.world));
  const loop = source.centerline.closed ? [...points, points[0]] : points;
  const out: { x: number; y: number; depth: number }[] = [];
  for (let k = 0; k + 1 < loop.length; k++) {
    const a = shotCameraProject(camera, loop[k]), b = shotCameraProject(camera, loop[k + 1]);
    if (!a || !b) return undefined;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
    for (let s = 0; s < steps; s++) {
      const seen = s === 0 ? a : shotCameraProject(camera, loop[k].clone().lerp(loop[k + 1], s / steps));
      if (!seen) return undefined;
      out.push(seen);
    }
  }
  if (!source.centerline.closed && loop.length) {
    const last = shotCameraProject(camera, loop[loop.length - 1]);
    if (!last) return undefined;
    out.push(last);
  }
  return out;
}

/** The diagonal of the box round every part mesh's vertices in the scene: the subject's size, in scene units. */
function sceneSize(meshes: readonly WalkedMesh[]) {
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity), v = new Vector3();
  for (const { mesh, world } of meshes) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(world);
      min.min(v); max.max(v);
    }
  }
  return Math.max(max.distanceTo(min), Number.EPSILON);
}

/**
 * The subject `input`'s annotated scene shows from its camera, with surface and illumination evidence, or every
 * problem found: unannotated meshes, annotations naming unknown or wrong-kind ids, then checkSubject's own.
 */
export function projectSubjectFromThree<
  const P extends string, const M extends string, const F extends string = never, const R extends string = never, const G extends string = never, const T extends string = never,
>(input: SubjectThreeInput<P, M, F, R, G, T>): SubjectResult<Subject<SubjectThreeIds<P, M, F, R, G, T>>, SubjectThreeDiagnostic> {
  const problems: SubjectThreeDiagnostic[] = [];
  const { camera, cellPx: cell } = input, featureInputs = input.features ?? [];
  const { meshes, paths } = walkSubjectThree(input.root, input.annotations, problems);
  const partIds = new Set<string>(input.parts.map(({ id }) => id));
  const featureKinds = new Map<string, string>(featureInputs.map(({ id, kind }) => [id, kind]));
  const knownAs = (address: string, kind: 'part' | 'region' | 'path', id: string) => {
    const isPart = partIds.has(id);
    const found = kind === 'part' && isPart ? 'part' : featureKinds.get(id) ?? (isPart ? 'part' : undefined);
    if (found === kind) return true;
    problems.push(subjectError(found ? 'invalid-annotation' : 'unknown-ref', address, found ? `'${id}' is a ${found}, not a ${kind}` : `no ${kind} '${id}' is declared`, `declare a ${kind} '${id}', or annotate with one that is`));
    return false;
  };
  for (const { feature } of paths) knownAs(`path:${feature}`, 'path', feature);

  const layout: SubjectSampleLayout = { x0: 0, y0: 0, cell, columns: Math.ceil(camera.frame.width / cell) + 1, rows: Math.ceil(camera.frame.height / cell) + 1 };
  const units = meshes.flatMap((walked, m) => projectMesh(walked, m, camera, problems))
    .filter(({ annotation, address }) => annotation.kind === 'unpainted' || knownAs(address, annotation.kind, annotation.kind === 'part' ? annotation.part : annotation.feature));
  if (problems.length) return { ok: false, diagnostics: problems };

  const surfaceMeshes = meshes.filter((_, m) => units.some((unit) => unit.mesh === m && unit.annotation.kind === 'part'));
  const size = sceneSize(surfaceMeshes.length ? surfaceMeshes : meshes);
  const tolerance = input.surfaceTolerance ?? 0.01 * size;
  const rasters = units.map(({ triangles }) => rasterSubjectUnit(layout, [triangles]));
  const partUnits = units.map((unit) => unit.annotation.kind === 'part');
  const nearest = nearestSubjectRaster(layout, rasters.map((raster, u) => (partUnits[u] ? raster : undefined)));
  const partOf = (u: number) => (u >= 0 && units[u].annotation.kind === 'part' ? units[u].annotation : undefined);
  const sampleCount = layout.columns * layout.rows;
  /** Whether mesh `m` covers sample `k` at all, in front or behind. */
  const meshCovers = (m: number, k: number) => units.some((unit, u) => unit.mesh === m && partUnits[u] && rasters[u] !== undefined && subjectRasterDepthAt(layout, rasters[u], k) < Infinity);
  // A decal's Infinity where it misses must not pass against the background's Infinity.
  const showsAt = (k: number, depth: number) => k >= 0 && Number.isFinite(depth) && depth <= nearest.depth[k] + tolerance;
  const covered = new Uint8Array(sampleCount);
  for (let k = 0; k < sampleCount; k++) covered[k] = nearest.unit[k] >= 0 ? 1 : 0;
  const subjectDepth = medianCoveredDepth(nearest.depth, covered);

  const areaOf = (inside: (k: number) => boolean) => subjectAreaVisibility(traceSubjectMaskRings(layout, inside));
  const farParts = farMirroredParts(input.mirrorPairs ?? [], seenPartDepths(nearest, (u) => partOf(u)?.part), units, 0.02 * size);
  const parts = input.parts.map((part) => {
    const visibility = areaOf((k) => partOf(nearest.unit[k])?.part === part.id);
    return { id: part.id, material: part.material, ...(part.tags && { tags: part.tags }), side: farParts.has(part.id) ? 'far' as const : 'near' as const, visibility };
  });
  const partShows = new Map<string, boolean>(parts.map(({ id, visibility }) => [id, visibility.kind === 'visible']));

  const regionRasters = (feature: string) => units.flatMap((unit, u) => (unit.annotation.kind === 'region' && unit.annotation.feature === feature && rasters[u] ? [rasters[u]] : []));
  const pathRuns = (feature: string): SubjectPathRun[] => paths.filter((path) => path.feature === feature).flatMap((path) => {
    const points = projectedCenterline(path, camera, cell);
    if (!points) return [];
    const shows = points.map((p) => showsAt(subjectSampleAt(layout, p), p.depth));
    return subjectVisibleRuns(layout, points, shows, path.centerline.closed);
  });
  const features: SubjectFeatureInput<F, P, M, G, T>[] = [];
  for (const feature of featureInputs) {
    const ownerShows = partShows.get(feature.owner) === true;
    if (feature.kind === 'region') {
      const covering = regionRasters(feature.id);
      const visibility = ownerShows ? areaOf((k) => covering.some((raster) => showsAt(k, subjectRasterDepthAt(layout, raster, k)))) : SUBJECT_HIDDEN;
      features.push({ ...feature, visibility });
    } else if (feature.kind === 'path') {
      features.push({ ...feature, visibility: ownerShows ? subjectPathVisibility(pathRuns(feature.id)) : SUBJECT_HIDDEN });
    } else {
      const { at, ...landmark } = feature;
      const world = worldMatrixOf(at.object, input.root);
      const seen = world ? shotCameraProject(camera, new Vector3(...at.point).applyMatrix4(world)) : null;
      const k = seen ? subjectSampleAt(layout, seen) : -1;
      features.push({ ...landmark, visibility: ownerShows && seen && showsAt(k, seen.depth) ? subjectVisible({ at: { x: seen.x, y: seen.y } }) : SUBJECT_HIDDEN });
    }
  }

  const outlines: SubjectFeatureInput<F, P, M, G, T>[] = input.parts.flatMap((part) => {
    if (part.outline === undefined) return [];
    const outlinedMeshes = [...new Set(units.filter((unit) => unit.annotation.kind === 'part' && unit.annotation.part === part.id && unit.annotation.outline !== false).map(({ mesh }) => mesh))];
    const runs = outlinedMeshes.flatMap((m) => traceSubjectMaskEdgeRuns(
      layout, (k) => nearest.unit[k] >= 0 && units[nearest.unit[k]].mesh === m,
      // An inverted hull shows where what lies past the mesh's edge continues behind it. Against the background it is
      // the silhouette, which the subject holds once, not as each part's outline.
      (inner, outer) => outer >= 0 && nearest.unit[outer] >= 0 && meshCovers(units[nearest.unit[outer]].mesh, inner),
    ));
    return [{ kind: 'path', id: part.outline, owner: part.id, line: 'occluding-edge', visibility: subjectPathVisibility(runs) }];
  });

  const silhouette = areaOf((k) => covered[k] === 1);
  // Depth in px as x and y are at the subject's own distance: a unit there spans pxPerUnit across and as deep.
  const pxPerUnit = shotCameraFocalPx(camera) / (subjectDepth ?? 1);
  const depthPx = new Float32Array(sampleCount);
  for (let k = 0; k < sampleCount; k++) depthPx[k] = covered[k] ? nearest.depth[k] * pxPerUnit : 0;
  const surface: SurfaceEvidence = { convention: 'view-x-right-y-down-z-toward-viewer', layout, coverage: subjectMaskSignedDistance(layout, covered), normals: nearest.normals, depth: depthPx };

  const subjectInput: SubjectInput<P, M, F, R, G, T> = {
    id: input.id, materials: input.materials, parts, features: [...features, ...outlines], silhouette, surface,
    ...(input.frames && { frames: input.frames }), ...(input.illumination && { illumination: illuminationOf(input.illumination, camera) }),
  };
  return checkSubject(subjectInput);
}

/** The subject `input` projects to, or a SubjectDiagnosticError listing every problem. */
export function defineSubjectFromThree<
  const P extends string, const M extends string, const F extends string = never, const R extends string = never, const G extends string = never, const T extends string = never,
>(input: SubjectThreeInput<P, M, F, R, G, T>): Subject<SubjectThreeIds<P, M, F, R, G, T>> {
  const result = projectSubjectFromThree(input);
  if (!result.ok) throw new SubjectDiagnosticError(`subject '${input.id}' doesn't project from its scene`, result.diagnostics);
  return result.value;
}

/** The median depth of what the eye sees of the subject: where it stands, undefined when none of it shows. */
function medianCoveredDepth(depth: Float32Array, covered: Uint8Array): number | undefined {
  const seen = depth.filter((_, k) => covered[k] === 1).toSorted();
  return seen.length ? seen[seen.length >> 1] : undefined;
}

/** Each part's mean depth over the samples it shows at: where the eye finds it, its hidden back left out. */
function seenPartDepths(nearest: { unit: Int32Array; depth: Float32Array }, partAt: (unit: number) => string | undefined) {
  const sums = new Map<string, { depth: number; count: number }>();
  nearest.unit.forEach((unit, k) => {
    const part = partAt(unit);
    if (part === undefined) return;
    const sum = sums.get(part) ?? { depth: 0, count: 0 };
    sums.set(part, { depth: sum.depth + nearest.depth[k], count: sum.count + 1 });
  });
  return new Map([...sums].map(([part, { depth, count }]) => [part, depth / count]));
}

/** The deeper of each mirrored pair, where it stands deeper than `margin`. */
function farMirroredParts(pairs: readonly (readonly [string, string])[], seen: ReadonlyMap<string, number>, units: readonly DrawUnit[], margin: number): Set<string> {
  const depthOf = (part: string) => seen.get(part) ?? partCentreDepth(units, part);
  return new Set(pairs.flatMap(([a, b]) => {
    const da = depthOf(a), db = depthOf(b);
    if (da === undefined || db === undefined || Math.abs(da - db) <= margin) return [];
    return [da > db ? a : b];
  }));
}

/** A hidden part's middle depth: midway between its nearest and farthest vertex. */
function partCentreDepth(units: readonly DrawUnit[], part: string) {
  let near = Infinity, far = -Infinity;
  for (const { annotation, triangles: { depth, corners } } of units) {
    if (annotation.kind !== 'part' || annotation.part !== part) continue;
    for (const k of corners) { near = Math.min(near, depth[k]); far = Math.max(far, depth[k]); }
  }
  return near <= far ? (near + far) / 2 : undefined;
}

/** `object`'s world matrix, composed down from `root`; undefined when it isn't beneath it. */
function worldMatrixOf(object: Object3D, root: Object3D): Matrix4 | undefined {
  const chain: Object3D[] = [];
  for (let at: Object3D | null = object; at; at = at.parent) {
    chain.unshift(at);
    if (at === root) return chain.reduce((world, link) => world.multiply(localMatrixOf(link)), new Matrix4());
  }
  return undefined;
}

function illuminationOf(light: NonNullable<SubjectThreeInput<string, string, string, string, string, string>['illumination']>, camera: ShotCamera): IlluminationEvidence {
  const view = viewReader(camera);
  const of = ({ direction, intensity = 1 }: SubjectThreeLight) => ({ direction: view(new Vector3(...direction).normalize()), intensity });
  return {
    convention: 'view-x-right-y-down-z-toward-viewer', key: of(light.key), fills: (light.fills ?? []).map(of),
    ...(light.terminator !== undefined && { terminator: light.terminator }),
  };
}
