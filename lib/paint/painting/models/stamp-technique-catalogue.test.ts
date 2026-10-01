import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampMaterialSet } from './stamp-material-set.ts';
import { compileStampPaintRecipe, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { defineStampTechnique } from './stamp-paint-passage.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPaintRecipeDeposit, StampPassageOptions, StampPassageScope } from './stamp-paint-recipe-types.ts';
import { stampBlot, stampChargedForm, stampGradedWash, stampGuidedMarks, type StampFormFace } from './stamp-technique-catalogue.ts';

const brush = (name: string): StampBrush => ({
  name, blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 's', pack: 'p', file: 'tip.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.25, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
});
const mixture = (pigment: keyof typeof W, amount = 0.3): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment: W[pigment], amount }], strength: 0.6 });
const WATERCOLOUR: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W } };
const square = (x0: number, y0: number, x1: number, y1: number) => ({ kind: 'polygon' as const, points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });

/** Passage `p` of group `g` as written by `body` against `environment`. */
function written(body: (p: StampPassageScope) => void, options: StampPassageOptions = {}, environment = WATERCOLOUR) {
  const recipe = stampPaintRecipe(environment, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => group.passage('p', { defaults: { brush: brush('round'), size: 20 }, ...options }, body)));
  const steps = recipe.groups[0].passes[0].steps;
  return { recipe, steps, deposits: steps.filter((step): step is StampPaintRecipeDeposit => step.kind === 'deposit') };
}
const named = (deposits: readonly StampPaintRecipeDeposit[]) => deposits.map(({ name }) => [...name.items, name.id, ...name.keys].join('/'));

test('a graded wash floods one grade between single wells, takes its brush from the style beneath its call, and hands back where it went', () => {
  const sky = square(0, 0, 400, 200), along = [{ x: 0, y: 0 }, { x: 0, y: 200 }] as const;
  const environment = { ...WATERCOLOUR, techniques: { gradedWash: { brush: brush('wet') } } };
  let handle: ReturnType<typeof stampGradedWash> | undefined;
  const { recipe, deposits } = written((p) => {
    handle = stampGradedWash(p, 'sky', { region: sky, from: { paint: mixture('ultramarine') }, to: { paint: mixture('cerulean', 0.05) }, along, reach: { past: 0.5 }, variety: { amount: 0.3, scale: 80 }, junctions: { horizon: [{ x: 0, y: 200 }, { x: 400, y: 200 }] } });
  }, {}, environment);
  assert.deepEqual(named(deposits), ['sky/body', 'sky/variety']);
  const [body] = deposits;
  assert.equal(body.tool.brush.name, 'wet');
  assert.ok(body.geometry.kind === 'fill' && body.geometry.application?.kind === 'flood' && body.geometry.application.reach !== 'inside' && body.geometry.application.reach?.past === 0.5);
  assert.ok(body.action.kind === 'paint' && body.action.material.kind === 'linear');
  assert.deepEqual(handle!.footprint.regions, [sky, sky]);
  assert.deepEqual(Object.keys(handle!.junctions), ['horizon']);
  // It compiles, and a call's own brush beats the style's.
  assert.equal(stampPassDeposits(compileStampPaintRecipe(recipe).groups[0].passes[0]).length, 2);
  assert.equal(written((p) => stampGradedWash(p, 'sky', { region: sky, brush: brush('mine'), well: { paint: mixture('quinacridoneRose') }, load: { along, from: 1, to: 0 } }), {}, environment).deposits[0].tool.brush.name, 'mine');
  assert.throws(() => written((p) => stampGradedWash(p, 'sky', { region: sky, from: { paint: stampMaterialSet({ a: mixture('quinacridoneRose') }) }, to: { paint: mixture('cerulean') }, along })), /between single materials/);
});

test('guided marks run along their guides, leaned toward an absolute way, and a new guide moves none of the others', () => {
  const tier = { id: 'low', path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] };
  const marksOf = (guides: { id: string; path: { x: number; y: number }[] }[]) => {
    let marks: ReturnType<typeof stampGuidedMarks>['marks'] = [];
    const { recipe } = written((p) => ({ marks } = stampGuidedMarks(p, 'needles', { guides, perGuide: 6, length: [20, 20], size: 4, well: { paint: mixture('phthaloBlue') }, lean: { toward: Math.PI / 2, share: 0.5 }, spread: 3 })));
    compileStampPaintRecipe(recipe);
    return marks;
  };
  const one = marksOf([tier]);
  assert.equal(one.length, 6);
  for (const { geometry } of one) {
    assert.ok(geometry.kind === 'stroke');
    const [a, , b] = geometry.path;
    // Half way from the guide's heading (0) to straight down (π/2): π/4.
    assert.ok(Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 4) < 1e-9);
  }
  const two = marksOf([{ id: 'high', path: [{ x: 120, y: 60 }, { x: 280, y: 60 }] }, tier]);
  assert.deepEqual(two.filter(({ key }) => key.includes('/low-')), one);
  assert.throws(() => marksOf([tier, tier]), /an ID of its own/);
});

test("a faceted form's faces are lit by their own facing: moving the light recharges them, its body and shade one history", () => {
  const outline = square(0, 0, 200, 120);
  const faces: StampFormFace[] = [
    { id: 'top', region: square(0, 0, 200, 40), facing: { direction: -Math.PI / 2, elevation: 0.9 } },
    { id: 'left', region: square(0, 40, 100, 120), facing: { direction: Math.PI, elevation: 0.3 } },
    { id: 'right', region: square(100, 40, 200, 120), facing: { direction: 0, elevation: 0.3 } },
  ];
  const wells = { lit: { paint: mixture('yellowOchre') }, half: { paint: mixture('burntSienna') }, shade: { paint: mixture('ultramarine') }, core: { paint: mixture('burntUmber') }, undercut: { paint: mixture('phthaloBlue', 0.6) } };
  const rock = (direction: number, extra = {}) => written((p) => stampChargedForm(p, 'rock', {
    model: { kind: 'faces', outline, faces }, light: { direction, elevation: 0.9 }, core: [[{ x: 100, y: 40 }, { x: 100, y: 120 }]], coreSize: 6, undercut: [{ x: 0, y: 124 }, { x: 200, y: 124 }], ...extra,
  }), { defaults: { brush: brush('round'), size: 20, wells } });
  const fromRight = rock(-0.3);
  assert.deepEqual(fromRight.steps.map((step) => (step.kind === 'wait' ? `wait ${typeof step.until === 'string' ? step.until : 'seconds'}` : named([step])[0])), ['rock/body', 'wait shiny', 'rock/left', 'rock/core-0', 'wait set', 'rock/undercut']);
  const fromLeft = rock(Math.PI + 0.3);
  assert.deepEqual(named(fromLeft.deposits), ['rock/body', 'rock/right', 'rock/core-0', 'rock/undercut']);
  // A role the form needs and the defaults lack is refused, never made from another well.
  assert.throws(() => written((p) => stampChargedForm(p, 'rock', { model: { kind: 'faces', outline, faces }, light: { direction: -0.3, elevation: 0.5 }, wells: { lit: wells.lit } })), /no half well/);
  // A merged foot lays a damp brush along it in the same history; a passage that keeps none refuses it.
  const foot = { path: [{ x: 0, y: 120 }, { x: 200, y: 120 }], treatment: 'merge' as const, reach: 10 };
  assert.ok(named(rock(-0.3, { within: { region: outline, boundaries: { foot } } }).deposits).includes('rock/merge-foot'));
  assert.throws(() => written((p) => stampChargedForm(p, 'rock', { model: { kind: 'faces', outline, faces }, light: { direction: -0.3, elevation: 0.5 }, wells }), { wetHistory: false }), /wet history/);
});

test('a blot presses each shape as often as asked, waiting once before the first, each press crumpled afresh', () => {
  const cloud = { id: 'cloud', region: { kind: 'ellipse' as const, x: 200, y: 100, radiusX: 80, radiusY: 30 } };
  const { steps, deposits } = written((p) => {
    p.fill('sky', { region: square(0, 0, 400, 200), well: { paint: mixture('cerulean') } });
    stampBlot(p, 'tissue', { shapes: [cloud], repeat: 2, irregular: 4 });
  });
  assert.deepEqual(steps.map((step) => (step.kind === 'wait' ? 'wait' : named([step])[0])), ['sky', 'wait', 'tissue/cloud-0', 'tissue/cloud-1']);
  const [, first, second] = deposits;
  assert.ok(first.action.kind === 'lift' && first.geometry.kind === 'fill' && second.geometry.kind === 'fill');
  assert.notDeepEqual(first.geometry.region, second.geometry.region);
  // In flat colour, there's nothing to lift from.
  assert.throws(() => written((p) => stampBlot(p, 'tissue', { shapes: [cloud], when: false }), {}, { paper: { color: '#ffffff' }, mixing: { kind: 'flat' } }), /lift/);
});

test("an author's raw op may say why it escapes the techniques, which its deposit keeps; a technique's own ops may not", () => {
  const { deposits } = written((p) => p.stroke('accent', { path: [{ x: 0, y: 0 }, { x: 50, y: 0 }], well: { paint: mixture('quinacridoneRose') }, escape: 'one warm accent no technique lays' }));
  assert.equal(deposits[0].escape, 'one warm accent no technique lays');
  assert.throws(() => written((p) => p.stroke('accent', { path: [{ x: 0, y: 0 }, { x: 50, y: 0 }], well: { paint: mixture('quinacridoneRose') }, escape: ' ' })), /with no reason/);
  const sneaky = defineStampTechnique<object>({ name: 'sneaky', weight: 1, requires: [], expand: ({ p }) => (p.stroke('line', { path: [{ x: 0, y: 0 }, { x: 50, y: 0 }], well: { paint: mixture('quinacridoneRose') }, escape: 'mine' }), {}) });
  assert.throws(() => written((p) => sneaky(p, 'it', {})), /inside the sneaky technique/);
});
