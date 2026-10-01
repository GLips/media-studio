// stamp-form.ts: where a rounded form turns from the light, as guides for painting it: its shade, the core along the
// shade's inner edge, and the stretches of its outline that face the light.
//
// The form is assumed, not measured: an ellipsoid over an ellipse in the picture plane (fitted to the outline when
// none is given), its depth the ellipse's shorter radius, as an apple, a stone or a cheek is about as deep as it is
// narrow. Lambert's cosine law over its normals gives the light; a painter's eye decides whether the assumption fits.
// Faceted forms, cast shadows and reflected light aren't inferred.

import { stampDistanceGrid, stampGridContours, stampPolygonBox, stampPolygonDistance, stampRegionPolygon, type StampPoint, type StampRegion } from './stamp-region.ts';

/** An ellipse in the picture plane: its centre, its radii along its own axes, px, and `rotation`, radians, of its x axis. */
export type StampFormEllipse = { x: number; y: number; radiusX: number; radiusY: number; rotation: number };

/**
 * Where the light comes from. `direction`: radians in the picture plane toward the light (0 to the right, π/2 down,
 * as the painting's y runs). `elevation`: radians from the picture plane toward the viewer, π/2 lighting the form
 * from the front, 0 grazing it from the side, below 0 from behind it.
 */
export type StampFormLight = { direction: number; elevation: number };

/**
 * A rounded form to shade. `outline`: its silhouette, which shade and lit edges keep to. `ellipse`: the form's
 * ellipsoid, fitted to the outline by its moments when left out. `terminator`: the light (0..1 Lambert) below which
 * it's in shade, 0 when left out: where the light grazes it.
 */
export type StampRoundedFormSettings = { outline: StampRegion; ellipse?: StampFormEllipse; light: StampFormLight; terminator?: number };

/** A rounded form's guides, and the ellipse it was assumed over. */
export type StampRoundedForm = {
  ellipse: StampFormEllipse;
  /** Each part of the outline in shade. */
  shade: StampRegion[];
  /** The shade's edges inside the form, away from the silhouette, where a painter lays the core; not reflected light. */
  core: StampPoint[][];
  /** The outline's stretches facing the light in the picture plane, for lost edges. */
  lit: StampPoint[][];
  /** The Lambert term, 0..1, off the ellipsoid (its rim's beyond it), for grading a load or a material across the form. */
  light: (x: number, y: number) => number;
};

/** Cells across the form's shorter radius for the shade's grid: its edge within a couple of px on a sizeable form. */
const FORM_GRID_CELLS = 48;
/** How far inside the silhouette, in grid cells, a shade's edge counts as the core rather than the outline's. */
const CORE_MARGIN = 1.5;

/** `outline`'s shade, core and lit edges as a rounded form lit by `light` (StampRoundedFormSettings). */
export function stampRoundedForm({ outline, ellipse: given, light, terminator = 0 }: StampRoundedFormSettings): StampRoundedForm {
  const polygon = stampRegionPolygon(outline);
  const ellipse = given ?? (outline.kind === 'ellipse' ? { ...outline, rotation: 0 } : stampFittedEllipse(polygon));
  if (![ellipse.x, ellipse.y, ellipse.rotation].every(Number.isFinite) || !(ellipse.radiusX > 0 && ellipse.radiusY > 0 && Number.isFinite(ellipse.radiusX * ellipse.radiusY))) {
    throw new Error(`stamp paint: a rounded form needs an ellipse of finite place and positive radii, not ${JSON.stringify(ellipse)}`);
  }
  if (!(Math.abs(light.elevation) <= Math.PI / 2 && Number.isFinite(light.direction))) throw new Error(`stamp paint: a rounded form's light needs a finite direction and an elevation of -π/2..π/2, not ${JSON.stringify(light)}`);
  if (!(terminator > -1 && terminator < 1)) throw new Error(`stamp paint: a rounded form's terminator is a light between -1 and 1, not ${terminator}`);
  const lambert = stampEllipsoidLambert(ellipse, light);
  const shorter = Math.min(ellipse.radiusX, ellipse.radiusY), cell = Math.max(1, shorter / FORM_GRID_CELLS);
  // Positive in shade and inside the outline: the lesser of the two, the light's shortfall in px as the ellipsoid
  // turns, so its edge interpolates as the outline's does.
  const field = stampDistanceGrid(polygon, stampPolygonBox(polygon, 2 * cell), cell);
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.columns; i++) {
      const at = j * field.columns + i;
      field.values[at] = Math.min(field.values[at], (terminator - lambert(field.x0 + i * cell, field.y0 + j * cell)) * shorter);
    }
  }
  const loops = stampGridContours(field, 0);
  const core = loops.flatMap((loop) => cyclicRuns(loop, ({ x, y }) => stampPolygonDistance(polygon, x, y) > CORE_MARGIN * cell));
  return {
    ellipse,
    shade: loops.map((points): StampRegion => ({ kind: 'polygon', points })),
    core,
    lit: cyclicRuns(polygon, facingLight(polygon, light.direction)),
    light: (x, y) => Math.min(1, Math.max(0, lambert(x, y))),
  };
}

/** The ellipse with `polygon`'s area, centroid and second moments: a solid ellipse's covariance is its radii² / 4. */
export function stampFittedEllipse(polygon: readonly StampPoint[]): StampFormEllipse {
  let area = 0, cx = 0, cy = 0, xx = 0, yy = 0, xy = 0;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length], cross = a.x * b.y - b.x * a.y;
    area += cross / 2;
    cx += ((a.x + b.x) * cross) / 6;
    cy += ((a.y + b.y) * cross) / 6;
    xx += ((a.x * a.x + a.x * b.x + b.x * b.x) * cross) / 12;
    yy += ((a.y * a.y + a.y * b.y + b.y * b.y) * cross) / 12;
    xy += ((a.x * b.y + 2 * a.x * a.y + 2 * b.x * b.y + b.x * a.y) * cross) / 24;
  });
  const x = cx / area, y = cy / area;
  const sxx = xx / area - x * x, syy = yy / area - y * y, sxy = xy / area - x * y;
  const rotation = Math.atan2(2 * sxy, sxx - syy) / 2, mean = (sxx + syy) / 2, spread = Math.hypot((sxx - syy) / 2, sxy);
  return { x, y, radiusX: 2 * Math.sqrt(mean + spread), radiusY: 2 * Math.sqrt(Math.max(0, mean - spread)), rotation };
}

/**
 * The Lambert term (unclipped, -1..1) at a point of `ellipse`'s ellipsoid, its depth the shorter radius; past its rim,
 * the rim's nearest normal, so the light carries on smoothly to an outline the ellipse doesn't quite cover.
 */
function stampEllipsoidLambert({ x: ex, y: ey, radiusX: a, radiusY: b, rotation }: StampFormEllipse, { direction, elevation }: StampFormLight) {
  const c = Math.min(a, b), cos = Math.cos(rotation), sin = Math.sin(rotation);
  const flat = Math.cos(elevation), toward = [flat * Math.cos(direction), flat * Math.sin(direction), Math.sin(elevation)];
  return (x: number, y: number) => {
    const dx = x - ex, dy = y - ey;
    let p = (dx * cos + dy * sin) / a, q = (-dx * sin + dy * cos) / b;
    const rim = Math.hypot(p, q);
    if (rim > 1) [p, q] = [p / rim, q / rim];
    // The gradient of x²/a² + y²/b² + z²/c² at the point, with z from p and q: the outward normal, in the ellipse's frame.
    const z = Math.sqrt(Math.max(0, 1 - p * p - q * q)), u = p / a, v = q / b, w = z / c;
    const length = Math.hypot(u, v, w) || 1;
    const nx = (u * cos - v * sin) / length, ny = (u * sin + v * cos) / length, nz = w / length;
    return nx * toward[0] + ny * toward[1] + nz * toward[2];
  };
}

/** Whether each of `polygon`'s points faces the light in the picture plane: its outward normal turned toward `direction`. */
function facingLight(polygon: readonly StampPoint[], direction: number): (point: StampPoint, index: number) => boolean {
  let twiceArea = 0;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    twiceArea += a.x * b.y - b.x * a.y;
  });
  // With y down, a positive area runs clockwise on screen, its outside to the left of travel: (dy, -dx).
  const outward = twiceArea > 0 ? 1 : -1, lx = Math.cos(direction), ly = Math.sin(direction);
  return (_, i) => {
    const before = polygon[(i - 1 + polygon.length) % polygon.length], after = polygon[(i + 1) % polygon.length];
    const dx = after.x - before.x, dy = after.y - before.y;
    return outward * (dy * lx - dx * ly) > 0;
  };
}

/**
 * The open runs of closed `loop` whose points pass `keep`, each in loop order; a loop that keeps every point comes
 * back whole, closed.
 */
function cyclicRuns(loop: readonly StampPoint[], keep: (point: StampPoint, index: number) => boolean): StampPoint[][] {
  const kept = loop.map(keep);
  if (kept.every(Boolean)) return [[...loop, loop[0]]];
  // Start just after a dropped point, so no run wraps past the loop's end.
  const start = kept.indexOf(false) + 1, runs: StampPoint[][] = [];
  let run: StampPoint[] = [];
  for (let k = 0; k < loop.length; k++) {
    const i = (start + k) % loop.length;
    if (kept[i]) run.push(loop[i]);
    else if (run.length) runs.push(run.splice(0));
  }
  if (run.length) runs.push(run);
  return runs.filter((points) => points.length > 1);
}
