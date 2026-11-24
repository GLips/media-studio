import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

// The film looks hang on two pieces of colour maths in library-grade.py that no frame shows plainly: footage
// re-encoded as Cineon for the LUT, and the LUT read whole past Resolve's LUT_3D_INPUT_RANGE line. The script asserts
// both in its `check` step.
test("the grade script encodes mid-grey where Cineon puts it and reads a Resolve .cube as an identity", () => {
  const script = new URL('./library-grade.py', import.meta.url).pathname;
  const out = execFileSync('uv', ['run', '--quiet', '--script', script, 'check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const { cineonMidGrey } = JSON.parse(out.trim().split('\n').at(-1)!) as { cineonMidGrey: number };
  assert.ok(Math.abs(cineonMidGrey - 470) < 6, `18% grey at Cineon code ${cineonMidGrey}`);
});
