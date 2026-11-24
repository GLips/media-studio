import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment, useMemo, useRef, useState } from 'react';
import type { LibraryFlag } from '#lib/footage/library/models/library-flags.ts';
import type { TranscriptLine } from '#lib/footage/transcript/models/footage-transcript.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { useLinkedMediaTick } from '#web/shared/ui/linked-media-clock.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { useLibraryItemScreen } from './library-item-context.tsx';
import { LIBRARY_CLOCK_FPS, useLibraryPlaybackState } from './library-item-playback.ts';

// LIBRARY_TIME_VAR spelled out: StyleX compiles each file alone and can't read an imported value.
const TIME = 'var(--library-time, 0)';

/** How long after the reader scrolls the transcript stops following the playhead, so it doesn't snatch the page back. */
const LIBRARY_FOLLOW_PAUSE_MS = 4000;

const styles = stylex.create({
  body: { padding: spacing.inset, display: 'flex', flexDirection: 'column', gap: spacing.gap },
  empty: { padding: spacing.inset, color: colors.dim },
  line: { display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', columnGap: spacing.gap, alignItems: 'baseline' },
  stamp: {
    textAlign: 'start', paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  words: { margin: 0, color: colors.cream, lineHeight: typography.proseLeading },
  word: {
    position: 'relative', isolation: 'isolate', cursor: 'pointer', borderRadius: radius.control,
    textUnderlineOffset: '5px', textDecorationThickness: '2px',
  },
  // The word being said: lit in cobalt from its start to its end, pure CSS on the time variable, as the plan lights it.
  wash: {
    position: 'absolute', insetInline: `calc(-1 * ${spacing.hairline})`, insetBlock: 0, backgroundColor: colors.cobalt,
    borderRadius: radius.control, pointerEvents: 'none', zIndex: -1,
  },
  washOn: (from: number, to: number) => ({
    opacity: `calc(0.8 * min(clamp(0, calc((${TIME} - ${from}) * 100000 + 1), 1), clamp(0, calc((${to} - ${TIME}) * 100000), 1)))`,
  }),
  marked: { backgroundColor: colors.rangeWash },
  flagged: { textDecorationLine: 'underline' },
  agent: { textDecorationColor: colors.caution },
  reviewer: { textDecorationColor: colors.cobalt },
});

/** The line spoken at `seconds`: the last to start by then. -1 before the first. */
function lineIndexAt(lines: readonly TranscriptLine[], seconds: number): number {
  let low = 0, high = lines.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].start <= seconds) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** By word index, the flag each word's middle falls in, the newest where flags overlap. */
function flaggedWords(words: readonly { start: number; end: number }[], flags: readonly LibraryFlag[]): Map<number, LibraryFlag> {
  const marks = new Map<number, LibraryFlag>();
  words.forEach((word, i) => {
    const middle = (word.start + word.end) / 2;
    const flag = flags.findLast((f) => f.start <= middle && middle <= f.end);
    if (flag) marks.set(i, flag);
  });
  return marks;
}

/** The words a selection in the transcript runs over, by the `data-word` index of its two ends. */
function selectedWordRange(root: HTMLElement): [number, number] | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return null;
  const indexOf = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    const word = element?.closest<HTMLElement>('[data-word]');
    return word && root.contains(word) ? Number(word.dataset.word) : null;
  };
  const a = indexOf(selection.anchorNode), b = indexOf(selection.focusNode);
  return a === null || b === null ? null : [Math.min(a, b), Math.max(a, b)];
}

/**
 * The line being said, and the transcript's root kept scrolled to it while playing, unless the reader has just scrolled
 * away to read, which `readerScrolled` hears.
 */
function useLibraryTranscriptFollow() {
  const { playback, lines } = useLibraryItemScreen();
  const root = useRef<HTMLDivElement>(null);
  const scrolledAt = useRef(0);
  const [current, setCurrent] = useState(-1);
  const playing = useLibraryPlaybackState(playback, (s) => s.playing);
  const time = useLibraryPlaybackState(playback, (s) => s.time);
  useLinkedMediaTick(playback, (frame) => {
    const at = lineIndexAt(lines, frame / LIBRARY_CLOCK_FPS);
    if (at === current) return;
    setCurrent(at);
    if (Date.now() - scrolledAt.current < LIBRARY_FOLLOW_PAUSE_MS) return;
    root.current?.querySelector(`[data-line="${at}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, playing);
  const readerScrolled = () => {
    scrolledAt.current = Date.now();
  };
  return { root, readerScrolled, shownLine: playing ? current : lineIndexAt(lines, time) };
}

/**
 * What's said, line by line, the word being said lit and the page following it while it plays. A word's click plays
 * from it; a line's time plays from the line. Words selected become the range to flag. Flagged words are underlined
 * in their author's colour.
 */
export function LibraryTranscript() {
  const { view, playback, words, lines, flags, marked, setMarked } = useLibraryItemScreen();
  const { root, readerScrolled, shownLine } = useLibraryTranscriptFollow();
  const marks = useMemo(() => flaggedWords(words, flags.flags), [words, flags.flags]);

  if (!words.length) {
    const why = view.item.speech ? 'No transcript yet: `studio library finish` makes it.' : 'Nothing in this item has sound to transcribe.';
    return <Text size="sm" {...stylex.props(styles.empty)}>{why}</Text>;
  }
  const seekTo = (seconds: number) => {
    // A word clicked at the end of a drag is a selection, not a seek.
    if (!window.getSelection()?.isCollapsed) return;
    playback.seek(seconds);
  };
  return (
    <FadeScroll>
      <Box
        ref={root}
        onWheel={readerScrolled}
        onMouseUp={() => {
          const range = root.current && selectedWordRange(root.current);
          if (range) setMarked({ start: words[range[0]].start, end: words[range[1]].end });
        }}
        {...stylex.props(styles.body)}
      >
        {lines.map((line, n) => (
          <Box key={line.firstWord} data-line={n} aria-current={n === shownLine || undefined} {...stylex.props(styles.line)}>
            <UnstyledButton onClick={() => playback.seek(line.start)} {...stylex.props(styles.stamp)}><Readout>{formatReviewClock(line.start)}</Readout></UnstyledButton>
            <Text component="p" size="md" {...stylex.props(styles.words)}>
              {words.slice(line.firstWord, line.firstWord + line.wordCount).map((word, k) => {
                const i = line.firstWord + k, flag = marks.get(i), middle = (word.start + word.end) / 2;
                const inMarked = marked !== null && marked.start <= middle && middle <= marked.end;
                return (
                  <Fragment key={i}>
                    {k > 0 && ' '}
                    <Text component="span" inherit data-word={i} onClick={() => seekTo(word.start)}
                      {...stylex.props(styles.word, inMarked && styles.marked, flag && styles.flagged, flag && styles[flag.by])}>
                      <Box component="span" aria-hidden {...stylex.props(styles.wash, styles.washOn(word.start, word.end))} />
                      {word.text}
                    </Text>
                  </Fragment>
                );
              })}
            </Text>
          </Box>
        ))}
      </Box>
    </FadeScroll>
  );
}
