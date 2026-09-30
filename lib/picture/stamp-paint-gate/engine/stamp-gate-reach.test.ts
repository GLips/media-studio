import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stampGateImportedFiles, stampGateReachedBy } from './stamp-gate-reach.ts';
import { STAMP_GATE_PAGE } from './stamp-gate.ts';

test("pre-commit runs the gate for a staged file the renderer imports from another feature, and not for an unrelated one", async () => {
  const imported = await stampGateImportedFiles(fileURLToPath(new URL('../../../../', import.meta.url)), STAMP_GATE_PAGE);
  assert.deepEqual(stampGateReachedBy([
    'lib/picture/motion/models/random.ts',
    'lib/picture/stamp-paint/studio/stamp-paint-renderer.ts',
    'harness/fixtures/stamp-paint/manifest.json',
    'lib/picture/composition/studio/Video.tsx',
    'docs/brush-engine.md',
  ], imported), [
    'lib/picture/motion/models/random.ts',
    'lib/picture/stamp-paint/studio/stamp-paint-renderer.ts',
    'harness/fixtures/stamp-paint/manifest.json',
  ]);
});
