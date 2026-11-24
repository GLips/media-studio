import { useCallback, useSyncExternalStore } from 'react';

/** How a page of things shows them: tiles of their pictures, or rows. One choice for the whole studio. */
export type StudioCollectionView = 'grid' | 'list';

const STUDIO_COLLECTION_VIEW_KEY = 'studio.collection-view';

/** The `storage` event only reaches other tabs, so this tab's own writes are announced to its subscribers here. */
const sameTabListeners = new Set<() => void>();

function subscribeToStudioCollectionView(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STUDIO_COLLECTION_VIEW_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  sameTabListeners.add(onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    sameTabListeners.delete(onChange);
  };
}

// Anything but a saved `list` is the grid: the default, and what an unreadable value falls back to.
const readStudioCollectionView = (): StudioCollectionView => (localStorage.getItem(STUDIO_COLLECTION_VIEW_KEY) === 'list' ? 'list' : 'grid');

/** The grid on the server's render, before the saved choice can be read. */
const serverStudioCollectionView = (): StudioCollectionView => 'grid';

/**
 * The studio's one list-or-grid choice, remembered in localStorage and kept in step across tabs. Grid until the reviewer
 * picks list. Every page that can show either reads it, so a choice made on one holds on all.
 */
export function useStudioCollectionView(): { view: StudioCollectionView; setView: (view: StudioCollectionView) => void } {
  const view = useSyncExternalStore(subscribeToStudioCollectionView, readStudioCollectionView, serverStudioCollectionView);
  const setView = useCallback((next: StudioCollectionView) => {
    localStorage.setItem(STUDIO_COLLECTION_VIEW_KEY, next);
    for (const listener of sameTabListeners) listener();
  }, []);
  return { view, setView };
}
