import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintChannelConflicts, paintStrokeBoilEpoch } from './paint-channels.ts';

test('two writers on one channel of one target conflict only where their half-open intervals overlap', () => {
  const conflicts = paintChannelConflicts([
    { channel: 'deform', target: 'frog/throat', start: 0, end: Infinity, origin: 'puff loop' },
    { channel: 'deform', target: 'frog/throat', start: 3, end: 4, origin: 'gulp' },
    { channel: 'deform', target: 'frog', start: 0, end: Infinity, origin: 'breath' },
    { channel: 'reveal', target: 'frog/throat', start: 0, end: 2, origin: 'paint in' },
    { channel: 'reveal', target: 'frog/throat', start: 2, end: 3, origin: 'outline in' },
  ]);
  assert.deepEqual(conflicts, ['gulp writes deform on frog/throat from 3s while puff loop still does (without end)']);
});

const epochAt = (frame: number, revealEnd: number) => paintStrokeBoilEpoch(frame / 24, revealEnd, 2, 24);

test('a stroke keeps its drawn seed through its reveal and up to the next grid step, then boils with its part', () => {
  assert.deepEqual([9, 10, 11, 12, 13, 14].map((frame) => epochAt(frame, 10.5 / 24)), [0, 0, 0, 1, 1, 2]);
  // A stroke that finished earlier steps on the same frames.
  assert.deepEqual([11, 12, 13, 14].map((frame) => epochAt(frame, 3 / 24) - epochAt(frame - 1, 3 / 24)), [0, 1, 0, 1]);
});
