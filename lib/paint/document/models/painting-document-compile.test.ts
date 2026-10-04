import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stampSheetEntryKey, stampSheetHeadKey } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { stampSheetSolvePlan, stampSheetWrapHalo } from '#lib/paint/painting/models/stamp-sheet-wrap.ts';
import type { StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintingSelection } from './painting-document-compile.ts';
import type { Layer, PaintingDocument } from './painting-document.ts';
import { painting, type PaintingEvaluation } from './painting-source.ts';
import { paintingTestBrushOf } from './painting-test-brush.ts';
import * as meadow from './meadow.painting.ts';

const brushOf = paintingTestBrushOf;
/** `evaluation`'s root sheet as its program, every layer selected. */
const rootProgram = (evaluation: PaintingEvaluation) => compilePaintingSelection(evaluation, brushOf).sheets[0].program;

test('the meadow compiles to its sheet order: a film per layer, a wash per wash, its treeline waiting on wet paper', () => {
  const program = rootProgram(painting(meadow));
  assert.deepEqual(program.films.map(({ name }) => name), ['landscape', 'cloud']);
  assert.deepEqual(program.washes.map(({ name, film }) => [name, film]), [['sky', 0], ['hill', 0], ['cloud-wash', 1]]);
  assert.deepEqual(program.entries.map(({ name, wash: w, on }) => [name, w, on]), [['sky-flood', 0, null], ['treeline', 0, 'wet'], ['hill-flood', 1, null], ['cloud-wash.applications[0]', 2, null]]);
  const [sky, treeline, , cloud] = program.entries;
  assert.equal(sky.deposit.kind, 'flood');
  assert.equal(treeline.deposit.within?.length, 1);
  assert.ok(cloud.deposit.kind === 'flood' && cloud.deposit.flood.barrier.edge?.soft === 14);
  // A property step re-reads only what it changes: the hill's entry, not the sky's.
  const higher = rootProgram(painting(meadow, { hillTopPx: 210 }));
  assert.deepEqual(higher.entries.map(({ datum }, k) => datum === program.entries[k].datum), [true, true, false, true]);
});

const square = (x0: number, size: number) => [{ x: x0, y: x0 }, { x: x0 + size, y: x0 }, { x: x0 + size, y: x0 + size }, { x: x0, y: x0 + size }];
const ringedDocument = (rings: readonly ReturnType<typeof square>[]): PaintingDocument => ({
  widthPx: 300, heightPx: 300, paper: { color: '#ffffff', absorbency: 0.5 }, medium: 'watercolour',
  layers: [{ key: 'target', washes: [{ key: 'rings', applications: [{
    kind: 'fill', area: { region: { kind: 'polygon', rings } },
    brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 24, seed: 'rings', charge: { kind: 'paint', mix: { parts: [{ pigment: '#335577', amount: 1 }], strength: 0.6 } },
  }] }] }],
});

test('a fill with an island in its hole floods both outer rings as one deposit, stopped at the ringed area', () => {
  const compiled = (rings: readonly ReturnType<typeof square>[]) => rootProgram(painting({ default: () => ringedDocument(rings) })).entries[0].deposit;
  const ringed = compiled([square(20, 260), square(80, 140), square(130, 40)]), outline = compiled([square(20, 260)]);
  assert.ok(ringed.kind === 'flood');
  assert.equal(ringed.flood.barrier.rings?.length, 3);
  assert.ok(ringed.stamps.length > outline.stamps.length, 'the island is flooded besides the outline');
});

const strokedDocument = (profile: (along: number) => number, from = { x: 20, y: 60 }, to = { x: 180, y: 60 }): PaintingDocument => ({
  widthPx: 200, heightPx: 120, paper: { color: '#ffffff', absorbency: 0.5 }, medium: 'watercolour',
  layers: [{ key: 'ink', washes: [{ key: 'line', applications: [{
    kind: 'stroke', subpaths: [[from, to]], hand: { profile },
    brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 16, seed: 'line', charge: { kind: 'paint', mix: { parts: [{ pigment: '#223344', amount: 1 }], strength: 0.8 } },
  }] }] }],
});

test("a stroke's hand curve enters its key through the stamps it lays: two curves, two keys; the same curve, one", async () => {
  const keyOf = async (profile: (along: number) => number) => {
    const program = rootProgram(painting({ default: () => strokedDocument(profile) }));
    return stampSheetEntryKey(await stampSheetHeadKey(program.head), program.entries[0]);
  };
  const [rising, falling, risingAgain] = await Promise.all([keyOf((along) => 0.2 + 0.8 * along), keyOf((along) => 1 - 0.8 * along), keyOf((along) => 0.2 + 0.8 * along)]);
  assert.notEqual(rising, falling);
  assert.equal(rising, risingAgain);
});

/** A layer laying one dab. */
const dab = (key: string): Layer => ({
  key, washes: [{ key: `${key}-wash`, applications: [{
    kind: 'stamps', placements: [{ x: 50, y: 50 }], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 20, seed: key,
    charge: { kind: 'paint', mix: { parts: [{ pigment: '#335577', amount: 1 }], strength: 0.6 } },
  }] }],
});
const OWN = { kind: 'own', paper: { color: '#efe6d2', absorbency: 0.4 } } as const;

test("a selection's sheets: an own sheet's card before all under its owner, a nested one inside its parent's run, a scene layer in the root's program", () => {
  const heron = painting({
    default: (): PaintingDocument => ({
      widthPx: 100, heightPx: 100, paper: { color: '#ffffff', absorbency: 0.5 }, medium: 'watercolour',
      layers: [dab('water'), { key: 'heron', children: [dab('body'), {
        key: 'wing', sheet: OWN, children: [{ key: 'tip', sheet: OWN, children: [dab('feather')] }, dab('vane'), { ...dab('shadow'), sheet: { kind: 'scene' } }],
      }] }],
    }),
  });
  const all = compilePaintingSelection(heron, brushOf);
  assert.deepEqual(all.sheets.map(({ sheet, program }) => [sheet.owner, program.films.map(({ name }) => name)]), [[null, ['water', 'body', 'shadow']], ['wing', ['vane']], ['tip', ['feather']]]);
  assert.deepEqual(all.steps.map((step) => (step.kind === 'card' ? `card ${step.sheet}` : `${step.sheet}/${step.film}`)), ['0/0', '0/1', 'card 1', 'card 2', '2/0', '1/0', '0/2']);
  // The root's sheet is always there, its paper the ground; a selection paints its own layers as a painting of their own.
  const wing = compilePaintingSelection(heron, brushOf, { layers: ['wing'] });
  assert.deepEqual(wing.sheets.map(({ sheet, layers }) => [sheet.owner, layers]), [[null, [4]], ['wing', [3]], ['tip', [2]]]);
  assert.deepEqual(wing.sheets[0].program.entries.map(({ chain }) => chain), [[1, 3, 7]]);
});

test("a boil epoch reseeds its layer's marks and keys alone: each epoch lays them anew, the same epoch alike", () => {
  const evaluation = painting(meadow);
  const rootOf = (reseed?: ReadonlyMap<string, number>) => compilePaintingSelection(evaluation, brushOf, { reseed }).sheets[0].program;
  const still = rootOf(), boiled = rootOf(new Map([['landscape', 1]])), again = rootOf(new Map([['landscape', 1]]));
  assert.deepEqual(boiled.entries.map(({ datum }, k) => datum === still.entries[k].datum), [false, false, false, true]);
  assert.notEqual(boiled.entries[0].deposit.id, still.entries[0].deposit.id);
  assert.deepEqual(again.entries.map(({ datum }) => datum), boiled.entries.map(({ datum }) => datum));
});

test('a wrapped document is keyed apart from itself unwrapped and wrapped otherwise, and an unwrapped head reads no wrap', () => {
  const head = (wrap?: StampWrap) => rootProgram(painting({ default: () => ({ ...strokedDocument(() => 1), ...(wrap && { wrap }) }) })).head;
  const heads = [head(), head('x'), head('y'), head('xy')];
  assert.equal(new Set(heads).size, heads.length);
  assert.ok(!heads[0].includes('wrap'));
});

/** Whether `d` px is a whole number of `period`s, to rounding. */
const wholePeriods = (d: number, period: number) => Math.abs(d / period - Math.round(d / period)) < 1e-9;

test("banded for its solve, a stroke run past a tile's corner lays its copies a period back on each axis and across the corner, each reading as its stamp", () => {
  // Across both seams of a 200 × 120 tile, by its corner: from (150, 90) to (260, 150).
  const program = rootProgram(painting({ default: () => ({ ...strokedDocument(() => 1, { x: 150, y: 90 }, { x: 260, y: 150 }), wrap: 'xy' }) }));
  assert.equal(program.wrap, 'xy');
  const halo = stampSheetWrapHalo(program), plan = stampSheetSolvePlan(program);
  // A power of two, so a pose or edit widening the widest reach a little keeps the sheet's key.
  assert.ok(Number.isInteger(Math.log2(halo)) && halo >= 8 * Math.SQRT2 + 2, `a halo of ${halo} px reaches a 16 px stamp's turned corner and its edge`);
  assert.deepEqual([plan.stage.margin, plan.stage.wrap], [halo, { x: 200, y: 120 }]);
  const planned = program.entries[0].deposit, banded = plan.painted().entries[0].deposit;
  // Each stamp, then its copies, each keeping where it was placed: whole periods away, within the halo's reach.
  const originals = banded.stamps.filter((stamp) => stamp.rest === undefined);
  assert.deepEqual(originals.map(({ x, y }) => [x, y]), planned.stamps.map(({ x, y }) => [x, y]));
  const copies = banded.stamps.filter((stamp) => stamp.rest !== undefined);
  assert.ok(copies.every(({ x, y, rest }) => wholePeriods(x - rest!.x, 200) && wholePeriods(y - rest!.y, 120) && x > -2 * halo && x < 200 + 2 * halo && y > -2 * halo && y < 120 + 2 * halo));
  const shifted = (dx: number, dy: number) => copies.some(({ x, y, rest }) => Math.abs(x - rest!.x - dx) < 1e-9 && Math.abs(y - rest!.y - dy) < 1e-9 && x >= 0 && y >= 0);
  assert.ok(shifted(-200, -120), 'the run past the corner is copied into the frame at its top left');
  assert.ok(shifted(-200, 0) && shifted(0, -120), 'and past each seam, a period back on that axis');
  const xs = planned.stamps.map(({ x }) => x), ys = planned.stamps.map(({ y }) => y);
  assert.deepEqual(banded.wrapFrom, [(Math.min(...xs) + Math.max(...xs)) / 2 - 100, (Math.min(...ys) + Math.max(...ys)) / 2 - 60]);
  assert.notEqual(plan.head, program.head);
  assert.equal(plan.painted().head, plan.head);
});
