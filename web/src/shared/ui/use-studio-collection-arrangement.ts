import {
  STUDIO_COLLECTION_GROUPS, STUDIO_COLLECTION_SORTS, type StudioCollectionGroup, type StudioCollectionSort,
} from '../studio-collection-arrangement.ts';
import { useStudioStoredChoice } from './use-studio-stored-choice.ts';

export type StudioCollectionArrangement = {
  readonly group: StudioCollectionGroup;
  readonly sort: StudioCollectionSort;
  readonly setGroup: (group: StudioCollectionGroup) => void;
  readonly setSort: (sort: StudioCollectionSort) => void;
};

/**
 * How the studio's picture grids group and order their pictures: one choice for every grid (a project page's tiles, a
 * folder of stills), remembered and kept in step across tabs. By shape and by name until changed.
 */
export function useStudioCollectionArrangement(): StudioCollectionArrangement {
  const [group, setGroup] = useStudioStoredChoice('studio.collection-group', STUDIO_COLLECTION_GROUPS, 'shape');
  const [sort, setSort] = useStudioStoredChoice('studio.collection-sort', STUDIO_COLLECTION_SORTS, 'name');
  return { group, sort, setGroup, setSort };
}
