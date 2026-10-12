import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { reviewTimelineFramePx, reviewTimelineSpan, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, fonts, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { useReviewPlaybackState } from './review-playback-store.ts';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';
import type { ReviewTimelineLine } from './use-review-dock-lanes.ts';

/** Zoomed in this far (px a frame), each word is written at the frame it starts on. */
const REVIEW_WORD_FRAME_PX = 3;
/** A line's text inset from its span's left edge: `spacing.tight`. */
const REVIEW_LINE_INSET_PX = 4;

const styles = stylex.create({
  lane: { position: 'relative', height: '100%', overflow: 'hidden' },
  line: {
    position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', paddingInline: spacing.tight, whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.dim,
    backgroundColor: colors.laneA, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
  // A line begun off the lanes' left edge writes its words from the edge, so a zoomed lane still reads.
  pinnedText: (inset: number) => ({ paddingInlineStart: `${inset}px` }),
  words: { paddingInline: 0 },
  word: {
    position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', paddingInlineStart: spacing.hairline, whiteSpace: 'nowrap',
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
  // The word being spoken: cream, with shadows.spokenUnderline.
  spoken: { color: colors.cream },
  span: (left: string, width: string) => ({ left, width }),
});

type ReviewSpokenWord = { line: string; from: number };

/** The word under `frame`: each runs from its start to the next word's, the last to its line's end. */
function reviewSpokenWordAt(lines: readonly ReviewTimelineLine[], frame: number): ReviewSpokenWord | null {
  const line = lines.find((l) => l.from <= frame && frame < l.to);
  const word = line?.words.findLast((w) => w.from <= frame);
  return line && word ? { line: line.id, from: word.from } : null;
}

/**
 * The word being spoken: at the settled frame, and while playing read off the clock each animation frame, the lane
 * re-rendering only when the word changes.
 */
function useReviewSpokenWord(lines: readonly ReviewTimelineLine[], watching: boolean): ReviewSpokenWord | null {
  const { playback } = useReviewScreen();
  const frame = useReviewFrame();
  const playing = useReviewPlaybackState(playback, (s) => s.playing);
  const [played, setPlayed] = useState<ReviewSpokenWord | null>(null);
  useEffect(() => {
    if (!playing || !watching) return undefined;
    let raf = requestAnimationFrame(function follow() {
      const now = reviewSpokenWordAt(lines, playback.frameNow());
      setPlayed((was) => (was?.line === now?.line && was?.from === now?.from ? was : now));
      raf = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, watching, lines, playback]);
  return playing ? played : reviewSpokenWordAt(lines, frame);
}

/**
 * Each voiced line over the frames it's spoken in, its words written out; up close, each word at the frame it starts
 * on, the one being spoken marked.
 */
export function ReviewLaneVoice({ view, lines }: { readonly view: ReviewTimelineView; readonly lines: readonly ReviewTimelineLine[] }) {
  const framePx = reviewTimelineFramePx(view);
  const words = framePx >= REVIEW_WORD_FRAME_PX;
  const spoken = useReviewSpokenWord(lines, words);
  return (
    <Box {...stylex.props(styles.lane)}>
      {lines.map((line) => {
        const span = reviewTimelineSpan(view, line.from, line.to);
        if (!span) return null;
        if (!words) {
          return (
            <Text key={line.id} component="span" fz="xs"
              {...stylex.props(styles.line, styles.span(`${span.x}px`, `${span.w}px`), span.x < 0 && styles.pinnedText(REVIEW_LINE_INSET_PX - span.x))}>
              {line.text}
            </Text>
          );
        }
        return (
          <Box key={line.id} {...stylex.props(styles.line, styles.words, styles.span(`${span.x}px`, `${span.w}px`))}>
            {line.words.map((word, i) => {
              const to = line.words[i + 1]?.from ?? line.to;
              const lit = spoken?.line === line.id && spoken.from === word.from;
              return (
                <Text key={`${word.from}:${word.text}`} component="span" fz="xs"
                  {...stylex.props(styles.word, lit && styles.spoken, lit && shadows.spokenUnderline, styles.span(`${(word.from - line.from) * framePx}px`, `${(to - word.from) * framePx}px`))}>
                  {word.text}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
