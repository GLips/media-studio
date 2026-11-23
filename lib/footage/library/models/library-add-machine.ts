// library-add-machine.ts: one add's progress, and what a failure at each step undoes. Pure; the add
// (add-library-item.ts) feeds it each step as it's done and asks it what to undo when one fails.
//
//   probing     ffprobe reads every track; nothing is touched yet
//   bringing    files go into the item's media folder, copied or moved, each one recorded
//   writing     item.json is being written
//   finishing   item.json is there: transcript, levelled speech, proxies (`studio library finish` makes what's missing)
//   added       done
//   refused     failed before item.json was written: every move is reversed and the media folder removed
//   unfinished  failed after: the item stays, and `studio library finish` picks up where it stopped
import type { SnapshotFrom } from 'xstate';
import { initialTransition, setup, transition, types } from 'xstate';

/** A file the add put into the media folder, and whether it moved (so undoing it moves it back) or was copied. */
export type LibraryBroughtFile = { readonly from: string; readonly to: string; readonly moved: boolean };

/** What a refused add undoes: the moves to reverse, newest first, and the media folder to remove. */
export type LibraryAddUndo = { readonly moves: readonly LibraryBroughtFile[]; readonly media: string | null };

type LibraryAddContext = { readonly media: string | null; readonly brought: readonly LibraryBroughtFile[] };

const addSetup = setup({
  schemas: {
    context: types<LibraryAddContext>(),
    events: {
      probed: types<{ readonly media: string }>(),
      fileBrought: types<{ readonly file: LibraryBroughtFile }>(),
      broughtAll: types<object>(),
      metadataWritten: types<object>(),
      finished: types<object>(),
      failed: types<object>(),
    },
  },
  states: {
    probing: {},
    bringing: {},
    writing: {},
    finishing: {},
    added: {},
    refused: { id: 'addRefused', schemas: { input: types<LibraryAddUndo>() } },
    unfinished: { id: 'addUnfinished' },
  },
});

/** Before item.json exists, the add leaves the sources as they were. */
const refuse = ({ context }: { context: LibraryAddContext }) => ({
  target: '#addRefused' as const,
  input: { moves: context.brought.filter((file) => file.moved).toReversed(), media: context.media },
});

export const libraryAddMachine = addSetup.createMachine({
  id: 'libraryAdd',
  context: { media: null, brought: [] },
  initial: 'probing',
  states: {
    probing: {
      on: {
        probed: ({ context, event }) => ({ target: 'bringing', context: { ...context, media: event.media } }),
        failed: refuse,
      },
    },
    bringing: {
      on: {
        fileBrought: ({ context, event }) => ({ context: { ...context, brought: [...context.brought, event.file] } }),
        broughtAll: () => ({ target: 'writing' }),
        failed: refuse,
      },
    },
    writing: { on: { metadataWritten: () => ({ target: 'finishing' }), failed: refuse } },
    finishing: { on: { finished: () => ({ target: 'added' }), failed: () => ({ target: '#addUnfinished' }) } },
    added: { type: 'final' },
    refused: { type: 'final' },
    unfinished: { type: 'final' },
  },
});

export type LibraryAddSnapshot = SnapshotFrom<typeof libraryAddMachine>;
type LibraryAddEvent = Parameters<typeof transition<typeof libraryAddMachine>>[2];

export const libraryAddStarted = (): LibraryAddSnapshot => initialTransition(libraryAddMachine)[0];

export const libraryAddStep = (snapshot: LibraryAddSnapshot, event: LibraryAddEvent): LibraryAddSnapshot =>
  transition(libraryAddMachine, snapshot, event)[0];

/** What a failed add must undo, once `failed` has moved it to refused; none once it's unfinished. */
export const libraryAddUndo = (snapshot: LibraryAddSnapshot): LibraryAddUndo | undefined =>
  (snapshot.matches('refused') ? snapshot.getInputs().addRefused : undefined);
