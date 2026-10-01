import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintChannelConflicts } from './paint-channels.ts';
import { sceneSeconds } from './paint-clock.ts';

const during = (start: number, end: number) => ({ start: sceneSeconds(start), end: sceneSeconds(end) });

test('two writers on one channel of one target conflict only where their half-open intervals overlap', () => {
  const conflicts = paintChannelConflicts([
    { channel: 'deform', target: 'frog/throat', ...during(0, Infinity), origin: 'puff loop' },
    { channel: 'deform', target: 'frog/throat', ...during(3, 4), origin: 'gulp' },
    { channel: 'deform', target: 'frog', ...during(0, Infinity), origin: 'breath' },
    { channel: 'place', target: 'frog', ...during(0, 2), origin: 'hop' },
    { channel: 'place', target: 'frog', ...during(2, 3), origin: 'land' },
  ]);
  assert.deepEqual(conflicts, ['gulp writes deform on frog/throat from 3s while puff loop still does (without end)']);
});
