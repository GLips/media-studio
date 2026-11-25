/** What a group of same-shaped stills is called: its orientation in a word. */
export type ReviewStillOrientation = 'wide' | 'square' | 'tall';

/** Stills of one aspect, widest group first; `size` names their pixels when every one shares them. */
export type ReviewStillAspectSection<T> = {
  readonly word: ReviewStillOrientation;
  /** Width over height, to two places: what the section shares. */
  readonly aspect: number;
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
    return { word: orientationOfAspect(aspect), aspect, size: same ? { w: sizes[0].w, h: sizes[0].h } : null, items: members };
  });
  return { groups, unread };
}

/**
 * The names a still's caption is shortened among: its section's, whose heading says what they share (`buy-box-og-`),
 * or the whole folder's for a still alone in its section. The grid's caption and the rail's name both read it.
 */
export function reviewStillCaptionSiblingsOf(section: readonly { readonly name: string }[], folder: readonly { readonly name: string }[]): string[] {
  return (section.length > 1 ? section : folder).map((s) => s.name);
}

/** The ratios stills are cut to, by the name each goes by: an OG card is 1.91:1, not 40:21. */
const REVIEW_STILL_NAMED_RATIOS: readonly (readonly [number, string])[] = [
  [21 / 9, '21:9'], [2, '2:1'], [1.91, '1.91:1'], [16 / 9, '16:9'], [3 / 2, '3:2'], [4 / 3, '4:3'], [5 / 4, '5:4'], [1, '1:1'],
  [4 / 5, '4:5'], [3 / 4, '3:4'], [2 / 3, '2:3'], [9 / 16, '9:16'],
];

/** How close an aspect, already rounded to two places, must come to a named ratio to go by its name. */
const REVIEW_STILL_RATIO_SLACK = 0.015;

/** `16:9`, `1.91:1`, `4:5` for a ratio stills are cut to; any other as its width to one, `1.43:1`. */
export function reviewStillRatioName(aspect: number): string {
  const named = REVIEW_STILL_NAMED_RATIOS.find(([ratio]) => Math.abs(ratio - aspect) <= REVIEW_STILL_RATIO_SLACK);
  return named ? named[1] : `${Number(aspect.toFixed(2))}:1`;
}
