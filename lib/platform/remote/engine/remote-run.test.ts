// What `studio remote run` refuses must run on this Mac, and it says so before anything uploads or bills: an agent
// asking for the GPU gate remotely learns why and where to run it, not after a minute of uploading.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRemoteScripts } from './remote-run.ts';

test('stamp:gate, the harness and a script package.json lacks are refused up front, each with its reason, and nothing else is', async () => {
  const reasons = await runRemoteScripts(['typecheck', 'stamp:gate', 'wet:passages', 'typecheck:everything']).then(
    () => assert.fail('studio remote run ran scripts it should have refused'),
    (error: Error) => error.message.split('\n'),
  );
  assert.equal(reasons.length, 3, reasons.join('\n'));
  assert.match(reasons[0], /^stamp:gate judges paint against baselines drawn on this Mac's GPU/);
  assert.match(reasons[1], /^wet:passages runs harness\//);
  assert.match(reasons[2], /^typecheck:everything isn't a script in package\.json/);
});
