// Each container cuts its own share from the frames its page reads, with no word from the others: the shares and
// pieces must cover the video exactly, in order, whatever the counts, or the join refuses a gap or an overlap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remoteContainerCount, remoteContainerPieces, type RemoteFrames } from './remote-render-plan.ts';

const piecesOf = (frames: RemoteFrames, containers: number, browsers: number) =>
  Array.from({ length: containers }, (_, index) => remoteContainerPieces(frames, { containers, index, browsers }));

test('a video is shared over containers and their browsers whole and in order, a container to each 600 frames', () => {
  const frames = { from: 0, end: 1801 }, containers = remoteContainerCount(frames.end - frames.from, 8);
  assert.equal(containers, 4);
  const shares = piecesOf(frames, containers, 3);
  assert.deepEqual(shares.map((pieces) => pieces.length), [3, 3, 3, 3]);
  const pieces = shares.flat();
  assert.equal(pieces[0].from, 0);
  assert.equal(pieces.at(-1)?.end, 1801);
  for (const [i, piece] of pieces.entries()) if (i) assert.equal(piece.from, pieces[i - 1].end);
});

test('a short share draws in fewer browsers, and a container past the frames draws none', () => {
  assert.deepEqual(remoteContainerPieces({ from: 100, end: 160 }, { containers: 1, index: 0, browsers: 3 }), [{ from: 100, end: 130 }, { from: 130, end: 160 }]);
  assert.deepEqual(piecesOf({ from: 0, end: 2 }, 3, 3), [[{ from: 0, end: 1 }], [{ from: 1, end: 2 }], []]);
  assert.equal(remoteContainerCount(5000, 4), 4);
  assert.equal(remoteContainerCount(1, 4), 1);
});
