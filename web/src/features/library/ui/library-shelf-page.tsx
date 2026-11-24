import { Box, Code, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import { AudioLines, File, Film, Mic, Monitor, Video, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { libraryItemHasRecorderTitle, librarySourcesOf, type LibrarySourceKind } from '#lib/footage/library/models/library-item.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { TextInput } from '#web/shared/ui/text-input.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { libraryShelfQueryOptions } from '../controllers/library-queries.ts';
import type { LibraryShelfItem } from '../controllers/library-reads.ts';
import { LibraryPoster } from './library-poster.tsx';
import { LibrarySearchHitRow } from './library-search-hit-row.tsx';
import { libraryShelfColumns, LibraryShelfRow } from './library-shelf-row.tsx';
import { focusLibraryShelfRow, useLibraryShelfHotkeys } from './use-library-shelf-hotkeys.ts';
import { useLibraryShelfQuery } from './use-library-shelf-query.ts';

const styles = stylex.create({
  // Fills whatever width it's given: a row's columns spread with it, so its figures line up under their names.
  page: { paddingInline: spacing.row, paddingBlock: spacing.row },
  title: { display: 'flex', alignItems: 'baseline', gap: spacing.inset, paddingInline: spacing.gap, paddingBlockEnd: spacing.inset },
  heading: { fontWeight: 900, color: colors.cream, margin: 0 },
  count: { color: colors.dim },
  search: { paddingInline: spacing.gap, paddingBlockEnd: spacing.inset },
  head: {
    height: spacing.row, color: colors.dim,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line, marginBlockEnd: spacing.tight,
  },
  quiet: { padding: spacing.gap, color: colors.dim },
  name: { minWidth: 0, display: 'flex', alignItems: 'baseline', gap: spacing.gap },
  text: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  untitled: { color: colors.dim },
  fact: { color: colors.dim },
  mark: { color: colors.caution, whiteSpace: 'nowrap' },
  sources: { color: colors.dim, minWidth: 0, overflow: 'hidden' },
  source: { display: 'inline-flex', alignItems: 'center', gap: spacing.tight, whiteSpace: 'nowrap' },
});

const SOURCE_ICONS: Record<LibrarySourceKind, LucideIcon> = { screen: Monitor, camera: Video, mic: Mic, video: Film, audio: AudioLines, other: File };

/** When the footage began, or was added: `Nov 22, 9:41 PM`, with the year only when it isn't this one. */
function formatLibraryDate(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year, hour: 'numeric', minute: '2-digit' });
}

function LibraryShelfItemRow({ shelved: { item, flags }, online }: { readonly shelved: LibraryShelfItem; readonly online: boolean }) {
  const interrupted = item.source.kind === 'studio-recorder' && item.source.status === 'interrupted';
  // A recording the recorder named is named by its date, which the Recorded column already says.
  const untitled = libraryItemHasRecorderTitle(item);
  return (
    <LibraryShelfRow item={item.id} layout="columns">
      <LibraryPoster item={item} online={online} />
      <Box {...stylex.props(styles.name)}>
        <Text component="span" size="md" title={item.title} {...stylex.props(styles.text, untitled && styles.untitled)}>{untitled ? 'Untitled recording' : item.title}</Text>
        {interrupted && <Text component="span" size="sm" {...stylex.props(styles.mark)}>interrupted</Text>}
      </Box>
      <Group gap="inset" wrap="nowrap" {...stylex.props(styles.sources)}>
        {librarySourcesOf(item).map(({ track, kind, label }) => {
          const Icon = SOURCE_ICONS[kind];
          return (
            <Text key={track} component="span" size="sm" {...stylex.props(styles.source)}>
              <Icon size={12} aria-hidden />{label}
            </Text>
          );
        })}
      </Group>
      <Box {...stylex.props(libraryShelfColumns.end)}><Readout>{formatReviewClock(item.durationSeconds)}</Readout></Box>
      <Text component="span" size="sm" {...stylex.props(styles.text, styles.fact)}>{formatLibraryDate(item.recordedAt ?? item.addedAt)}</Text>
      <Box {...stylex.props(libraryShelfColumns.end)}>{flags > 0 && <Text component="span" size="sm">{flags} flag{flags > 1 ? 's' : ''}</Text>}</Box>
    </LibraryShelfRow>
  );
}

/** The names over the shelf's columns. */
function LibraryShelfColumnHead() {
  return (
    <Box aria-hidden {...stylex.props(libraryShelfColumns.grid, styles.head)}>
      <Box />
      <Text component="span" size="sm">Title</Text>
      <Text component="span" size="sm">Sources</Text>
      <Text component="span" size="sm" {...stylex.props(libraryShelfColumns.end)}>Length</Text>
      <Text component="span" size="sm">Recorded</Text>
      <Text component="span" size="sm" {...stylex.props(libraryShelfColumns.end)}>Flags</Text>
    </Box>
  );
}

/**
 * The footage library: every item, newest first, on columns under a poster each, or with a query, every place an
 * item says it or a flag's note does. Keyboard first: `/` searches, the arrows walk the rows, `Enter` opens one at
 * its moment.
 */
export function LibraryShelfPage() {
  const shelf = useSuspenseQuery(libraryShelfQueryOptions).data;
  const { query, change, hits, searching } = useLibraryShelfQuery();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useLibraryShelfHotkeys(listRef, searchRef);
  const titles = new Map(shelf.items.map(({ item }) => [item.id, item.title]));
  const count = shelf.items.length;
  return (
    <StudioShell>
      <FadeScroll>
        <Stack ref={listRef} gap={0} {...stylex.props(styles.page, stylex.defaultMarker())}>
          <Box {...stylex.props(styles.title)}>
            <Text component="h1" size="heading" {...stylex.props(styles.heading)}>Library</Text>
            {count > 0 && <Text component="span" size="sm" {...stylex.props(styles.count)}>{count} recording{count > 1 ? 's' : ''}</Text>}
          </Box>
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
          {!searching && count === 0 && (
            <Text size="sm" {...stylex.props(styles.quiet)}>The library is empty: <Code>studio library add &lt;file&gt;</Code></Text>
          )}
          {!searching && count > 0 && <LibraryShelfColumnHead />}
          {!searching && shelf.items.map((shelved) => <LibraryShelfItemRow key={shelved.item.id} shelved={shelved} online={shelf.media.online} />)}
        </Stack>
      </FadeScroll>
    </StudioShell>
  );
}
