// library-add-marker.ts: what an add of a recorder take leaves in its item's media folder while it runs: the take, and
// the process adding it. An add stopped part way (a SIGTERM gives it seconds to undo a copy that may
// take minutes) can leave media no item.json names; the marker says whose it is. Pure.
import { Schema } from 'effect';

export const LIBRARY_ADD_MARKER_FILE = '.adding.json';

export const LibraryAddMarker = Schema.Struct({
  /** The take's folder in the recorder's recordings folder. */
  take: Schema.String,
  /** The adding process as studio-process.ts identifies it: removed with the marker once the add is done. */
  process: Schema.Struct({ pid: Schema.Finite, started: Schema.Finite }),
});
export type LibraryAddMarker = typeof LibraryAddMarker.Type;

export const LibraryAddMarkerText = Schema.fromJsonString(LibraryAddMarker);
