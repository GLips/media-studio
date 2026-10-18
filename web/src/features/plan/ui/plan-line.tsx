import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Pencil } from 'lucide-react';
import { Fragment, useState } from 'react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { findScriptPhrase } from '#lib/timing/voice/models/voice-words.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { PlanEditableText } from './plan-editable-text.tsx';
import { planThreadMarkOf, planTargetAttributes, planUnquotedAttributes, type PlanPlacedThread } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { PlanThreadMarks } from './plan-thread-marks.tsx';
import { formatPlanSeconds, type PlanCue, type PlanLine as PlanTimedLine, type PlanWord } from './plan-timing.ts';

// PLAN_FRAME_VAR spelled out: StyleX compiles each file alone and can't read an imported value.
const FRAME = 'var(--plan-frame, 0)';
const PLAYING = 'var(--plan-playing, 0)';

const styles = stylex.create({
  line: {
    position: 'relative', display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', columnGap: spacing.inset, alignItems: 'baseline',
    paddingBlock: spacing.gap, paddingInlineEnd: spacing.row,
  },
  stamp: {
    fontFamily: fonts.mono, color: colors.dim, textAlign: 'start',
    paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  words: { margin: 0, color: colors.cream, fontWeight: 500 },
  word: {
    position: 'relative', isolation: 'isolate', cursor: 'pointer', borderRadius: radius.control,
    textUnderlineOffset: '6px', textDecorationThickness: '2px',
  },
  emphasis: { fontStyle: 'italic' },
  keycap: { fontFamily: fonts.mono },
  noted: { textDecorationLine: 'underline' },
  draft: { textDecorationLine: 'underline', textDecorationStyle: 'dashed', textDecorationColor: colors.cobalt },
  // The word being said: lit in cobalt from its first frame to its last, pure CSS on the frame variable.
  wash: {
    position: 'absolute', insetInline: `calc(-1 * ${spacing.hairline})`, insetBlock: 0, backgroundColor: colors.cobalt,
    borderRadius: radius.control, pointerEvents: 'none', zIndex: -1,
  },
  washOn: (from: number, to: number) => ({
    opacity: `calc(0.8 * min(clamp(0, calc((${FRAME} - ${from}) * 1000 + 1), 1), clamp(0, calc((${to} - ${FRAME}) * 1000), 1)))`,
  }),
  // Said already: dimmed once the playhead passes, so the eye finds its place while it plays; paused, the line being
  // edited reads whole.
  saidOn: (to: number) => ({ opacity: `calc(1 - 0.45 * ${PLAYING} * clamp(0, calc((${FRAME} - ${to}) * 1000), 1))` }),
  tag: {
    // Outlined, not filled: solid cobalt is the word being said.
    display: 'inline-block', verticalAlign: 'middle', marginInlineStart: spacing.tight, fontWeight: 500, color: colors.cobalt,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.cobalt, lineHeight: typography.lineHeight,
    paddingInline: spacing.tight, borderRadius: radius.control, whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default',
  },
  tools: {
    position: 'absolute', insetInlineEnd: 0, top: spacing.gap, display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: spacing.tight, opacity: { default: 0.7, ':hover': 1 },
  },
});

const underlines = stylex.create({
  accent: { textDecorationColor: colors.accent },
  pass: { textDecorationColor: colors.pass },
  caution: { textDecorationColor: colors.caution },
  dim: { textDecorationColor: colors.dim },
});

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
 * A spoken line as the scene panel reads it: its start (click to play from it), its words large, lit as they're said
 * (click one to jump to it; drag across some to comment on them), each cue's name tagged under the word it lands on,
 * and the pencil that edits the line's text in storyboard.ts.
 */
export function PlanLine({ scene, id, timed, cues, threads }: PlanLineProps) {
  const { plan, timing, playback, draft, setSearch } = usePlanScreen();
  const [editing, setEditing] = useState(false);
  const fps = timing?.fps ?? 1;
  const said = plan.resolved.voice[id];
  const text = plan.storyboard.scenes[scene]?.lines?.[id]?.text ?? '';
  const words: readonly (Pick<PlanWord, 'text' | 'mark'> & Partial<PlanWord>)[] = timed?.words ?? said.words.map((w) => ({ text: w.text, mark: null }));
  const cuesOn = (k: number) => cues.filter((c) => c.word?.line === id && c.word.k === k);
  const draftAnchor = draft.isOpen && draft.anchor.on === 'plan' && draft.anchor.field === 'line' && draft.anchor.line === id ? draft.anchor : null;
  const draftRun = draftAnchor?.text === undefined ? null : findScriptPhrase(words.map((w) => w.text), draftAnchor.text);
  const seekWord = (k: number) => {
    // A click that ends a drag across words is a selection to comment on, not a seek.
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    const from = words[k]?.from;
    if (from === undefined) return;
    playback.seek(from);
    setSearch({ scene });
  };
  return (
    <Box data-plan-line={id} {...planTargetAttributes({ field: 'line', scene, line: id })} {...stylex.props(styles.line)}>
      {timed
        ? (
          <HotkeyTooltip name={`Play from here · this line runs ${formatPlanSeconds(said.duration)}`}>
            <UnstyledButton fz="xs" onClick={() => playback.seek(timed.from)} {...stylex.props(styles.stamp)}>{formatReviewClock(timed.from / fps)}</UnstyledButton>
          </HotkeyTooltip>
        )
        : <Box component="span" />}
      {editing
        ? (
          <PlanEditableText value={text} target={{ field: 'line', scene, line: id }} size="line" startEditing onDone={() => setEditing(false)}>
            {text}
          </PlanEditableText>
        )
        : (
          <Text component="p" size="line" {...stylex.props(styles.words)}>
            {words.map((word, k) => {
              const noted = threads.find((t) => t.state !== 'resolved' && inRun(t.plan.words, k));
              const on = cuesOn(k);
              const shown = (
                <Text component="span" inherit data-word={k} onClick={() => seekWord(k)}
                  {...stylex.props(styles.word, word.mark === 'emphasis' && styles.emphasis, word.mark === 'keycap' && styles.keycap,
                    noted && [styles.noted, underlines[planThreadMarkOf(noted).tone]], inRun(draftRun, k) && styles.draft,
                    word.to !== undefined && styles.saidOn(word.to))}>
                  {word.text}
                  {word.from !== undefined && word.to !== undefined && <Box component="span" {...stylex.props(styles.wash, styles.washOn(word.from, word.to))} />}
                </Text>
              );
              return (
                // oxlint-disable-next-line react/no-array-index-key -- a word's place in its line is its identity
                <Fragment key={k}>
                  {shown}
                  {on.length > 0 && (
                    <HotkeyTooltip name={on.map((c) => `The picture's “${c.name}” lands on this word, at ${formatReviewClock(c.frame / fps)}`).join(' · ')}>
                      <Text component="span" size="xs" {...planUnquotedAttributes} {...stylex.props(styles.tag)}>{on.map((c) => c.name).join(' · ')}</Text>
                    </HotkeyTooltip>
                  )}
                  {k < words.length - 1 && ' '}
                </Fragment>
              );
            })}
          </Text>
        )}
      <Box {...stylex.props(styles.tools)}>
        <PlanThreadMarks threads={threads} />
        {!editing && <IconButton name="Edit this line" onClick={() => setEditing(true)}><Pencil size={14} /></IconButton>}
      </Box>
    </Box>
  );
}
