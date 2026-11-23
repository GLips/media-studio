// Renders frame-glitch-render/video.tsx, whose frame 12 is torn, through a render session: the render fails naming
// the frame by its scene, while a slice clear of it renders and records the check in its snapshot.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withFixtureStudioProject } from './fixture-studio-project.ts';
import { openRenderSession, SLICE_ENCODING } from './render-session.ts';
import { loadRenderSnapshot } from './render-snapshot.ts';

const outcomes = await withFixtureStudioProject('frame-glitch-render', join(import.meta.dirname, 'frame-glitch-render'), async (project) => {
  const session = await openRenderSession(project);
  const render = (from: number, end: number) => {
    const out = join(project, 'out', `frames-${from}-${end}.mp4`);
    return session.renderVideo({ out, frames: { from, end }, sound: 'none', encoding: SLICE_ENCODING })
      .then(() => ({ snapshot: loadRenderSnapshot(out) }), (error: Error) => ({ error, written: existsSync(out) }));
  };
  return { torn: await render(0, 30), clear: await render(0, 10) };
});

test('a render with a torn frame fails naming it, and writes nothing', () => {
  assert.ok('error' in outcomes.torn, 'the render passed');
  assert.match(outcomes.torn.error.message, /frame 12 \(0\.40 s, scene torn\): frame 12 blank at x 0–100%, y 5\d–100% of the frame/);
  assert.equal(outcomes.torn.written, false);
});

test('a render clear of it passes, its snapshot saying every frame was checked', () => {
  assert.ok('snapshot' in outcomes.clear, `the render failed: ${'error' in outcomes.clear ? outcomes.clear.error.message : ''}`);
  assert.equal(outcomes.clear.snapshot.kind === 'snapshot' && outcomes.clear.snapshot.snapshot.glitchCheck, 'whole');
});
