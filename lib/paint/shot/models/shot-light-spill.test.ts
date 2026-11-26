import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { compilePaintedShot } from './shot-compile.ts';
import { shotFigure } from './shot-figure.ts';
import { illuminate, lightSpill } from './shot-light-spill.ts';
import { neon } from './shot-neon.ts';
import type { PaintedShotProps, PlaneProps } from './shot-props.ts';

const FPS = 24;
const SPAN: SceneShownSpan = { from: 0, to: 1 + 1 / FPS, fps: FPS };
const camera: PaintedShotProps['camera'] = { stage: stampStage({ width: 160, height: 120 }, 2), fov: 35, lens: { bloom: 2, shutter: 'shut' }, animationFps: FPS };
const paper = { color: '#2a2226', absorbency: 0.5 } as const;
const square: Region = { kind: 'polygon', rings: [[{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 100 }, { x: 20, y: 100 }]] };
const scene = { default: (): PaintingDocument => ({
  widthPx: 160, heightPx: 120, paper, medium: 'watercolour', layers: [
    { key: 'wall', washes: [] },
    { key: 'sign', sheet: { kind: 'own', paper, card: { figure: square, fadePx: 2 } }, children: [{ key: 'tube', washes: [] }] },
  ],
}) };
const wall: PlaneProps = { id: 'wall', depth: 2, source: layersOf(painting(scene), ['wall']) };
const sign = neon({ palette: ['#ff3fa4', '#3ff0ff'], spill: { reach: 24 } });
const tubes = sign.place(shotFigure(painting(scene), 'sign'), { id: 'sign', depth: 1 });
const shot = (...planes: PlaneProps[]) => compilePaintedShot({ camera, span: SPAN, planes }, []);

test("a wall lit by neon keeps its spill by receiving plane, the back included; the tubes stand without it", () => {
  const lit = shot(sign.light(wall, 'sign'), tubes);
  assert.deepEqual(lit.problems, []);
  assert.deepEqual(lit.shot!.spills.get('wall'), [{ kind: 'light-spill', source: 'sign', reach: 24, gain: 6, added: 0.5 }]);
  const alone = shot(wall, tubes);
  assert.deepEqual(alone.problems, []);
  assert.equal(alone.shot!.spills.size, 0);
});

test('a spill from what throws no light, or past its bounds, is refused at its field', () => {
  const said = shot(illuminate(wall, lightSpill('nowhere', { reach: 0 }), lightSpill('wall', { reach: 8, gain: -1 }), lightSpill('glass', { reach: 8 })), tubes, {
    id: 'glass', depth: 1.5, source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: () => Promise.resolve(null) },
  }).problems.map(({ field, message }) => `${field}: ${message}`).join('\n');
  assert.match(said, /spills\[0\]\.source: names nowhere, which is no plane of this shot/);
  assert.match(said, /spills\[0\]\.reach: 0 px isn't a reach above 0/);
  assert.match(said, /spills\[1\]\.source: is the plane it lights/);
  assert.match(said, /spills\[1\]\.gain: -1 isn't a gain of 0 or more/);
  assert.match(said, /spills\[2\]\.source: names glass, a picture plane: light is thrown by a painted or effect plane's emission/);
});

test("neon's flicker is the same at a moment whatever order it's read in, and dims below full", () => {
  const flicker = neon({ palette: ['#ff3fa4'], flicker: { chance: 0.5, seed: 7 } }).flicker;
  assert.equal(typeof flicker, 'function');
  const at = (s: number) => (flicker as (m: ReturnType<typeof paintMoment>) => number)(paintMoment(s));
  const seconds = Array.from({ length: 48 }, (_, i) => i / 24), forward = seconds.map(at), backward = seconds.toReversed().map(at).toReversed();
  assert.deepEqual(forward, backward);
  assert.ok(Math.min(...forward) < 0.8 && Math.max(...forward) <= 1);
});
