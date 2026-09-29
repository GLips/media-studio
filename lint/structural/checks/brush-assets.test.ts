import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('the studio tracks no brush archive and the workspace nothing in a style\'s brushes/', () => {
  const findings = runCheckOnFiles('brush-assets', {
    'docs/packs/Watercolor.brushset': 'zip',
    // Adversarial: Photoshop's archive, in capitals, deep in lib/.
    'lib/picture/kit/models/fixture/Ink.ABR': 'abr',
    'work/styles/wash/brushes/manifest.json': '{}',
    'work/styles/wash/brushes/tips/wash-01.png': 'png',
    // Legal neighbours: a style's own source and notes, and a pack kept in the private workspace.
    'work/styles/wash/style.ts': 'export default {};\n',
    'work/styles/wash/wash.md': '# Wash\n',
    'work/packs/Watercolor.brushset': 'zip',
  });
  assert.deepEqual(caught(findings), [
    'docs/packs/Watercolor.brushset:tracked',
    'lib/picture/kit/models/fixture/Ink.ABR:tracked',
    'work/styles/wash/brushes/manifest.json:tracked',
    'work/styles/wash/brushes/tips/wash-01.png:tracked',
  ]);
});
