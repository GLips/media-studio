import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Split } from 'lucide-react';
import { Fragment, useCallback } from 'react';
import type { ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { decisionLineTextOf } from './decision-about.tsx';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  queue: { display: 'grid', gridTemplateRows: `${spacing.bar} minmax(0, 1fr)`, height: '100%', minHeight: 0 },
  head: { display: 'flex', alignItems: 'center', paddingInline: spacing.inset, color: colors.dim, whiteSpace: 'nowrap' },
  done: { color: colors.pass },
  list: { paddingBlockEnd: spacing.inset },
  scene: { color: colors.dim, paddingInline: spacing.inset, paddingBlockStart: spacing.gap, paddingBlockEnd: spacing.tight },
  row: {
    display: 'flex', alignItems: 'center', gap: spacing.gap, minHeight: spacing.row, paddingInline: spacing.inset,
    borderRadius: radius.control, color: colors.dim,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  here: { color: colors.cream, backgroundColor: colors.raised },
  // One width for both glyphs, so the rows' words line up down the queue.
  glyph: { display: 'inline-flex', justifyContent: 'center', flexShrink: 0, width: spacing.inset },
  open: { color: colors.caution },
  closed: { color: colors.pass },
  words: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/** A decision's state, as the dashboard marks it: an open one waits on you (`caution`), a signed-off one is done. */
function DecisionStateGlyph({ state }: { readonly state: ReviewDecision['state'] }) {
  return state === 'open'
    ? <Text component="span" size="sm" {...stylex.props(styles.glyph, styles.open)}><Split size={12} /></Text>
    : <Text component="span" size="sm" {...stylex.props(styles.glyph, styles.closed)}>✓</Text>;
}

/**
 * The pass grouped by scene, in the order the scenes first come, each under its scene's name. Grouped, not split into
 * runs: decisions about a scene since cut sort last with those about none, by posting order, and would interleave.
 */
function sceneRunsOf(decisions: readonly ReviewDecision[]): { scene: string | undefined; decisions: ReviewDecision[] }[] {
  const runs = new Map<string | undefined, ReviewDecision[]>();
  for (const d of decisions) runs.set(d.about?.scene, [...(runs.get(d.about?.scene) ?? []), d]);
  return [...runs].map(([scene, run]) => ({ scene, decisions: run }));
}

/**
 * The queue beside the candidates: the pass in story order under its scenes' names, each row the line it's about (or
 * its question), `3 of 12 · 9 open` above. A row opens its decision; `↑` `↓` step through them, and signing off opens
 * the next open one.
 */
export function DecisionQueue() {
  const { pass, topic, openDecision } = useDecisionScreen();
  const at = pass.decisions.findIndex((d) => d.topic === topic);
  const open = pass.decisions.filter((d) => d.state === 'open').length;
  // The queue mounts with each decision, so the one on show is brought into view as its row first appears. Stable, so
  // a re-render (the pulse's, every second) doesn't scroll back a list the reviewer moved.
  const here = useCallback((row: HTMLButtonElement | null) => {
    row?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <Box {...stylex.props(styles.queue)}>
      <Text size="sm" {...stylex.props(styles.head)}>
        {at + 1} of {pass.decisions.length} ·{' '}
        {open > 0 ? `${open} open` : <Text component="span" inherit {...stylex.props(styles.done)}>all signed off</Text>}
      </Text>
      <FadeScroll>
        <Stack gap={0} {...stylex.props(styles.list)}>
          {/* Shown once in story order, so the list doesn't jump from posting order as the storyboard loads. */}
          {pass.ordered && sceneRunsOf(pass.decisions).map((run) => (
            <Fragment key={run.decisions[0].id}>
              <Text component="h3" size="sm" {...stylex.props(styles.scene)}>{run.scene ?? 'no scene'}</Text>
              {run.decisions.map((d) => {
                const line = decisionLineTextOf(pass.scenes, d);
                const shown = d.topic === topic;
                return (
                  <HotkeyTooltip key={d.id} name={d.question}>
                    <UnstyledButton
                      ref={shown ? here : undefined} aria-current={shown || undefined} onClick={() => openDecision(d.topic)}
                      {...stylex.props(styles.row, shown && styles.here)}
                    >
                      <DecisionStateGlyph state={d.state} />
                      <Text component="span" size="sm" {...stylex.props(styles.words)}>{line ?? d.question}</Text>
                    </UnstyledButton>
                  </HotkeyTooltip>
                );
              })}
            </Fragment>
          ))}
        </Stack>
      </FadeScroll>
    </Box>
  );
}
