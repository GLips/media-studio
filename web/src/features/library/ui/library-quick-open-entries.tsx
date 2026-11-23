// library-quick-open-entries.tsx: the library's places in quick-open: the library itself, then each item by title.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { LibraryBig, Video } from 'lucide-react';
import type { QuickOpenEntry } from '#web/shared/ui/quick-open-entries.tsx';
import { libraryShelfQueryOptions } from '../controllers/library-queries.ts';

const GLYPH_SIZE = 12;

/** The library's places, newest item first; undefined until the shelf has loaded, while quick-open is open. */
export function useLibraryQuickOpenEntries(): QuickOpenEntry[] | undefined {
  const shelf = useQuery(libraryShelfQueryOptions).data;
  const router = useRouter();
  if (!shelf) return undefined;
  return [
    { key: 'library', glyph: <LibraryBig size={GLYPH_SIZE} />, label: 'library', href: router.buildLocation({ to: '/library' }).href },
    ...shelf.items.map(({ item }): QuickOpenEntry => ({
      key: `library/${item.id}`, glyph: <Video size={GLYPH_SIZE} />, label: item.title, context: 'library',
      href: router.buildLocation({ to: '/library/$item', params: { item: item.id } }).href,
    })),
  ];
}
