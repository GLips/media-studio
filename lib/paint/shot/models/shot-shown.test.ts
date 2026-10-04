import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layer, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintedShot } from './shot-compile.ts';
import { shotExposureMoments, shotSolvablesShown, shotWarmShown } from './shot-shown.ts';
import { shotWarmFrames } from './shot-warm.ts';

const FPS = 24, SHUTTER = 0.1;

const layer = (key: string): Layer => ({
  key, washes: [{
    key: `${key}-wash`,
    applications: [{
      kind: 'stroke', subpaths: [[{ x: 40, y: 100 }, { x: 200, y: 120 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 20,
      seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
    }],
  }],
});

const pond = painting({
  default: function pond(): PaintingDocument {
    return {
      widthPx: 320, heightPx: 240, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour',
      layers: [layer('sky'), layer('mist'), { key: 'birds', children: [layer('swift'), layer('swallow')] }],
    };
  },
});

/**
 * Over the back: a mist shown from 1 s; birds whose swift shows from 2 s and swallow never, their group gone from 3 s;
 * and a card whose one layer is hidden, laid on its paper.
 */
const { shot } = compilePaintedShot({
  camera: { stage: stampStage({ width: 320, height: 240 }, 2), fov: 35, lens: { bloom: 0, shutter: SHUTTER }, plays: [], animationFps: FPS },
  planes: [
    { id: 'back', depth: 4, source: layersOf(pond, ['sky']) }, { id: 'mist', depth: 3, source: layersOf(pond, ['mist']) },
    { id: 'birds', depth: 2, source: layersOf(pond, ['birds']) }, { id: 'card', depth: 1, source: layersOf(pond, ['swallow'], { ground: 'paper' }) },
  ],
  visibility: {
    mist: ({ at }) => (at < 1 ? 0 : 1), 'birds/swift': ({ at }) => (at < 2 ? 0 : 1), 'birds/swallow': 0, 'birds/birds': ({ at }) => (at < 3 ? 1 : 0),
    'card/swallow': 0,
  },
}, []);

test('a frame solves a painted plane only if it lays something at one of its exposures; the back always does', () => {
  const shownAt = (t: number, mode: 'fast' | 'reference') => {
    const { shown, hidden } = shotSolvablesShown(shot!, shotExposureMoments(SHUTTER, t, mode));
    return [shown.map(({ id }) => id), hidden];
  };
  assert.deepEqual(shownAt(0.98, 'fast'), [['back', 'card'], 2]);
  // Its shutter, open 0.93..1.03 s, sees the mist arrive in its last exposures.
  assert.deepEqual(shownAt(0.98, 'reference'), [['back', 'mist', 'card'], 1]);
  assert.deepEqual(shownAt(2.5, 'fast'), [['back', 'mist', 'birds', 'card'], 0]);
  // The swift shows, but not through its group.
  assert.deepEqual(shownAt(3.5, 'fast'), [['back', 'mist', 'card'], 1]);
});

test('a warm solves a plane at the frames it shows at, counting those it skips', () => {
  const mist = shot!.planes.find(({ id }) => id === 'mist')!;
  assert.ok(mist.kind === 'painted');
  const { frames, hidden } = shotWarmShown(shot!, mist, shotWarmFrames({ from: 0.5, to: 1.5 }, FPS), 'fast');
  assert.deepEqual(frames.map(({ at }) => Math.round(at * FPS)), Array.from({ length: 13 }, (_, i) => 24 + i));
  assert.equal(hidden, 12);
});
