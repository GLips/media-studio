import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampRingsDistance } from '#lib/paint/painting/models/stamp-region.ts';
import { subjectVisible } from '#lib/paint/subject/models/subject-geometry.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { burstRays, type BurstRaysOptions } from './subject-burst-rays.ts';

/** A post `width` × `height` at (x, y), its face a landmark near its top. */
function post(x: number, y: number, width: number, height: number) {
  const ring = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  return defineSubject({
    id: 'post', materials: [{ id: 'wood', localColor: '#8a5a30' }],
    parts: [{ id: 'pole', material: 'wood', visibility: subjectVisible({ rings: [ring] }) }], silhouette: subjectVisible({ rings: [ring] }),
    features: [{ id: 'nose', kind: 'landmark', owner: 'pole', groups: ['face'], visibility: subjectVisible({ at: { x: x + width / 2, y: y + 8 } }) }],
  });
}

const options: BurstRaysOptions = { brush: { style: 'watercolor', brush: 'ink' }, inks: ['#00a0e3', '#e5007e', '#ffe100'], token: 'initial/0', density: 24 };

/** Every ray's points, ray by ray. */
function rays(...args: Parameters<typeof burstRays>): StampPoint[][] {
  return burstRays(...args).flatMap((layer) => (layer.washes ?? []).flatMap(({ applications }) =>
    applications.flatMap((application) => (application.kind === 'stroke' ? application.subpaths.map((path) => [...path]) : []))));
}

test('rays aim at the body from clear of it, the face kept clearer, and run well past it', () => {
  const subject = post(400, 300, 100, 200), dealt = rays(subject, options);
  assert.ok(dealt.length >= 12);
  const ring = [[{ x: 400, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 500 }, { x: 400, y: 500 }]];
  for (const [tip, , , , , , , , , , , , end] of dealt) {
    assert.ok(stampRingsDistance(ring, tip.x, tip.y) <= -0.04 * 200 + 1e-6, 'the inner tip keeps its air');
    assert.ok(Math.hypot(tip.x - 450, tip.y - 308) >= 3 * 0.04 * 200 - 1e-6, 'no tip crowds the face');
    assert.ok(Math.hypot(end.x - 450, end.y - 400) > 160, 'the ray reaches far past the body');
    // Inner tip, outer end and the body's middle in one line: the ray points at the actor.
    const cross = (tip.x - 450) * (end.y - 400) - (tip.y - 400) * (end.x - 450);
    assert.ok(Math.abs(cross) / Math.hypot(end.x - tip.x, end.y - tip.y) < 1);
  }
});

/** Rays' points moved by (dx, dy), to the px: float noise in the walk is no change of deal. */
const rounded = (dealt: StampPoint[][], dx: number, dy: number) => dealt.map((ray) => ray.map(({ x, y }) => [Math.round(x + dx), Math.round(y + dy)]));

test('one token holds the same rays wherever the actor stands; a new token redraws them', () => {
  const here = rays(post(400, 300, 100, 200), options), moved = rays(post(100, 50, 100, 200), options);
  assert.deepEqual(rounded(moved, 300, 250), rounded(here, 0, 0));
  assert.notDeepEqual(rays(post(400, 300, 100, 200), { ...options, token: '1/0' }), here);
});
