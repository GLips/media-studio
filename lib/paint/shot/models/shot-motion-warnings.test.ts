import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { PaintCameraShutter } from '#lib/paint/animation/models/paint-camera.ts';
import type { PaintCurve } from '#lib/paint/animation/models/paint-curves.ts';
import type { Layer, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { compilePaintedShot } from './shot-compile.ts';
import type { PaintedShotProps } from './shot-props.ts';

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
    return { widthPx: 320, heightPx: 240, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', layers: [layer('sky'), layer('swift'), layer('swallow'), layer('swallow-up')] };
  },
});

/**
 * A swift flying 120 px in a second and stopping by `arrival`, held on `hold`s (unheld when left out), a swallow
 * appearing at 1.5 s and swapped for its wings-up view at 1.75 s, under a shutter `shutter` open.
 */
function flight(arrival: PaintCurve, shutter: PaintCameraShutter, hold?: number): string[] {
  const { problems } = compilePaintedShot({
    camera: { stage: stampStage({ width: 320, height: 240 }, 2), fov: 35, lens: { bloom: 0, shutter } },
    span: { from: 0, to: 2, fps: 24 },
    planes: [
      { id: 'back', depth: 4, source: layersOf(pond, ['sky']) },
      {
        id: 'birds', depth: 1, source: layersOf(pond, ['swift', 'swallow', 'swallow-up']),
        occurrences: {
          swift: { plays: [{ clip: { kind: 'place', value: paintKeyed([{ at: 0, value: { x: 0 } }, { at: 1, value: { x: 120 }, curve: arrival }]) }, clock: { at: 0, ...(hold && { hold }) }, origin: 'flight' }] },
          swallow: { visibility: ({ at }) => (at >= 1.5 && at < 1.75 ? 1 : 0) },
          'swallow-up': { visibility: ({ at }) => (at < 1.75 ? 0 : 1) },
        },
      },
    ],
  } satisfies PaintedShotProps, []);
  return problems.map(({ severity, owner, message }) => `${severity} ${owner}: ${message}`);
}

test('a shot warns, naming drawable, time and pace, of a stop at full speed, a move the shut shutter strobes, and a pop, not a swap', () => {
  const warned = flight('linear', 'shut');
  assert.equal(warned.length, 3, warned.join('\n'));
  assert.match(warned[0], /^warning birds\/swift: its speed jumps at 1 s, from 5 to 0 px a frame: meet the key/);
  assert.match(warned[1], /^warning birds\/swift: moves up to 5 px a frame with the shutter shut, from 0 s to 1 s; past 1\.9 px a frame it strobes/);
  assert.match(warned[2], /^warning birds\/swallow: its visibility steps from 0 to 1 within a frame at 1\.5 s: it pops in or out$/);
  // The same stop eased into under an open shutter warns only of the pop.
  assert.deepEqual(flight('inOut', 1 / 48).map((each) => each.split(':')[0]), ['warning birds/swallow']);
});

test("a hold's steps strobe through an open shutter, and the warning says to hold on ones", () => {
  const swift = flight('inOut', 1 / 48, 2).filter((each) => each.startsWith('warning birds/swift'));
  // One warning for the held stretch, though its steps fall every other frame.
  assert.equal(swift.length, 1, swift.join('\n'));
  assert.match(swift[0], /^warning birds\/swift: steps up to [\d.]+ px at a time as its hold steps, from [\d.]+ s to [\d.]+ s; a held drawing holds through the shutter, so a step past 1\.9 px strobes: hold it on ones, or slow it$/);
});
