import { studioSharedNameStartOf } from './studio-sibling-names.ts';

/** How a grid of pictures is split: by shape (a grid per aspect), by the names' shared starts, or not at all. */
export type StudioCollectionGroup = 'shape' | 'name' | 'none';
export const STUDIO_COLLECTION_GROUPS: readonly StudioCollectionGroup[] = ['shape', 'name', 'none'];

/** The order a grid's pictures, and its groups, go in. */
export type StudioCollectionSort = 'name' | 'newest';
export const STUDIO_COLLECTION_SORTS: readonly StudioCollectionSort[] = ['name', 'newest'];

/** What sorting reads off an item: its name, and when it was last written (ms since the epoch), when known. */
export type StudioSortKey = { readonly name: string; readonly modified?: number };

const byName = (a: StudioSortKey, b: StudioSortKey) => a.name.localeCompare(b.name, undefined, { numeric: true });

/** Items in `sort`'s order: names numerically (`og-2` before `og-10`), or newest first with names breaking ties. */
export function studioSortedBy<T>(items: readonly T[], sort: StudioCollectionSort, keyOf: (item: T) => StudioSortKey): T[] {
  if (sort === 'name') return items.toSorted((a, b) => byName(keyOf(a), keyOf(b)));
  return items.toSorted((a, b) => (keyOf(b).modified ?? 0) - (keyOf(a).modified ?? 0) || byName(keyOf(a), keyOf(b)));
}

/** A run of items whose names start alike, headed by that start (`03-menu-appstore-iphone-`); '' when it has none. */
export type StudioNameGroup<T> = { readonly head: string; readonly items: readonly T[] };

/** A name's first word after `start`, with the break that ends it: `og-` of `og-one-box.png`, `video` of `video.mp4`. */
const firstWordAfter = (name: string, start: string) => /^[^-_ /.]*[-_ /]?/.exec(name.slice(start.length))?.[0] ?? '';

/**
 * Items grouped on how their names start, read from the names alone: past the start they all share, each first word
 * starts a group (`02-barcode-…`; `og-`), headed by what its names share. Groups keep their first items' order, so
 * sorting first orders groups and members both. Names with nothing more in common make one group.
 */
export function studioNameGroupsOf<T>(items: readonly T[], nameOf: (item: T) => string): StudioNameGroup<T>[] {
  const names = items.map(nameOf);
  const start = studioSharedNameStartOf(names);
  const byWord = new Map<string, T[]>();
  items.forEach((item, i) => {
    const word = firstWordAfter(names[i], start);
    byWord.set(word, [...(byWord.get(word) ?? []), item]);
  });
  const runs = [...byWord.entries()];
  if (runs.length === 1 || runs.every(([, run]) => run.length === 1)) return [{ head: start, items }];
  return runs.map(([word, run]) => ({ head: run.length > 1 ? studioSharedNameStartOf(run.map(nameOf)) : start + word, items: run }));
}

/** One justified row: the items it holds, by index, and the height they all share. */
export type StudioJustifiedRow = { readonly indices: readonly number[]; readonly height: number };

/**
 * Pictures of `aspects` (width over height) broken into rows that each fill `width` exactly, every picture in a row at
 * one height near `target` and its own shape: no crop, no letterbox. A row takes the next picture when that brings its
 * height nearer the target. The last row, short of the width, stays at the target rather than stretching.
 */
export function studioJustifiedRowsOf(aspects: readonly number[], width: number, target: number, gap: number): StudioJustifiedRow[] {
  const rows: StudioJustifiedRow[] = [];
  const fitHeight = (indices: readonly number[]) => (width - gap * (indices.length - 1)) / indices.reduce((sum, i) => sum + aspects[i], 0);
  let row: number[] = [];
  for (let i = 0; i < aspects.length; i += 1) {
    const withIt = [...row, i];
    const naturalWidth = withIt.reduce((sum, j) => sum + aspects[j] * target, 0) + gap * row.length;
    if (naturalWidth < width) {
      row = withIt;
      continue;
    }
    const heightWith = fitHeight(withIt);
    if (row.length === 0 || Math.abs(heightWith - target) <= Math.abs(fitHeight(row) - target)) {
      rows.push({ indices: withIt, height: heightWith });
      row = [];
    } else {
      rows.push({ indices: row, height: fitHeight(row) });
      row = [i];
      // Alone, it may already be wider than the row: then it fills the row by itself.
      if (aspects[i] * target >= width) {
        rows.push({ indices: row, height: fitHeight(row) });
        row = [];
      }
    }
  }
  if (row.length > 0) rows.push({ indices: row, height: Math.min(target, fitHeight(row)) });
  return rows;
}
