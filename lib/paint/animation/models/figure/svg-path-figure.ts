// svg-path-figure.ts: SVG path data as regions and paths, so a traced or drawn SVG drops in. `svgPathRegions` reads
// one path: closed subpaths become regions, open ones paths to stroke. `svgFigureShapes` takes one path per named
// part, stacked as SVG paints them (later in front), and builds a figure through the shared stage, so an imported
// drawing gets the same parts, silhouette, lines and anchors as any other source.
//
// Negative space: arcs (A) are refused rather than approximated, and transforms, styles and fill rules beyond
// even-odd aren't read. A path's own data is all it takes; flatten arcs in the drawing tool first.

import { stampPolygonBox, stampPolygonDistance, type StampPoint, type StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { paintFigureSampling, paintFigureShapesFromFields, type PaintFigureShapes } from './paint-figure-shapes.ts';
import { PAINT_FIGURE_TRACE_DEFAULTS, type PaintFigureTraceSettings } from './paint-figure-trace.ts';

/** Where SVG units land: a point (x, y) in the path is (place.x + x·scale, place.y + y·scale) px. */
export type SvgPathPlacement = { readonly x: number; readonly y: number; readonly scale: number };

const IDENTITY_PLACEMENT: SvgPathPlacement = { x: 0, y: 0, scale: 1 };

/** How far a flattened curve's chords may stray from it, px. */
const CURVE_TOLERANCE = 0.2;

/** The subpaths of SVG path data, flattened to px: each its points, and whether a Z closed it. */
function svgSubpaths(d: string, placement: SvgPathPlacement): { points: StampPoint[]; closed: boolean }[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtZzAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths: { points: StampPoint[]; closed: boolean }[] = [];
  const px = (x: number, y: number): StampPoint => ({ x: placement.x + x * placement.scale, y: placement.y + y * placement.scale });
  let index = 0, command = '', x = 0, y = 0, startX = 0, startY = 0;
  // The last curve's second control point, for S and T's reflection; reset by any other command.
  let lastControl: { x: number; y: number; cubic: boolean } | undefined;
  let current: { points: StampPoint[]; closed: boolean } | undefined;
  const number = () => {
    const token = tokens[index++];
    if (token === undefined || /[a-z]/i.test(token)) throw new Error(`svgPathRegions: path data ends or breaks where a number should be, in "${d.slice(0, 60)}"`);
    return Number(token);
  };
  const lineTo = (nx: number, ny: number) => { current?.points.push(px(nx, ny)); x = nx; y = ny; };
  const curve = (controls: { x: number; y: number }[], nx: number, ny: number) => {
    const all = [{ x, y }, ...controls, { x: nx, y: ny }].map((p) => px(p.x, p.y));
    // Segments enough that no chord strays CURVE_TOLERANCE px, from the control polygon's second differences.
    const bend = Math.max(...all.slice(2).map((p, i) => Math.hypot(all[i].x - 2 * all[i + 1].x + p.x, all[i].y - 2 * all[i + 1].y + p.y)));
    const steps = Math.max(1, Math.ceil(Math.sqrt(((all.length - 1) * (all.length - 2) * bend) / (8 * CURVE_TOLERANCE))));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      // de Casteljau: the same arithmetic for a quadratic or a cubic.
      let level = all;
      while (level.length > 1) level = level.slice(1).map((p, i) => ({ x: level[i].x + (p.x - level[i].x) * t, y: level[i].y + (p.y - level[i].y) * t }));
      current?.points.push(level[0]);
    }
    x = nx; y = ny;
  };
  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) command = tokens[index++];
    else if (!command) throw new Error(`svgPathRegions: path data must start with a command, not "${tokens[index]}"`);
    const relative = command === command.toLowerCase(), ox = relative ? x : 0, oy = relative ? y : 0;
    const upper = command.toUpperCase();
    let control: typeof lastControl;
    switch (upper) {
      case 'M': {
        const nx = ox + number(), ny = oy + number();
        current = { points: [px(nx, ny)], closed: false };
        subpaths.push(current);
        x = startX = nx; y = startY = ny;
        // Pairs after a moveto are linetos.
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': lineTo(ox + number(), oy + number()); break;
      case 'H': lineTo(ox + number(), y); break;
      case 'V': lineTo(x, oy + number()); break;
      case 'C': {
        const c1 = { x: ox + number(), y: oy + number() }, c2 = { x: ox + number(), y: oy + number() }, nx = ox + number(), ny = oy + number();
        curve([c1, c2], nx, ny);
        control = { ...c2, cubic: true };
        break;
      }
      case 'S': {
        const c1 = lastControl?.cubic ? { x: 2 * x - lastControl.x, y: 2 * y - lastControl.y } : { x, y };
        const c2 = { x: ox + number(), y: oy + number() }, nx = ox + number(), ny = oy + number();
        curve([c1, c2], nx, ny);
        control = { ...c2, cubic: true };
        break;
      }
      case 'Q': {
        const c = { x: ox + number(), y: oy + number() }, nx = ox + number(), ny = oy + number();
        curve([c], nx, ny);
        control = { ...c, cubic: false };
        break;
      }
      case 'T': {
        const c = lastControl && !lastControl.cubic ? { x: 2 * x - lastControl.x, y: 2 * y - lastControl.y } : { x, y };
        curve([c], ox + number(), oy + number());
        control = { ...c, cubic: false };
        break;
      }
      case 'Z':
        if (current) current.closed = true;
        x = startX; y = startY;
        // A command after Z without its own moveto starts a new subpath at the closed one's start.
        current = { points: [px(x, y)], closed: false };
        subpaths.push(current);
        command = '';
        break;
      default:
        throw new Error(`svgPathRegions: "${command}" isn't read (arcs aren't); flatten it to curves first`);
    }
    lastControl = control;
  }
  return subpaths
    .map(({ points, closed }) => {
      const last = points[points.length - 1];
      // A closed subpath that returned to its start by a line ends on its first point: drop the repeat.
      const trimmed = closed && points.length > 1 && Math.hypot(last.x - points[0].x, last.y - points[0].y) < 1e-9 ? points.slice(0, -1) : points;
      return { points: trimmed, closed };
    })
    .filter(({ points, closed }) => points.length >= (closed ? 3 : 2));
}

/** One SVG path's data as px: its closed subpaths as regions, its open ones as paths. */
export function svgPathRegions(d: string, placement: SvgPathPlacement = IDENTITY_PLACEMENT): { regions: StampRegion[]; paths: StampPoint[][] } {
  const subpaths = svgSubpaths(d, placement);
  return {
    regions: subpaths.filter((s) => s.closed).map((s): StampRegion => ({ kind: 'polygon', points: s.points })),
    paths: subpaths.filter((s) => !s.closed).map((s) => s.points),
  };
}

/** A figure from SVG: one path's data per part (back to front), anchors in the SVG's units, placed together. */
export type SvgPathFigure<P extends string, A extends string> = {
  readonly parts: Readonly<Record<P, string>>;
  readonly anchors: Readonly<Record<A, StampPoint>>;
  readonly placement?: SvgPathPlacement;
  readonly cell?: number;
  readonly trace?: PaintFigureTraceSettings;
};

const EMPTY = -1e6;

/**
 * The SVG figure's shapes, px. A part's closed subpaths fill even-odd, as SVG's evenodd rule; its open subpaths join
 * the figure's lines as drawn. Costs a polygon distance per sample, so trace a static drawing once, not per frame.
 */
export function svgFigureShapes<P extends string, A extends string>(figure: SvgPathFigure<P, A>): PaintFigureShapes<P, A> {
  const placement = figure.placement ?? IDENTITY_PLACEMENT, cell = figure.cell ?? 2;
  // SAFETY: the keys of a Record<P, …> are P.
  const names = Object.keys(figure.parts) as P[];
  const read = names.map((name) => svgPathRegions(figure.parts[name], placement));
  const loops = read.map(({ regions }) => regions.flatMap((r) => (r.kind === 'polygon' ? [r.points] : [])));
  const boxes = loops.map((own) => stampPolygonBox(own.flat(), 2 * cell));
  // A part of open strokes alone has no area: it adds lines, and no box.
  const filled = boxes.filter((_, k) => loops[k].length > 0);
  if (filled.length === 0) throw new Error('svgFigureShapes: no part has a closed subpath, so the figure has no area');
  const sampling = paintFigureSampling({ x0: Math.min(...filled.map((b) => b.x0)), y0: Math.min(...filled.map((b) => b.y0)), x1: Math.max(...filled.map((b) => b.x1)), y1: Math.max(...filled.map((b) => b.y1)) }, cell);
  const count = sampling.columns * sampling.rows;
  const inside = names.map(() => new Float32Array(count).fill(EMPTY));
  for (let j = 0; j < sampling.rows; j++) {
    for (let i = 0; i < sampling.columns; i++) {
      const x = sampling.x0 + i * cell, y = sampling.y0 + j * cell, at = j * sampling.columns + i;
      loops.forEach((own, k) => {
        const box = boxes[k];
        if (own.length === 0 || x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return;
        let odd = false, nearest = Infinity;
        for (const loop of own) {
          const distance = stampPolygonDistance(loop, x, y);
          if (distance > 0) odd = !odd;
          nearest = Math.min(nearest, Math.abs(distance));
        }
        inside[k][at] = odd ? nearest : -nearest;
      });
    }
  }
  const union = new Float32Array(count).fill(EMPTY);
  const visible = names.map((_, k) => inside[k].map((value, at) => {
    union[at] = Math.max(union[at], value);
    let field = value;
    for (let other = k + 1; other < names.length; other++) field = Math.min(field, -inside[other][at]);
    return field;
  }));
  // Later parts are nearer, as SVG paints them: a constant depth per part ranks them for the lines.
  const depth = names.map((_, k) => new Float32Array(count).fill((names.length - k) * 100 * cell));
  const shapes = paintFigureShapesFromFields(
    { sampling, union, parts: names.map((name, k) => ({ name, visible: visible[k], depth: depth[k] })) },
    // SAFETY: built from the keys of figure.anchors, a Record<A, …>.
    Object.fromEntries(Object.entries<StampPoint>(figure.anchors).map(([name, p]) => [name, { x: placement.x + p.x * placement.scale, y: placement.y + p.y * placement.scale }])) as Record<A, StampPoint>,
    figure.trace ?? PAINT_FIGURE_TRACE_DEFAULTS,
  );
  return { ...shapes, lines: [...shapes.lines, ...read.flatMap(({ paths }) => paths)] };
}
