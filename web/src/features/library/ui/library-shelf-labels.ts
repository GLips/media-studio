// library-shelf-labels.ts: what the shelf calls an item, in both its list row and its grid tile.
import { libraryItemHasRecorderTitle } from '#lib/footage/library/models/library-item.ts';
import type { LibraryShelfItem } from '../controllers/library-reads.ts';

/** When the footage began, or was added: `Nov 22, 9:41 PM`, with the year only when it isn't this one. */
export function formatLibraryDate(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year, hour: 'numeric', minute: '2-digit' });
}

/**
 * An item's labels on the shelf. A recording the recorder named is titled by when it began, its opening words telling
 * it from its neighbours; a named item keeps its name, and its date goes before its opening words (`dateLead`).
 */
export function libraryShelfLabelsOf({ item, opening, flags }: LibraryShelfItem) {
  const date = formatLibraryDate(item.recordedAt ?? item.addedAt);
  const dated = libraryItemHasRecorderTitle(item);
  return {
    title: dated ? date : item.title,
    dateLead: dated ? undefined : date,
    opening,
    interrupted: item.source.kind === 'studio-recorder' && item.source.status === 'interrupted',
    flagCount: flags > 0 ? `${flags} flag${flags > 1 ? 's' : ''}` : undefined,
  };
}
