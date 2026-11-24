import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { libraryFootage } from '#lib/footage/library/models/library-footage.ts';
import { libraryFlagsInOrder, type LibraryFlag, type LibraryFlagFilter } from '#lib/footage/library/models/library-flags.ts';
import { transcriptLines } from '#lib/footage/transcript/models/footage-transcript.ts';
import { RouteNotFoundPage } from '#web/shared/ui/route-not-found-page.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { libraryItemViewQueryOptions, useLibraryFlagOps, useLibraryFlags } from '../controllers/library-queries.ts';
import type { LibraryItemView } from '../controllers/library-reads.ts';
import { useLibraryItemSearch } from '../controllers/library-search.ts';
import { LibraryFlagPanel } from './library-flag-panel.tsx';
import { LibraryItemFacts, LibraryItemHeader } from './library-item-header.tsx';
import { LibraryItemScreenProvider, type LibraryComposing, type LibraryItemScreenValue, type LibraryMarkedRange } from './library-item-context.tsx';
import { createLibraryItemPlayback, LIBRARY_CLOCK_FPS } from './library-item-playback.ts';
import { LibraryRecordingMedia } from './library-recording-media.tsx';
import { LibraryTimeline } from './library-timeline.tsx';
import { LibraryTranscript } from './library-transcript.tsx';
import { useLibraryItemHotkeys } from './use-library-item-hotkeys.ts';

const styles = stylex.create({
  body: {
    display: 'grid', height: '100%', minHeight: 0,
    // The flags take the height their rows need, up to 40%, and scroll past it; the picture has the rest.
    gridTemplateColumns: `minmax(0, 1fr) minmax(320px, 34%)`, gridTemplateRows: 'auto minmax(0, 1fr) auto fit-content(40%)',
    gridTemplateAreas: '"facts facts" "picture transcript" "timeline transcript" "flags transcript"',
  },
  facts: { gridArea: 'facts', minWidth: 0 },
  picture: { gridArea: 'picture', minHeight: 0, position: 'relative' },
  offline: {
    position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: spacing.inset, color: colors.dim,
    backgroundColor: colors.screen, textAlign: 'center',
  },
  timeline: { gridArea: 'timeline', minWidth: 0 },
  flags: { gridArea: 'flags', minHeight: 0, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  transcript: { gridArea: 'transcript', minHeight: 0, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line },
});

/** A flag played over and over while it's on show: an instant flag gets a moment around it to hear. */
const flagLoopOf = (flag: LibraryFlag) => ({ start: flag.start, end: Math.max(flag.end, flag.start + 1) });

function LibraryItemScreenBody({ view }: { readonly view: LibraryItemView }) {
  const { item } = view;
  const [search, setSearch] = useLibraryItemSearch();
  const flags = useLibraryFlags(item.id);
  const ops = useLibraryFlagOps(item.id, item.durationSeconds);
  const [playback] = useState(() => createLibraryItemPlayback(item, search.t ?? 0));
  const [filter, setFilter] = useState<LibraryFlagFilter>('all');
  const [marked, setMarked] = useState<LibraryMarkedRange | null>(null);
  const [composing, setComposing] = useState<LibraryComposing | null>(null);
  const { words, lines } = useMemo(() => {
    const footage = libraryFootage(item, view.transcript);
    return { words: footage.words, lines: transcriptLines({ words: footage.words }) };
  }, [item, view.transcript]);
  const queue = libraryFlagsInOrder(flags.flags, filter);
  const focused = flags.flags.find((f) => f.id === search.flag);
  const loopStart = focused && flagLoopOf(focused).start, loopEnd = focused && flagLoopOf(focused).end;

  // The playhead goes into the URL as it settles, so a reload or a copied link opens at the same moment.
  useEffect(() => playback.subscribe(() => {
    const { playing, time } = playback.getState();
    if (!playing) setSearch({ t: Math.round(time * 100) / 100 });
  }), [playback, setSearch]);
  // A flag on show loops; one removed, or left, stops looping.
  useEffect(() => {
    playback.setLoop(loopStart === undefined || loopEnd === undefined ? null : { start: loopStart, end: loopEnd });
  }, [playback, loopStart, loopEnd]);

  const screen: LibraryItemScreenValue = {
    view, playback, words, lines, flags, queue, filter, setFilter, focused, marked, setMarked, composing, setComposing,
    focusFlag: (flag) => {
      setSearch({ flag: flag?.id });
      if (!flag) return;
      playback.setLoop(flagLoopOf(flag));
      playback.seek(flag.start);
      playback.play();
    },
    changeFlags: (op) => {
      ops.reset();
      ops.apply(op);
    },
    refusal: ops.error?.message,
  };
  useLibraryItemHotkeys(screen);
  const { reach, heard, attachRoot, attachLeader } = playback;
  return (
    <LibraryItemScreenProvider value={screen}>
      <StudioShell start={<LibraryItemHeader />}>
        <Box ref={attachRoot} {...stylex.props(styles.body)}>
          <Box {...stylex.props(styles.facts)}><LibraryItemFacts /></Box>
          <Box {...stylex.props(styles.picture)}>
            <LibraryRecordingMedia item={item} clock={playback} placement={{ offsetSeconds: 0, fps: LIBRARY_CLOCK_FPS }}
              heard={{ track: heard, attach: attachLeader }} />
            {!view.media.online && (
              <Text size="sm" {...stylex.props(styles.offline)}>
                Media offline: {view.media.path} isn&apos;t there, so nothing plays. The transcript, search and flags still work.
              </Text>
            )}
          </Box>
          <Box {...stylex.props(styles.timeline)}><LibraryTimeline reach={reach} /></Box>
          <Box {...stylex.props(styles.flags)}><LibraryFlagPanel /></Box>
          <Box {...stylex.props(styles.transcript)}><LibraryTranscript /></Box>
        </Box>
      </StudioShell>
    </LibraryItemScreenProvider>
  );
}

/**
 * One library item: its tracks played together on one clock, its transcript lit as it's said, and its flags, made
 * by range on the timeline or from the transcript's words and stepped through in order. Its flags are polled, so an
 * agent's appear as it sets them.
 */
export function LibraryItemScreen({ item }: { readonly item: string }) {
  const view = useSuspenseQuery(libraryItemViewQueryOptions(item)).data;
  if (!view) return <RouteNotFoundPage />;
  return <LibraryItemScreenBody view={view} />;
}
