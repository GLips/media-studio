import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampRoundedForm } from './stamp-form.ts';
import { stampPolygonDistance, stampRegionPolygon, type StampRegion } from './stamp-region.ts';

test('a ball lit from the upper left is shaded on its lower right, its core inside it and its lit edge facing the light', () => {
  const ball: StampRegion = { kind: 'ellipse', x: 200, y: 200, radiusX: 100, radiusY: 100 };
  const toward = -0.75 * Math.PI, elevation = Math.PI / 6;
  const form = stampRoundedForm({ outline: ball, light: { direction: toward, elevation } });
  // Lambert on a sphere: the terminator is a great circle square to the light, tilted toward the viewer by the
  // elevation, so on the axis away from the light it crosses r·sin(elevation) past the centre.
  const away = [Math.cos(toward + Math.PI), Math.sin(toward + Math.PI)] as const;
  const onAxis = (k: number) => [200 + k * away[0], 200 + k * away[1]] as const;
  assert.equal(form.shade.length, 1);
  const shade = stampRegionPolygon(form.shade[0]), crossing = 100 * Math.sin(elevation);
  assert.ok(stampPolygonDistance(shade, ...onAxis(crossing + 3)) > 0 && stampPolygonDistance(shade, ...onAxis(crossing - 3)) < 0 && stampPolygonDistance(shade, ...onAxis(97)) > 0);
  assert.ok(form.light(200 - 60, 200 - 60) > 0.8 && form.light(200 + 70, 200 + 70) === 0);
  // The core is the terminator's arc, never the silhouette; the lit edge is the outline's half toward the light.
  assert.ok(form.core.length === 1 && form.core[0].every(({ x, y }) => stampPolygonDistance(stampRegionPolygon(ball), x, y) > 1));
  assert.ok(form.core[0].some(({ x, y }) => Math.hypot(x - onAxis(crossing)[0], y - onAxis(crossing)[1]) < 3));
  assert.ok(form.lit.length === 1 && form.lit[0].every(({ x, y }) => (x - 200) * away[0] + (y - 200) * away[1] < 2));
});

test("a form's ellipse is fitted to its outline, and a front light leaves no shade", () => {
  // An ellipse 120 by 50 turned 0.4 rad, traced as a polygon: its moments give it back.
  const turned = Array.from({ length: 180 }, (_, i) => {
    const t = (i / 180) * 2 * Math.PI, x = 120 * Math.cos(t), y = 50 * Math.sin(t);
    return { x: 300 + x * Math.cos(0.4) - y * Math.sin(0.4), y: 150 + x * Math.sin(0.4) + y * Math.cos(0.4) };
  });
  const form = stampRoundedForm({ outline: { kind: 'polygon', points: turned }, light: { direction: 0, elevation: Math.PI / 2 } });
  const { x, y, radiusX, radiusY, rotation } = form.ellipse;
  assert.ok(Math.hypot(x - 300, y - 150) < 0.01 && Math.abs(radiusX - 120) < 0.1 && Math.abs(radiusY - 50) < 0.1 && Math.abs(rotation - 0.4) < 1e-3, JSON.stringify(form.ellipse));
  assert.deepEqual(form.shade, []);
  assert.ok(form.light(300, 150) > 0.999);
});
