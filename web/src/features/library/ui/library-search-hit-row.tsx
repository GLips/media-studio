import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { librarySearchToken, type LibrarySearchHit } from '#lib/footage/library/models/library-search.ts';
import { formatReviewClockRange } from '#lib/output/review/models/review-timeline-geometry.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { LibraryShelfRow } from './library-shelf-row.tsx';

const styles = stylex.create({
  item: { color: colors.dim, marginInlineEnd: spacing.inset },
  said: { color: colors.dim },
  match: { color: colors.cream, fontWeight: 600 },
});

/** `text` in runs, each word of a run of `query`'s words in order marked `match`, as search found it. */
export function libraryHitTextRuns(text: string, query: string): { text: string; match: boolean }[] {
  const wanted = query.split(/\s+/).map(librarySearchToken).filter(Boolean);
  const words = text.split(/(\s+)/);
  const tokens = words.map((w, i) => (i % 2 === 0 ? librarySearchToken(w) : null));
  const said = words.flatMap((_, i) => (i % 2 === 0 && tokens[i] ? [i] : []));
  const matched = new Set<number>();
  for (let k = 0; wanted.length && k + wanted.length <= said.length; k++) {
    if (wanted.every((token, j) => tokens[said[k + j]] === token)) {
      for (let j = 0; j < wanted.length; j++) matched.add(said[k + j]);
    }
  }
  return words.map((w, i) => ({ text: w, match: matched.has(i) }));
}

type LibrarySearchHitRowProps = { readonly hit: LibrarySearchHit; readonly title: string; readonly query: string };

/** A search hit: the item, the line or flag note with the words found lit, and where it is. */
export function LibrarySearchHitRow({ hit, title, query }: LibrarySearchHitRowProps) {
  return (
    <LibraryShelfRow
      item={hit.item}
      at={{ t: hit.start, ...(hit.on === 'flag' && { flag: hit.flag }) }}
      title={(
        <>
          <Text component="span" inherit {...stylex.props(styles.item)}>{title}</Text>
          {libraryHitTextRuns(hit.text, query).map((run, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- the runs of one hit's text, never reordered.
            <Text key={i} component="span" inherit {...stylex.props(run.match ? styles.match : styles.said)}>{run.text}</Text>
          ))}
        </>
      )}
      end={(
        <>
          {hit.on === 'flag' && <Readout>flag #{hit.flag}</Readout>}
          <Readout>{formatReviewClockRange(hit.start, hit.end)}</Readout>
        </>
      )}
    />
  );
}
