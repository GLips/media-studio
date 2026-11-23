// library-frame-decoder-machine.ts: one ffmpeg frame decoder's process, as its reads see it. Pure; the decoder
// (library-frame-decoder.ts) feeds it what its process does.
//
//   decoding  running: frames arrive on its grid, in order
//   finished  exited cleanly at the file's end: its last frame stands for any time past it
//   stopped   killed (closed for another, or idle) or died after some frames: nothing more comes, and nothing past
//             its last frame can be inferred
//   failed    couldn't start, or died before its first frame: every read of it fails with why
import type { SnapshotFrom } from 'xstate';
import { initialTransition, setup, transition, types } from 'xstate';

const decoderSetup = setup({
  schemas: {
    context: types<{ readonly decoded: number }>(),
    events: {
      frameDecoded: types<object>(),
      exited: types<{ readonly code: number | null; readonly stderr: string }>(),
      spawnFailed: types<{ readonly reason: string }>(),
    },
  },
  states: {
    decoding: {},
    finished: {},
    stopped: {},
    failed: { id: 'decoderFailed', schemas: { input: types<{ readonly reason: string }>() } },
  },
});

export const libraryFrameDecoderMachine = decoderSetup.createMachine({
  id: 'libraryFrameDecoder',
  context: { decoded: 0 },
  initial: 'decoding',
  states: {
    decoding: {
      on: {
        frameDecoded: ({ context }) => ({ context: { decoded: context.decoded + 1 } }),
        // A signal (code null) is a kill: the decoder was closed, not broken.
        exited: ({ context, event }) => {
          if (event.code === 0) return { target: 'finished' as const };
          if (event.code === null || context.decoded > 0) return { target: 'stopped' as const };
          return { target: '#decoderFailed' as const, input: { reason: event.stderr.trim() || `exit ${event.code}` } };
        },
        spawnFailed: ({ event }) => ({ target: '#decoderFailed' as const, input: { reason: event.reason } }),
      },
    },
    finished: { type: 'final' },
    stopped: { type: 'final' },
    failed: { type: 'final' },
  },
});

export type LibraryFrameDecoderSnapshot = SnapshotFrom<typeof libraryFrameDecoderMachine>;
type LibraryFrameDecoderEvent = Parameters<typeof transition<typeof libraryFrameDecoderMachine>>[2];

export const libraryFrameDecoderStarted = (): LibraryFrameDecoderSnapshot => initialTransition(libraryFrameDecoderMachine)[0];

export const libraryFrameDecoderStep = (snapshot: LibraryFrameDecoderSnapshot, event: LibraryFrameDecoderEvent): LibraryFrameDecoderSnapshot =>
  transition(libraryFrameDecoderMachine, snapshot, event)[0];

/** Why the decoder failed, once it has. */
export const libraryFrameDecoderFailure = (snapshot: LibraryFrameDecoderSnapshot): string | undefined =>
  (snapshot.matches('failed') ? snapshot.getInputs().decoderFailed?.reason : undefined);
