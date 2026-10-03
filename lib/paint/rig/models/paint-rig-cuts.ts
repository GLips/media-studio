// paint-rig-cuts.ts: a painted layer, one whole painting at rest, divided among the parts cut from it, purely. Drawn
// regions are sampled 4 × 4 per texel; a subsample two regions claim goes, across a skin joint, to the side of the
// joint line it lies on (through the child's pivot, square to its bone), and otherwise to the cut given later. A
// texel then belongs wholly to the cut claiming most of it, so the parts tile the layer and recompose it exactly at
// rest. The matte is the regions' union clipped to the layer's painted coverage: the paint's edge is the silhouette,
// and a region only divides the painting among the parts.

import { stampPolygonDistance, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * A texel grid in the layer's px, the space its regions and pivots are given in: texel (i, j) covers x0 + i … x0 + i + 1,
 * y0 + j … y0 + j + 1.
 */
export type PaintRigTexelBox = { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number };

/**
 * A part as it's declared cut from a layer: its draw order and, below the root, its parent by id and how it meets it
 * there, at its rest `pivot`: a skin joint blending the two parts' moves over `blend` px, or a hinge.
 */
export type PaintRigCutDeclaration = { readonly id: string; readonly z: number } & (
  | { readonly parent: null }
  | { readonly parent: string; readonly joint: 'skin'; readonly pivot: StampPoint; readonly blend: number }
  | { readonly parent: string; readonly joint: 'hinge'; readonly pivot: StampPoint });

/**
 * How a part meets its parent within its layer, the parent an index into the layer's parts. `loose`: its parent isn't
 * cut from this layer (or it has none), so it starts a group of its own here, as a root does.
 */
export type PaintRigCutJoint =
  | { readonly kind: 'loose' }
  | { readonly kind: 'skin'; readonly parent: number; readonly pivot: StampPoint; readonly blend: number }
  | { readonly kind: 'hinge'; readonly parent: number; readonly pivot: StampPoint };

/** A part as its layer's cuts know it. */
export type PaintRigCutPart = { readonly id: string; readonly z: number; readonly joint: PaintRigCutJoint };

/**
 * A layer's cuts: `parts` cut from it; `owner` each texel's part (an index into `parts`, -1 none); `matte` the
 * layer's coverage; `overlaps` each hinge part's extra texels past its joint, taken from its parent's.
 */
export type PaintRigCutLayer = {
  readonly id: string; readonly box: PaintRigTexelBox; readonly parts: readonly PaintRigCutPart[];
  readonly owner: Int16Array; readonly matte: Float32Array; readonly overlaps: ReadonlyMap<number, Uint8Array>;
};

/** `declared`, one layer's parts in order, with each parent found among them. */
export function paintRigCutParts(declared: readonly PaintRigCutDeclaration[]): PaintRigCutPart[] {
  const index = new Map(declared.map((part, k) => [part.id, k]));
  return declared.map((part): PaintRigCutPart => {
    const { id, z } = part, parent = part.parent === null ? undefined : index.get(part.parent);
    if (!('joint' in part) || parent === undefined) return { id, z, joint: { kind: 'loose' } };
    if (part.joint === 'skin') return { id, z, joint: { kind: 'skin', parent, pivot: part.pivot, blend: part.blend } };
    return { id, z, joint: { kind: 'hinge', parent, pivot: part.pivot } };
  });
}

/** What a hinge child takes past its joint, besides its own region: a disc about its pivot, or a region drawn by hand. */
export type PaintRigOverlapZone = { readonly radius: number } | { readonly polygon: readonly StampPoint[] };

/** A part's region of a layer as drawn by hand, in the layer's px; a hinge's with its overlap, if it was given one. */
export type PaintRigDrawnCut =
  | { readonly part: Exclude<PaintRigCutDeclaration, { readonly joint: 'hinge' }>; readonly polygon: readonly StampPoint[]; readonly overlap?: never }
  | { readonly part: Extract<PaintRigCutDeclaration, { readonly joint: 'hinge' }>; readonly polygon: readonly StampPoint[]; readonly overlap: PaintRigOverlapZone | null };

/** A layer's cuts resolved from drawn regions, with `region`, the regions' union as drawn, before the paint clips it. */
export type PaintRigDrawnCutLayer = PaintRigCutLayer & { readonly region: Float32Array };

const SUB = 4;

function polygonCentroid(polygon: readonly StampPoint[]): StampPoint {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], cross = a.x * b.y - b.x * a.y;
    area += cross; cx += (a.x + b.x) * cross; cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) return { x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length, y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length };
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/** A child's bone at its pivot: the unit vector from its pivot toward its region's centroid (straight down if they meet). */
function cutBone(pivot: StampPoint, polygon: readonly StampPoint[]): StampPoint {
  const c = polygonCentroid(polygon), dx = c.x - pivot.x, dy = c.y - pivot.y, length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 0, y: 1 };
}

/** Where a subrow at `y` crosses `polygon`'s edges, in order: even-odd, so each pair is a span inside it. */
function spans(polygon: readonly StampPoint[], y: number): number[] {
  const crossings: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if ((a.y <= y) !== (b.y <= y)) crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return crossings.toSorted((a, b) => a - b);
}

/** The texels `zone` covers about `pivot`, as a test of a texel's centre. */
function inZone(zone: PaintRigOverlapZone, pivot: StampPoint): (x: number, y: number) => boolean {
  if ('radius' in zone) return (x, y) => Math.hypot(x - pivot.x, y - pivot.y) <= zone.radius;
  return (x, y) => stampPolygonDistance(zone.polygon, x, y) >= 0;
}

/**
 * Layer `layer`'s `cuts` (in the order given) resolved within `sheet` (w × h px) over `painted`, the layer's painted
 * coverage per sheet texel. A hinge drawn over a parent cut from the same layer needs its overlap; throws without one.
 */
export function resolvePaintRigCutLayer(layer: string, cuts: readonly PaintRigDrawnCut[], sheet: { readonly w: number; readonly h: number }, painted: Float32Array): PaintRigDrawnCutLayer {
  const parts = paintRigCutParts(cuts.map(({ part }) => part)), all = cuts.flatMap(({ polygon }) => polygon);
  const x0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p.x)))), y0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p.y))));
  const box = { x0, y0, w: Math.min(sheet.w, Math.ceil(Math.max(...all.map((p) => p.x)))) - x0, h: Math.min(sheet.h, Math.ceil(Math.max(...all.map((p) => p.y)))) - y0 };
  // Each skin child's joint line.
  const lines = parts.map(({ joint }, k) => (joint.kind === 'skin' ? { parent: joint.parent, pivot: joint.pivot, bone: cutBone(joint.pivot, cuts[k].polygon) } : undefined));
  const resolve = (earlier: number, later: number, x: number, y: number): number => {
    let across = -1;
    if (lines[later]?.parent === earlier) across = later;
    else if (lines[earlier]?.parent === later) across = earlier;
    if (across < 0) return later;
    const { pivot, bone, parent } = lines[across]!;
    return (x - pivot.x) * bone.x + (y - pivot.y) * bone.y >= 0 ? across : parent;
  };
  const sw = box.w * SUB, claims = new Int16Array(sw * box.h * SUB).fill(-1);
  cuts.forEach(({ polygon }, k) => {
    for (let row = 0; row < box.h * SUB; row++) {
      const y = box.y0 + (row + 0.5) / SUB, xs = spans(polygon, y);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const from = Math.max(0, Math.ceil((xs[s] - box.x0) * SUB - 0.5)), to = Math.min(sw - 1, Math.ceil((xs[s + 1] - box.x0) * SUB - 0.5) - 1);
        for (let col = from; col <= to; col++) {
          const at = row * sw + col, before = claims[at];
          claims[at] = before < 0 ? k : resolve(before, k, box.x0 + (col + 0.5) / SUB, y);
        }
      }
    }
  });
  const owner = new Int16Array(box.w * box.h).fill(-1), region = new Float32Array(box.w * box.h), matte = new Float32Array(box.w * box.h), counts = new Int32Array(parts.length);
  for (let j = 0; j < box.h; j++) for (let i = 0; i < box.w; i++) {
    let claimed = 0, best = -1;
    for (let sj = 0; sj < SUB; sj++) for (let si = 0; si < SUB; si++) {
      const k = claims[(j * SUB + sj) * sw + i * SUB + si];
      if (k < 0) continue;
      claimed++;
      counts[k]++;
      if (best < 0 || counts[k] > counts[best] || (counts[k] === counts[best] && k > best)) best = k;
    }
    counts.fill(0);
    if (!claimed) continue;
    const t = j * box.w + i;
    region[t] = claimed / (SUB * SUB);
    matte[t] = region[t] * painted[(box.y0 + j) * sheet.w + box.x0 + i];
    if (matte[t] > 0) owner[t] = best;
  }
  const overlaps = new Map<number, Uint8Array>();
  cuts.forEach((cut, k) => {
    const part = parts[k], { joint } = part;
    if (joint.kind !== 'hinge' || !('overlap' in cut)) return;
    // A hinge drawn beneath its parent has its seam covered by it; what its turn uncovers is cut from a layer behind.
    if (!cut.overlap && part.z < parts[joint.parent].z) return;
    if (!cut.overlap) throw new Error(`paint rig: cut ${part.id} is a hinge drawn over ${parts[joint.parent].id} on ${layer} with no overlap; give it one (a radius in px, or a region)`);
    const zone = inZone(cut.overlap, joint.pivot), extra = new Uint8Array(box.w * box.h);
    for (let j = 0; j < box.h; j++) for (let i = 0; i < box.w; i++) {
      const t = j * box.w + i;
      if (owner[t] === joint.parent && matte[t] >= 1 && zone(box.x0 + i + 0.5, box.y0 + j + 0.5)) extra[t] = 1;
    }
    overlaps.set(k, extra);
  });
  return { id: layer, box, parts, owner, region, matte, overlaps };
}
