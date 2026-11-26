import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawingSchedule, type DrawingSchedule } from '#lib/timing/drawings/models/drawing-schedule.ts';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintedShot, type CompiledShotEffectPlane } from './shot-compile.ts';
import { shotImageLeafReads, shotLeafReadMoment } from './shot-effect.ts';
import { shotFigure, shotPlace } from './shot-figure.ts';
import { scheduledSource, sourceMoment } from './shot-props.ts';
import { trail } from './shot-trail.ts';

const FPS = 24;
const paper = { color: '#f4f2ed', absorbency: 0.5 } as const;
const hand = { default: (): PaintingDocument => ({
  widthPx: 160, heightPx: 120, paper, medium: 'watercolour', layers: [
    { key: 'ground', washes: [] },
    { key: 'hand', sheet: { kind: 'own', paper, card: { figure: { kind: 'polygon', rings: [[{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 100 }, { x: 20, y: 100 }]] }, fadePx: 2 } }, children: [{ key: 'palm', washes: [] }] },
  ],
}) };
const figure = shotFigure(painting(hand), 'hand');
const shot = (drawings: DrawingSchedule | undefined, params: Parameters<typeof trail>[1] = { count: 3, every: { drawings: 1 }, fade: 0.5 }) => compilePaintedShot({
  camera: { stage: stampStage({ width: 160, height: 120 }, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, animationFps: FPS },
  span: { from: 0, to: 1, fps: FPS },
  planes: [{ id: 'ground', depth: 2, source: layersOf(painting(hand), ['ground']) }, shotPlace(trail(drawings ? scheduledSource(figure, drawings) : figure, params), { id: 'trail', depth: 1 })],
}, []);

test('a trail reads its input now and each ghost whole drawings back on its source schedule, time and frame alike, and no ghost before its source\'s first drawing', () => {
  const { shot: compiled, problems } = shot(drawingSchedule({ fps: FPS / 2 }));
  assert.deepEqual(problems, []);
  const plane = compiled!.planes.find(({ id }) => id === 'trail') as CompiledShotEffectPlane, reads = shotImageLeafReads(plane.image);
  const frames = (m: PaintMoment | null) => m && Math.round(m.frame * FPS);
  const drawn = (t: PaintMoment) => reads.map((read) => {
    const at = shotLeafReadMoment(read, t);
    return at && Math.round(sourceMoment(read.leaf.drawings, at).frame * FPS);
  });
  // Frame 5 shows the drawing held from frame 4; its ghosts, those from 2 and 0; the third would be before the first.
  assert.deepEqual(drawn(paintMoment(5 / FPS)), [4, 2, 0, null]);
  assert.deepEqual(drawn(paintMoment(9 / FPS)), [8, 6, 4, 2]);
  // A shutter's moment within frame 9 reads each ghost as far within its own frame.
  const open = shotLeafReadMoment(reads[1], { at: 8.75 / FPS, frame: 9 / FPS });
  assert.deepEqual([Math.round(open!.at * FPS * 100) / 100, frames(open)], [6.75, 7]);
});

test('a trail needs a scheduled input and counts whole drawings', () => {
  const said = (drawings: DrawingSchedule | undefined, params?: Parameters<typeof trail>[1]) => shot(drawings, params).problems.map(({ field, message }) => `${field}: ${message}`).join('\n');
  assert.match(said(undefined), /trail reads earlier drawings of source/);
  assert.match(said(drawingSchedule({ fps: FPS / 2 }), { every: { drawings: 0.5 } }), /source\.params\.every\.drawings: trail: 0\.5 isn't a whole number of drawings from 1/);
});

test('history crosses a mid-hold cut and a long held drawing on cold, forward and reverse seeks', () => {
  const sample = () => {
    const drawings = drawingSchedule({ fps: 12 }, [{ at: 0.05, cadence: 'held' }, { at: 0.4, cadence: { fps: 24 } }]);
    const { shot: compiled } = shot(drawings);
    const plane = compiled!.planes.find(p => p.id === 'trail');
    assert.ok(plane?.kind === 'effect');
    const reads = shotImageLeafReads(plane.image);
    return (t: number) => reads.map(read => {
      const moment = shotLeafReadMoment(read, paintMoment(t));
      return moment && drawings.at(moment.frame).time;
    });
  };
  const times = [0, 0.05, 0.4], expected = [[0, null, null, null], [0.05, 0, null, null], [0.4, 0.05, 0, null]];
  assert.deepEqual(times.map(sample()), expected);
  assert.deepEqual(times.toReversed().map(sample()).toReversed(), expected);
  assert.deepEqual(times.map(t => sample()(t)), expected);
});
