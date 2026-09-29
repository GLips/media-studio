import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lookAgainst, lookMotion, openLookSource } from './frame-look.ts';
import { findStillRuns } from './frame-motion.ts';
import { runFfmpeg } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';

// Six black frames, losslessly encoded; `after` draws a white 10×10 box on its frame 3 only.
const dir = join(studioTempRoot(), 'frame-look-test');
mkdirSync(dir);
const video = (name: string, box: string) => {
  const file = join(dir, name);
  runFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x36:r=30', '-frames:v', '6', '-vf', `format=yuv420p${box}`,
    '-c:v', 'libx264', '-qp', '0', file]);
  return file;
};
const before = video('before.mp4', ''), after = video('after.mp4', `,drawbox=x=10:y=10:w=10:h=10:color=white:t=fill:enable='eq(n,3)'`);

test('--against counts exactly the pixels that changed, on the frame they changed, in one pass per video', async () => {
  const [a, b] = await Promise.all([before, after].map((file) => openLookSource({ kind: 'video', file, startsAt: 100 })));
  const out = join(dir, 'against.jpg');
  const lines = await lookAgainst(a, b, [101, 102, 103, 104], { cols: 1, w: 64, out });
  assert.match(lines[1], /1 of 4 frames changed .* the most at 103: 100 px/);
  assert.deepEqual(readFileSync(out.replace('.jpg', '.txt'), 'utf8').trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/).slice(0, 2)),
    [['101', '0'], ['102', '0'], ['103', '100'], ['104', '0']]);
  await assert.rejects(lookAgainst(a, b, [99], { cols: 1, w: 64, out }), /holds frames 100–105, not 99/);
});

test('--motion credits a change to the frame it appears on, and measures a stretch\'s first frame from the one before', async () => {
  const out = join(dir, 'motion.txt');
  await lookMotion(await openLookSource({ kind: 'video', file: after, startsAt: 0 }), 2, 4, { still: 1, out });
  const diffs = readFileSync(out, 'utf8').trim().split('\n').slice(1).map((l) => Number(l.trim().split(/\s+/)[2]));
  assert.equal(diffs[0], 0);
  assert.ok(diffs[1] > 1 && diffs[2] > 1, `frames 3 and 4 move (the box comes and goes): ${diffs}`);
});

test('a still run is 7+ frames under the threshold, broken by a cut and ended by the fade', () => {
  const diff = [null, ...Array(20).fill(1)];
  const clock = {
    fps: 30, end: 21, fade: { from: 18, to: 21 }, beats: [], cues: {},
    bars: [{ n: 1, id: 'a', from: 0, to: 9, beats: 4, musicBeat: 1 }, { n: 2, id: 'b', from: 9, to: 21, beats: 4, musicBeat: 1 }],
  };
  assert.deepEqual(findStillRuns({ first: 0, luma: [], diff }, 3.5, clock), [{ from: 0, to: 8, maxDiff: 1 }, { from: 9, to: 17, maxDiff: 1 }]);
  assert.deepEqual(findStillRuns({ first: 0, luma: [], diff: diff.slice(0, 6) }, 3.5), []);
});
