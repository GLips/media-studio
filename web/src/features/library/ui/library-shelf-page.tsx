import { Code, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { TextInput } from '#web/shared/ui/text-input.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { libraryShelfQueryOptions } from '../controllers/library-queries.ts';
import type { LibraryShelfItem } from '../controllers/library-reads.ts';
import { LibrarySearchHitRow } from './library-search-hit-row.tsx';
import { LibraryShelfRow } from './library-shelf-row.tsx';
import { focusLibraryShelfRow, useLibraryShelfHotkeys } from './use-library-shelf-hotkeys.ts';
import { useLibraryShelfQuery } from './use-library-shelf-query.ts';

const styles = stylex.create({
  // Capped as the dashboard's list is, so a row's readouts sit near its title on a wide screen.
  list: { padding: spacing.gap, maxWidth: '960px' },
  search: { paddingInline: spacing.gap, paddingBlockEnd: spacing.gap },
  quiet: { padding: spacing.gap, color: colors.dim },
  mark: { color: colors.caution },
});

/** When the footage began, or was added: `22 Nov 2026, 21:41`. */
const formatLibraryDate = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function LibraryShelfItemRow({ shelved: { item, flags } }: { readonly shelved: LibraryShelfItem }) {
  const interrupted = item.source.kind === 'studio-recorder' && item.source.status === 'interrupted';
  return (
    <LibraryShelfRow
      item={item.id}
      title={item.title}
      end={(
        <>
          {interrupted && <Text component="span" size="sm" {...stylex.props(styles.mark)}>interrupted</Text>}
          {flags > 0 && <Readout bright>{flags} flag{flags > 1 ? 's' : ''}</Readout>}
          <Readout>{Object.keys(item.tracks).join('+')}</Readout>
          <Readout>{formatReviewClock(item.durationSeconds)}</Readout>
          <Readout>{formatLibraryDate(item.recordedAt ?? item.addedAt)}</Readout>
        </>
      )}
    />
  );
}

/**
 * The footage library: every item, newest first, or with a query, every place an item says it or a flag's note does.
 * Keyboard first: `/` searches, the arrows walk the rows, `Enter` opens one at its moment.
 */
export function LibraryShelfPage() {
  const shelf = useSuspenseQuery(libraryShelfQueryOptions).data;
  const { query, change, hits, searching } = useLibraryShelfQuery();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useLibraryShelfHotkeys(listRef, searchRef);
  const titles = new Map(shelf.items.map(({ item }) => [item.id, item.title]));
  return (
    <StudioShell start={<Text size="sm">library</Text>}>
      <FadeScroll>
        <Stack ref={listRef} gap={0} {...stylex.props(styles.list, stylex.defaultMarker())}>
          <TextInput
            ref={searchRef}
            aria-label="Search the library"
            placeholder="Search what's said, or a flag's note  /"
            value={query}
            onChange={(event) => change(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusLibraryShelfRow(listRef.current, 1);
              } else if (event.key === 'Escape') event.currentTarget.blur();
            }}
            {...stylex.props(styles.search)}
          />
          {!shelf.media.online && (
            <Text size="sm" {...stylex.props(styles.quiet)}>
              Media offline: <Code>{shelf.media.path}</Code> isn't there, so nothing plays. Transcripts, search and flags still work.
            </Text>
          )}
          {searching && hits.error && <Text size="sm" {...stylex.props(styles.quiet)}>{hits.error.message}</Text>}
          {searching && hits.data?.length === 0 && <Text size="sm" {...stylex.props(styles.quiet)}>Nothing in the library says “{query.trim()}”.</Text>}
          {searching && hits.data?.map((hit) => (
            <LibrarySearchHitRow key={hit.on === 'flag' ? `${hit.item}#${hit.flag}` : `${hit.item}@${hit.start}`} hit={hit} title={titles.get(hit.item) ?? hit.item} query={query} />
          ))}
          {!searching && shelf.items.length === 0 && (
            <Text size="sm" {...stylex.props(styles.quiet)}>The library is empty: <Code>studio library add &lt;file&gt;</Code></Text>
          )}
          {!searching && shelf.items.map((shelved) => <LibraryShelfItemRow key={shelved.item.id} shelved={shelved} />)}
        </Stack>
      </FadeScroll>
    </StudioShell>
  );
}
