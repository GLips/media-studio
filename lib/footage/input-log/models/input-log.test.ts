import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Result } from 'effect';
import { inputLogKeyStrikes, inputLogWaypoints, parseRecorderInputLog } from './input-log.ts';

test("a killed recording's input log keeps every whole line, a gap included, and drops the torn last one", () => {
  const jsonl = [
    '{"t":0.41,"type":"mouseMove","x":120,"y":80,"modifiers":[]}',
    '{"t":0.9,"type":"gap"}',
    '{"t":1.2,"type":"keyDown","keyCode":0,"key":"a","modifiers":["cmd"]}',
    '{"t":1.3,"type":"keyDown","keyCode":0,"key":"a","repeat":true,"modif',
  ].join('\n');
  const log = Result.getOrThrow(parseRecorderInputLog(jsonl, 'input.jsonl'));
  assert.equal(log.coordinates, 'global-points');
  assert.deepEqual(log.events.map((e) => e.type), ['mouseMove', 'gap', 'keyDown']);
});

test('a torn line anywhere but last is refused, naming its line: the log is corrupt, not killed', () => {
  const read = parseRecorderInputLog('{"t":0.1,"ty\n{"t":0.2,"type":"gap"}', 'input.jsonl');
  assert.ok(Result.isFailure(read));
  assert.equal(read.failure._tag, 'RecordingLogLineUnreadable');
  assert.equal(read.failure.line, 1);
});

test("a take's cursor runs through its moves and clicks, a press and release counting once, and its key strikes skip repeats", () => {
  const log = {
    coordinates: 'viewport-css-pixels' as const,
    events: [
      { t: 0, type: 'mouseMove' as const, x: 10, y: 10 },
      { t: 0.5, type: 'mouseMove' as const, x: 50, y: 40 },
      { t: 0.5, type: 'mouseDown' as const, x: 50, y: 40, button: 'left', clicks: 1 },
      { t: 0.5, type: 'mouseUp' as const, x: 50, y: 40, button: 'left', clicks: 1 },
      { t: 0.7, type: 'keyDown' as const, key: 'h' },
      { t: 0.8, type: 'keyDown' as const, key: 'h', repeat: true as const },
    ],
  };
  assert.deepEqual(inputLogWaypoints(log), [
    { t: 0, x: 10, y: 10, click: false }, { t: 0.5, x: 50, y: 40, click: false }, { t: 0.5, x: 50, y: 40, click: true },
  ]);
  assert.deepEqual(inputLogKeyStrikes(log), [0.7]);
});
