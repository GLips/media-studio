import { drawingSchedule } from '#lib/timing/drawings/models/drawing-schedule.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingTestBrushOf } from '#lib/paint/document/models/painting-test-brush.ts';
import { stampSheetEntryKey, stampSheetHeadKey } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { trail } from '#lib/paint/shot/models/shot-trail.ts';
import { subjectVisible } from '#lib/paint/subject/models/subject-geometry.ts';
import { defineSubject } from '#lib/paint/subject/models/subject.ts';
import { createLineLook } from './line-look.ts';
import { lookPlanes } from './look-planes.ts';
import { defineLook, deriveLook, printLook } from './paint-look.ts';
import { lookDraw, type LookStep } from './look-step.ts';

const silhouette = subjectVisible({ rings: [[{ x: 10, y: 10 }, { x: 170, y: 10 }, { x: 170, y: 170 }, { x: 10, y: 170 }]] } as const);
const tile = defineSubject({
  id: 'tile', materials: [{ id: 'ink', localColor: '#141414' }],
  parts: [{ id: 'body', material: 'ink', visibility: silhouette }], silhouette,
  features: [{ id: 'smile', kind: 'path', owner: 'body', line: 'authored', visibility: subjectVisible({
    runs: [{ closed: false, points: [{ x: 35, y: 100 }, { x: 85, y: 125 }, { x: 132, y: 98 }] }],
  }) }],
});
const brush = { style: 'watercolor', brush: 'ink' };
const line = createLineLook({ ink: brush, pencil: brush });
const blue = deriveLook(line, { name: 'blue', replace: { contour: c => c.with({ colour: '#2455bb' }) } });

function evaluation(look: typeof line) {
  const [plane] = lookPlanes(look, tile, { widthPx: 180, heightPx: 180 }, name => ({ id: name, depth: 1 }));
  const figure = plane.source;
  assert.ok(typeof figure === 'object' && 'kind' in figure && figure.kind === 'figure');
  assert.ok(typeof figure.source === 'object' && figure.source.kind === 'layers');
  return figure.source.painting;
}

test('a blue contour changes only outline paint on the actor sheet', () => {
  const base = evaluation(line).document.layers[0], variant = evaluation(blue).document.layers[0];
  assert.ok(base.children && variant.children);
  assert.deepEqual(base.children.map(({ key }) => key), ['tile.fill.part:body', 'tile.contour.part:body', 'tile.line.feature:smile']);
  const [fill, contour, features] = base.children;
  assert.deepEqual(variant.children[0], fill);
  assert.deepEqual(variant.children[2], features);
  const expected = JSON.stringify(contour).replaceAll('#1c1a19', '#2455bb');
  assert.notEqual(expected, JSON.stringify(contour));
  assert.equal(JSON.stringify(variant.children[1]), expected);
});

test('an empty named derivation reuses every chained sheet solve key', () => {
  function keys(look: typeof line) {
    const { sheets } = compilePaintingSelection(evaluation(look), paintingTestBrushOf);
    return sheets.flatMap(({ program }) => {
      let key = stampSheetHeadKey(program.head);
      return program.entries.map((entry) => { key = stampSheetEntryKey(key, entry); return key; });
    });
  }
  const base = keys(line);
  assert.ok(base.length >= 3);
  assert.deepEqual(keys(deriveLook(line, { name: 'another-name' })), base);
  assert.notDeepEqual(keys(blue), base);
});

test('a knob edits both widths and a later replacement inherits the result', () => {
  const thin = line.with({ inkWeight: 0.6 });
  const edited = deriveLook(thin, { replace: { contour: c => c.with({ colour: '#2455bb' }) } });
  assert.match(printLook(edited), /contour .*"colour":"#2455bb","weight":0.6/);
  assert.match(printLook(edited), /features .*"colour":"#1c1a19","weight":0.6/);
  assert.match(printLook(edited), /sheet \[fill, contour, features\]/);
  assert.match(printLook(line), /contour .*"weight":1/);
  const conflicting = defineLook(line, { pen: line.knobs.inkWeight, nib: line.knobs.inkWeight });
  assert.throws(() => conflicting.with({ pen: 1, nib: 1 }), /conflicting writes to contour.weight/);
});

test('a private replacement publishes its own settings and evidence requirements', () => {
  const relit = deriveLook(line, { replace: { fill: () => lookDraw('fill', 'lit paper', { opacity: 1 }, () => [], ['illumination']) } });
  const faint = deriveLook(relit, { replace: { fill: f => f.with({ opacity: 0.3 }) } });
  assert.match(printLook(faint), /lit paper.*"opacity":0.3/);
  assert.throws(() => lookPlanes(faint, tile, { widthPx: 180, heightPx: 180 }, id => ({ id, depth: 1 })), /fill reads illumination evidence/);
  assert.throws(() => deriveLook(line, { replace: { contour: () => lookDraw('contour', 'fixed nib', {}, () => []) } }), /inkWeight.*contour.weight/);
});

test('graph diagnostics identify the broken connection before painting', () => {
  const graph = (steps: readonly LookStep[], show: readonly string[] = []) => defineLook({ ...line, steps, show }, {});
  assert.throws(() => graph([...line.steps, ...line.steps]), /duplicate look step 'fill'/);
  assert.throws(() => graph(line.steps, ['missing']), /show reads unknown step 'missing'/);
  assert.throws(() => graph(line.steps, ['contour']), /show reads 'contour' \(draw\), expected place/);
  assert.throws(() => graph([{ name: 'page', kind: 'process', definition: trail.definition, params: {}, inputs: { source: 'place' }, space: 'stage' }, { name: 'place', kind: 'place', image: 'page' }]), /cycle: page -> place -> page/);
});

test('a contour redraw at a cue keeps sibling layers and resolves identically on reverse seeks', () => {
  const schedule = drawingSchedule({ fps: 12 }, [{ at: 0.05, cadence: 'held' }]);
  const boiling = deriveLook(line, { replace: { contour: c => c.with({ redraw: schedule }) } });
  const [plane] = lookPlanes(boiling, tile, { widthPx: 180, heightPx: 180 }, id => ({ id, depth: 1 }));
  const figure = plane.source;
  assert.ok(typeof figure !== 'function' && figure.kind === 'figure');
  const sample = figure.source;
  assert.ok(typeof sample === 'function');
  const marks = (t: number) => [...sample({ frame: t, at: t }).redraw!];
  const times = [0, 0.02, 0.05, 1];
  const expected = times.map(t => [['tile.contour.part:body', schedule.at(t).token]]);
  assert.deepEqual(times.map(marks), expected);
  assert.deepEqual(times.toReversed().map(marks).toReversed(), expected);
});
