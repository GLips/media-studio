import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import { paintSimilarityAfter, paintSimilarityApply, paintSimilarityInverse, paintSimilarityOf } from '#lib/paint/animation/models/paint-similarity.ts';
import type { StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotCoverLay, shotDomCentre, shotPinLay, shotPinMeasureProblems, shotPlaneViewAt } from './shot-placement.ts';

/** A camera panning, zooming and rolling over two seconds, a plane at depth 3 under it. */
function rollingCamera() {
  const built = buildPaintCamera({
    stage: stampStage({ width: 800, height: 600 }), fov: 35, lens: { bloom: 0, shutter: 0 },
    planes: [{ id: 'sky', depth: 3, kind: 'picture', extent: { kind: 'unchecked', why: 'only its view is read' } }],
    plays: [paintCameraPlay({ kind: 'move', keys: [{ at: 0 }, { at: 2, pan: { x: 60, y: -30 }, zoom: 1.4, roll: 0.3 }] }, { clock: { at: 0 }, origin: 'drift' })],
  });
  if (!built.ok) assert.fail(built.problems.join('\n'));
  return built.camera;
}

/** Where `lay` puts document point `p` in frame px, seen through `view`. */
const onFrame = (lay: StampGroupLay, view: ReturnType<typeof shotPlaneViewAt>, p: StampPoint) => paintSimilarityApply(paintSimilarityAfter(view, paintSimilarityOf(lay.placement, lay.pivot)), p);
const near = (a: StampPoint, b: StampPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

test('a cover holds the whole frame as the camera stands at its second, the box only as large as the rolled frame needs', () => {
  const view = shotPlaneViewAt(rollingCamera(), 3, 1), box = { x0: 200, y0: 40, x1: 600, y1: 240 };
  const lay = shotCoverLay(box, view, { width: 800, height: 600 });
  assert.equal(lay.placement.rotation, 0);
  const toDocument = paintSimilarityInverse(paintSimilarityAfter(view, paintSimilarityOf(lay.placement, lay.pivot)));
  const corners = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }].map((corner) => paintSimilarityApply(toDocument, corner));
  const slack = corners.map(({ x, y }) => Math.min(x - box.x0, box.x1 - x, y - box.y0, box.y1 - y));
  assert.ok(slack.every((s) => s > -1e-6), `every frame corner lies on the box: ${slack.join(', ')}`);
  assert.ok(Math.min(...slack) < 1e-6, 'and one lies on its edge');
});

test('a pin lays its document points on its elements\' measured centres, through the camera at its second', () => {
  const view = shotPlaneViewAt(rollingCamera(), 3, 1.5);
  const sources = [{ x: 10, y: 20 }, { x: 110, y: 20 }], centres = [{ x: 300, y: 250 }, { x: 420, y: 330 }];
  const two = shotPinLay(sources, centres, view);
  assert.ok(sources.every((source, i) => near(onFrame(two, view, source), centres[i])));
  const one = shotPinLay(sources.slice(0, 1), centres.slice(0, 1), view);
  assert.ok(near(onFrame(one, view, sources[0]), centres[0]));
  assert.equal(one.placement.scale, 1);
  // A shot 1920 frame px wide shown at 960 page px, scrolled to 100, 50: page px are two frame px.
  assert.deepEqual(shotDomCentre({ left: 300, top: 150, width: 40, height: 20 }, { left: 100, top: 50, width: 960, height: 540 }, 1920), { x: 440, y: 220 });
  assert.deepEqual(shotPinMeasureProblems('label', [null, { x: 1, y: 2 }]).map(({ path, message }) => `${path}: ${message}`), [
    "label.lay.points[0].element: isn't mounted: a pin lies on its element's centre once laid out",
  ]);
});
