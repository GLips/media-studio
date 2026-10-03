import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { compiledPaintedTextureSourceAt, compileShotPaintedTextures } from './shot-painted-texture-compile.ts';
import type { PaintedTexture } from './shot-props.ts';
import { dissolve } from './shot-selection.ts';

/** A label round a can, painted to wrap or not. */
const canLabel = (wrap: boolean) => painting({
  default: function label(): PaintingDocument {
    return {
      widthPx: 256, heightPx: 96, paper: { color: '#f4f2ed', absorbency: 0.5 }, medium: 'watercolour', ...(wrap && { wrap: 'x' as const }),
      layers: [{ key: 'band', washes: [{ key: 'band-wash', applications: [{
        kind: 'stroke', subpaths: [[{ x: 200, y: 48 }, { x: 300, y: 48 }]], brush: { style: 'watercolor', brush: 'wash' }, diameterPx: 16,
        seed: 'band', charge: { kind: 'paint', mix: { parts: [{ pigment: '#3a4a6b', amount: 1 }], strength: 0.6 } },
      }] }] }],
    };
  },
});

/** A 256 × 96 painted texture `id` showing `source`. */
const canTexture = (id: string, source: PaintedTexture['source']): PaintedTexture => ({ id, source, widthPx: 256, heightPx: 96 });

test('a painted texture repeats across u as its paintings wrap, and is refused one blending a wrap with none, a clear ground or a reused id', () => {
  const [wrapped, flat] = [canLabel(true), canLabel(false)];
  const drawn = compileShotPaintedTextures([canTexture('label', layersOf(wrapped, ['band'])), canTexture('plain', () => dissolve(layersOf(flat, ['band']), layersOf(flat, ['band']), 0.5))]);
  assert.deepEqual(drawn.textures?.map(({ id, wrap }) => [id, wrap]), [['label', 'x'], ['plain', null]]);
  // How a texture wraps is held from moment 0: a callback turning to a flat painting later is refused there.
  const [turning] = compileShotPaintedTextures([canTexture('turn', (moment) => layersOf(moment.at < 1 ? wrapped : flat, ['band']))]).textures!;
  assert.deepEqual(compiledPaintedTextureSourceAt(turning, paintMoment(2)).problems.map(({ message }) => message), ["wraps at 0 s, and at 2 s doesn't: a texture repeats across u or doesn't, for all time"]);
  // Mixed even where the dissolve's weight leaves one side out: a later moment may weigh it in.
  const refused = compileShotPaintedTextures([
    canTexture('can', () => dissolve(layersOf(wrapped, ['band']), layersOf(flat, ['band']), 0)),
    canTexture('can', layersOf(wrapped, ['band'], { ground: 'transparent' })),
  ]);
  assert.equal(refused.textures, null);
  assert.deepEqual(refused.problems.map(({ path, message }) => `${path}: ${message}`), [
    "can.source: blends a painting that wraps with one that doesn't: a texture repeats across u or doesn't",
    'can.id: names two painted textures: an id names one',
    "can.source: selects on a transparent ground: a painted texture is opaque, shown on its paintings' paper",
  ]);
});
