import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookFramesOf, lookFramesToEnd } from './look-frames.ts';

test('a strip that runs past a render\'s end reads to its last frame; frames all past it are left to fail', () => {
  // A 793-frame render, 0–792, asked for 26.4–26.6 s every 0.1 s: frames 792, 795 and 798.
  const span = { fps: 30, first: 0, end: 793 };
  const asked = lookFramesOf({ strip: '26.4:26.6', step: 0.1, every: false }, span, { clock: undefined, project: 'p' });
  assert.deepEqual(lookFramesToEnd(asked, span), { frames: [792], past: 2 });
  assert.deepEqual(lookFramesToEnd([780, 790, 800], span), { frames: [780, 790, 792], past: 1 });
  assert.deepEqual(lookFramesToEnd([900, 910], span), { frames: [900, 910], past: 0 });
});
