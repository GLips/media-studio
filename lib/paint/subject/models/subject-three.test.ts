import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bone, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, Path, PlaneGeometry, Shape, ShapeGeometry, Skeleton, SkinnedMesh, SphereGeometry, Vector2, Vector3, type Object3D } from 'three';
import { shotCameraLookingAt, shotCameraProject } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { subjectFramePoint } from './subject-frame.ts';
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

test('a mesh the GPU deforms is refused by name and annotation; a morph weighted zero projects as its geometry', () => {
  const material = new MeshBasicMaterial();
  const skinned = Object.assign(new SkinnedMesh(new PlaneGeometry(1, 1), material), { name: 'arm' });
  skinned.bind(new Skeleton([new Bone()]));
  const instanced = Object.assign(new InstancedMesh(new PlaneGeometry(1, 1), material, 3), { name: 'leaves' });
  const morphGeometry = new PlaneGeometry(1, 1);
  morphGeometry.morphAttributes.position = [new Float32BufferAttribute(new Float32Array(morphGeometry.getAttribute('position').count * 3), 3)];
  const morphed = Object.assign(new Mesh(morphGeometry, material), { name: 'cheek' });
  morphed.morphTargetInfluences = [0.5];
  const resting = Object.assign(new Mesh(morphGeometry, material), { name: 'brow' });
  resting.morphTargetInfluences = [0];
  const root = Object.assign(new Group(), { name: 'face' });
  root.add(skinned, instanced, morphed, resting);
  const annotations = new Map<Object3D, SubjectThreeAnnotation<'arm' | 'brow', 'leaf'>>([
    [skinned, { kind: 'part', part: 'arm' }], [instanced, { kind: 'region', feature: 'leaf' }],
    [morphed, { kind: 'part', part: 'arm' }], [resting, { kind: 'part', part: 'brow' }],
  ]);
  const result = projectSubjectFromThree({
    id: 'deformed', root, camera, cellPx: 1, annotations, materials: [{ id: 'skin', localColor: '#e0b090' }],
    parts: [{ id: 'arm', material: 'skin' }, { id: 'brow', material: 'skin' }], features: [{ kind: 'region', id: 'leaf', owner: 'arm' }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.ok ? [] : result.diagnostics.map(({ code, address, message }) => `${code} ${address}: ${message.split(':')[0]}`), [
    "deformed-mesh face/arm: the mesh annotated part 'arm' can't be projected",
    "deformed-mesh face/leaves: the mesh annotated region 'leaf' can't be projected",
    "deformed-mesh face/cheek: the mesh annotated part 'arm' can't be projected",
  ]);
});

test('a plane frame maps its face exactly through the perspective, and is unavailable seen from behind', () => {
  const near = shotCameraLookingAt({ frame: { width: 100, height: 100 }, fov: 60, near: 0.1, far: 100 }, { position: [4, 1, 5], target: [0, 0, 0] });
  const frameOn = (turn: number) => {
    const card = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ side: DoubleSide }));
    card.rotation.y = turn;
    const root = new Group();
    root.add(card);
    const subject = defineSubjectFromThree({
      id: 'card', root, camera: near, cellPx: 1, annotations: new Map([[card, { kind: 'part', part: 'card' } as const]]),
      materials: [{ id: 'paper', localColor: '#f0ead8' }], parts: [{ id: 'card', material: 'paper' }],
      frames: [{ id: 'front', owner: 'card', from: { kind: 'plane', object: card, origin: [0, 0, 0], xAxis: [2, 0, 0], yAxis: [0, -2, 0] } }],
    });
    return { card, status: subject.frames.values().next().value!.status };
  };
  const { card, status } = frameOn(0.3);
  assert.equal(status.kind, 'available');
  if (status.kind !== 'available') return;
  assert.ok(status.basis.perspective && Math.hypot(status.basis.perspective.x, status.basis.perspective.y) > 0.05, 'a near, turned face is foreshortened');
  card.updateMatrixWorld();
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0.3, -0.7]]) {
    const seen = shotCameraProject(near, card.localToWorld(new Vector3(2 * x, -2 * y, 0)))!;
    const mapped = subjectFramePoint(status.basis, { x, y });
    assert.ok(Math.hypot(mapped.x - seen.x, mapped.y - seen.y) < 1e-6, `local (${x}, ${y}) lands where the camera sees it`);
  }
  assert.deepEqual(frameOn(Math.PI).status, { kind: 'unavailable', reason: 'its face is turned away from the camera' });
});
