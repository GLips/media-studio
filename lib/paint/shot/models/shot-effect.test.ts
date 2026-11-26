import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_SIMILARITY_IDENTITY } from '#lib/paint/animation/models/paint-similarity.ts';
import type { Layer, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { compilePaintedShot, type CompiledShotEffectPlane } from './shot-compile.ts';
import { defineShotEffect, shotEffectKeyAt, shotEffectTimeAt, shotImageLeafReads, shotMomentMapped } from './shot-effect.ts';
import { shotFigure, shotPlace } from './shot-figure.ts';
import { shotEffectImageKey } from './shot-images.ts';
import { offsetCopies } from './shot-offset-copies.ts';
import { channelSplit } from './shot-channel-split.ts';
import { shotSlicesCell, slices } from './shot-slices.ts';
import type { PaintedShotProps, PlaneProps } from './shot-props.ts';
import { shotEffectExtent, shotPaintedExtent } from './shot-reach.ts';

const FPS = 24;
const SPAN: SceneShownSpan = { from: 0, to: 1 + 1 / FPS, fps: FPS };
const camera: PaintedShotProps['camera'] = { stage: stampStage({ width: 160, height: 120 }, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, animationFps: FPS };
const paper = { color: '#f4f2ed', absorbency: 0.5 } as const;
const layer = (key: string): Layer => ({
  key, washes: [{ key: `${key}-wash`, applications: [{
    kind: 'stroke', subpaths: [[{ x: 40, y: 60 }, { x: 100, y: 60 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 12,
    seed: key, charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
  }] }],
});
const square: Region = { kind: 'polygon', rings: [[{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 100 }, { x: 20, y: 100 }]] };
const street = { default: (): PaintingDocument => ({
  widthPx: 160, heightPx: 120, paper, medium: 'watercolour', layers: [
    layer('shadow'), { key: 'walker', sheet: { kind: 'own', paper, card: { figure: square, fadePx: 2 } }, children: [layer('body')] },
  ],
}) };
const back: PlaneProps = { id: 'street', depth: 2, source: layersOf(painting(street), ['shadow']) };
const hero = shotFigure(painting(street), 'walker');
const compiled = (...planes: PlaneProps[]) => compilePaintedShot({ camera, span: SPAN, planes: [back, ...planes] }, []);
const messages = (...planes: PlaneProps[]) => compiled(...planes).problems.map(({ field, message }) => `${field}: ${message}`).join('\n');

const twoReads = (key: string) => [{ key, map: PAINT_SIMILARITY_IDENTITY }, { key, map: { ...PAINT_SIMILARITY_IDENTITY, kx: 30 } }];

/** Two inputs, each read once, the second at the moment a quarter second earlier. */
const chase = defineShotEffect({
  name: 'chase', inputs: ['lead', 'follow'], defaults: { lag: 0.25 },
  problems: ({ lag }) => (lag >= 0 ? [] : [{ field: 'lag', message: `${lag} s runs ahead` }]),
  reads: ({ lag }) => [{ input: 'lead' }, { input: 'follow', moment: ({ at, frame }) => ({ at: at - lag, frame: frame - lag }) }],
});

test("an effect's input in no plane compiles under the effect's plane, unplaced, and its output grows past the input's box by its offsets", () => {
  const { shot, problems } = compiled(shotPlace(offsetCopies(hero, { count: 2, dx: 30, dy: -10 }), { id: 'echo', depth: 1 }));
  assert.deepEqual(problems, []);
  const plane = shot!.planes.find(({ id }) => id === 'echo') as CompiledShotEffectPlane, [leaf] = shotImageLeafReads(plane.image).map((read) => read.leaf);
  assert.equal(plane.kind, 'effect');
  assert.equal(leaf.id, 'echo');
  assert.equal(leaf.placed, false);
  assert.deepEqual(plane.occurrences.map(({ key }) => key), ['echo/walker', 'echo/body']);
  const input = shotPaintedExtent(leaf, shot!.motion, new Set()), output = shotEffectExtent(plane.image, shot!.motion, new Set());
  assert.ok(input.kind === 'box' && output.kind === 'box');
  assert.deepEqual(output.box, { x0: input.box.x0, y0: input.box.y0 - 20, x1: input.box.x1 + 60, y1: input.box.y1 });
});

test('bad parameters and graphs are refused with what to do, each at its field', () => {
  const said = messages(
    shotPlace(offsetCopies(hero, { count: 0, fade: 2 }), { id: 'a', depth: 1 }),
    { id: 'b', depth: 1, source: { ...offsetCopies(hero), params: { speed: 3 } } },
    { id: 'c', depth: 1, source: chase({ lead: hero } as never) },
    { id: 'd', depth: 1, source: offsetCopies(layersOf(painting(street), ['shadow'])) },
    { id: 'e', depth: 1, source: offsetCopies(hero), masks: [{ kind: 'alphaOf', drawable: 'street/shadow' }] },
  );
  assert.match(said, /source\.params\.count: offsetCopies: 0 isn't a whole number of copies from 1 to 11/);
  assert.match(said, /source\.params\.fade: offsetCopies: 2 isn't within 0\.\.1/);
  assert.match(said, /source\.params\.speed: offsetCopies: takes no parameter speed; it takes count, dx, dy, fade/);
  assert.match(said, /source\.inputs: chase: reads follow, which isn't given: give lead, follow/);
  assert.match(said, /source\.inputs\.source: lays its paper ground, and offsetCopies reads colour and transmittance/);
  assert.match(said, /masks: places offsetCopies's output, and masks cut a painted plane's films/);
});

test("an effect's reads at moments map the frame's outermost first, and its output's key names its effect, parameters and reads, never a moment", () => {
  const { shot, problems } = compiled(shotPlace(chase({ lead: hero, follow: chase({ lead: hero, follow: hero }, { lag: 0.5 }) }), { id: 'chase', depth: 1 }));
  assert.deepEqual(problems, []);
  const plane = shot!.planes.find(({ id }) => id === 'chase') as CompiledShotEffectPlane;
  assert.deepEqual(shotImageLeafReads(plane.image).map(({ moments }) => shotMomentMapped(moments, paintMoment(1)).at), [1, 0.75, 0.25]);
  assert.equal(shotEffectImageKey(plane.image.key, 1, twoReads('hero at 0')), shotEffectImageKey(plane.image.key, 1, twoReads('hero at 0')));
  assert.notEqual(shotEffectImageKey(plane.image.key, 1, twoReads('hero at 0')), shotEffectImageKey(plane.image.key, 1, twoReads('hero at 1')));
  assert.notEqual(shotEffectImageKey(plane.image.key, 1, twoReads('hero at 0')), shotEffectImageKey(plane.image.key, 0.5, twoReads('hero at 0')));
});

test('slices reads each input given, the optional ones left out when not given, and grows its output by its shift', () => {
  const crayon = shotFigure(painting(street), 'walker', { at: 0.5 });
  const { shot, problems } = compiled(
    shotPlace(slices({ source: hero, second: crayon }, { cells: 'rects', shift: 20 }), { id: 'tiles', depth: 1 }),
    shotPlace(slices({ source: hero }), { id: 'cut', depth: 1 }),
  );
  assert.deepEqual(problems, []);
  const [tiles, cut] = ['tiles', 'cut'].map((id) => shot!.planes.find((plane) => plane.id === id) as CompiledShotEffectPlane);
  assert.equal(tiles.image.reads.length, 2);
  assert.ok(shotImageLeafReads(tiles.image).every(({ leaf }) => !leaf.placed));
  assert.equal(cut.image.reads.length, 1);
  const input = shotPaintedExtent(shotImageLeafReads(tiles.image)[0].leaf, shot!.motion, new Set()), output = shotEffectExtent(tiles.image, shot!.motion, new Set());
  assert.ok(input.kind === 'box' && output.kind === 'box');
  assert.deepEqual(output.box, { x0: input.box.x0 - 20, y0: input.box.y0 - 20, x1: input.box.x1 + 20, y1: input.box.y1 + 20 });
  assert.match(messages(shotPlace(slices({ second: hero } as never), { id: 'x', depth: 1 })), /slices: reads source, which isn't given: give source/);
  assert.equal(compiled(shotPlace(slices({ source: hero, second: undefined }), { id: 'y', depth: 1 })).problems.length, 0);
});

test('slices rerolling each drawing keys its output by the drawing its plane shows, alike through a hold, and needs a drawing clock', () => {
  const { shot, problems } = compiled(
    shotPlace(slices({ source: hero }, { reroll: 'drawing' }), { id: 'reroll', depth: 1, sourceClock: { hold: 2 } }),
    shotPlace(slices({ source: hero }), { id: 'fixed', depth: 1, sourceClock: { hold: 2 } }),
  );
  assert.deepEqual(problems, []);
  const [reroll, fixed] = ['reroll', 'fixed'].map((id) => (shot!.planes.find((plane) => plane.id === id) as CompiledShotEffectPlane).image);
  // On twos at 24 fps: animation frames 0 and 1 show drawing 0, frame 2 drawing 1.
  const [first, held, next] = [0, 1 / FPS, 2 / FPS].map((t) => paintMoment(t));
  assert.equal(shotEffectKeyAt(reroll, first), shotEffectKeyAt(reroll, held));
  assert.notEqual(shotEffectKeyAt(reroll, first), shotEffectKeyAt(reroll, next));
  assert.deepEqual(shotEffectTimeAt(reroll, next), { drawing: 1, seconds: 0 });
  assert.equal(shotEffectKeyAt(fixed, first), shotEffectKeyAt(fixed, next));
  const drift = defineShotEffect({ name: 'drift', inputs: ['source'], defaults: {}, problems: () => [], reads: () => [{ input: 'source' }], varies: () => ['moment'] });
  const drifting = (compiled(shotPlace(drift(hero), { id: 'drift', depth: 1 })).shot!.planes.find(({ id }) => id === 'drift') as CompiledShotEffectPlane).image;
  // Two exposures of one frame: a moment followed is read by its seconds, not its frame.
  assert.deepEqual(shotEffectTimeAt(drifting, paintMoment(0.51, 0.5)), { drawing: 0, seconds: 0.51 });
  assert.notEqual(shotEffectKeyAt(drifting, paintMoment(0.5)), shotEffectKeyAt(drifting, paintMoment(0.51, 0.5)));
  assert.match(messages(shotPlace(slices({ source: hero }, { reroll: 'drawing' }), { id: 'x', depth: 1 })), /sourceClock: slices varies with each drawing, and the plane declares no drawing clock/);
  const params = { cells: 'rects', size: 12, shift: 24, share: 0.5, seed: 1 } as const;
  const cells = (cut: 'never' | 'drawing', drawing: number) => Array.from({ length: 16 }, (_, k) => shotSlicesCell({ ...params, reroll: cut }, 2, [k, 0], drawing));
  assert.deepEqual(cells('never', 0), cells('never', 3));
  assert.notDeepEqual(cells('drawing', 0), cells('drawing', 1));
});

test("channel split reads its input once a channel, each through its channel's offset, its output spanning every channel's", () => {
  const { shot, problems } = compiled(shotPlace(channelSplit(hero, { red: [10, 0], blue: [0, -4] }), { id: 'split', depth: 1 }));
  assert.deepEqual(problems, []);
  const plane = shot!.planes.find(({ id }) => id === 'split') as CompiledShotEffectPlane;
  assert.deepEqual(plane.image.reads.map(({ map }) => [map.kx, map.ky]), [[10, 0], [0, 0], [0, -4]]);
  assert.match(messages(shotPlace(channelSplit(hero, { red: [Number.NaN, 0] }), { id: 'x', depth: 1 })), /source\.params\.red: channelSplit: \[NaN, 0\] isn't an offset/);
});
