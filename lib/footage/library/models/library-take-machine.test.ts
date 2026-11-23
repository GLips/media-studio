// The take machine over generated histories: recording.json read as recording or complete, and the folder's files
// seen at times from a small pool, in any order, as a recorder and the library's reads interleave.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { array, assert as assertProperty, constantFrom, integer, oneof, property, record } from 'fast-check';
import type { StudioRecordingJson } from '#lib/footage/recording/models/studio-recording-json.ts';
import { observeRecorderTake, RECORDER_TAKE_QUIET_MS, recorderTakeEnding, recorderTakeUnread } from './library-take-machine.ts';

const recording = (status: StudioRecordingJson['status']): StudioRecordingJson => ({ format: 'studio-recording/1', status, startedAt: '2026-11-22T18:19:29.847-08:00', tracks: {} });

// Times in quarter-quiet steps, so a change and a clock reading land either side of the quiet line often.
const at = integer({ min: 0, max: 12 }).map((n) => (n * RECORDER_TAKE_QUIET_MS) / 4);

const observation = oneof(
  constantFrom('recording' as const, 'complete' as const).map((status) => ({ type: 'recordingRead' as const, recording: recording(status) })),
  record({ type: constantFrom('filesSeen' as const), newestChangeMs: at, nowMs: at }),
);

const history = array(observation, { maxLength: 12 });

const replay = (observations: readonly Parameters<typeof observeRecorderTake>[1][]) => {
  let snapshot = recorderTakeUnread();
  return observations.map((seen) => (snapshot = observeRecorderTake(snapshot, seen)));
};

test('a take seen complete never reads live again, and only a complete read makes it complete', () => {
  assertProperty(property(history, (observations) => {
    const snapshots = replay(observations);
    const firstComplete = observations.findIndex((seen) => seen.type === 'recordingRead' && seen.recording.status === 'complete');
    snapshots.forEach((snapshot, i) => {
      assert.equal(snapshot.matches('complete'), firstComplete >= 0 && i >= firstComplete);
    });
  }));
});

test('a take is addable only once complete, or still for the quiet time by the newest change and clock seen', () => {
  assertProperty(property(history, (observations) => {
    let newest = -Infinity, now = -Infinity, complete = false, read = false;
    replay(observations).forEach((snapshot, i) => {
      const seen = observations[i];
      if (seen.type === 'filesSeen') [newest, now] = [Math.max(newest, seen.newestChangeMs), Math.max(now, seen.nowMs)];
      else [read, complete] = [true, complete || seen.recording.status === 'complete'];
      const quiet = now - newest >= RECORDER_TAKE_QUIET_MS;
      // An add never moves a live take: it adds only what has ended, and says how.
      assert.equal(recorderTakeEnding(snapshot), complete ? 'complete' : read && quiet ? 'interrupted' : undefined);
    });
  }));
});
