import type { ReviewTileStep } from './use-review-board-hotkeys.ts';

/** What a group of same-shaped stills is called: its orientation in a word. */
export type ReviewStillOrientation = 'wide' | 'square' | 'tall';

/** Stills of one aspect, widest group first; `size` names their pixels when every one shares them. */
export type ReviewStillAspectSection<T> = {
  readonly word: ReviewStillOrientation;
  readonly size: { readonly w: number; readonly h: number } | null;
  readonly items: readonly T[];
};

/** How far from 1:1 a still may be and still read as square: a 1080 × 1080 export a pixel off is square. */
const REVIEW_STILL_SQUARE_SLACK = 0.02;

function orientationOfAspect(aspect: number): ReviewStillOrientation {
  if (Math.abs(aspect - 1) <= REVIEW_STILL_SQUARE_SLACK) return 'square';
  return aspect > 1 ? 'wide' : 'tall';
}

/**
 * A folder's stills in groups of one aspect each (to two places, so 1200 × 630 and 2400 × 1260 share one), widest
 * first, each keeping the order it was given. A still whose pixels haven't been read yet goes in a last group with no
 * word, so the grid lays it out now and moves it once it decodes.
 */
export function reviewStillAspectSectionsOf<T>(
  items: readonly T[], sizeOf: (item: T) => { readonly w: number; readonly h: number } | undefined,
): { groups: ReviewStillAspectSection<T>[]; unread: T[] } {
  const byAspect = new Map<number, T[]>();
  const unread: T[] = [];
  for (const item of items) {
    const size = sizeOf(item);
    if (!size) {
      unread.push(item);
      continue;
    }
    const aspect = Math.round((size.w / size.h) * 100) / 100;
    byAspect.set(aspect, [...(byAspect.get(aspect) ?? []), item]);
  }
  const groups = [...byAspect].toSorted(([a], [b]) => b - a).map(([aspect, members]) => {
    const sizes = members.map((m) => sizeOf(m)!);
    const same = sizes.every((s) => s.w === sizes[0].w && s.h === sizes[0].h);
    return { word: orientationOfAspect(aspect), size: same ? { w: sizes[0].w, h: sizes[0].h } : null, items: members };
  });
  return { groups, unread };
}

/**
 * The cursor's next place in a grid laid out in sections of `columns` each (a group's rows begin afresh): along steps
 * through the reading order, a row up or down keeps the column where the row reaches it. Held inside the grid.
 */
export function reviewSectionedGridStep(at: number, { along, rows }: ReviewTileStep, sections: readonly number[], columns: number): number {
  const count = sections.reduce((sum, n) => sum + n, 0);
  if (count === 0) return 0;
  if (rows === 0) return Math.min(Math.max(at + along, 0), count - 1);
  // Every laid-out row, as the index its first tile has and how many it holds.
  const laid: { first: number; length: number }[] = [];
  let first = 0;
  for (const size of sections) {
    for (let r = 0; r < size; r += columns) laid.push({ first: first + r, length: Math.min(columns, size - r) });
    first += size;
  }
  const row = laid.findIndex((r) => at < r.first + r.length);
  const target = laid[Math.min(Math.max(row + rows, 0), laid.length - 1)];
  return target.first + Math.min(at - laid[row].first, target.length - 1);
}
