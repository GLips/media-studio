// library-frame-decoder-machine.ts: one ffmpeg frame decoder's life, as its reads see it. Pure; the decoder
// (library-frame-decoder.ts) feeds it what its process does and when the pool closes it, and its reads wait on it.
//
//   decoding    running: frames arrive on its grid, in order
//   diagnosing  exited non-zero before its first frame; a second run is finding out why
//   finished    exited cleanly at the file's end: its last frame stands for any time past it
//   stopped     closed by the pool (for another, or idle), or died after some frames: nothing more comes, and
//               nothing past its last frame can be inferred
//   failed      couldn't start, or died before its first frame: every read of it fails with why
import type { SnapshotFrom } from 'xstate';
import { initialTransition, setup, transition, types } from 'xstate';

const decoderSetup = setup({
  schemas: {
    context: types<{ readonly decoded: number }>(),
    events: {
      frameDecoded: types<object>(),
      /** `code` is null when a signal ended it. */
      exited: types<{ readonly code: number | null }>(),
      spawnFailed: types<{ readonly reason: string }>(),
      diagnosed: types<{ readonly reason: string }>(),
      closed: types<object>(),
    },
  },
  states: {
    decoding: {},
    diagnosing: {},
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
        // A signal it wasn't sent by the pool (the pool closes before it kills) still ends it short, not broken.
        exited: ({ context, event }) => {
          if (event.code === 0) return { target: 'finished' as const };
          if (event.code === null || context.decoded > 0) return { target: 'stopped' as const };
          return { target: 'diagnosing' as const };
        },
        // Node also reports a process error after the spawn; once frames came, the decoder is only cut short.
        spawnFailed: ({ context, event }) => (context.decoded > 0 ? { target: 'stopped' as const } : { target: '#decoderFailed' as const, input: { reason: event.reason } }),
        closed: () => ({ target: 'stopped' as const }),
      },
    },
    diagnosing: {
      on: {
        diagnosed: ({ event }) => ({ target: '#decoderFailed' as const, input: { reason: event.reason } }),
        closed: () => ({ target: 'stopped' as const }),
      },
    },
    finished: { type: 'final' },
    stopped: { type: 'final' },
    failed: { type: 'final' },
  },
});

export type LibraryFrameDecoderSnapshot = SnapshotFrom<typeof libraryFrameDecoderMachine>;
export type LibraryFrameDecoderEvent = Parameters<typeof transition<typeof libraryFrameDecoderMachine>>[2];

export const libraryFrameDecoderStarted = (): LibraryFrameDecoderSnapshot => initialTransition(libraryFrameDecoderMachine)[0];

export const libraryFrameDecoderStep = (snapshot: LibraryFrameDecoderSnapshot, event: LibraryFrameDecoderEvent): LibraryFrameDecoderSnapshot =>
  transition(libraryFrameDecoderMachine, snapshot, event)[0];

/** Why the decoder failed, once it has. */
export const libraryFrameDecoderFailure = (snapshot: LibraryFrameDecoderSnapshot): string | undefined =>
  (snapshot.matches('failed') ? snapshot.getInputs().decoderFailed?.reason : undefined);
