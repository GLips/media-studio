// library-proxy-machine.ts: one run making an item's missing proxies, encoded side by side. Pure; the run
// (library-proxies.ts) reports each encode as it settles.
//
//   encoding  some wanted proxy hasn't settled; each made one is kept as it lands
//   settled   every wanted proxy was made or failed: the made ones go into item.json, whatever else failed
//
// Which proxies a track has is item.json's (libraryProxiesWanted), never this machine's: it lives for one run.
import type { SnapshotFrom } from 'xstate';
import { initialTransition, setup, transition, types } from 'xstate';
import type { LibraryTrackProxy } from './library-item.ts';

type LibraryProxyRunContext = {
  readonly wanted: readonly string[];
  readonly made: Readonly<Record<string, LibraryTrackProxy>>;
  readonly failed: readonly string[];
};

const proxySetup = setup({
  schemas: {
    context: types<LibraryProxyRunContext>(),
    input: types<{ readonly wanted: readonly string[] }>(),
    events: {
      proxyMade: types<{ readonly track: string; readonly proxy: LibraryTrackProxy }>(),
      proxyFailed: types<{ readonly track: string }>(),
    },
  },
  states: { encoding: {}, settled: {} },
});

const allSettled = ({ wanted, made, failed }: LibraryProxyRunContext) => wanted.every((track) => track in made || failed.includes(track));

const settledIfDone = (context: LibraryProxyRunContext) => (allSettled(context) ? { target: 'settled' as const, context } : { context });

export const libraryProxyRunMachine = proxySetup.createMachine({
  id: 'libraryProxyRun',
  context: ({ input }) => ({ wanted: input.wanted, made: {}, failed: [] }),
  initial: 'encoding',
  states: {
    encoding: {
      // A run that wants nothing has nothing to wait for.
      always: ({ context }) => (allSettled(context) ? { target: 'settled' } : undefined),
      on: {
        proxyMade: ({ context, event }) => settledIfDone({ ...context, made: { ...context.made, [event.track]: event.proxy } }),
        proxyFailed: ({ context, event }) => settledIfDone({ ...context, failed: [...context.failed, event.track] }),
      },
    },
    settled: { type: 'final' },
  },
});

export type LibraryProxyRunSnapshot = SnapshotFrom<typeof libraryProxyRunMachine>;
type LibraryProxyRunEvent = Parameters<typeof transition<typeof libraryProxyRunMachine>>[2];

export const libraryProxyRunStarted = (wanted: readonly string[]): LibraryProxyRunSnapshot => initialTransition(libraryProxyRunMachine, { wanted })[0];

export const libraryProxyRunStep = (snapshot: LibraryProxyRunSnapshot, event: LibraryProxyRunEvent): LibraryProxyRunSnapshot =>
  transition(libraryProxyRunMachine, snapshot, event)[0];

/** The proxies made, by track, once every encode has settled; none while any runs. */
export const libraryProxiesMade = (snapshot: LibraryProxyRunSnapshot): Readonly<Record<string, LibraryTrackProxy>> | undefined =>
  (snapshot.matches('settled') ? snapshot.context.made : undefined);
