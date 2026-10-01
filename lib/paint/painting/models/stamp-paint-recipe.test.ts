import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { visibleStampCountAt } from './stamp-deposit-reveal.ts';
import type { StampRegion } from './stamp-region.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampBloom, stampSoften } from './stamp-wet-techniques.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';

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
/** Flat colour on white, and watercolour, whose passages keep a wet history. */
const FLAT: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'flat' } };
const WET: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: WATERCOLOUR_PIGMENTS } };
const horizon: StampRegion = { kind: 'polygon', points: [{ x: 0, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 320 }] };

test('a clipped pass clips to an unclipped pass before it; a deposit lands under the fluid declared before it, until its scope ends', () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => {
    paint.mask('frame', { region: horizon });
    paint.group('sky', { composite: 'opaque' }, (group) => {
      group.mask('sun', { region: sun, edge: { ragged: { amount: 3, scale: 12 } } });
      group.passage('base', {}, (pass) => pass.stroke('fill', { brush, well: { paint: ochre }, size: 60, path }));
      group.passage('texture', { clipTo: 'base', within: { region: sun } }, (pass) => {
        pass.stroke('before', { brush, well: { paint: ochre }, size: 30, path });
        pass.unmask('lift', { amount: 0.5 });
        pass.stroke('after', { brush, well: { paint: ochre }, size: 30, path });
      });
      group.passage('blotches', {}, (pass) => pass.stamps('drops', { brush, well: { paint: ochre }, size: 20, at: [{ x: 10, y: 10 }] }));
      group.passage('glints', { clipTo: 'blotches' }, (pass) => pass.stamps('dots', { brush, well: { paint: ochre }, size: 5, at: [{ x: 12, y: 12 }] }));
    });
    paint.group('land', { composite: 'opaque' }, (group) => group.passage('wash', {}, (pass) => pass.stroke('s', { brush, well: { paint: ochre }, size: 30, path })));
  }));
  const [sky, land] = painting.groups;
  assert.deepEqual(sky.passes.map((pass) => [pass.id, pass.clipTo, !!pass.within]), [
    ['sky/base', undefined, false],
    ['sky/texture', 'sky/base', true],
    ['sky/blotches', undefined, false],
    ['sky/glints', 'sky/blotches', false],
  ]);
  const [base, texture, blotches] = sky.passes;
  assert.deepEqual([stampPassDeposits(base)[0], ...stampPassDeposits(texture), stampPassDeposits(blotches)[0], stampPassDeposits(land.passes[0])[0]].map((deposit) => [deposit.id, fluid(deposit.mask)]), [
    ['sky/base/fill', ['frame', 'sky/sun']],
    ['sky/texture/before', ['frame', 'sky/sun']],
    ['sky/texture/after', ['frame', 'sky/sun', 'sky/texture/lift']],
    // The lift ended with its pass, the sun's mask with its group.
    ['sky/blotches/drops', ['frame', 'sky/sun']],
    ['land/wash/s', ['frame']],
  ]);
  // Deposits under the same fluid share it, so it's worked out once.
  assert.equal(stampPassDeposits(base)[0].mask, stampPassDeposits(blotches)[0].mask);

  assert.throws(
    () => compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', { clipTo: 'base' }, () => {})))),
    /g\/p is clipped to base, which isn't a pass of g before it/,
  );
});

test("a group knocks out first and once: its knockout's fluid is its own, and nothing clips to it", () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('cloud', { composite: 'glaze', opacity: 1 }, (group) => {
    group.knockout('lights', {}, (knockout) => {
      knockout.mask('fluid', { region: sun });
      knockout.water('wash', { kind: 'fill', brush, size: 20, application: { kind: 'flood' }, region: sun });
    });
    group.passage('body', {}, (pass) => pass.fill('puff', { brush, well: { paint: ochre }, size: 20, application: { kind: 'flood' }, region: sun }));
  })));
  const [knockout, body] = painting.groups[0].passes;
  assert.equal(knockout.kind === 'wash' && knockout.knockout, true);
  assert.deepEqual(fluid(stampPassDeposits(knockout)[0].mask), ['cloud/lights/fluid']);
  assert.equal(stampPassDeposits(body)[0].mask, null);
  assert.throws(
    () => compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => {
      group.knockout('k', {}, () => {});
      group.passage('p', { clipTo: 'k' }, () => {});
    }))),
    /g\/p is clipped to k, and a pass clips only to an unclipped one that paints/,
  );
  assert.throws(
    () => stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => {
      group.passage('p', {}, () => {});
      group.knockout('k', {}, () => {});
    })),
    /a group knocks out once, before it paints/,
  );
  // A recipe is a plain value: one reordered by hand is refused as it compiles.
  const written = stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => {
    group.knockout('k', {}, () => {});
    group.passage('p', {}, () => {});
  }));
  const [{ passes }] = written.groups;
  assert.throws(() => compileStampPaintRecipe({ ...written, groups: [{ ...written.groups[0], passes: [passes[1], passes[0]] }] }), /g\/k is a knockout after g's first pass/);
});

test('groups paint far to near by depth, an order overrides depth, and ties keep the order written', () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => {
    paint.group('figure', { composite: 'opaque', depth: 1 }, () => {});
    paint.group('mist', { composite: 'glaze', opacity: 0.3, depth: 5, order: 1 }, () => {});
    paint.group('hills', { composite: 'opaque', depth: 5 }, () => {});
    paint.group('rock', { composite: 'opaque', depth: 1 }, () => {});
  }));
  assert.deepEqual(painting.groups.map((group) => group.id), ['hills', 'figure', 'rock', 'mist']);
});

test('a recipe that would seed or draw wrongly is refused when it compiles, naming what', () => {
  assert.throws(() => stampPaintRecipe(FLAT, (paint) => paint.group('sky', { composite: 'opaque' }, (group) => group.passage('wash', {}, (pass) => {
    pass.stroke('s1', { brush, well: { paint: ochre }, size: 40, path });
    pass.stamps('s1', { brush, well: { paint: ochre }, size: 40, at: [{ x: 0, y: 0 }] });
  }))), /two applications are named sky\/wash\/s1/);
  const recipe = stampPaintRecipe(FLAT, (paint) => {
    paint.group('sky', { composite: 'opaque' }, (group) => {
      group.passage('wash', {}, (pass) => pass.stroke('s1', { brush, well: { paint: ochre }, size: 40, path }));
      // The same name under another pass is another ID.
      group.passage('glaze', {}, (pass) => pass.stroke('s1', { brush, well: { paint: ochre }, size: 40, path }));
    });
    paint.group('sky', { composite: 'glaze', opacity: 0.5 }, () => {});
  });
  assert.throws(() => compileStampPaintRecipe(recipe), (error: Error) => error.message.includes(': sky') && !error.message.includes('sky/glaze/s1'));

  const oneStroke = (settings: { size: number } | { size: number; reveal: { at: number; over: number } }) => () => compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) =>
    paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) => pass.stroke('s', { brush, well: { paint: ochre }, path, ...settings })))));
  assert.throws(oneStroke({ size: 0 }), /g\/p\/s has diameter 0/);
  assert.throws(oneStroke({ size: 40, reveal: { at: 1, over: -3 } }), /reveals over -3s, and a reveal takes a finite 0 or more/);
});

test('a stroke tapers at both ends however short, and turns with its direction from its first stamp', () => {
  const still = { ...brush, dynamics: stampLinearDynamics({ size: { pressure: 0.5 }, opacity: { pressure: 0.5 }, rotation: { direction: 1 } }), scatter: { count: 1, radius: 0, lateral: 0 } };
  // A pen often repeats its first point.
  const stroke = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 19 }];
  const [deposit] = stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.passage('p', {}, (pass) => pass.stroke('dab', { brush: { ...still, spacing: 0.5 }, well: { paint: ochre }, size: 10, path: stroke }))))).groups[0].passes[0]);
  const sizes = deposit.stamps.map((stamp) => stamp.diameter);
  assert.equal(sizes[0], sizes.at(-1));
  assert.ok(sizes[0] < Math.max(...sizes), `${sizes}`);
  assert.ok(deposit.stamps.every((stamp) => Math.abs(stamp.rotation - Math.PI / 2) < 1e-9));
});

test('a stroke partway drawn shows a prefix of the finished stroke\'s stamps, the same every compile', () => {
  const recipe = (drawnOver = 0) => stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.passage('p', {}, (pass) => pass.stroke('line', { brush, well: { paint: ochre }, size: 40, path, reveal: { at: 2, over: drawnOver } }))));
  const whole = stampPassDeposits(compileStampPaintRecipe(recipe()).groups[0].passes[0])[0];
  const drawn = stampPassDeposits(compileStampPaintRecipe(recipe(4)).groups[0].passes[0])[0];
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
  const [stroke, placed] = stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) => {
    pass.stroke('s', { brush: dualed, well: { paint: ochre }, size: 20, path: [{ x: 0, y: 0 }, { x: 300, y: 0 }] });
    pass.stamps('d', { brush: dualed, well: { paint: ochre }, size: 20, at: [{ x: 0, y: 0, diameter: 8 }] });
  })))).groups[0].passes[0]);
  assert.ok(stroke.dualStamps.length > 0 && stroke.dualStamps.every((stamp) => stamp.diameter === 30));
  assert.ok(stroke.stamps.every((stamp) => stamp.diameter === 20));
  assert.equal(placed.stamps[0].diameter, 8);
  assert.equal(placed.dualStamps[0].diameter, 12);
});

test("a wash keeps its deposits and waits in painting order, a bloom waiting until it's damp, and each tool's water", () => {
  const washed = compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => {
    group.passage('dry', { wetHistory: false }, (pass) => pass.stroke('s', { brush, well: { paint: ochre }, size: 30, path }));
    group.passage('wet', { preparation: { region: sun } }, (wash) => {
      wash.stroke('blue', { brush, well: { paint: ochre, water: 0.8 }, size: 30, path });
      stampSoften(wash, 'edge', { brush, size: 20, along: path });
      wash.wait({ seconds: 30 });
      wash.lift('cloud', { kind: 'stamps', brush, size: 40, at: [{ x: 200, y: 100 }], strength: 0.6 });
      stampBloom(wash, 'drop', { brush, size: 10, at: [{ x: 210, y: 90 }] });
    });
  }))).groups[0];
  const [dry, wet] = washed.passes;
  assert.equal(dry.kind, 'dry');
  assert.ok(wet.kind === 'wash' && wet.wash.preparation);
  assert.deepEqual(wet.wash.schedule.map((step) => (step.kind === 'wait' ? ['wait', step.until] : [step.deposit.id, step.deposit.action.kind, step.deposit.action.kind === 'lift' ? step.deposit.action.strength : step.deposit.action.water])), [
    ['sky/wet/blue', 'paint', 0.8], ['sky/wet/edge', 'water', 0.3], ['wait', { seconds: 30 }], ['sky/wet/cloud', 'lift', 0.6], ['wait', 'damp'], ['sky/wet/drop', 'water', 1],
  ]);
  assert.deepEqual(stampPassDeposits(wet).map(({ id }) => id), ['sky/wet/blue', 'sky/wet/edge', 'sky/wet/cloud', 'sky/wet/drop']);
  assert.throws(() => compileStampPaintRecipe(stampPaintRecipe(WET, (paint) => paint.group('g', { composite: 'opaque' }, (group) =>
    group.passage('w', {}, (wash) => wash.stroke('s', { brush, well: { paint: ochre, water: 2 }, size: 30, path }))))), /carries 2 water/);
});

test("a boil's epoch re-seeds only its own group's marks, keeping their IDs and colours", () => {
  const jittery: StampBrush = { ...brush, color: { stamp: { hue: 0, saturation: 0, lightness: 0, darkness: 0 }, stroke: { hue: 0.2, saturation: 0.2, lightness: 0.2, darkness: 0 }, pressure: { hue: 0, saturation: 0, lightness: 0, secondary: 0 } } };
  const painting = compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => {
    paint.group('cloud', { composite: 'glaze', opacity: 1, boil: { every: 2 } }, (group) => group.passage('p', {}, (pass) => pass.stroke('puff', { brush: jittery, well: { paint: ochre }, size: 30, path })));
    paint.group('hill', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) => pass.stroke('line', { brush, well: { paint: ochre }, size: 30, path })));
  }));
  const [cloud, hill] = painting.groups;
  assert.equal(hill.boil, undefined);
  assert.equal(stampPassDeposits(cloud.boil!.reseeded(0).passes[0])[0].stamps.length, stampPassDeposits(cloud.passes[0])[0].stamps.length);
  assert.deepEqual(stampPassDeposits(cloud.boil!.reseeded(0).passes[0])[0].stamps, stampPassDeposits(cloud.passes[0])[0].stamps);
  const [puff0, puff1] = [0, 1].map((epoch) => stampPassDeposits(cloud.boil!.reseeded(epoch).passes[0])[0]);
  assert.notDeepEqual(puff1.stamps, puff0.stamps);
  assert.equal(puff1.id, puff0.id);
  assert.deepEqual(puff1.action, puff0.action);
});

test('a colour change reshapes nothing: every mark lands where and as it did, only its paint differs', () => {
  const jittery: StampBrush = { ...brush, color: { stamp: { hue: 0.1, saturation: 0.1, lightness: 0.1, darkness: 0 }, stroke: { hue: 0, saturation: 0, lightness: 0, darkness: 0 }, pressure: { hue: 0, saturation: 0, lightness: 0, secondary: 0 } } };
  const lit = (color: `#${string}`) => stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => {
    paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.passage('p', {}, (pass) => pass.stroke('glow', { brush: jittery, well: { paint: { kind: 'color', color } }, size: 30, path })));
  })).groups[0].passes[0])[0];
  const [day, dusk] = [lit('#c8902f'), lit('#b0402a')];
  assert.deepEqual(dusk.stamps, day.stamps);
  assert.deepEqual(dusk.dualStamps, day.dualStamps);
});

test('a colour keyed to itself paints as the colour does: each key jittered alike, its own colour still the secondary', () => {
  const jittery: StampBrush = { ...brush, color: { stamp: { hue: 0, saturation: 0, lightness: 0, darkness: 0 }, stroke: { hue: 0.2, saturation: 0.2, lightness: 0.2, darkness: 0 }, pressure: { hue: 0, saturation: 0, lightness: 0, secondary: 0.5 } } };
  const red: PaintMaterial = { kind: 'color', color: '#c03020' };
  const glow = (material: PaintMaterial | { kind: 'keys'; keys: { at: number; material: PaintMaterial }[] }) => stampPassDeposits(compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => {
    paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.passage('p', {}, (pass) => pass.stroke('glow', { brush: jittery, well: { paint: material }, size: 30, path })));
  })).groups[0].passes[0])[0].action;
  const still = glow(red), keyed = glow({ kind: 'keys', keys: [{ at: 0, material: red }, { at: 2, material: red }] });
  assert.ok(still.kind === 'paint' && keyed.kind === 'paint' && still.material.kind === 'constant' && keyed.material.kind === 'constant');
  assert.notEqual(still.material.value, red, 'the stroke jitter moved the colour');
  assert.deepEqual(keyed.material.value, { kind: 'keys', keys: [{ at: 0, material: still.material.value }, { at: 2, material: still.material.value }] });
  assert.equal(still.secondaryColor, red.color);
  assert.deepEqual(keyed.secondaryColor, { kind: 'keys', keys: [{ at: 0, material: red.color }, { at: 2, material: red.color }] });
});
