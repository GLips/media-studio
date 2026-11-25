import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Path, PlaneGeometry, Shape, ShapeGeometry, SphereGeometry, Vector2, type Object3D } from 'three';
import { shotCameraLookingAt } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { defineSubjectFromThree, projectSubjectFromThree, type SubjectThreeAnnotation } from './subject-three.ts';
import { findSubjectFeature, findSubjectPart } from './subject.ts';

const camera = shotCameraLookingAt({ frame: { width: 100, height: 100 }, fov: 40, near: 0.1, far: 100 }, { position: [0, 0, 10], target: [0, 0, 0] });
const square = (half: number) => [new Vector2(-half, -half), new Vector2(half, -half), new Vector2(half, half), new Vector2(-half, half)];
const placed = <O extends Object3D>(object: O, z: number) => {
  object.position.z = z;
  return object;
};

/** A 6 × 6 card, a 4 × 4 frame with a 2 × 2 window in front of it, a line across the card, and a tab hidden behind it all. */
function framedCard() {
  const material = new MeshBasicMaterial();
  const card = placed(new Mesh(new PlaneGeometry(6, 6), material), 0);
  const outline = new Shape(square(2));
  outline.holes.push(new Path(square(1)));
  const frame = placed(new Mesh(new ShapeGeometry(outline), material), 1);
  const line = placed(new Group(), 0.01);
  const tab = placed(new Mesh(new PlaneGeometry(1, 1), material), -1);
  const root = new Group();
  root.add(card, frame, line, tab);
  const annotations = new Map<Object3D, SubjectThreeAnnotation<'card' | 'frame' | 'tab', 'card-line' | 'frame-outline' | 'tab-mark'>>([
    [card, { kind: 'part', part: 'card' }], [frame, { kind: 'part', part: 'frame' }], [tab, { kind: 'part', part: 'tab' }],
    [line, { kind: 'path', feature: 'card-line', centerline: { points: [[-2.5, 0, 0], [2.5, 0, 0]], closed: false } }],
  ]);
  return defineSubjectFromThree({
    id: 'framed-card', root, camera, cellPx: 0.5, annotations,
    materials: [{ id: 'paper', localColor: '#f0ead8' }],
    parts: [{ id: 'card', material: 'paper' }, { id: 'frame', material: 'paper', outline: 'frame-outline' }, { id: 'tab', material: 'paper' }],
    features: [
      { kind: 'path', id: 'card-line', owner: 'card', line: 'authored' },
      { kind: 'landmark', id: 'tab-mark', owner: 'tab', at: { object: tab, point: [0, 0, 0] } },
    ],
  });
}

test('an occluder cuts holes and pieces: the card shows round the frame and through its window, and the frame hides the line', () => {
  const subject = framedCard();
  const rings = (id: string) => {
    const visibility = findSubjectPart(subject, id)?.visibility;
    return visibility?.kind === 'visible' ? visibility.geometry.rings.length : 0;
  };
  assert.equal(rings('card'), 3, 'the card\'s outer edge, the frame\'s outer edge as a hole, and the window as a piece');
  assert.equal(rings('frame'), 2, 'the frame and its window');
  const runs = (id: string) => {
    const feature = findSubjectFeature(subject, id);
    return feature?.kind === 'path' && feature.visibility.kind === 'visible' ? feature.visibility.geometry.runs : [];
  };
  assert.equal(runs('card-line').length, 3, 'left of the frame, through the window, right of it');
  // The frame stands in front of the card all round, so its hull line shows on both its edges, each a closed loop.
  assert.deepEqual(runs('frame-outline').map(({ closed }) => closed), [true, true]);
});

test('a part hidden behind others keeps its id and place, and its landmark hides with it', () => {
  const subject = framedCard();
  assert.deepEqual([...subject.parts.keys()], ['card', 'frame', 'tab']);
  assert.deepEqual(findSubjectPart(subject, 'tab')?.visibility, { kind: 'hidden' });
  assert.deepEqual(findSubjectFeature(subject, 'tab-mark')?.visibility, { kind: 'hidden' });
  assert.deepEqual([...subject.features.keys()], ['card-line', 'tab-mark', 'frame-outline']);
});

test('normals are unit length and face the viewer; a single-sided back face is culled, a double-sided one turned to the viewer', () => {
  const material = new MeshBasicMaterial(), doubled = new MeshBasicMaterial({ side: DoubleSide });
  const ball = new Mesh(new SphereGeometry(2, 48, 24), material);
  const away = placed(new Mesh(new PlaneGeometry(1, 1), material), 0), turned = placed(new Mesh(new PlaneGeometry(1, 1), doubled), 0);
  away.rotation.y = turned.rotation.y = Math.PI;
  away.position.x = -3; turned.position.x = 3;
  const root = new Group();
  root.add(ball, away, turned);
  const result = projectSubjectFromThree({
    id: 'ball', root, camera, cellPx: 1, annotations: new Map<Object3D, SubjectThreeAnnotation<'ball' | 'away' | 'turned', never>>([[ball, { kind: 'part', part: 'ball' }], [away, { kind: 'part', part: 'away' }], [turned, { kind: 'part', part: 'turned' }]]),
    materials: [{ id: 'clay', localColor: '#a0522d' }],
    parts: [{ id: 'ball', material: 'clay' }, { id: 'away', material: 'clay' }, { id: 'turned', material: 'clay' }],
  });
  assert.ok(result.ok);
  const { surface, parts } = result.value;
  assert.ok(surface);
  const { coverage, normals, layout } = surface;
  let covered = 0;
  for (let k = 0; k < coverage.length; k++) {
    if (coverage[k] <= 0) continue;
    covered++;
    assert.ok(Math.abs(Math.hypot(normals[3 * k], normals[3 * k + 1], normals[3 * k + 2]) - 1) < 1e-4);
    assert.ok(normals[3 * k + 2] > 0);
  }
  assert.ok(covered > 0);
  const centre = (layout.rows >> 1) * layout.columns + (layout.columns >> 1);
  assert.ok(normals[3 * centre + 2] > 0.999, 'the ball faces the viewer at its middle');
  assert.deepEqual([...parts.values()].map(({ visibility }) => visibility.kind), ['visible', 'hidden', 'visible']);
});
