import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampPoint, StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { svgPathRegions } from './svg-path-figure.ts';

const flat = (shapes: { regions: StampRegion[]; paths: StampPoint[][] }) => [...shapes.regions.flatMap((region) => (region.kind === 'polygon' ? region.points : [])), ...shapes.paths.flat()];

test('relative path data reads as its absolute twin, every command, and an open subpath is a path', () => {
  const absolute = 'M10 10 H60 V40 C60 60 40 70 30 70 S10 60 10 40 Q10 30 15 25 T10 10 Z M100 100 L120 130';
  const relative = 'm10 10 h50 v30 c0 20-20 30-30 30 s-20-10-20-30 q0-10 5-15 t-5-15 z m90 90 l20 30';
  const placement = { x: 5, y: -3, scale: 2 };
  const a = svgPathRegions(absolute, placement), r = svgPathRegions(relative, placement);
  assert.equal(a.regions.length, 1);
  assert.equal(a.paths.length, 1);
  const [pa, pr] = [flat(a), flat(r)];
  assert.equal(pa.length, pr.length);
  pa.forEach((p, i) => assert.ok(Math.abs(p.x - pr[i].x) < 1e-9 && Math.abs(p.y - pr[i].y) < 1e-9, `point ${i}`));
  assert.deepEqual(pa[0], { x: 25, y: 17 });
  assert.throws(() => svgPathRegions('M0 0 A10 10 0 0 1 20 0'), /arcs/);
});
