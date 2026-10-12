import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { reviewScriptLineWords, type ReviewScriptLine } from '#lib/output/review/models/review-script.ts';
import { REVIEW_FRAME_VAR } from '#web/features/review/index.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import type { ScriptThreadMark, ScriptTimedLine } from './script-read-along.ts';

const FRAME = `var(${REVIEW_FRAME_VAR})`;

const styles = stylex.create({
  row: {
    // The marks follow the words, not the far edge: a note's dot sits where the eye already is.
    display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: spacing.gap, alignItems: 'baseline',
    paddingBlock: spacing.tight, paddingInlineStart: spacing.inset, paddingInlineEnd: spacing.gap,
    borderLeftWidth: spacing.hairline, borderLeftStyle: 'solid', borderLeftColor: 'transparent',
  },
  focused: { borderLeftColor: colors.cream },
  stamp: {
    display: 'flex', gap: spacing.gap, paddingInline: spacing.tight, borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  stampStill: { cursor: 'default', backgroundColor: 'transparent' },
  text: { lineHeight: `calc(${spacing.row} + ${spacing.gap})`, color: colors.dim },
  current: { color: colors.cream },
  word: {
    position: 'relative', isolation: 'isolate', cursor: 'pointer', borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    textUnderlineOffset: '5px', textDecorationThickness: '1px',
  },
  noted: { textDecorationLine: 'underline' },
  draft: { textDecorationLine: 'underline', textDecorationStyle: 'dashed', textDecorationColor: colors.cobalt },
  // The word being read: a faint cobalt wash behind it and a cobalt bar sweeping under it as the clock crosses it,
  // both gone once it's said. Pure CSS on the frame variable, so playing re-renders nothing inside a line.
  sweepWash: {
    position: 'absolute', insetInline: '-2px', insetBlock: 0, backgroundColor: colors.cobalt, borderRadius: radius.control,
    pointerEvents: 'none', zIndex: -1,
  },
  sweepBar: {
    position: 'absolute', insetInline: 0, bottom: '-1px', height: '2px', backgroundColor: colors.cobalt,
    transformOrigin: 'left', pointerEvents: 'none',
  },
  sweep: (from: number, to: number) => ({
    transform: `scaleX(clamp(0, calc((${FRAME} - ${from}) / ${to - from}), 1))`,
    opacity: `clamp(0, calc((${to} - ${FRAME}) * 1000), 1)`,
  }),
  // On only from the word's first frame to its last: 0.3 of the cobalt, enough to find the word, not to hide it.
  washOn: (from: number, to: number) => ({
    opacity: `calc(0.3 * min(clamp(0, calc((${FRAME} - ${from}) * 1000 + 1), 1), clamp(0, calc((${to} - ${FRAME}) * 1000), 1)))`,
  }),
  marks: { display: 'flex', gap: spacing.tight },
  markAccent: { color: colors.accent },
  markPass: { color: colors.pass },
  markCaution: { color: colors.caution },
  markDim: { color: colors.dim },
  mark: {
    lineHeight: typography.lineHeight, paddingInline: spacing.tight, borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
});

/** A thread on the line: its state's mark and, for a note on words, which. */
export type ScriptLineThread = { id: number; label: string; mark: ScriptThreadMark; run: { word: number; wordEnd: number } | null };

export type ScriptLineActions = {
  seek: (frame: number) => void;
  openThread: (id: number) => void;
};

type ScriptLineRowProps = {
  readonly line: ReviewScriptLine;
  readonly index: number;
  /** Null for a line the take doesn't voice: it shows, dim, with no time and nothing to seek to. */
  readonly timed: ScriptTimedLine | null;
  readonly highlight: { readonly current: boolean; readonly focused: boolean };
  readonly threads: readonly ScriptLineThread[];
  /** The draft's words, when it's on this line. */
  readonly draftRun: { readonly word: number; readonly wordEnd: number } | null;
  readonly actions: ScriptLineActions;
};

// Colour is the thread's state, on its glyph and under the words it's about.
const underlines = stylex.create({
  accent: { textDecorationColor: colors.accent },
  pass: { textDecorationColor: colors.pass },
  caution: { textDecorationColor: colors.caution },
  dim: { textDecorationColor: colors.dim },
});
const glyphTones = { accent: styles.markAccent, pass: styles.markPass, caution: styles.markCaution, dim: styles.markDim };

const inRun = (run: { word: number; wordEnd: number } | null, k: number) => run !== null && run.word <= k && k <= run.wordEnd;

/**
 * `3  0:05.49  and identify the FODMAPs…  ●`: a line of the script, its number and start (click to play from it), its
 * words (click one to seek to it and select it, drag across some to select them; `N` notes the selection), and its threads' marks.
 */
export function ScriptLineRow({ line, index, timed, highlight, threads, draftRun, actions }: ScriptLineRowProps) {
  // A word's place in its line is its identity: notes and the take both count words by it.
  const words = reviewScriptLineWords(line).map(({ text }, k) => ({ text, k, key: `${k}:${text}` }));
  const seekWord = (k: number, word: HTMLElement) => {
    // A click that ends a drag across words is a selection to note, not a seek.
    const selection = window.getSelection();
    if (!timed || !selection?.isCollapsed) return;
    actions.seek(timed.words[k]?.from ?? timed.from);
    // Selected, so the word lit is the one `N` notes, as a drag across words is.
    selection.selectAllChildren(word);
  };
  const stamp = (
    <>
      <Readout>{index + 1}</Readout>
      <Readout>{line.start === undefined ? '' : formatReviewClock(line.start)}</Readout>
    </>
  );
  return (
    <Box data-line={line.id} {...stylex.props(styles.row, highlight.focused && styles.focused)}>
      {timed
        ? <UnstyledButton aria-label={`Play from line ${index + 1}`} onClick={() => actions.seek(timed.from)} {...stylex.props(styles.stamp)}>{stamp}</UnstyledButton>
        : <Box {...stylex.props(styles.stamp, styles.stampStill)}>{stamp}</Box>}
      <Text component="p" size="lg" {...stylex.props(styles.text, highlight.current && styles.current)}>
        {words.map(({ text, k, key }) => {
          const noted = threads.find((t) => inRun(t.run, k));
          const sweep = highlight.current && timed?.words[k];
          return (
            <Fragment key={key}>
              <Text component="span" inherit data-word={k} onClick={(event) => seekWord(k, event.currentTarget)}
                {...stylex.props(styles.word, noted && [styles.noted, underlines[noted.mark.tone]], inRun(draftRun, k) && styles.draft)}>
                {text}
                {sweep && <Box component="span" {...stylex.props(styles.sweepWash, styles.washOn(sweep.from, sweep.to))} />}
                {sweep && <Box component="span" {...stylex.props(styles.sweepBar, styles.sweep(sweep.from, sweep.to))} />}
              </Text>
              {k < words.length - 1 && ' '}
            </Fragment>
          );
        })}
      </Text>
      <Group gap={0} wrap="nowrap" {...stylex.props(styles.marks)}>
        {threads.map((t) => (
          <HotkeyTooltip key={t.id} name={t.label}>
            <UnstyledButton aria-label={t.label} onClick={() => actions.openThread(t.id)} {...stylex.props(styles.mark, glyphTones[t.mark.tone])}><Text component="span" size="sm" inherit>{t.mark.glyph}</Text></UnstyledButton>
          </HotkeyTooltip>
        ))}
      </Group>
    </Box>
  );
}
