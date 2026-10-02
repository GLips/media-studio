import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL_GUIDE_TEXEL_FLOATS, modelGuideChannel, modelGuideCoverageBox, modelGuideLayout, modelGuidePasses, modelGuideRegion, type ModelGuides } from './model-guides.ts';

/** Texel (i, j)'s first float in a 3 × 2 guide's target. */
const texelAt = (i: number, j: number) => (j * 3 + i) * MODEL_GUIDE_TEXEL_FLOATS;

/** A 3 × 2 guide carrying `regions`, every channel 0 but those `write` sets. */
function guidesWith(regions: string[], write: (guides: ModelGuides) => void): ModelGuides {
  const layout = modelGuideLayout(regions), frame = { width: 3, height: 2 };
  const guides = { frame, layout, targets: layout.targets.map(() => new Float32Array(6 * MODEL_GUIDE_TEXEL_FLOATS)) };
  write(guides);
  return guides;
}

test('regions pack after the object id, four to a target, spilling into passes the device allows', () => {
  const layout = modelGuideLayout(['a', 'b', 'c', 'd']);
  assert.deepEqual(layout.targets, ['surface', 'place', 'fields0', 'fields1']);
  assert.deepEqual(modelGuidePasses(layout, 3), [[0, 1, 2], [3]]);
  assert.throws(() => modelGuideLayout(['throat', 'throat']));
  assert.throws(() => modelGuideLayout(['_REGION_THROAT']));
});

test('a channel view reads the texel components the layout puts it in', () => {
  const guides = guidesWith(['throat', 'cheek', 'moss', 'bib'], (g) => {
    const texel = 1 * 3 + 2;
    g.targets[3][texel * MODEL_GUIDE_TEXEL_FLOATS + 0] = 0.25; // bib: the fourth region, first in fields1
    g.targets[1][texel * MODEL_GUIDE_TEXEL_FLOATS + 3] = 7; // depth
  });
  const bib = modelGuideRegion(guides, 'bib'), depth = modelGuideChannel(guides, 'depth'), texel = 5;
  assert.equal(bib.data[texel * MODEL_GUIDE_TEXEL_FLOATS + bib.offset], 0.25);
  assert.equal(depth.data[texel * MODEL_GUIDE_TEXEL_FLOATS + depth.offset], 7);
  assert.throws(() => modelGuideRegion(guides, 'tail'));
});

test('the coverage box holds the texels a mesh shows, or any mesh', () => {
  const guides = guidesWith([], (g) => {
    g.targets[2][texelAt(1, 0)] = 22;
    g.targets[2][texelAt(2, 1)] = 23;
  });
  assert.deepEqual(modelGuideCoverageBox(guides), { i0: 1, j0: 0, i1: 2, j1: 1 });
  assert.deepEqual(modelGuideCoverageBox(guides, 23), { i0: 2, j0: 1, i1: 2, j1: 1 });
  assert.equal(modelGuideCoverageBox(guides, 99), null);
});
