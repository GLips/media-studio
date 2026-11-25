import { useStudioStoredChoice } from './use-studio-stored-choice.ts';

/** How a page of things shows them: tiles of their pictures, or rows. One choice for the whole studio. */
export type StudioCollectionView = 'grid' | 'list';

const STUDIO_COLLECTION_VIEWS: readonly StudioCollectionView[] = ['grid', 'list'];

/**
 * The studio's one list-or-grid choice, remembered and kept in step across tabs (useStudioStoredChoice). Grid until the
 * reviewer picks list. Every page that can show either reads it, so a choice made on one holds on all.
 */
export function useStudioCollectionView(): { view: StudioCollectionView; setView: (view: StudioCollectionView) => void } {
  const [view, setView] = useStudioStoredChoice('studio.collection-view', STUDIO_COLLECTION_VIEWS, 'grid');
  return { view, setView };
}
