// use-library-flag-undo.ts: removing a flag, and taking the removal back. The flag removed is kept whole, so Undo puts
// it back as it was, under its own id (`flag.restore`). Its row offers Undo in place for a few seconds; `Mod+Z` reaches
// the last removal until the next one.
import { useEffect, useState } from 'react';
import type { LibraryFlag } from '#lib/footage/library/models/library-flags.ts';
import type { LibraryFlagOpInput } from '../controllers/library-reads.ts';

/** How long a removed flag's row offers Undo in place, as the render review's deleted notes do. */
const LIBRARY_UNDO_SHOWN_MS = 6000;

export type LibraryFlagUndo = {
  removeFlag: (flag: LibraryFlag) => void;
  /** Puts back the last flag removed; undefined when there's none to put back. */
  undoRemove: (() => void) | undefined;
  /** The flag whose Undo row shows in its old place, for a few seconds after it goes. */
  removedShown: LibraryFlag | undefined;
};

export function useLibraryFlagUndo(changeFlags: (op: LibraryFlagOpInput) => void): LibraryFlagUndo {
  const [last, setLast] = useState<LibraryFlag | undefined>(undefined);
  const [shown, setShown] = useState<LibraryFlag | undefined>(undefined);
  // Each removal is a new flag object here, so the next one starts its own few seconds.
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setTimeout(() => setShown(undefined), LIBRARY_UNDO_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return {
    removeFlag: (flag) => {
      changeFlags({ op: 'flag.remove', id: flag.id });
      setLast(flag);
      setShown(flag);
    },
    undoRemove: last && (() => {
      changeFlags({ op: 'flag.restore', flag: last });
      setLast(undefined);
      setShown(undefined);
    }),
    removedShown: shown,
  };
}
