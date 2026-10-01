import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampPaint } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPassageOptions, StampPassageScope } from './stamp-paint-recipe-types.ts';
import { stampSizeToken } from './stamp-paint-sizes.ts';
import { stampCharge } from './stamp-wet-techniques.ts';

const brush: StampBrush = {
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 's', pack: 'p', file: 'tip.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25, stepping: 'spread', dynamics: stampLinearDynamics({ size: { random: 0.3 }, rotation: { random: 0.5 } }), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};
const paper = { color: '#ffffff' } as const;
const blue = { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 0.6 } as const;
const WATERCOLOUR: StampPaintEnvironment = { paper, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W } };
const CRAYON: StampPaintEnvironment = { paper, mixing: { kind: 'pigment', medium: PAINT_MEDIA.crayon, pigments: W } };
const line = (y: number) => [{ x: 20, y }, { x: 380, y: y + 10 }];

/** One passage `p` of group `g`, written by `body` against `environment`, compiled. */
const painted = (body: (p: StampPassageScope) => void, options: StampPassageOptions = {}, environment = WATERCOLOUR): CompiledStampPaint =>
  compileStampPaintRecipe(stampPaintRecipe(environment, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) =>
    group.passage('p', { defaults: { brush, well: { paint: blue } }, ...options }, body))));
const depositsOf = (painting: CompiledStampPaint) => stampPassDeposits(painting.groups[0].passes[0]);

test('wrapping calls in an apply changes no deposit, and an item of p.each keeps its deposits as others are added or reordered', () => {
  const strokes = (p: StampPassageScope) => {
    p.stroke('sky', { size: 30, path: line(40) });
    stampCharge(p, 'warm', { placement: { kind: 'area', region: { kind: 'ellipse', x: 200, y: 60, radiusX: 80, radiusY: 30 } }, touches: 3, size: [10, 16], length: [20, 30] });
  };
  assert.deepEqual(painted((p) => p.apply('sky', {}, strokes)).groups, painted(strokes).groups);

  const leaves = (ids: readonly string[]) => painted((p) => p.each('leaf', ids.map((id, k) => ({ id, y: 100 + k })), (q, { y }) => q.stroke('dab', { size: 12, path: line(y) })));
  const [a, b] = depositsOf(leaves(['a', 'b']));
  const more = depositsOf(leaves(['c', 'b', 'a']));
  assert.deepEqual([a.id, b.id], ['g/p/leaf/a/dab', 'g/p/leaf/b/dab']);
  // Their paths moved with their place in the list; their seeds didn't, so each lays the same stamps along its own.
  assert.deepEqual(more.find(({ id }) => id === a.id)!.stamps.map(({ rotation }) => rotation), a.stamps.map(({ rotation }) => rotation));
  assert.throws(() => leaves(['a', 'a']), /two applications are named/);
});

test("a condition in a medium that can't judge one is refused as it's written, naming the medium", () => {
  assert.throws(
    () => painted((p) => p.stroke('line', { size: 8, path: line(40), when: 'damp' }), {}, CRAYON),
    (error: Error) => /g\/p/.test(error.message) && /'wet-conditions'/.test(error.message) && /crayon/.test(error.message),
  );
  // The same stroke without the condition draws.
  assert.equal(depositsOf(painted((p) => p.stroke('line', { size: 8, path: line(40) }), {}, CRAYON)).length, 1);
});

test("a named size is measured on the painting's sheet, and refused without one", () => {
  const broad = stampSizeToken('broad', 10);
  const sized = (environment: StampPaintEnvironment) => depositsOf(painted((p) => p.stroke('s', { size: broad, path: line(40) }), {}, environment))[0].diameter;
  assert.equal(sized({ ...WATERCOLOUR, sheet: { pxPerMm: 4 } }), 40);
  assert.throws(() => sized(WATERCOLOUR), /sized broad, and a named size needs the painting's sheet/);
});
