import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import type { StoryboardLineRead } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { findScriptPhrase } from '#lib/timing/voice/models/voice-words.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { planThreadMarkOf, type PlanPlacedThread } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { PlanTargetBox } from './plan-target-box.tsx';
import { PlanThreadMarks } from './plan-thread-marks.tsx';
import { formatPlanSeconds, type PlanCue, type PlanLine as PlanTimedLine, type PlanWord } from './plan-timing.ts';

// PLAN_FRAME_VAR spelled out: StyleX compiles each file alone and can't read an imported value.
const FRAME = 'var(--plan-frame, 0)';

const styles = stylex.create({
  line: {
    display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: spacing.gap, alignItems: 'baseline',
    paddingBlock: spacing.tight, paddingInline: spacing.tight,
  },
  stamp: {
    display: 'inline-flex', gap: spacing.tight, paddingInline: spacing.tight, borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  stampStill: { cursor: 'default', backgroundColor: 'transparent' },
  read: { color: colors.dim, cursor: 'default', fontFamily: fonts.mono },
  words: { margin: 0, color: colors.cream, lineHeight: `calc(${typography.line} * 1.45)` },
  // A line with chips under its words leaves a chip's height below each row of text, so a wrapped row clears them.
  wordsCued: { lineHeight: `calc(${typography.line} * 2.8)` },
  // The chip hangs under its word out of the flow, so a name longer than its word doesn't spread the line's spacing.
  cued: { position: 'relative' },
  word: {
    position: 'relative', isolation: 'isolate', cursor: 'pointer', borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    textUnderlineOffset: '5px', textDecorationThickness: '1px',
  },
  emphasis: { fontStyle: 'italic' },
  keycap: { fontFamily: fonts.mono },
  noted: { textDecorationLine: 'underline' },
  draft: { textDecorationLine: 'underline', textDecorationStyle: 'dashed', textDecorationColor: colors.cobalt },
  // The word being said: a faint cobalt wash from its first frame to its last, pure CSS on the frame variable.
  wash: {
    position: 'absolute', insetInline: `calc(-1 * ${spacing.hairline})`, insetBlock: 0, backgroundColor: colors.cobalt,
    borderRadius: radius.control, pointerEvents: 'none', zIndex: -1,
  },
  washOn: (from: number, to: number) => ({
    opacity: `calc(0.35 * min(clamp(0, calc((${FRAME} - ${from}) * 1000 + 1), 1), clamp(0, calc((${to} - ${FRAME}) * 1000), 1)))`,
  }),
  chip: {
    // Below a note's underline (5px under the text), so the two don't cross.
    position: 'absolute', insetInlineStart: 0, top: `calc(100% + ${spacing.tight})`,
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.cobalt,
    whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default',
  },
});

const underlines = stylex.create({
  accent: { textDecorationColor: colors.accent },
  pass: { textDecorationColor: colors.pass },
  caution: { textDecorationColor: colors.caution },
  dim: { textDecorationColor: colors.dim },
});

const READ_GLYPHS: Readonly<Record<StoryboardLineRead, { glyph: string; word: string }>> = {
  recorded: { glyph: '◉', word: 'recorded' },
  draft: { glyph: '◎', word: 'draft read' },
  estimated: { glyph: '≈', word: 'estimated from its word count' },
};

const inRun = (run: readonly [number, number] | null, k: number) => run !== null && run[0] <= k && k <= run[1];

type PlanLineProps = {
  readonly scene: string;
  readonly id: string;
  /** Null when the plan doesn't time: the words show, with no time and nothing to seek. */
  readonly timed: PlanTimedLine | null;
  readonly cues: readonly PlanCue[];
  readonly threads: readonly PlanPlacedThread[];
};

/**
 * `0:00.20 ≈ Take a photo of what you're about to eat.  ●`: a line, its start (click to play from it), how it's timed,
 * its words (click one to seek to it; drag across some to quote them for `N`), the cue chips under their words, and its
 * notes' marks, their quotes underlined in their state's colour.
 */
export function PlanLine({ scene, id, timed, cues, threads }: PlanLineProps) {
  const { plan, timing, playback, draft, setSearch, setTarget } = usePlanScreen();
  const fps = timing?.fps ?? 1;
  const said = plan.resolved.voice[id];
  const read = plan.resolved.lines.find((l) => l.line === id)?.read ?? 'estimated';
  const words: readonly (Pick<PlanWord, 'text' | 'mark'> & Partial<PlanWord>)[] = timed?.words ?? said.words.map((w) => ({ text: w.text, mark: null }));
  const cuesOn = (k: number) => cues.filter((c) => c.word?.line === id && c.word.k === k);
  const draftAnchor = draft.isOpen && draft.anchor.on === 'plan' && draft.anchor.field === 'line' && draft.anchor.line === id ? draft.anchor : null;
  const draftRun = draftAnchor?.text === undefined ? null : findScriptPhrase(words.map((w) => w.text), draftAnchor.text);
  const seekWord = (k: number, element: HTMLElement) => {
    const selection = window.getSelection();
    // A click that ends a drag across words is a selection to quote, not a seek.
    if (!selection?.isCollapsed) return;
    setTarget({ field: 'line', scene, line: id });
    setSearch({ scene });
    const from = words[k]?.from;
    if (from !== undefined) playback.seek(from);
    // Selected, so the word lit is the one `N` quotes, as a drag across words is.
    selection.selectAllChildren(element);
  };
  const stamp = timed && <Readout>{formatReviewClock(timed.from / fps)}</Readout>;
  return (
    <PlanTargetBox target={{ field: 'line', scene, line: id }}>
      <Box data-plan-line={id} {...stylex.props(styles.line)}>
        <HotkeyTooltip name={timed ? `${id} · ${formatPlanSeconds(said.duration)} · ${READ_GLYPHS[read].word}` : `${id} · ${READ_GLYPHS[read].word}`}>
          {timed
            ? <UnstyledButton aria-label={`Play from ${id}`} onClick={(event) => { event.stopPropagation(); playback.seek(timed.from); setSearch({ scene }); }} {...stylex.props(styles.stamp)}>{stamp}<Text component="span" size="xs" {...stylex.props(styles.read)}>{READ_GLYPHS[read].glyph}</Text></UnstyledButton>
            : <Box component="span" {...stylex.props(styles.stamp, styles.stampStill)}><Text component="span" size="xs" {...stylex.props(styles.read)}>{READ_GLYPHS[read].glyph}</Text></Box>}
        </HotkeyTooltip>
        <Text component="p" size="line" {...stylex.props(styles.words, cues.some((c) => c.word?.line === id) && styles.wordsCued)}>
          {words.map((word, k) => {
            const noted = threads.find((t) => t.state !== 'resolved' && inRun(t.plan.words, k));
            const on = cuesOn(k);
            const text = (
              <Text component="span" inherit data-word={k} onClick={(event) => seekWord(k, event.currentTarget)}
                {...stylex.props(styles.word, word.mark === 'emphasis' && styles.emphasis, word.mark === 'keycap' && styles.keycap,
                  noted && [styles.noted, underlines[planThreadMarkOf(noted).tone]], inRun(draftRun, k) && styles.draft)}>
                {word.text}
                {word.from !== undefined && word.to !== undefined && <Box component="span" {...stylex.props(styles.wash, styles.washOn(word.from, word.to))} />}
              </Text>
            );
            return (
              // oxlint-disable-next-line react/no-array-index-key -- a word's place in its line is its identity
              <Fragment key={k}>
                {on.length ? (
                  <Box component="span" {...stylex.props(styles.cued)}>
                    {text}
                    <HotkeyTooltip name={on.map((c) => `${c.name} · ${formatReviewClock(c.frame / fps)}`).join(' · ')}>
                      <Text component="span" size="xs" {...stylex.props(styles.chip)}>{on.map((c) => `◆ ${c.name}`).join(' ')}</Text>
                    </HotkeyTooltip>
                  </Box>
                ) : text}
                {k < words.length - 1 && ' '}
              </Fragment>
            );
          })}
        </Text>
        <PlanThreadMarks threads={threads} />
      </Box>
    </PlanTargetBox>
  );
}
