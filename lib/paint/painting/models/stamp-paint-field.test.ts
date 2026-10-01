import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPaintFieldAt, type StampPaintField } from './stamp-paint-field.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampDeposit } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { compileStampWetness, stampWetGrid } from './stamp-wetness.ts';
import { stampGridAt } from './stamp-region.ts';

const brush: StampBrush = {
  name: 'Round',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({}),
  scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 1,
};
const blue: PaintMaterial = { kind: 'color', color: '#336699' }, rose: PaintMaterial = { kind: 'color', color: '#cc6688' };
const path = [{ x: 20, y: 100 }, { x: 380, y: 120 }];

/** A deposit's material as a number field, its ends read as 0 and 1, so where it sits between them can be compared. */
function materialShare(deposit: CompiledStampDeposit, x: number, y: number): number {
  assert.equal(deposit.action.kind, 'paint');
  const material = deposit.action.material;
  assert.equal(material.kind, 'noise');
  return stampPaintFieldAt({ ...material, a: 0, b: 1 }, x, y);
}

test('deposits naming one seed share a passage of noise; unseeded, each mottles by its own ID, whatever its boil epoch', () => {
  const passage = { kind: 'noise' as const, scale: 24, seed: 'sky', a: blue, b: rose };
  const own = { kind: 'noise' as const, scale: 24, a: blue, b: rose };
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1, boil: { every: 2 } }, (group) => group.pass('p', {}, (pass) => {
    pass.stroke('left', { brush, diameter: 30, material: passage, path });
    pass.stroke('right', { brush, diameter: 30, material: passage, path });
    pass.stroke('a', { brush, diameter: 30, material: own, path });
    pass.stroke('b', { brush, diameter: 30, material: own, path });
  }))));
  const [group] = painting.groups;
  const [left, right, a, b] = stampPassDeposits(group.passes[0]);
  const points = [[10, 10], [57.5, 133], [301, 42.25], [210, 290]] as const;
  const shares = (deposit: CompiledStampDeposit) => points.map(([x, y]) => materialShare(deposit, x, y));
  assert.deepEqual(shares(left), shares(right));
  assert.notDeepEqual(shares(a), shares(b));
  // A boil's epoch reshapes marks, never where the colour mottles.
  assert.deepEqual(shares(stampPassDeposits(group.boil!.reseeded(1).passes[0])[2]), shares(a));
});

// A dry medium fills in strokes unless it says, each stamp's opacity its load.
const shading: StampBrush = { ...brush, media: 'dry' };

test("noise spreads smoothly over nearly all of its range, in a fill's load and a preparation's wetness alike", () => {
  const wetness: StampPaintField<number> = { kind: 'noise', scale: 20, a: 0.2, b: 1 };
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.wash('w', {
    preparation: { region: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] }, wetness },
  }, (wash) => wash.fill('sky', { brush: shading, diameter: 30, region: { kind: 'ellipse', x: 200, y: 150, radiusX: 150, radiusY: 100 }, material: blue, load: { kind: 'noise', scale: 30, a: 0, b: 1 } })))));
  const pass = painting.groups[0].passes[0];
  assert.equal(pass.kind, 'wash');
  const prepared = pass.wash.preparation!.wetness;
  // Its pass's ID seeds a preparation's noise.
  assert.deepEqual(prepared, { ...wetness, seed: 'g/w' });
  const values: number[] = [];
  let steepest = 0;
  for (let y = 0; y < 300; y += 2) {
    for (let x = 0; x < 400; x += 2) {
      const value = stampPaintFieldAt(prepared, x, y);
      values.push(value);
      steepest = Math.max(steepest, Math.abs(stampPaintFieldAt(prepared, x + 1, y) - value));
    }
  }
  assert.ok(Math.min(...values) < 0.22 && Math.max(...values) > 0.98, `range ${Math.min(...values)}..${Math.max(...values)}`);
  assert.ok(steepest < 0.1, `a pixel's step ${steepest}`);
  // The paper lies as wet as the field before any paint lands, and each stroke stamp's opacity follows its load.
  const [sky] = stampPassDeposits(pass);
  const before = compileStampWetness(painting, () => PAINT_MEDIA.watercolour, { color: '#ffffff' }, { width: 400, height: 300 }).landings.get(sky)!.before;
  for (const [x, y] of [[96, 104], [200, 152], [304, 200]]) assert.ok(Math.abs(stampGridAt(stampWetGrid(before, 'wetness'), x, y) - stampPaintFieldAt(prepared, x, y)) < 1e-6);
  const opacities = sky.stamps.map(({ opacity }) => opacity);
  assert.ok(Math.min(...opacities) < 0.1 && Math.max(...opacities) > 0.9, `stamp opacities ${Math.min(...opacities)}..${Math.max(...opacities)}`);
});
