// The frame decoder's machine over generated histories: ffmpeg's frames and exit, a diagnosis and the pool's close,
// in any order, as the decoder's process and its pool interleave.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { array, assert as assertProperty, constant, constantFrom, oneof, property, record } from 'fast-check';
import { libraryFrameDecoderFailure, libraryFrameDecoderStarted, libraryFrameDecoderStep, type LibraryFrameDecoderEvent } from './library-frame-decoder-machine.ts';

const event = oneof(
  constant({ type: 'frameDecoded' as const }),
  record({ type: constant('exited' as const), code: constantFrom(0, 1, 234, null) }),
  record({ type: constant('spawnFailed' as const), reason: constant('spawn ffmpeg ENOENT') }),
  record({ type: constant('diagnosed' as const), reason: constant('moov atom not found') }),
  constant({ type: 'closed' as const }),
);

const history = array<LibraryFrameDecoderEvent>(event, { maxLength: 16 });

const replay = (events: readonly LibraryFrameDecoderEvent[]) => {
  let snapshot = libraryFrameDecoderStarted();
  return events.map((seen) => (snapshot = libraryFrameDecoderStep(snapshot, seen)));
};

test('a decoder counts only the frames before it ends, and an ended one never changes', () => {
  assertProperty(property(history, (events) => {
    const snapshots = replay(events);
    const ended = snapshots.findIndex((snapshot) => !snapshot.matches('decoding'));
    const counted = events.slice(0, ended < 0 ? events.length : ended).filter((seen) => seen.type === 'frameDecoded').length;
    assert.equal(snapshots.at(-1)?.context.decoded ?? 0, counted);
    const final = snapshots.findIndex((snapshot) => snapshot.status === 'done');
    if (final >= 0) for (const later of snapshots.slice(final)) assert.equal(later, snapshots[final]);
  }));
});

test("a decoder fails only before its first frame and with a reason, and the pool's close always ends a read's wait", () => {
  assertProperty(property(history, (events) => {
    replay(events).forEach((snapshot, i) => {
      if (snapshot.matches('failed')) {
        assert.equal(snapshot.context.decoded, 0);
        assert.ok(libraryFrameDecoderFailure(snapshot));
      }
      if (events[i].type === 'closed') assert.equal(snapshot.status, 'done');
      // A clean exit is the one way to finish: its last frame then stands for times past the file's end.
      if (snapshot.matches('finished')) assert.ok(events.slice(0, i + 1).some((seen) => seen.type === 'exited' && seen.code === 0));
    });
  }));
});
