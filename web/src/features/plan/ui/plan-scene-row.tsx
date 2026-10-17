import { Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatReviewPlanNoteWhere } from '#lib/output/review/models/review-plan.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { REVIEW_THREAD_TONES, reviewThreadTone, type ReviewThread } from '#lib/output/review/models/review-threads.ts';
import type { StoryboardScene } from '#lib/timing/storyboard/models/storyboard.ts';
import { formatStudioClock } from '#web/shared/ui/agent-presence.tsx';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { PlanLine } from './plan-line.tsx';
import { PlanInline } from './plan-inline.tsx';
import { planThreadMarkOf, type PlanPlacedThread } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { PlanTargetBox } from './plan-target-box.tsx';
import { PlanThreadMarks } from './plan-thread-marks.tsx';
import { formatPlanSeconds, type PlanScene } from './plan-timing.ts';

/**
 * The table's columns, shared with its head row: the scene, its lines, then its row's cells. A style, not a constant,
 * since StyleX compiles each file's styles alone and can't read an imported value.
 */
export const planSceneColumnStyles = stylex.create({
  columns: {
    display: 'grid', columnGap: spacing.inset,
    gridTemplateColumns: 'minmax(132px, 0.55fr) minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.8fr)',
  },
});

const styles = stylex.create({
  row: {
    rowGap: spacing.gap,
    paddingBlock: spacing.inset, paddingInlineEnd: spacing.inset, paddingInlineStart: spacing.gap,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
    borderLeftWidth: spacing.hairline, borderLeftStyle: 'solid', borderLeftColor: 'transparent',
  },
  focused: { borderLeftColor: colors.cream },
  meta: { display: 'flex', flexDirection: 'column', gap: spacing.tight, alignItems: 'flex-start', minWidth: 0 },
  name: { display: 'flex', alignItems: 'baseline', gap: spacing.gap, paddingInline: spacing.tight, minWidth: 0 },
  n: { fontFamily: fonts.mono, color: colors.dim },
  id: { color: colors.cream, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  facts: { display: 'flex', flexDirection: 'column', paddingInline: spacing.tight },
  cell: { color: colors.cream, padding: spacing.tight, overflowWrap: 'anywhere' },
  cellMarks: { float: 'right' },
  dim: { color: colors.dim },
  reads: { margin: 0, paddingInlineStart: spacing.inset, display: 'flex', flexDirection: 'column', gap: spacing.tight },
  sceneCues: { display: 'flex', flexWrap: 'wrap', columnGap: spacing.gap, paddingInline: spacing.tight, paddingTop: spacing.tight },
  sceneCue: { fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.dim, whiteSpace: 'nowrap', cursor: 'default' },
  sceneCueGlyph: { color: colors.cobalt },
  under: { gridColumn: '2 / -1', display: 'flex', flexDirection: 'column', gap: spacing.tight, minWidth: 0 },
  diagnostic: { color: colors.danger, paddingInline: spacing.tight, overflowWrap: 'anywhere' },
  note: {
    display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr) auto', columnGap: spacing.gap, alignItems: 'baseline', width: '100%',
    paddingInline: spacing.tight, height: spacing.rowDense, borderRadius: radius.control, textAlign: 'start', textDecoration: 'none',
    color: colors.cream, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  noteText: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  noteWhere: { color: colors.dim, whiteSpace: 'nowrap', maxWidth: '28ch', overflow: 'hidden', textOverflow: 'ellipsis' },
  accent: { color: colors.accent },
  pass: { color: colors.pass },
  caution: { color: colors.caution },
  signOff: { color: colors.cream, backgroundColor: { default: colors.accent, ':disabled': colors.raised }, borderWidth: 0, borderRadius: radius.control },
  again: { color: colors.caution, backgroundColor: 'transparent', borderWidth: '1px', borderStyle: 'solid', borderColor: colors.caution, borderRadius: radius.control },
  signed: { color: colors.pass, fontWeight: 600, cursor: 'default', whiteSpace: 'nowrap', paddingInline: spacing.tight },
  link: {
    color: { default: colors.dim, ':hover': colors.cream }, paddingInline: spacing.tight, borderRadius: radius.control,
    textDecoration: 'none', whiteSpace: 'nowrap', backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
});

/** How the scene's length is set, where no lines say it: its beats or its seconds. */
function drivenBy(row: StoryboardScene): string {
  if (row.beats !== undefined) return `${row.beats} beats`;
  if (row.seconds !== undefined) return `${row.seconds} s, fixed`;
  return '';
}

/** The scene's sign-off: Sign off, Sign off again once it changed, `✓ signed`, or nothing to sign while the plan doesn't time. */
function PlanSceneSignOff({ scene }: { readonly scene: string }) {
  const { signoffs, signOff, threads } = usePlanScreen();
  const signoff = signoffs.get(scene);
  const open = (threads ?? []).filter((t) => t.plan.scene === scene && reviewThreadTone(t) === 'open').length;
  const openNote = open > 0 ? ` · ${open} open` : '';
  switch (signoff?.state) {
    case 'signed': return (
      <HotkeyTooltip name={`signed off ${signoff.at ? formatStudioClock(signoff.at) : ''}`}>
        <Text component="span" size="sm" {...stylex.props(styles.signed)}>✓ signed</Text>
      </HotkeyTooltip>
    );
    case 'stale': return (
      <HotkeyTooltip name={`changed since signed off${signoff.at ? ` ${formatStudioClock(signoff.at)}` : ''}${openNote}`} hotkey="Sign off scene">
        <Button size="compact-xs" onClick={() => signOff(scene)} {...stylex.props(styles.again)}>Sign off again</Button>
      </HotkeyTooltip>
    );
    case 'unknown': return (
      <HotkeyTooltip name="The plan doesn't time, so a sign-off couldn't say what it covers">
        <Group component="span"><Button size="compact-xs" disabled {...stylex.props(styles.signOff)}>Sign off</Button></Group>
      </HotkeyTooltip>
    );
    default: return (
      <HotkeyTooltip name={`Sign off this scene${openNote}`} hotkey="Sign off scene">
        <Button size="compact-xs" onClick={() => signOff(scene)} {...stylex.props(styles.signOff)}>Sign off{open > 0 && ` ●${open}`}</Button>
      </HotkeyTooltip>
    );
  }
}

/** The scene's notes under its row: the plan's, which open in the thread, and the video review's, which open there. */
function PlanSceneNotes({ scene, threads, videoNotes }: { readonly scene: string; readonly threads: readonly PlanPlacedThread[]; readonly videoNotes: readonly ReviewThread[] }) {
  const { project, render, setSearch } = usePlanScreen();
  const shown = threads.filter((t) => t.state !== 'resolved');
  return (
    <Stack gap={0}>
      {shown.map((thread) => {
        const mark = planThreadMarkOf(thread);
        return (
          <UnstyledButton key={thread.id} onClick={() => setSearch({ note: thread.id, scene })} {...stylex.props(styles.note)}>
            <Text component="span" size="sm" {...stylex.props(styles[mark.tone === 'dim' ? 'dim' : mark.tone])}>{mark.glyph}</Text>
            <Readout>#{thread.id}</Readout>
            <Text component="span" size="sm" {...stylex.props(styles.noteText)}>{thread.entries[0].text}</Text>
            <Text component="span" size="sm" {...stylex.props(styles.noteWhere)}>{formatReviewPlanNoteWhere(thread.anchor, { short: true })}</Text>
          </UnstyledButton>
        );
      })}
      {videoNotes.map((thread) => {
        const tone = reviewThreadTone(thread), glyph = REVIEW_THREAD_TONES[tone].glyph;
        const path = thread.anchor.on === 'video' ? thread.anchor.writtenOn.path : render?.path ?? '';
        return (
          <HotkeyTooltip key={thread.id} name={`a note on ${path}, read-only here: open it in the video review`}>
            <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: render?.path ?? path }} search={{ note: thread.id }} underline="never" {...stylex.props(styles.note)}>
              <Text component="span" size="sm" {...stylex.props(styles.dim)}>{glyph}</Text>
              <Readout>#{thread.id}</Readout>
              <Text component="span" size="sm" {...stylex.props(styles.noteText, styles.dim)}>{thread.entries[0].text}</Text>
              <Text component="span" size="sm" {...stylex.props(styles.noteWhere)}>video ↗</Text>
            </AnchorLink>
          </HotkeyTooltip>
        );
      })}
    </Stack>
  );
}

/**
 * A scene's row: its number, id, span and length with its sign-off and its moment in the video review; its lines; what's
 * on screen, the motion and what it reads as, each a cell a note can quote; then its diagnostics and its notes.
 */
export function PlanSceneRow({ id, n, timed }: { readonly id: string; readonly n: number; readonly timed: PlanScene | null }) {
  const { project, plan, timing, threads, videoNotes, render, focusedScene, setSearch, playback } = usePlanScreen();
  const row = plan.storyboard.scenes[id];
  const fps = timing?.fps ?? 1;
  const onScene = (threads ?? []).filter((t) => !t.plan.unplaced && t.plan.scene === id);
  const onField = (field: string) => onScene.filter((t) => t.anchor.field === field);
  const diagnostics = plan.resolved.diagnostics.filter((d) => d.scene === id);
  const moment = render?.artifact?.timing?.scenes.find((s) => s.id === id);
  const sceneCues = timed?.cues.filter((c) => c.word === null) ?? [];
  const video = videoNotes.get(id) ?? [];
  return (
    <Box data-plan-scene={id} onClick={() => focusedScene !== id && setSearch({ scene: id })} {...stylex.props(planSceneColumnStyles.columns, styles.row, focusedScene === id && styles.focused)}>
      <Box {...stylex.props(styles.meta)}>
        <PlanTargetBox target={{ field: 'scene', scene: id }}>
          <Box {...stylex.props(styles.name)}>
            <Text component="span" size="xs" {...stylex.props(styles.n)}>{n}</Text>
            <Text component="span" size="md" {...stylex.props(styles.id)}>{id}</Text>
            <PlanThreadMarks threads={onField('scene')} />
          </Box>
        </PlanTargetBox>
        {timed && (
          <Box {...stylex.props(styles.facts)}>
            <Readout>{formatReviewClock(timed.from / fps)}–{formatReviewClock(timed.to / fps)}</Readout>
            <Readout bright>{formatPlanSeconds((timed.to - timed.from) / fps)}</Readout>
          </Box>
        )}
        <PlanSceneSignOff scene={id} />
        {render && moment && (
          <HotkeyTooltip name={`this scene in ${render.path}`}>
            <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: render.path }} search={{ f: Math.max(0, moment.from) }} underline="never" {...stylex.props(styles.link)}>
              <Text component="span" size="sm" inherit>{formatReviewClock(Math.max(0, moment.from) / (render.artifact?.fps ?? fps))} in video ↗</Text>
            </AnchorLink>
          </HotkeyTooltip>
        )}
      </Box>
      <Box>
        {Object.keys(row.lines ?? {}).map((line) => (
          <PlanLine key={line} scene={id} id={line} timed={timed?.lines.find((l) => l.id === line) ?? null} cues={timed?.cues ?? []}
            threads={onField('line').filter((t) => t.plan.line === line)} />
        ))}
        {!row.lines && <Text size="md" {...stylex.props(styles.cell, styles.dim)}>{drivenBy(row)}</Text>}
        {sceneCues.length > 0 && (
          <Box {...stylex.props(styles.sceneCues)}>
            {sceneCues.map((cue) => (
              <UnstyledButton key={cue.name} aria-label={`Play from ${cue.name}`} onClick={() => playback.seek(cue.frame)} {...stylex.props(styles.sceneCue)}>
                <Text component="span" size="xs"><Text component="span" inherit {...stylex.props(styles.sceneCueGlyph)}>◆</Text> {cue.name} {formatReviewClock(cue.frame / fps)}</Text>
              </UnstyledButton>
            ))}
          </Box>
        )}
      </Box>
      <PlanTargetBox target={{ field: 'onScreen', scene: id }}>
        <Text component="div" size="md" {...stylex.props(styles.cell)}><Box component="span" {...stylex.props(styles.cellMarks)}><PlanThreadMarks threads={onField('onScreen')} /></Box><PlanInline text={row.onScreen} /></Text>
      </PlanTargetBox>
      <PlanTargetBox target={{ field: 'motion', scene: id }}>
        <Text component="div" size="md" {...stylex.props(styles.cell)}><Box component="span" {...stylex.props(styles.cellMarks)}><PlanThreadMarks threads={onField('motion')} /></Box><PlanInline text={row.motion} /></Text>
      </PlanTargetBox>
      <PlanTargetBox target={{ field: 'reads', scene: id }}>
        <Text component="div" size="md" {...stylex.props(styles.cell)}>
          <Box component="span" {...stylex.props(styles.cellMarks)}><PlanThreadMarks threads={onField('reads')} /></Box>
          {row.reads?.length
            ? row.reads.map((read) => <Text key={read} component="p" size="md" inherit><PlanInline text={read} /></Text>)
            : <Text component="span" inherit {...stylex.props(styles.dim)}>—</Text>}
        </Text>
      </PlanTargetBox>
      {(diagnostics.length > 0 || onScene.some((t) => t.state !== 'resolved') || video.length > 0) && (
        <Box {...stylex.props(styles.under)}>
          {diagnostics.map((d) => (
            <Text key={d.message} size="sm" {...stylex.props(styles.diagnostic)}>⚠ {[d.line, d.cue && `cue ${d.cue}`].filter(Boolean).join(' · ')}{(d.line || d.cue) && ': '}{d.message}</Text>
          ))}
          <PlanSceneNotes scene={id} threads={onScene} videoNotes={video} />
        </Box>
      )}
    </Box>
  );
}
