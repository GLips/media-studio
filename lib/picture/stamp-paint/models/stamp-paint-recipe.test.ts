import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from './stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampMask, type PaintMaterial } from './stamp-paint-recipe.ts';
import { visibleStampCountAt } from './stamp-deposit-reveal.ts';
import type { StampRegion } from './stamp-region.ts';

/** The masking fluid's ops under a deposit, oldest first, by ID. */
const fluid = (mask: CompiledStampMask | null): string[] => (mask ? [...fluid(mask.under), mask.id] : []);

const brush: StampBrush = {
  name: 'Wet Wash',
  blend: 'normal',
  accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/wash.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1,
  stepping: 'spread',
  dynamics: stampLinearDynamics({ size: { pressure: 0.5, random: 0.3 }, opacity: { pressure: 0.5, random: 0.3 }, rotation: { direction: 1, random: 0.5 } }),
  scatter: { count: 2, radius: 0.1, lateral: 0.2 },
  rotation: { angle: 0, randomStart: false },
  flip: { x: false, y: false },
  blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 },
  falloff: 0,
  flow: 0.4,
};
const ochre: PaintMaterial = { kind: 'color', color: '#c8902f' };
const path = [{ x: 0, y: 0 }, { x: 300, y: 40 }, { x: 520, y: 10, pressure: 0.4 }];
const sun: StampRegion = { kind: 'ellipse', x: 200, y: 100, radiusX: 40, radiusY: 40 };
const horizon: StampRegion = { kind: 'polygon', points: [{ x: 0, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 320 }] };

test('a clipped pass clips to the nearest unclipped pass before it; a deposit lands under the fluid declared before it, until its scope ends', () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe((paint) => {
    paint.mask('frame', { region: horizon });
    paint.group('sky', { composite: 'opaque' }, (group) => {
      group.mask('sun', { region: sun, edge: { ragged: { amount: 3, scale: 12 } } });
      group.pass('base', {}, (pass) => pass.stroke('fill', { brush, material: ochre, diameter: 60, path }));
      group.pass('texture', { clipped: true, within: sun }, (pass) => {
        pass.stroke('before', { brush, material: ochre, diameter: 30, path });
        pass.unmask('lift', { amount: 0.5 });
        pass.stroke('after', { brush, material: ochre, diameter: 30, path });
      });
      group.pass('blotches', {}, (pass) => pass.stamps('drops', { brush, material: ochre, diameter: 20, at: [{ x: 10, y: 10 }] }));
      group.pass('glints', { clipped: true }, (pass) => pass.stamps('dots', { brush, material: ochre, diameter: 5, at: [{ x: 12, y: 12 }] }));
    });
    paint.group('land', { composite: 'opaque' }, (group) => group.pass('wash', {}, (pass) => pass.stroke('s', { brush, material: ochre, diameter: 30, path })));
  }));
  const [sky, land] = painting.groups;
  assert.deepEqual(sky.passes.map((pass) => [pass.id, pass.clipTo, !!pass.within]), [
    ['sky/base', undefined, false],
    ['sky/texture', 'sky/base', true],
    ['sky/blotches', undefined, false],
    ['sky/glints', 'sky/blotches', false],
  ]);
  const [base, texture, blotches] = sky.passes;
  assert.deepEqual([base.deposits[0], ...texture.deposits, blotches.deposits[0], land.passes[0].deposits[0]].map((deposit) => [deposit.id, fluid(deposit.mask)]), [
    ['sky/base/fill', ['frame', 'sky/sun']],
    ['sky/texture/before', ['frame', 'sky/sun']],
    ['sky/texture/after', ['frame', 'sky/sun', 'sky/texture/lift']],
    // The lift ended with its pass, the sun's mask with its group.
    ['sky/blotches/drops', ['frame', 'sky/sun']],
    ['land/wash/s', ['frame']],
  ]);
  // Deposits under the same fluid share it, so it's worked out once.
  assert.equal(base.deposits[0].mask, blotches.deposits[0].mask);

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

  const oneStroke = (settings: { diameter: number } | { diameter: number; appliedAt: number; drawnOver: number }) => () => compileStampPaintRecipe(stampPaintRecipe((paint) =>
    paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => pass.stroke('s', { brush, material: ochre, path, ...settings })))));
  assert.throws(oneStroke({ diameter: 0 }), /g\/p\/s has diameter 0/);
  assert.throws(oneStroke({ diameter: 40, appliedAt: 1, drawnOver: -3 }), /g\/p\/s draws over -3s, and a draw takes no less than 0/);
});

test('a stroke tapers at both ends however short, and turns with its direction from its first stamp', () => {
  const still = { ...brush, dynamics: stampLinearDynamics({ size: { pressure: 0.5 }, opacity: { pressure: 0.5 }, rotation: { direction: 1 } }), scatter: { count: 1, radius: 0, lateral: 0 } };
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
  assert.deepEqual(counts, counts.toSorted((a, b) => a - b));
  assert.equal(counts[0], 0);
  assert.ok(counts[1] > 0 && counts[3] > counts[1] && counts[3] < whole.stamps.length, `a partial stroke: ${counts}`);
  assert.equal(counts.at(-1), whole.stamps.length);
  // Halfway through its time, halfway along its length: the stamps shown are those in the first half.
  const halfway = drawn.stamps.slice(0, counts[3]);
  assert.ok(halfway.every((stamp) => stamp.reveal <= 0.5) && drawn.stamps[counts[3]].reveal > 0.5);
});

test("a dual brush's stamps are its scale times the deposit's diameter, stroked or placed", () => {
  const still = { ...brush, dynamics: stampLinearDynamics({ size: { pressure: 0.5 }, opacity: { pressure: 0.5 }, rotation: { direction: 1, random: 0.5 } }), scatter: { ...brush.scatter, lateral: 0 }, taper: { ...brush.taper, start: 0, end: 0, size: 1, opacity: 1 } };
  const dualed = { ...still, dual: { ...still, accumulation: { kind: 'build' as const }, blend: { family: 'layer' as const, mode: 'multiply' as const }, scale: 1.5 } };
  const [stroke, placed] = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => {
    pass.stroke('s', { brush: dualed, material: ochre, diameter: 20, path: [{ x: 0, y: 0 }, { x: 300, y: 0 }] });
    pass.stamps('d', { brush: dualed, material: ochre, diameter: 20, at: [{ x: 0, y: 0, diameter: 8 }] });
  })))).groups[0].passes[0].deposits;
  assert.ok(stroke.dualStamps.length > 0 && stroke.dualStamps.every((stamp) => stamp.diameter === 30));
  assert.ok(stroke.stamps.every((stamp) => stamp.diameter === 20));
  assert.equal(placed.stamps[0].diameter, 8);
  assert.equal(placed.dualStamps[0].diameter, 12);
});

test("a wash keeps its deposits and waits in painting order, a bloom waiting until it's damp, and each tool's water", () => {
  const washed = compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => {
    group.pass('dry', {}, (pass) => pass.stroke('s', { brush, material: ochre, diameter: 30, path }));
    group.wash('wet', { preparation: { region: sun } }, (wash) => {
      wash.stroke('blue', { brush, material: ochre, diameter: 30, path, water: 0.8 });
      wash.soften('edge', { brush, diameter: 20, path });
      wash.wait({ seconds: 30 });
      wash.lift('cloud', { kind: 'stamps', brush, diameter: 40, at: [{ x: 200, y: 100 }], strength: 0.6 });
      wash.bloom('drop', { brush, diameter: 10, at: [{ x: 210, y: 90 }] });
    });
  }))).groups[0];
  const [dry, wet] = washed.passes;
  assert.equal(dry.kind, 'dry');
  assert.ok(wet.kind === 'wash' && wet.wash.preparation);
  assert.deepEqual(wet.wash.schedule.map((step) => (step.kind === 'wait' ? ['wait', step.until] : [step.deposit.id, step.deposit.action.kind, step.water])), [
    ['sky/wet/blue', 'paint', 0.8], ['sky/wet/edge', 'water', 0.3], ['wait', { seconds: 30 }], ['sky/wet/cloud', 'lift', null], ['wait', 'damp'], ['sky/wet/drop', 'water', 1],
  ]);
  assert.deepEqual(wet.deposits.map(({ id }) => id), ['sky/wet/blue', 'sky/wet/edge', 'sky/wet/cloud', 'sky/wet/drop']);
  assert.throws(() => compileStampPaintRecipe(stampPaintRecipe((paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.wash('w', {}, (wash) => wash.stroke('s', { brush, material: ochre, diameter: 30, path, water: 2 }))))), /carries 2 water/);
});

test("a boil's epoch re-seeds only its own group's deposits, their IDs kept", () => {
  const recipe = stampPaintRecipe((paint) => {
    paint.group('cloud', { composite: 'glaze', opacity: 1, boil: { every: 2 } }, (group) => group.pass('p', {}, (pass) => pass.stroke('puff', { brush, material: ochre, diameter: 30, path })));
    paint.group('hill', { composite: 'opaque' }, (group) => group.pass('p', {}, (pass) => pass.stroke('line', { brush, material: ochre, diameter: 30, path })));
  });
  const stampsOf = (epoch: number) => compileStampPaintRecipe(recipe, { boilEpochs: new Map([['cloud', epoch], ['hill', epoch]]) }).groups.map((group) => group.passes[0].deposits[0]);
  const [cloud0, hill0] = stampsOf(0), [cloud1, hill1] = stampsOf(1);
  assert.deepEqual(compileStampPaintRecipe(recipe).groups[0].passes[0].deposits[0].stamps, cloud0.stamps);
  assert.notDeepEqual(cloud1.stamps, cloud0.stamps);
  assert.equal(cloud1.id, cloud0.id);
  assert.deepEqual(hill1.stamps, hill0.stamps);
});
