import { Box, Code, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import { AudioLines, File, Film, Mic, Monitor, Video, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { formatLibraryLength, librarySourcesOf, type LibrarySourceKind } from '#lib/footage/library/models/library-item.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { StudioCollectionViewToggle } from '#web/shared/ui/studio-collection-view-toggle.tsx';
import { StudioPageTitle } from '#web/shared/ui/studio-page-title.tsx';
import { useStudioCollectionView } from '#web/shared/ui/use-studio-collection-view.ts';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { TextInput } from '#web/shared/ui/text-input.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { libraryShelfQueryOptions } from '../controllers/library-queries.ts';
import type { LibraryShelfItem } from '../controllers/library-reads.ts';
import { LibraryPoster } from './library-poster.tsx';
import { LibrarySearchHitRow } from './library-search-hit-row.tsx';
import { libraryShelfLabelsOf } from './library-shelf-labels.ts';
import { LibraryShelfTile } from './library-shelf-tile.tsx';
import { libraryShelfColumns, LibraryShelfRow } from './library-shelf-row.tsx';
import { focusLibraryShelfRow, useLibraryShelfHotkeys } from './use-library-shelf-hotkeys.ts';
import { useLibraryShelfQuery } from './use-library-shelf-query.ts';

const styles = stylex.create({
  // As wide as it's given, to the table's cap (libraryShelfColumns.table): a row's columns spread with it, so its
  // figures line up under their names.
  // Each row pads itself by a gap, so the page pads the rest: the search field, the column names and the posters all
  // start at the page title's inset (StudioPageTitle).
  page: { paddingInline: `calc(${spacing.row} - ${spacing.gap})`, paddingBlockStart: spacing.gap, paddingBlockEnd: spacing.row },
  search: { paddingInline: spacing.gap, paddingBlockEnd: spacing.inset },
  // An outline on the ground, as the page is, rather than a filled box.
  searchField: {
    backgroundColor: 'transparent', color: colors.cream,
    borderColor: { default: colors.line, ':hover': colors.mark, ':focus': colors.cream },
  },
  head: {
    height: spacing.row, color: colors.dim,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line, marginBlockEnd: spacing.tight,
  },
  quiet: { padding: spacing.gap, color: colors.dim },
  name: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.hairline },
  titleLine: { minWidth: 0, display: 'flex', alignItems: 'baseline', gap: spacing.gap },
  text: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  // The second line keeps to a measure a line of speech reads at.
  second: { maxWidth: '72ch' },
  // What the take opens by saying reads above the dates and column names.
  said: { color: `color-mix(in srgb, ${colors.cream} 70%, transparent)` },
  dim: { color: colors.dim },
  mark: { color: colors.caution, whiteSpace: 'nowrap' },
  // A count beside the title, not a column: most items have no flags, and a column of blanks says nothing.
  badge: {
    flexShrink: 0, paddingInline: spacing.tight, borderRadius: radius.control, color: colors.cream, backgroundColor: colors.raised,
    whiteSpace: 'nowrap',
  },
  sources: { color: colors.dim, width: 'fit-content' },
  // As the project page's tile grid, posters as large as four abreast allow; inset so their edges meet the title's.
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', alignItems: 'start', gap: spacing.gap, marginInline: spacing.tight },
});

const SOURCE_ICONS: Record<LibrarySourceKind, LucideIcon> = { screen: Monitor, camera: Video, mic: Mic, video: Film, audio: AudioLines, other: File };

/** An item's two lines in the list: its title and marks, then its date where that isn't the title, and its opening words. */
function LibraryShelfItemName({ shelved }: { readonly shelved: LibraryShelfItem }) {
  const { title, dateLead, opening, interrupted, flagCount } = libraryShelfLabelsOf(shelved);
  return (
    <Box {...stylex.props(styles.name)}>
      <Box {...stylex.props(styles.titleLine)}>
        <Text component="span" size="md" title={shelved.item.title} {...stylex.props(styles.text)}>{title}</Text>
        {interrupted && <Text component="span" size="sm" {...stylex.props(styles.mark)}>interrupted</Text>}
        {flagCount && <Text component="span" size="xs" {...stylex.props(styles.badge)}>{flagCount}</Text>}
      </Box>
      {(dateLead || opening) && (
        <Text component="span" size="sm" {...stylex.props(styles.text, styles.second)}>
          {dateLead && <Text component="span" inherit {...stylex.props(styles.dim)}>{dateLead}{opening && ' · '}</Text>}
          <Text component="span" inherit {...stylex.props(styles.said)}>{opening}</Text>
        </Text>
      )}
    </Box>
  );
}

function LibraryShelfItemRow({ shelved, online }: { readonly shelved: LibraryShelfItem; readonly online: boolean }) {
  const { item } = shelved;
  const sources = librarySourcesOf(item);
  const named = sources.map(({ label }) => label).join(', ');
  return (
    <LibraryShelfRow item={item.id} layout="columns">
      <LibraryPoster item={item} online={online} />
      <LibraryShelfItemName shelved={shelved} />
      <HotkeyTooltip name={named}>
        <Group gap="gap" wrap="nowrap" aria-label={named} {...stylex.props(styles.sources)}>
          {sources.map(({ track, kind }) => {
            const Icon = SOURCE_ICONS[kind];
            return <Icon key={track} size={14} aria-hidden />;
          })}
        </Group>
      </HotkeyTooltip>
      <Box {...stylex.props(libraryShelfColumns.end)}><Readout>{formatLibraryLength(item.durationSeconds)}</Readout></Box>
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
    </Box>
  );
}

/**
 * The footage library: every item, newest first, as large posters or as a table of rows, or with a query, every place
 * an item says it or a flag's note does. Keyboard first: `/` searches, the arrows walk the rows, `Enter` opens one at
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
  const { view: shelfView } = useStudioCollectionView();
  const listed = shelfView === 'list';
  return (
    <StudioShell>
      <StudioPageTitle count={count > 0 ? `${count} recording${count > 1 ? 's' : ''}` : undefined} end={<StudioCollectionViewToggle />}>Library</StudioPageTitle>
      <FadeScroll>
        <Stack ref={listRef} gap={0} {...stylex.props(styles.page, listed && libraryShelfColumns.table, stylex.defaultMarker())}>
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
            classNames={{ input: stylex.props(styles.searchField).className }}
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
          {!searching && count > 0 && listed && <LibraryShelfColumnHead />}
          {!searching && listed && shelf.items.map((shelved) => <LibraryShelfItemRow key={shelved.item.id} shelved={shelved} online={shelf.media.online} />)}
          {!searching && count > 0 && !listed && (
            <Box {...stylex.props(styles.grid)}>
              {shelf.items.map((shelved) => <LibraryShelfTile key={shelved.item.id} shelved={shelved} online={shelf.media.online} />)}
            </Box>
          )}
        </Stack>
      </FadeScroll>
    </StudioShell>
  );
}
