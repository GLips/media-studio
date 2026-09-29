import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, visibleStampCountAt, type PaintMaterial, type StampRegion } from './stamp-paint-recipe.ts';

const brush: StampBrush = {
  name: 'Wet Wash',
  blend: 'normal',
  accumulation: 'glaze',
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/wash.png' }, roundness: 1 },
  spacing: 0.1,
  stepping: 'spread',
  jitter: { lateral: 0.2, size: 0.3, opacity: 0.3, flow: 0 },
  scatter: { count: 2, countJitter: 0, radius: 0.1 },
  rotation: { angle: 0, follow: 1, jitter: 0.5, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 0.4,
  pressure: { size: 0.5, opacity: 0.5, flow: 0 },
};
const ochre: PaintMaterial = { kind: 'pigment', color: '#c8902f' };
const path = [{ x: 0, y: 0 }, { x: 300, y: 40 }, { x: 520, y: 10, pressure: 0.4 }];
const sun: StampRegion = { kind: 'ellipse', x: 200, y: 100, radiusX: 40, radiusY: 40 };
const horizon: StampRegion = { kind: 'polygon', points: [{ x: 0, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 320 }] };

test('a clipped pass clips to the nearest unclipped pass before it in its group, and protect masks only the deposits inside it', () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => {
    paint.group('sky', { composite: 'opaque' }, (group) => {
      group.pass('base', {}, (pass) => pass.stroke('fill', { brush, material: ochre, diameter: 60, path }));
      group.pass('texture', { clipped: true }, (pass) => {
        pass.stroke('before', { brush, material: ochre, diameter: 30, path });
        pass.protect([sun], () => {
          pass.stroke('around-sun', { brush, material: ochre, diameter: 30, path });
          group.protect([horizon], () => pass.stroke('nested', { brush, material: ochre, diameter: 30, path }));
        });
        pass.stroke('after', { brush, material: ochre, diameter: 30, path });
      });
      group.pass('blotches', {}, (pass) => pass.stamps('drops', { brush, material: ochre, diameter: 20, at: [{ x: 10, y: 10 }] }));
      group.pass('glints', { clipped: true }, (pass) => pass.stamps('dots', { brush, material: ochre, diameter: 5, at: [{ x: 12, y: 12 }] }));
    });
  }));
  const [sky] = painting.groups;
  assert.deepEqual(sky.passes.map((pass) => [pass.id, pass.clipTo]), [
    ['sky/base', undefined],
    ['sky/texture', 'sky/base'],
    ['sky/blotches', undefined],
    ['sky/glints', 'sky/blotches'],
  ]);
  // Protecting adds a mask to the deposits made inside it and paints nothing of its own: no deposit restores paper.
  assert.deepEqual(sky.passes[1].deposits.map((deposit) => [deposit.id, deposit.protectedBy]), [
    ['sky/texture/before', []],
    ['sky/texture/around-sun', [sun]],
    ['sky/texture/nested', [sun, horizon]],
    ['sky/texture/after', []],
  ]);

  assert.throws(
    () => compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', { clipped: true }, () => {})))),
    /g\/p is clipped, but no unclipped pass comes before it/,
  );
});

test('groups paint far to near by depth, an order overrides depth, and ties keep the order written', () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => {
    paint.group('figure', { composite: 'opaque', depth: 1 }, () => {});
    paint.group('mist', { composite: 'glaze', opacity: 0.3, depth: 5, order: 1 }, () => {});
    paint.group('hills', { composite: 'opaque', depth: 5 }, () => {});
    paint.group('rock', { composite: 'opaque', depth: 1 }, () => {});
  }));
  assert.deepEqual(painting.groups.map((group) => group.id), ['hills', 'figure', 'rock', 'mist']);
});

test('a recipe that would seed or draw wrongly is refused when it compiles, naming what', () => {
  const recipe = stampPaintRecipe((paint) => {
    paint.group('sky', { composite: 'opaque' }, (group) => {
      group.pass('wash', {}, (pass) => {
        pass.stroke('s1', { brush, material: ochre, diameter: 40, path });
        pass.stamps('s1', { brush, material: ochre, diameter: 40, at: [{ x: 0, y: 0 }] });
      });
      // The same name under another pass is another ID.
      group.pass('glaze', {}, (pass) => pass.stroke('s1', { brush, material: ochre, diameter: 40, path }));
    });
    paint.group('sky', { composite: 'glaze', opacity: 0.5 }, () => {});
  });
  assert.throws(() => compileStampPaintRecipe(recipe), (error: Error) =>
    error.message.includes('sky/wash/s1') && error.message.includes(': sky/wash/s1, sky') && !error.message.includes('sky/glaze/s1'));

  const oneStroke = (settings: { diameter: number; appliedAt?: number; drawnOver?: number }) => () => compileStampPaintRecipe(stampPaintRecipe((paint) =>
    paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => pass.stroke('s', { brush, material: ochre, path, ...settings })))));
  assert.throws(oneStroke({ diameter: 0 }), /g\/p\/s has diameter 0/);
  assert.throws(oneStroke({ diameter: 40, drawnOver: 3 }), /g\/p\/s draws over 3s, which needs an appliedAt/);
});

test('a stroke tapers at both ends however short, and turns with its direction from its first stamp', () => {
  const still = { ...brush, jitter: { lateral: 0, size: 0, opacity: 0, flow: 0 }, scatter: { count: 1, countJitter: 0, radius: 0 }, rotation: { ...brush.rotation, jitter: 0 } };
  // A pen often repeats its first point.
  const stroke = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 19 }];
  const [deposit] = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.pass('p', {}, (pass) => pass.stroke('dab', { brush: { ...still, spacing: 0.5 }, material: ochre, diameter: 10, path: stroke }))))).groups[0].passes[0].deposits;
  const sizes = deposit.stamps.map((stamp) => stamp.diameter);
  assert.equal(sizes[0], sizes.at(-1));
  assert.ok(sizes[0] < Math.max(...sizes), `${sizes}`);
  assert.ok(deposit.stamps.every((stamp) => Math.abs(stamp.rotation - Math.PI / 2) < 1e-9));
});

test('a stroke partway drawn shows a prefix of the finished stroke\'s stamps, the same every compile', () => {
  const recipe = (drawnOver?: number) => stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.pass('p', {}, (pass) => pass.stroke('line', { brush, material: ochre, diameter: 40, path, appliedAt: 2, drawnOver }))));
  const whole = compileStampPaintRecipe(recipe()).groups[0].passes[0].deposits[0];
  const drawn = compileStampPaintRecipe(recipe(4)).groups[0].passes[0].deposits[0];
  assert.deepEqual(drawn.stamps, whole.stamps);

  assert.equal(visibleStampCountAt(whole, 1.9), 0);
  assert.equal(visibleStampCountAt(whole, 2), whole.stamps.length);
  const counts = [1.99, 2, 3, 4, 5, 6, 7].map((t) => visibleStampCountAt(drawn, t));
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  assert.equal(counts[0], 0);
  assert.ok(counts[1] > 0 && counts[3] > counts[1] && counts[3] < whole.stamps.length, `a partial stroke: ${counts}`);
  assert.equal(counts.at(-1), whole.stamps.length);
  // Halfway through its time, halfway along its length: the stamps shown are those in the first half.
  const halfway = drawn.stamps.slice(0, counts[3]);
  assert.ok(halfway.every((stamp) => stamp.reveal <= 0.5) && drawn.stamps[counts[3]].reveal > 0.5);
});

test("a dual brush's stamps are its scale times the deposit's diameter, stroked or placed", () => {
  const still = { ...brush, jitter: { lateral: 0, size: 0, opacity: 0, flow: 0 }, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 } };
  const dualed = { ...still, dual: { ...still, accumulation: 'build' as const, blend: 'multiply' as const, scale: 1.5 } };
  const [stroke, placed] = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => {
    pass.stroke('s', { brush: dualed, material: ochre, diameter: 20, path: [{ x: 0, y: 0 }, { x: 300, y: 0 }] });
    pass.stamps('d', { brush: dualed, material: ochre, diameter: 20, at: [{ x: 0, y: 0, diameter: 8 }] });
  })))).groups[0].passes[0].deposits;
  assert.ok(stroke.dualStamps.length > 0 && stroke.dualStamps.every((stamp) => stamp.diameter === 30));
  assert.ok(stroke.stamps.every((stamp) => stamp.diameter === 20));
  assert.equal(placed.stamps[0].diameter, 8);
  assert.equal(placed.dualStamps[0].diameter, 12);
});
