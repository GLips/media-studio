import { Box, Button, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownToLine } from 'lucide-react';
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

const styles = stylex.create({
  body: { padding: spacing.inset, display: 'flex', flexDirection: 'column', gap: spacing.tight },
  empty: { padding: spacing.inset, color: colors.dim },
  frame: { position: 'relative', height: '100%', minHeight: 0 },
  // Over the transcript's foot, where the eye goes when the lit line has scrolled out of view.
  follow: { position: 'absolute', insetInline: 0, bottom: spacing.inset, display: 'flex', justifyContent: 'center', pointerEvents: 'none' },
  followButton: { pointerEvents: 'auto' },
  // A flag marks its lines with a rule down their edge, in its author's colour, so the lit word is the one mark in the text.
  line: {
    display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', columnGap: spacing.gap, alignItems: 'baseline',
    borderInlineStartWidth: '2px', borderInlineStartStyle: 'solid', borderInlineStartColor: 'transparent',
  },
  agentLine: { borderInlineStartColor: colors.caution },
  reviewerLine: { borderInlineStartColor: colors.cobalt },
  stamp: {
    textAlign: 'start', paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  // A line's time to the second; the hundredths only under the pointer, where they're wanted to place a cut.
  whole: { display: { default: 'inline', [stylex.when.ancestor(':hover')]: 'none' } },
  exact: { display: { default: 'none', [stylex.when.ancestor(':hover')]: 'inline' } },
  // Words dragged over take the accent's tone, not the browser's blue, which reads as the cobalt of the word being said.
  words: {
    margin: 0, color: colors.cream, lineHeight: typography.proseLeading,
    '::selection': { backgroundColor: `color-mix(in srgb, ${colors.accent} 40%, transparent)`, color: colors.cream },
  },
  word: {
    position: 'relative', isolation: 'isolate', cursor: 'pointer', borderRadius: radius.control,
    '::selection': { backgroundColor: `color-mix(in srgb, ${colors.accent} 40%, transparent)`, color: colors.cream },
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
});

const LINE_RULES = { agent: styles.agentLine, reviewer: styles.reviewerLine } as const;

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
 * The line being said, and the transcript's root kept scrolled to it while playing, until the reader scrolls away to
 * read; `follow` brings it back to the playhead and keeps it there again.
 */
function useLibraryTranscriptFollow() {
  const { playback, lines } = useLibraryItemScreen();
  const root = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [current, setCurrent] = useState(-1);
  const playing = useLibraryPlaybackState(playback, (s) => s.playing);
  const time = useLibraryPlaybackState(playback, (s) => s.time);
  const shownLine = playing ? current : lineIndexAt(lines, time);
  const scrollTo = (line: number) => root.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  useLinkedMediaTick(playback, (frame) => {
    const at = lineIndexAt(lines, frame / LIBRARY_CLOCK_FPS);
    if (at === current) return;
    setCurrent(at);
    if (following) scrollTo(at);
  }, playing);
  return {
    root,
    shownLine,
    following,
    readerScrolled: () => setFollowing(false),
    follow: () => {
      setFollowing(true);
      scrollTo(shownLine);
    },
  };
}

/**
 * What's said, line by line, the word being said lit and the page following it while it plays. A word's click plays
 * from it; a line's time plays from the line. Words selected become the range to flag. A flag's lines carry a
 * rule in its author's colour.
 */
export function LibraryTranscript() {
  const { view, playback, words, lines, flags, marked, setMarked } = useLibraryItemScreen();
  const { root, readerScrolled, shownLine, following, follow } = useLibraryTranscriptFollow();
  // By line, the newest flag over any of its words.
  const lineFlags = useMemo(() => {
    const marks = flaggedWords(words, flags.flags);
    return lines.map((line) => Array.from({ length: line.wordCount }, (_, k) => marks.get(line.firstWord + k)).findLast(Boolean));
  }, [words, lines, flags.flags]);

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
    <Box {...stylex.props(styles.frame)}>
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
            <Box key={line.firstWord} data-line={n} aria-current={n === shownLine || undefined}
              {...stylex.props(styles.line, lineFlags[n] && LINE_RULES[lineFlags[n].by])}>
              <UnstyledButton onClick={() => playback.seek(line.start)} {...stylex.props(styles.stamp, stylex.defaultMarker())}>
                <Readout>
                  <Box component="span" {...stylex.props(styles.whole)}>{formatReviewClock(line.start).slice(0, -3)}</Box>
                  <Box component="span" {...stylex.props(styles.exact)}>{formatReviewClock(line.start)}</Box>
                </Readout>
              </UnstyledButton>
              <Text component="p" size="md" {...stylex.props(styles.words)}>
                {words.slice(line.firstWord, line.firstWord + line.wordCount).map((word, k) => {
                  const i = line.firstWord + k, middle = (word.start + word.end) / 2;
                  const inMarked = marked !== null && marked.start <= middle && middle <= marked.end;
                  return (
                    <Fragment key={i}>
                      {k > 0 && ' '}
                      <Text component="span" inherit data-word={i} onClick={() => seekTo(word.start)}
                        {...stylex.props(styles.word, inMarked && styles.marked)}>
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
      {!following && (
        <Box {...stylex.props(styles.follow)}>
          <Button size="compact-xs" leftSection={<ArrowDownToLine size={12} />} onClick={follow} {...stylex.props(styles.followButton)}>Follow</Button>
        </Box>
      )}
    </Box>
  );
}
