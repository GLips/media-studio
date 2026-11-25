import { createContext, useContext, type ReactNode } from 'react';
import type { LibraryFlag, LibraryFlagFilter, LibraryFlagsFile } from '#lib/footage/library/models/library-flags.ts';
import type { LibraryTranscriptLine, LibraryWord } from '#lib/footage/library/models/library-footage.ts';
import type { LibraryFlagOpInput, LibraryItemView } from '../controllers/library-reads.ts';
import type { LibraryItemPlayback } from './library-item-playback.ts';
import type { LibraryFlagUndo } from './use-library-flag-undo.ts';

/** A range of the item marked to flag: by I and O, a drag on the timeline, or words selected in the transcript. */
export type LibraryMarkedRange = { start: number; end: number };

/** What the composer writes: a new flag's note over the marked range, or a flag's note changed. */
export type LibraryComposing = { kind: 'new'; range: LibraryMarkedRange } | { kind: 'note'; flag: number };

export type LibraryItemScreenValue = LibraryFlagUndo & {
  view: LibraryItemView;
  playback: LibraryItemPlayback;
  /** The item's tracks with sound, in the shelf's order and words; the transport offers them when there are two or more. */
  audible: readonly { track: string; label: string }[];
  /** Hears the item through `track` from now on, carrying on from where the playback is. */
  hear: (track: string) => void;
  /** Every word said on any spoken track, in reading order (libraryFootage's); none before the item's transcript is made. */
  words: readonly LibraryWord[];
  /** The words as lines to read, on item time. */
  lines: readonly LibraryTranscriptLine[];
  flags: LibraryFlagsFile;
  /** The flags N steps through: the filter's, in order. */
  queue: readonly LibraryFlag[];
  filter: LibraryFlagFilter;
  setFilter: (filter: LibraryFlagFilter) => void;
  /** The flag on show (the URL's `flag`), looped. */
  focused: LibraryFlag | undefined;
  /** Shows a flag: seeks to it and loops it; undefined leaves it. */
  focusFlag: (flag: LibraryFlag | undefined) => void;
  marked: LibraryMarkedRange | null;
  setMarked: (range: LibraryMarkedRange | null) => void;
  composing: LibraryComposing | null;
  setComposing: (composing: LibraryComposing | null) => void;
  /** Sends a change to the flags as the reviewer; `onSaved` hears the server take it. A refusal shows by the composer. */
  changeFlags: (op: LibraryFlagOpInput, onSaved?: () => void) => void;
  /** Why the last change was refused, if it was. */
  refusal: string | undefined;
  /** A change is on its way to the server. */
  saving: boolean;
};

const LibraryItemScreenContext = createContext<LibraryItemScreenValue | null>(null);

export function LibraryItemScreenProvider({ value, children }: { readonly value: LibraryItemScreenValue; readonly children: ReactNode }) {
  return <LibraryItemScreenContext value={value}>{children}</LibraryItemScreenContext>;
}

export function useLibraryItemScreen(): LibraryItemScreenValue {
  const screen = useContext(LibraryItemScreenContext);
  if (!screen) throw new Error("useLibraryItemScreen is for the library item screen's parts, inside its LibraryItemScreenProvider");
  return screen;
}
