// posed-primitive-figure.ts: a figure of ellipsoids and capsules on a hierarchy of joints, posed by turning joints and
// scaling parts, seen from any side. A ray per grid sample meets each primitive analytically and the nearest wins, so
// an arm passing into the body cuts it where they meet. Plain math, no GPU or three.js: it runs in Node.
//
// The fields are continuous (distance to each projected edge, depth differences where parts cut each other), so
// outlines land between samples and stay smooth on a coarse grid.
//
// Space: x forward (the snout), y up, z toward the near side. Yaw 0 sees the near side, x to the right; positive
// yaw swings round toward the front.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import {
  paintFigureSampling, paintFigureShapesFromFields, tracePaintFigureFields, type PaintFigureFields, type PaintFigureSampling, type PaintFigureShapes, type PaintFigureTrace,
} from './paint-figure-shapes.ts';
import { PAINT_FIGURE_TRACE_DEFAULTS, tracePaintFigureArea, type PaintFigureTracedArea, type PaintFigureTraceSettings } from './paint-figure-trace.ts';

export type PaintFigureVector = readonly [number, number, number];

/** A turn in degrees: about y first (heading), then z (bending in the side plane, positive lifts +x), then x (roll). */
export type PaintFigureTurn = { readonly x?: number; readonly y?: number; readonly z?: number };

/** A joint `at` a point in its parent's space (the figure's, when it has none), turned by `turn` at rest. */
export type PaintFigureJoint<J extends string> = { readonly parent?: J; readonly at: PaintFigureVector; readonly turn?: PaintFigureTurn };

/** A primitive carried by `joint`, in figure units. A capsule runs `from` (the joint, by default) `to`, `radius` round. */
export type PaintFigurePrimitive<J extends string> =
  | { readonly kind: 'ellipsoid'; readonly joint: J; readonly at?: PaintFigureVector; readonly radii: PaintFigureVector; readonly turn?: PaintFigureTurn }
  | { readonly kind: 'capsule'; readonly joint: J; readonly from?: PaintFigureVector; readonly to: PaintFigureVector; readonly radius: number };

/** A part: its primitives, and the point its pose scale grows it from (`pivot`, on a joint; its first primitive's joint origin by default). */
export type PaintFigurePrimitivePart<J extends string> = {
  readonly primitives: readonly PaintFigurePrimitive<J>[];
  readonly pivot?: { readonly joint: J; readonly at: PaintFigureVector };
};

/** A named point on the figure, carried by `joint`; with `part`, it grows with that part's scale too. */
export type PaintFigureAnchor<J extends string, P extends string> = { readonly joint: J; readonly at?: PaintFigureVector; readonly part?: P };

/** A figure's declaration. Parts are declared back to front only for ties: depth decides what hides what. */
export type PosedPrimitiveFigure<J extends string, P extends string, A extends string> = {
  readonly joints: Readonly<Record<J, PaintFigureJoint<J>>>;
  readonly parts: Readonly<Record<P, PaintFigurePrimitivePart<J>>>;
  readonly anchors: Readonly<Record<A, PaintFigureAnchor<J, P>>>;
};

/** A pose: joint turns added to each joint's rest turn, and a uniform scale per part about its pivot (1 at rest). */
export type PaintFigurePose<J extends string, P extends string> = {
  readonly turns?: Partial<Readonly<Record<J, PaintFigureTurn>>>;
  readonly scale?: Partial<Readonly<Record<P, number>>>;
};

/**
 * How the figure is seen and sampled. The camera circles `target` (figure units; the origin by default) by `yaw` and
 * `pitch` degrees (positive looks down). `target` lands at `centre` px, a figure unit spanning `scale` px there.
 * Orthographic unless `perspective` sets the eye's distance. `cell`: the sampling grid, px (3 by default).
 */
export type PaintFigureView = {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly target?: PaintFigureVector;
  readonly centre: StampPoint;
  readonly scale: number;
  readonly perspective?: { readonly distance: number };
  readonly cell?: number;
  readonly trace?: PaintFigureTraceSettings;
};

type Matrix = [number, number, number, number, number, number, number, number, number];
type Affine = { m: Matrix; t: [number, number, number] };

const RADIANS = Math.PI / 180;
const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
const apply = (m: Matrix, v: readonly number[]): [number, number, number] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const place = (a: Affine, v: readonly number[]): [number, number, number] => { const r = apply(a.m, v); return [r[0] + a.t[0], r[1] + a.t[1], r[2] + a.t[2]]; };
const compose = (outer: Affine, inner: Affine): Affine => ({ m: multiply(outer.m, inner.m), t: place(outer, inner.t) });

function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** Ry · Rz · Rx: heading, then the bend, then the roll. */
function turnMatrix(turn: PaintFigureTurn): Matrix {
  const [cy, sy] = [Math.cos((turn.y ?? 0) * RADIANS), Math.sin((turn.y ?? 0) * RADIANS)];
  const [cz, sz] = [Math.cos((turn.z ?? 0) * RADIANS), Math.sin((turn.z ?? 0) * RADIANS)];
  const [cx, sx] = [Math.cos((turn.x ?? 0) * RADIANS), Math.sin((turn.x ?? 0) * RADIANS)];
  const ry: Matrix = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], rz: Matrix = [cz, -sz, 0, sz, cz, 0, 0, 0, 1], rx: Matrix = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  return multiply(multiply(ry, rz), rx);
}

const addTurns = (a: PaintFigureTurn | undefined, b: PaintFigureTurn | undefined): PaintFigureTurn => ({ x: (a?.x ?? 0) + (b?.x ?? 0), y: (a?.y ?? 0) + (b?.y ?? 0), z: (a?.z ?? 0) + (b?.z ?? 0) });

/** Each joint's figure-space transform in this pose, parents first. */
function posedJoints<J extends string, P extends string, A extends string>(figure: PosedPrimitiveFigure<J, P, A>, pose: PaintFigurePose<J, P>): Map<J, Affine> {
  const solved = new Map<J, Affine>();
  const solve = (name: J, chain: readonly J[]): Affine => {
    const known = solved.get(name);
    if (known) return known;
    if (chain.includes(name)) throw new Error(`posedPrimitiveFigure: joints ${[...chain, name].join(' → ')} form a cycle`);
    const joint = figure.joints[name];
    const parent = joint.parent === undefined ? IDENTITY : solve(joint.parent, [...chain, name]);
    const local: Affine = { m: turnMatrix(addTurns(joint.turn, pose.turns?.[name])), t: [...joint.at] };
    const world = compose(parent, local);
    solved.set(name, world);
    return world;
  };
  // SAFETY: the keys of a Record<J, …> are J.
  for (const name of Object.keys(figure.joints) as J[]) solve(name, []);
  return solved;
}

/** The camera: figure space to camera space (x right, y up, z toward the eye), and where the eye is. */
function viewTransform(view: PaintFigureView): Affine {
  const yaw = (view.yaw ?? 0) * RADIANS, pitch = (view.pitch ?? 0) * RADIANS;
  const back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const right = [back[2], 0, -back[0]];
  const length = Math.hypot(right[0], right[2]);
  const r = [right[0] / length, 0, right[2] / length];
  const up = [back[1] * r[2] - back[2] * r[1], back[2] * r[0] - back[0] * r[2], back[0] * r[1] - back[1] * r[0]];
  const m: Matrix = [r[0], r[1], r[2], up[0], up[1], up[2], back[0], back[1], back[2]];
  const target = view.target ?? [0, 0, 0];
  const shifted = apply(m, target);
  return { m, t: [-shifted[0], -shifted[1], -shifted[2]] };
}

/** One primitive in camera space, ready to meet rays. */
type CameraPrimitive =
  | { kind: 'ellipsoid'; inverse: Matrix; centre: [number, number, number]; edgeScale: number; box: number[] }
  | { kind: 'capsule'; a: [number, number, number]; b: [number, number, number]; radius: number; box: number[] };

/** A ray per sample: from `origin` along unit `direction`, in camera space. */
type Ray = { origin: [number, number, number]; direction: [number, number, number] };

const EMPTY = -1e6;

/** The eight corners of the box centred on `c`, `e` out each way. */
const cornersAround = (c: readonly number[], e: readonly number[]) => [-1, 1].flatMap((i) => [-1, 1].flatMap((j) => [-1, 1].map((k): [number, number, number] => [c[0] + i * e[0], c[1] + j * e[1], c[2] + k * e[2]])));
/** Where orthographic rays start, figure units in front of the target: past any figure, near enough to keep depth precise. */
const ORTHOGRAPHIC_EYE = 100;
/** Depth where a part wasn't sampled: finite, so a grid reading between samples never meets Infinity × 0. */
const FAR = 1e9;

/** What a ray met: signed distance to the primitive's projected edge (camera units, positive inside), and depth along the ray. */
type RayMeeting = { edge: number; depth: number; hit: boolean };

/** Writes into `met` rather than returning, as it runs once per primitive per sample. */
function meetRay(primitive: CameraPrimitive, ray: Ray, met: RayMeeting): void {
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.direction;
  if (primitive.kind === 'ellipsoid') {
    const m = primitive.inverse, c = primitive.centre;
    const px = ox - c[0], py = oy - c[1], pz = oz - c[2];
    const lx = m[0] * px + m[1] * py + m[2] * pz, ly = m[3] * px + m[4] * py + m[5] * pz, lz = m[6] * px + m[7] * py + m[8] * pz;
    const ex = m[0] * dx + m[1] * dy + m[2] * dz, ey = m[3] * dx + m[4] * dy + m[5] * dz, ez = m[6] * dx + m[7] * dy + m[8] * dz;
    const dd = ex * ex + ey * ey + ez * ez;
    const nearest = -(lx * ex + ly * ey + lz * ez) / dd;
    const qx = lx + nearest * ex, qy = ly + nearest * ey, qz = lz + nearest * ez;
    const q = qx * qx + qy * qy + qz * qz;
    met.edge = (1 - Math.sqrt(q)) * primitive.edgeScale;
    met.hit = q < 1;
    met.depth = met.hit ? nearest - Math.sqrt((1 - q) / dd) : nearest;
    return;
  }
  const { a, b, radius } = primitive;
  // The segment point nearest the ray's line: minimise the part of (a − o) + s(b − a) across the ray.
  const ax = a[0] - ox, ay = a[1] - oy, az = a[2] - oz, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const aAlong = ax * dx + ay * dy + az * dz, uAlong = ux * dx + uy * dy + uz * dz;
  const apx = ax - aAlong * dx, apy = ay - aAlong * dy, apz = az - aAlong * dz, upx = ux - uAlong * dx, upy = uy - uAlong * dy, upz = uz - uAlong * dz;
  const uu = upx * upx + upy * upy + upz * upz;
  const s = uu > 1e-12 ? Math.min(1, Math.max(0, -(apx * upx + apy * upy + apz * upz) / uu)) : 0;
  met.edge = radius - Math.hypot(apx + s * upx, apy + s * upy, apz + s * upz);
  met.hit = met.edge > 0;
  if (!met.hit) { met.depth = aAlong + s * uAlong; return; }
  // The front surface is the nearest entry into the capsule's cylinder (within its length) or either end's sphere; the
  // nearest sphere alone would be late where the capsule slants toward the eye.
  let front = Infinity;
  const baba = ux * ux + uy * uy + uz * uz, baoa = -(ux * ax + uy * ay + uz * az);
  const rdoa = -aAlong, oaoa = ax * ax + ay * ay + az * az;
  const qa = baba - uAlong * uAlong, qb = baba * rdoa - baoa * uAlong, qc = baba * oaoa - baoa * baoa - radius * radius * baba;
  const h = qb * qb - qa * qc;
  if (qa > 1e-12 && h >= 0) {
    const t = (-qb - Math.sqrt(h)) / qa, along = baoa + t * uAlong;
    if (along > 0 && along < baba) front = t;
  }
  for (const end of [a, b]) {
    const cx = ox - end[0], cy = oy - end[1], cz = oz - end[2];
    const cb = dx * cx + dy * cy + dz * cz, cc = cx * cx + cy * cy + cz * cz - radius * radius;
    if (cb * cb - cc >= 0) front = Math.min(front, -cb - Math.sqrt(cb * cb - cc));
  }
  met.depth = front;
}

/** The outward unit normal where `ray` meets `primitive` at `t`, in camera space, into `out`. */
function primitiveNormal(primitive: CameraPrimitive, ray: Ray, t: number, out: [number, number, number]): void {
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.direction;
  const px = ox + t * dx, py = oy + t * dy, pz = oz + t * dz;
  let nx: number, ny: number, nz: number;
  if (primitive.kind === 'ellipsoid') {
    // On the unit sphere the normal is the point itself; the inverse's transpose carries it back.
    const m = primitive.inverse, c = primitive.centre;
    const cx = px - c[0], cy = py - c[1], cz = pz - c[2];
    const qx = m[0] * cx + m[1] * cy + m[2] * cz, qy = m[3] * cx + m[4] * cy + m[5] * cz, qz = m[6] * cx + m[7] * cy + m[8] * cz;
    nx = m[0] * qx + m[3] * qy + m[6] * qz; ny = m[1] * qx + m[4] * qy + m[7] * qz; nz = m[2] * qx + m[5] * qy + m[8] * qz;
  } else {
    const { a, b } = primitive, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], uu = ux * ux + uy * uy + uz * uz;
    const s = uu > 1e-12 ? Math.min(1, Math.max(0, ((px - a[0]) * ux + (py - a[1]) * uy + (pz - a[2]) * uz) / uu)) : 0;
    nx = px - (a[0] + s * ux); ny = py - (a[1] + s * uy); nz = pz - (a[2] + s * uz);
  }
  const length = Math.hypot(nx, ny, nz);
  out[0] = nx / length; out[1] = ny / length; out[2] = nz / length;
}

/**
 * The surface nearest the eye at each sample of `sampling`, for shading from evidence rather than guessing it.
 * `coverage`: the silhouette, signed px, positive inside. `normals`: three per sample, unit where covered, in view
 * space with x right, y down the page and z toward the viewer. `depth`: px from the eye along the view.
 */
export type PaintFigureSurface = {
  readonly sampling: PaintFigureSampling;
  readonly coverage: Float32Array;
  readonly normals: Float32Array;
  readonly depth: Float32Array;
};

/**
 * What an anchor's line of sight meets. `open`: no part, the anchor stands clear of the figure. `on`: the nearest
 * part along it, and whether the anchor lies in that part's near half, so a mark set just under a surface shows from
 * its own side and hides from the other.
 */
export type PaintFigureAnchorSight<P extends string> =
  | { readonly kind: 'open' }
  | { readonly kind: 'on'; readonly part: P; readonly nearSide: boolean };

export type PaintFigureAnchorSeen<P extends string> = { readonly at: StampPoint; readonly sight: PaintFigureAnchorSight<P> };

/**
 * `far`: the part's centre is on the figure's far side, turned from the viewer. The declaration's convention puts the
 * near side at +z, so this is which side of the z = 0 plane faces away; seen head-on, nothing is far.
 */
export type PaintFigurePartSide = 'near' | 'far';

/** The posed figure as a subject adapter reads it: traced areas with holes, lines by part, the surface, anchors' sight. */
export type PosedFigureProjection<P extends string, A extends string> = {
  readonly trace: PaintFigureTrace<P>;
  readonly sides: Readonly<Record<P, PaintFigurePartSide>>;
  readonly surface: PaintFigureSurface;
  readonly anchors: Readonly<Record<A, PaintFigureAnchorSeen<P>>>;
  /**
   * What shows of `parts` as one area, its edge against every other part traced from the same field theirs is, so
   * areas traced here tile the silhouette, meeting without crossing, where trace's are each smoothed alone.
   */
  readonly traceArea: (parts: readonly P[]) => PaintFigureTracedArea;
};

/** How far off the mid plane, as a share of the farthest part centre's offset, a part must sit toward the back to be far. */
const FAR_SIDE_SHARE = 0.25;

type PosedFigureSamples<P extends string, A extends string> = {
  fields: PaintFigureFields<P>;
  sides: Record<P, PaintFigurePartSide>;
  surface: PaintFigureSurface;
  anchors: Record<A, PaintFigureAnchorSeen<P>>;
};

/** Rays through every sample meeting every primitive, keeping each part's fields and the nearest surface's normal and depth. */
function samplePosedFigure<J extends string, P extends string, A extends string>(
  figure: PosedPrimitiveFigure<J, P, A>,
  pose: PaintFigurePose<J, P>,
  view: PaintFigureView,
): PosedFigureSamples<P, A> {
  const joints = posedJoints(figure, pose);
  const camera = viewTransform(view);
  const { scale, centre } = view;
  const cell = view.cell ?? 3;
  const distance = view.perspective?.distance;
  // SAFETY: the keys of a Record<P, …> are P.
  const partNames = Object.keys(figure.parts) as P[];

  /** Figure space through a part's scale about its pivot. */
  const partAffine = (name: P): Affine => {
    const part = figure.parts[name], grow = pose.scale?.[name] ?? 1;
    const pivotJoint = part.pivot?.joint ?? part.primitives[0].joint;
    const pivot = place(joints.get(pivotJoint)!, part.pivot?.at ?? [0, 0, 0]);
    return { m: [grow, 0, 0, 0, grow, 0, 0, 0, grow], t: [pivot[0] * (1 - grow), pivot[1] * (1 - grow), pivot[2] * (1 - grow)] };
  };
  const toScreen = ([x, y, z]: readonly number[]): StampPoint => {
    const k = distance === undefined ? 1 : distance / (distance - z);
    return { x: centre.x + scale * x * k, y: centre.y - scale * y * k };
  };
  const boxOf = (corners: [number, number, number][]) => {
    const points = corners.map(toScreen);
    return [Math.min(...points.map((p) => p.x)), Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.x)), Math.max(...points.map((p) => p.y))];
  };

  const parts = partNames.map((name) => {
    const grow = pose.scale?.[name] ?? 1;
    const inFigure = partAffine(name);
    const toCamera = compose(camera, inFigure);
    const centres: number[] = [];
    const primitives = figure.parts[name].primitives.map((primitive): CameraPrimitive => {
      const onJoint = compose(toCamera, joints.get(primitive.joint)!);
      const figureJoint = compose(inFigure, joints.get(primitive.joint)!);
      if (primitive.kind === 'ellipsoid') {
        centres.push(place(figureJoint, primitive.at ?? [0, 0, 0])[2]);
        const [rx, ry, rz] = primitive.radii;
        const local: Affine = { m: multiply(turnMatrix(primitive.turn ?? {}), [rx, 0, 0, 0, ry, 0, 0, 0, rz]), t: [...(primitive.at ?? [0, 0, 0])] };
        const whole = compose(onJoint, local);
        const extent = [0, 3, 6].map((row) => Math.hypot(whole.m[row], whole.m[row + 1], whole.m[row + 2]));
        return { kind: 'ellipsoid', inverse: invert(whole.m), centre: whole.t, edgeScale: Math.min(rx, ry, rz) * grow, box: boxOf(cornersAround(whole.t, extent)) };
      }
      centres.push((place(figureJoint, primitive.from ?? [0, 0, 0])[2] + place(figureJoint, primitive.to)[2]) / 2);
      const a = place(onJoint, primitive.from ?? [0, 0, 0]), b = place(onJoint, primitive.to), radius = primitive.radius * grow;
      const lo = [0, 1, 2].map((i) => Math.min(a[i], b[i])), hi = [0, 1, 2].map((i) => Math.max(a[i], b[i]));
      return { kind: 'capsule', a, b, radius, box: boxOf(cornersAround(lo.map((v, i) => (v + hi[i]) / 2), lo.map((v, i) => (hi[i] - v) / 2 + radius))) };
    });
    const box = [Math.min(...primitives.map((p) => p.box[0])), Math.min(...primitives.map((p) => p.box[1])), Math.max(...primitives.map((p) => p.box[2])), Math.max(...primitives.map((p) => p.box[3]))];
    return { name, primitives, box, sideZ: centres.reduce((sum, z) => sum + z, 0) / centres.length };
  });

  const sampling = paintFigureSampling({ x0: Math.min(...parts.map((p) => p.box[0])), y0: Math.min(...parts.map((p) => p.box[1])), x1: Math.max(...parts.map((p) => p.box[2])), y1: Math.max(...parts.map((p) => p.box[3])) }, cell);
  const { columns, rows } = sampling, count = columns * rows, margin = 2 * cell;
  // Each part is sampled only over its own box, two cells wider, so its edge always lies between real samples.
  const spans = parts.map(({ box }) => ({
    i0: Math.max(0, Math.floor((box[0] - sampling.x0) / cell) - 2), i1: Math.min(columns - 1, Math.ceil((box[2] - sampling.x0) / cell) + 2),
    j0: Math.max(0, Math.floor((box[1] - sampling.y0) / cell) - 2), j1: Math.min(rows - 1, Math.ceil((box[3] - sampling.y0) / cell) + 2),
  }));
  const own = parts.map(() => new Float32Array(count).fill(EMPTY)), depth = parts.map(() => new Float64Array(count).fill(FAR));
  const nearest = new Float64Array(count).fill(Infinity), normals = new Float32Array(3 * count), viewDepth = new Float32Array(count).fill(FAR);
  const normal: [number, number, number] = [0, 0, 0];
  const ray: Ray = { origin: [0, 0, 0], direction: [0, 0, -1] }, met: RayMeeting = { edge: 0, depth: 0, hit: false };
  /** Points `ray` through the page point (x, y) px, from the eye or, orthographic, from in front. */
  const aimRay = (x: number, y: number) => {
    const u = (x - centre.x) / scale, v = (centre.y - y) / scale;
    if (distance === undefined) {
      // Orthographic: every ray runs straight in from far in front; depth is measured from there, the same for all.
      ray.origin[0] = u; ray.origin[1] = v; ray.origin[2] = ORTHOGRAPHIC_EYE;
      ray.direction[0] = 0; ray.direction[1] = 0; ray.direction[2] = -1;
    } else {
      const length = Math.hypot(u, v, distance);
      ray.origin[0] = 0; ray.origin[1] = 0; ray.origin[2] = distance;
      ray.direction[0] = u / length; ray.direction[1] = v / length; ray.direction[2] = -distance / length;
    }
  };
  parts.forEach((part, k) => {
    const { i0, i1, j0, j1 } = spans[k];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const at = j * columns + i;
        const sx = sampling.x0 + i * cell, sy = sampling.y0 + j * cell;
        aimRay(sx, sy);
        let edge = EMPTY / scale, nearestHit = Infinity, missDepth = FAR / scale;
        for (const primitive of part.primitives) {
          // Two cells clear of a primitive's box it can't be the nearest edge any outline passes between.
          if (sx < primitive.box[0] - margin || sx > primitive.box[2] + margin || sy < primitive.box[1] - margin || sy > primitive.box[3] + margin) continue;
          meetRay(primitive, ray, met);
          if (met.hit) {
            nearestHit = Math.min(nearestHit, met.depth);
            if (met.depth < nearest[at]) {
              nearest[at] = met.depth;
              primitiveNormal(primitive, ray, met.depth, normal);
              // Camera space has y up; evidence has y down the page.
              normals[3 * at] = normal[0]; normals[3 * at + 1] = -normal[1]; normals[3 * at + 2] = normal[2];
              viewDepth[at] = -ray.direction[2] * met.depth * scale;
            }
          }
          if (met.edge > edge) { edge = met.edge; missDepth = met.depth; }
        }
        own[k][at] = edge * scale;
        depth[k][at] = (Number.isFinite(nearestHit) ? nearestHit : missDepth) * scale;
      }
    }
  });
  const union = new Float32Array(count).fill(EMPTY);
  const visible = parts.map(() => new Float32Array(count).fill(EMPTY));
  parts.forEach((_, k) => {
    const { i0, i1, j0, j1 } = spans[k];
    const others = spans.flatMap((span, other) => (other !== k && span.i0 <= i1 && span.i1 >= i0 && span.j0 <= j1 && span.j1 >= j0 ? [other] : []));
    for (let j = j0; j <= j1; j++) {
      for (let at = j * columns + i0; at <= j * columns + i1; at++) {
        const mine = own[k][at];
        union[at] = Math.max(union[at], mine);
        // Outside its own outline a part stays outside; inside, another part hides it where it is inside that one too
        // and nearer, by the lesser of the two margins, so the cut lands on the nearer edge or where they meet.
        let field = mine;
        if (mine > 0) for (const other of others) if (own[other][at] !== EMPTY) field = Math.min(field, -Math.min(own[other][at], depth[k][at] - depth[other][at]));
        visible[k][at] = field;
      }
    }
  });

  /** The nearest and farthest a part's primitives reach along `ray`, or undefined when it misses them all. */
  const span = (part: (typeof parts)[number]) => {
    let front = Infinity, back = -Infinity;
    for (const primitive of part.primitives) {
      meetRay(primitive, ray, met);
      if (met.hit) front = Math.min(front, met.depth);
    }
    if (!Number.isFinite(front)) return undefined;
    // The far surface is the near one of the same ray run backward from well past the figure.
    const reach = 2 * (distance ?? ORTHOGRAPHIC_EYE);
    const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.direction;
    const reversed: Ray = { origin: [ox + reach * dx, oy + reach * dy, oz + reach * dz], direction: [-dx, -dy, -dz] };
    for (const primitive of part.primitives) {
      meetRay(primitive, reversed, met);
      if (met.hit) back = Math.max(back, reach - met.depth);
    }
    return { front, back };
  };
  const anchors = Object.fromEntries(Object.entries<PaintFigureAnchor<J, P>>(figure.anchors).map(([name, anchor]) => {
    const onJoint = place(joints.get(anchor.joint)!, anchor.at ?? [0, 0, 0]);
    const grown = anchor.part === undefined ? onJoint : place(partAffine(anchor.part), onJoint);
    const point = place(camera, grown), at = toScreen(point);
    aimRay(at.x, at.y);
    const along = distance === undefined ? ORTHOGRAPHIC_EYE - point[2] : Math.hypot(point[0], point[1], point[2] - distance);
    let first: { part: P; front: number; back: number } | undefined;
    for (const part of parts) {
      const reach = span(part);
      if (reach && (!first || reach.front < first.front)) first = { part: part.name, ...reach };
    }
    const sight: PaintFigureAnchorSight<P> = first ? { kind: 'on', part: first.part, nearSide: along - first.front <= first.back - along } : { kind: 'open' };
    return [name, { at, sight }];
  }));

  const facing = camera.m[8], widest = Math.max(...parts.map(({ sideZ }) => Math.abs(sideZ)));
  // SAFETY: built from partNames, every key of figure.parts.
  const sides = Object.fromEntries(parts.map(({ name, sideZ }) => [name, widest > 0 && sideZ * facing < -FAR_SIDE_SHARE * widest ? 'far' : 'near'])) as Record<P, PaintFigurePartSide>;
  return {
    fields: { sampling, union, parts: parts.map((part, k) => ({ name: part.name, visible: visible[k], depth: Float32Array.from(depth[k]) })) },
    sides,
    surface: { sampling, coverage: union, normals, depth: viewDepth },
    // SAFETY: built from the keys of figure.anchors, a Record<A, …>.
    anchors: anchors as Record<A, PaintFigureAnchorSeen<P>>,
  };
}

/**
 * The posed figure's shapes, in px: each part's visible region, the silhouette, the lines where parts meet, and the
 * anchors projected. Pure and deterministic: the same figure, pose and view give the same value, to the bit.
 */
export function posedFigureShapes<J extends string, P extends string, A extends string>(
  figure: PosedPrimitiveFigure<J, P, A>,
  pose: PaintFigurePose<J, P>,
  view: PaintFigureView,
): PaintFigureShapes<P, A> {
  const { fields, anchors } = samplePosedFigure(figure, pose, view);
  // SAFETY: built from the keys of anchors, a Record<A, …>.
  const points = Object.fromEntries(Object.entries<PaintFigureAnchorSeen<P>>(anchors).map(([name, { at }]) => [name, at])) as Record<A, StampPoint>;
  return paintFigureShapesFromFields(fields, points, view.trace ?? PAINT_FIGURE_TRACE_DEFAULTS);
}

/**
 * The posed figure as a subject reads it: every part's area with its holes and the lines it draws, which side each
 * part is on, the nearest surface's analytic normals and depth, and what each anchor's line of sight meets. Pure and
 * deterministic, as posedFigureShapes is.
 */
export function posedFigureProjection<J extends string, P extends string, A extends string>(
  figure: PosedPrimitiveFigure<J, P, A>,
  pose: PaintFigurePose<J, P>,
  view: PaintFigureView,
): PosedFigureProjection<P, A> {
  const { fields, sides, surface, anchors } = samplePosedFigure(figure, pose, view);
  const settings = view.trace ?? PAINT_FIGURE_TRACE_DEFAULTS;
  const traceArea = (parts: readonly P[]) => {
    const inside = fields.parts.filter(({ name }) => parts.includes(name)).map(({ visible }) => visible);
    const outside = fields.parts.filter(({ name }) => !parts.includes(name)).map(({ visible }) => visible);
    // Against another part the edge is where the nearest inside and outside fields are level, the one difference two
    // neighbours read negated, so they meet on the same points; against the background it is the silhouette's own.
    const values = Float32Array.from(fields.union, (silhouette, k) => {
      let mine = -Infinity, theirs = -Infinity;
      for (const field of inside) mine = Math.max(mine, field[k]);
      for (const field of outside) theirs = Math.max(theirs, field[k]);
      return Math.min(silhouette, mine - theirs);
    });
    // Unsmoothed: smoothing each area alone would part the points two neighbours share.
    return tracePaintFigureArea({ ...fields.sampling, values }, { tolerance: 0, smoothing: 0 });
  };
  return { trace: tracePaintFigureFields(fields, settings), sides, surface, anchors, traceArea };
}

/** Declares a figure, checking its joints form a tree; `NoInfer` makes the joint and part names come from their own records. */
export function posedPrimitiveFigure<J extends string, P extends string, A extends string>(figure: {
  readonly joints: Readonly<Record<J, PaintFigureJoint<NoInfer<J>>>>;
  readonly parts: Readonly<Record<P, PaintFigurePrimitivePart<NoInfer<J>>>>;
  readonly anchors: Readonly<Record<A, PaintFigureAnchor<NoInfer<J>, NoInfer<P>>>>;
}): PosedPrimitiveFigure<J, P, A> {
  posedJoints(figure, {});
  return figure;
}
