import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { libraryFootage } from '#lib/footage/library/models/library-footage.ts';
import { libraryFlagsInOrder, type LibraryFlag, type LibraryFlagFilter } from '#lib/footage/library/models/library-flags.ts';
import { librarySourcesOf } from '#lib/footage/library/models/library-item.ts';
import { transcriptLines } from '#lib/footage/transcript/models/footage-transcript.ts';
import { RouteNotFoundPage } from '#web/shared/ui/route-not-found-page.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { libraryItemViewQueryOptions, useLibraryFlagOps, useLibraryFlags } from '../controllers/library-queries.ts';
import type { LibraryItemView } from '../controllers/library-reads.ts';
import { useLibraryItemSearch } from '../controllers/library-search.ts';
import { LibraryFlagPanel } from './library-flag-panel.tsx';
import { LibraryItemHeader } from './library-item-header.tsx';
import { LibraryItemScreenProvider, type LibraryComposing, type LibraryItemScreenValue, type LibraryMarkedRange } from './library-item-context.tsx';
import { createLibraryItemPlayback, LIBRARY_CLOCK_FPS } from './library-item-playback.ts';
import { LibraryRecordingMedia } from './library-recording-media.tsx';
import { LibraryTimeline } from './library-timeline.tsx';
import { LibraryTranscript } from './library-transcript.tsx';
import { useLibraryFlagUndo } from './use-library-flag-undo.ts';
import { useLibraryItemHotkeys } from './use-library-item-hotkeys.ts';

const styles = stylex.create({
  body: {
    display: 'grid', height: '100%', minHeight: 0,
    // The picture and its transport own the left; the rail on the right holds the flags over the transcript.
    gridTemplateColumns: 'minmax(0, 1fr) 400px', gridTemplateRows: 'minmax(0, 1fr)', gridTemplateAreas: '"media rail"',
  },
  // The picture and its transport as one block, centred down the column: the picture's row is as tall as the picture
  // at the column's width, shrinking (minmax from 0) when that and the transport would overflow.
  media: { gridArea: 'media', minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0, auto) auto', alignContent: 'center' },
  picture: { minHeight: 0, position: 'relative' },
  offline: {
    position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: spacing.inset, color: colors.dim,
    backgroundColor: colors.screen, textAlign: 'center',
  },
  timeline: { minWidth: 0 },
  // The flags as tall as they are, to under half the rail, past which they scroll; the transcript has the rest.
  rail: {
    gridArea: 'rail', minHeight: 0, display: 'grid', gridTemplateRows: 'fit-content(45%) minmax(0, 1fr)',
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
  transcript: { minHeight: 0, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
});

/** A flag played over and over while it's on show: an instant flag gets a moment around it to hear. */
const flagLoopOf = (flag: LibraryFlag) => ({ start: flag.start, end: Math.max(flag.end, flag.start + 1) });

function LibraryItemScreenBody({ view }: { readonly view: LibraryItemView }) {
  const { item } = view;
  const [search, setSearch] = useLibraryItemSearch();
  const flags = useLibraryFlags(item.id);
  const ops = useLibraryFlagOps(item.id, item.durationSeconds);
  const [playback, setPlayback] = useState(() => createLibraryItemPlayback(item, search.t ?? 0, search.hear));
  const audible = useMemo(() => librarySourcesOf(item).filter(({ track }) => item.tracks[track].audio).map(({ track, label }) => ({ track, label })), [item]);
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

  const undo = useLibraryFlagUndo((op) => {
    ops.reset();
    ops.apply(op);
  });

  const screen: LibraryItemScreenValue = {
    ...undo,
    view, playback, audible, words, lines, flags, queue, filter, setFilter, focused, marked, setMarked, composing,
    // A composer opened or left starts with no refusal from before on show.
    setComposing: (next) => {
      ops.reset();
      setComposing(next);
    },
    hear: (track) => {
      if (track === playback.heard) return;
      const { playing, loop, rate, muted, volume } = playback.getState();
      const time = playback.timeNow();
      playback.pause();
      setPlayback(createLibraryItemPlayback(item, time, track, { playing, loop, rate, muted, volume }));
      setSearch({ hear: track });
    },
    focusFlag: (flag) => {
      setSearch({ flag: flag?.id });
      if (!flag) return;
      playback.setLoop(flagLoopOf(flag));
      playback.seek(flag.start);
      playback.play();
    },
    changeFlags: (op, onSaved) => {
      ops.reset();
      ops.apply(op, onSaved);
    },
    refusal: ops.error?.message,
    saving: ops.saving,
  };
  useLibraryItemHotkeys(screen);
  const { reach, heard, attachRoot, attachLeader } = playback;
  return (
    <LibraryItemScreenProvider value={screen}>
      <StudioShell start={<LibraryItemHeader />}>
        <Box ref={attachRoot} {...stylex.props(styles.body)}>
          <Box {...stylex.props(styles.media)}>
            <Box {...stylex.props(styles.picture)}>
              <LibraryRecordingMedia item={item} clock={playback} placement={{ offsetSeconds: 0, fps: LIBRARY_CLOCK_FPS }}
                heard={{ track: heard, attach: attachLeader }} letterbox={false} />
              {!view.media.online && (
                <Text size="sm" {...stylex.props(styles.offline)}>
                  Media offline: {view.media.path} isn&apos;t there, so nothing plays. The transcript, search and flags still work.
                </Text>
              )}
            </Box>
            <Box {...stylex.props(styles.timeline)}><LibraryTimeline reach={reach} /></Box>
          </Box>
          <Box {...stylex.props(styles.rail)}>
            <LibraryFlagPanel />
            <Box {...stylex.props(styles.transcript)}><LibraryTranscript /></Box>
          </Box>
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
