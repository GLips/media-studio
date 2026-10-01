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
import { paintFigureSampling, paintFigureShapesFromFields, type PaintFigureShapes } from './paint-figure-shapes.ts';
import { PAINT_FIGURE_TRACE_DEFAULTS, type PaintFigureTraceSettings } from './paint-figure-trace.ts';

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

/**
 * The posed figure's shapes, in px: each part's visible region, the silhouette, the lines where parts meet, and the
 * anchors projected. Pure and deterministic: the same figure, pose and view give the same value, to the bit.
 */
export function posedFigureShapes<J extends string, P extends string, A extends string>(
  figure: PosedPrimitiveFigure<J, P, A>,
  pose: PaintFigurePose<J, P>,
  view: PaintFigureView,
): PaintFigureShapes<P, A> {
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
    const toCamera = compose(camera, partAffine(name));
    const primitives = figure.parts[name].primitives.map((primitive): CameraPrimitive => {
      const onJoint = compose(toCamera, joints.get(primitive.joint)!);
      if (primitive.kind === 'ellipsoid') {
        const [rx, ry, rz] = primitive.radii;
        const local: Affine = { m: multiply(turnMatrix(primitive.turn ?? {}), [rx, 0, 0, 0, ry, 0, 0, 0, rz]), t: [...(primitive.at ?? [0, 0, 0])] };
        const whole = compose(onJoint, local);
        const extent = [0, 3, 6].map((row) => Math.hypot(whole.m[row], whole.m[row + 1], whole.m[row + 2]));
        return { kind: 'ellipsoid', inverse: invert(whole.m), centre: whole.t, edgeScale: Math.min(rx, ry, rz) * grow, box: boxOf(cornersAround(whole.t, extent)) };
      }
      const a = place(onJoint, primitive.from ?? [0, 0, 0]), b = place(onJoint, primitive.to), radius = primitive.radius * grow;
      const lo = [0, 1, 2].map((i) => Math.min(a[i], b[i])), hi = [0, 1, 2].map((i) => Math.max(a[i], b[i]));
      return { kind: 'capsule', a, b, radius, box: boxOf(cornersAround(lo.map((v, i) => (v + hi[i]) / 2), lo.map((v, i) => (hi[i] - v) / 2 + radius))) };
    });
    const box = [Math.min(...primitives.map((p) => p.box[0])), Math.min(...primitives.map((p) => p.box[1])), Math.max(...primitives.map((p) => p.box[2])), Math.max(...primitives.map((p) => p.box[3]))];
    return { name, primitives, box };
  });

  const sampling = paintFigureSampling({ x0: Math.min(...parts.map((p) => p.box[0])), y0: Math.min(...parts.map((p) => p.box[1])), x1: Math.max(...parts.map((p) => p.box[2])), y1: Math.max(...parts.map((p) => p.box[3])) }, cell);
  const { columns, rows } = sampling, count = columns * rows, margin = 2 * cell;
  // Each part is sampled only over its own box, two cells wider, so its edge always lies between real samples.
  const spans = parts.map(({ box }) => ({
    i0: Math.max(0, Math.floor((box[0] - sampling.x0) / cell) - 2), i1: Math.min(columns - 1, Math.ceil((box[2] - sampling.x0) / cell) + 2),
    j0: Math.max(0, Math.floor((box[1] - sampling.y0) / cell) - 2), j1: Math.min(rows - 1, Math.ceil((box[3] - sampling.y0) / cell) + 2),
  }));
  const own = parts.map(() => new Float32Array(count).fill(EMPTY)), depth = parts.map(() => new Float64Array(count).fill(FAR));
  const ray: Ray = { origin: [0, 0, 0], direction: [0, 0, -1] }, met: RayMeeting = { edge: 0, depth: 0, hit: false };
  parts.forEach((part, k) => {
    const { i0, i1, j0, j1 } = spans[k];
    for (let j = j0; j <= j1; j++) {
      const v = (centre.y - (sampling.y0 + j * cell)) / scale;
      for (let i = i0; i <= i1; i++) {
        const u = (sampling.x0 + i * cell - centre.x) / scale, at = j * columns + i;
        if (distance === undefined) {
          // Orthographic: every ray runs straight in from far in front; depth is measured from there, the same for all.
          ray.origin[0] = u; ray.origin[1] = v; ray.origin[2] = ORTHOGRAPHIC_EYE;
        } else {
          const length = Math.hypot(u, v, distance);
          ray.origin[0] = 0; ray.origin[1] = 0; ray.origin[2] = distance;
          ray.direction[0] = u / length; ray.direction[1] = v / length; ray.direction[2] = -distance / length;
        }
        const sx = sampling.x0 + i * cell, sy = sampling.y0 + j * cell;
        let edge = EMPTY / scale, nearestHit = Infinity, missDepth = FAR / scale;
        for (const primitive of part.primitives) {
          // Two cells clear of a primitive's box it can't be the nearest edge any outline passes between.
          if (sx < primitive.box[0] - margin || sx > primitive.box[2] + margin || sy < primitive.box[1] - margin || sy > primitive.box[3] + margin) continue;
          meetRay(primitive, ray, met);
          if (met.hit) nearestHit = Math.min(nearestHit, met.depth);
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
  const anchors = Object.fromEntries(Object.entries<PaintFigureAnchor<J, P>>(figure.anchors).map(([name, anchor]) => {
    const onJoint = place(joints.get(anchor.joint)!, anchor.at ?? [0, 0, 0]);
    const grown = anchor.part === undefined ? onJoint : place(partAffine(anchor.part), onJoint);
    return [name, toScreen(place(camera, grown))];
  }));
  return paintFigureShapesFromFields(
    { sampling, union, parts: parts.map((part, k) => ({ name: part.name, visible: visible[k], depth: Float32Array.from(depth[k]) })) },
    // SAFETY: built from the keys of figure.anchors, a Record<A, …>.
    anchors as Record<A, StampPoint>,
    view.trace ?? PAINT_FIGURE_TRACE_DEFAULTS,
  );
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
