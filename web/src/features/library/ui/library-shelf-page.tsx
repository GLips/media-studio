import { Box, Code, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import { AudioLines, File, Film, Mic, Monitor, Video, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { formatLibraryLength, libraryItemHasRecorderTitle, librarySourcesOf, type LibrarySourceKind } from '#lib/footage/library/models/library-item.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { StudioPageTitle } from '#web/shared/ui/studio-page-title.tsx';
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
  sources: { color: colors.dim, width: 'fit-content' },
});

const SOURCE_ICONS: Record<LibrarySourceKind, LucideIcon> = { screen: Monitor, camera: Video, mic: Mic, video: Film, audio: AudioLines, other: File };

/** When the footage began, or was added: `Nov 22, 9:41 PM`, with the year only when it isn't this one. */
function formatLibraryDate(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year, hour: 'numeric', minute: '2-digit' });
}

/**
 * An item's two lines. A recording the recorder named is titled by when it began, and its opening words tell it from
 * its neighbours; a named item keeps its name, over its date and opening words.
 */
function LibraryShelfItemName({ shelved: { item, opening } }: { readonly shelved: LibraryShelfItem }) {
  const interrupted = item.source.kind === 'studio-recorder' && item.source.status === 'interrupted';
  const date = formatLibraryDate(item.recordedAt ?? item.addedAt);
  const dated = libraryItemHasRecorderTitle(item);
  return (
    <Box {...stylex.props(styles.name)}>
      <Box {...stylex.props(styles.titleLine)}>
        <Text component="span" size="md" title={item.title} {...stylex.props(styles.text)}>{dated ? date : item.title}</Text>
        {interrupted && <Text component="span" size="sm" {...stylex.props(styles.mark)}>interrupted</Text>}
      </Box>
      {(!dated || opening) && (
        <Text component="span" size="sm" {...stylex.props(styles.text, styles.second)}>
          {!dated && <Text component="span" inherit {...stylex.props(styles.dim)}>{date}{opening && ' · '}</Text>}
          <Text component="span" inherit {...stylex.props(styles.said)}>{opening}</Text>
        </Text>
      )}
    </Box>
  );
}

function LibraryShelfItemRow({ shelved, online }: { readonly shelved: LibraryShelfItem; readonly online: boolean }) {
  const { item, flags } = shelved;
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
      <StudioPageTitle count={count > 0 ? `${count} recording${count > 1 ? 's' : ''}` : undefined}>Library</StudioPageTitle>
      <FadeScroll>
        <Stack ref={listRef} gap={0} {...stylex.props(styles.page, stylex.defaultMarker())}>
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
          {!searching && count > 0 && <LibraryShelfColumnHead />}
          {!searching && shelf.items.map((shelved) => <LibraryShelfItemRow key={shelved.item.id} shelved={shelved} online={shelf.media.online} />)}
        </Stack>
      </FadeScroll>
    </StudioShell>
  );
}
