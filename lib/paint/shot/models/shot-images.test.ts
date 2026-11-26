import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_SIMILARITY_IDENTITY, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { shotImageKeys, shotImageReadKey } from './shot-images.ts';

/** A pond dissolving `k` of the way from dawn to dusk. */
const dissolvingPond = (k: number) => [{ key: 'pond dawn', weight: 1 - k }, { key: 'pond dusk', weight: k }];

/** Tint reading heron's wing, heron reading a photo's render keyed `photo`, through `across` between tint and heron. */
function chain(photo: string, heron = 'heron', across: PaintSimilarity = PAINT_SIMILARITY_IDENTITY) {
  const heronKeys = shotImageKeys([{ key: heron, weight: 1 }], [{ name: 'photo', key: photo }]);
  return { heron: heronKeys, tint: shotImageKeys([{ key: 'tint', weight: 1 }], [{ name: 'heron/wing', key: shotImageReadKey(heronKeys.image, across) }]) };
}

/** Glow's image key, reading a pond whose image is keyed `pond`. */
const glow = (pond: string) => shotImageKeys([{ key: 'glow', weight: 1 }], [{ name: 'pond', key: shotImageReadKey(pond, PAINT_SIMILARITY_IDENTITY) }]).image;

test("a reader's image key moves with what it reads and where the camera shows it, through a chain and across a dissolve, and only then", () => {
  const keys = chain('photo@1');
  assert.notEqual(chain('photo@1', 'heron moved').tint.image, keys.tint.image);
  assert.notEqual(chain('photo@2').tint.image, keys.tint.image);
  // The camera's parallax between tint and heron moves the tint's read of the wing, and nothing the heron reads.
  const panned = chain('photo@1', 'heron', { ma: 1, mb: 0, kx: 12, ky: 0 });
  assert.notEqual(panned.tint.image, keys.tint.image);
  assert.deepEqual(panned.heron, keys.heron);
  // A dissolve moving only its weights keeps its selections' pictures, and moves its reader's.
  const [quarter, half] = [dissolvingPond(0.25), dissolvingPond(0.5)].map((pond) => shotImageKeys(pond, []));
  assert.deepEqual(quarter.shares, ['pond dawn', 'pond dusk']);
  assert.deepEqual(half.shares, quarter.shares);
  assert.notEqual(glow(half.image), glow(quarter.image));
});
