import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import { compiledPaintedTextureSourceAt, compileShotPaintedTextures } from './shot-painted-texture-compile.ts';
import type { PaintedTexture } from './shot-props.ts';
import { dissolve } from './shot-selection.ts';

/** A label round a can, painted to wrap as `wrap` says (null: not at all). */
const canLabel = (wrap: StampWrap | null) => painting({
  default: function label(): PaintingDocument {
    return {
      widthPx: 256, heightPx: 96, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', ...(wrap && { wrap }),
      layers: [{ key: 'band', washes: [{ key: 'band-wash', applications: [{
        kind: 'stroke', subpaths: [[{ x: 200, y: 48 }, { x: 300, y: 48 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 16,
        seed: 'band', charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
      }] }] }],
    };
  },
});

/** A 256 × 96 painted texture `id` showing `source`. */
const canTexture = (id: string, source: PaintedTexture['source']): PaintedTexture => ({ id, source, widthPx: 256, heightPx: 96 });

test('a painted texture repeats as its paintings wrap, and is refused one blending paintings that wrap otherwise, a clear ground or a reused id', () => {
  const [wrapped, tiled, flat] = [canLabel('x'), canLabel('xy'), canLabel(null)];
  const drawn = compileShotPaintedTextures([
    canTexture('label', layersOf(wrapped, ['band'])), canTexture('tile', layersOf(tiled, ['band'])), canTexture('plain', () => dissolve(layersOf(flat, ['band']), layersOf(flat, ['band']), 0.5)),
  ]);
  assert.deepEqual(drawn.textures?.map(({ id, wrap }) => [id, wrap]), [['label', 'x'], ['tile', 'xy'], ['plain', null]]);
  // How a texture wraps is held from moment 0: a callback turning to a flat painting later is refused there.
  const [turning] = compileShotPaintedTextures([canTexture('turn', (moment) => layersOf(moment.at < 1 ? wrapped : flat, ['band']))]).textures!;
  assert.deepEqual(compiledPaintedTextureSourceAt(turning, paintMoment(2)).problems.map(({ message }) => message), [
    "wraps across x at 0 s, and at 2 s doesn't wrap: a texture repeats as it did at 0 s, for all time",
  ]);
  // Mixed even where the dissolve's weight leaves one side out: a later moment may weigh it in.
  const refused = compileShotPaintedTextures([
    canTexture('can', () => dissolve(layersOf(wrapped, ['band']), layersOf(tiled, ['band']), 0)),
    canTexture('can', layersOf(wrapped, ['band'], { ground: 'transparent' })),
  ]);
  assert.equal(refused.textures, null);
  assert.deepEqual(refused.problems.map(({ path, message }) => `${path}: ${message}`), [
    'can.source: blends paintings that wrap otherwise: a texture repeats across u, v, both or neither, as all it blends do',
    'can.id: names two painted textures: an id names one',
    "can.source: selects on a transparent ground: a painted texture is opaque, shown on its paintings' paper",
  ]);
});
