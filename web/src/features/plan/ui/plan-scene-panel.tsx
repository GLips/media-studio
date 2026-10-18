import { Box, Button, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Check, ChevronLeft, ChevronRight, MessageSquarePlus } from 'lucide-react';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import type { StoryboardScene, StoryboardSceneCue } from '#lib/timing/storyboard/models/storyboard.ts';
import { ReviewThreadKindIcon } from '#web/features/review/index.ts';
import { formatStudioClock } from '#web/shared/ui/agent-presence.tsx';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { StudioInline } from '#web/shared/ui/studio-inline.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { PlanEditableText } from './plan-editable-text.tsx';
import { PlanLine } from './plan-line.tsx';
import { planSceneOpenNoteCount, planTargetAttributes, type PlanPlacedThread, type PlanTarget } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { usePlanStartNote } from './plan-selection-comment.tsx';
import { PlanThreadMarks } from './plan-thread-marks.tsx';
import { formatPlanSeconds, planSceneTitle, type PlanCue, type PlanScene } from './plan-timing.ts';
import { PlanSceneChanges } from './plan-word-diff.tsx';

const styles = stylex.create({
  panel: {
    minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column',
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
  body: { padding: spacing.row, display: 'flex', flexDirection: 'column', gap: spacing.row },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.inset },
  where: { display: 'flex', alignItems: 'center', gap: spacing.tight, color: colors.dim, flexShrink: 0 },
  mono: { fontFamily: fonts.mono },
  title: { fontWeight: 900, color: colors.cream, margin: 0 },
  lines: { display: 'flex', flexDirection: 'column' },
  driven: { color: colors.dim },
  field: { display: 'flex', flexDirection: 'column', gap: spacing.tight },
  label: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: colors.dim },
  value: { color: colors.cream },
  read: { margin: 0 },
  timed: { display: 'flex', flexDirection: 'column', gap: spacing.tight },
  timedRow: {
    display: 'grid', gridTemplateColumns: '64px max-content minmax(0, 1fr)', columnGap: spacing.inset, alignItems: 'baseline',
    textAlign: 'start', paddingBlock: spacing.hairline, borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  timedName: { color: colors.cream, fontWeight: 600 },
  timedHow: { color: colors.dim },
  problem: { color: colors.danger },
  changes: { display: 'flex', flexDirection: 'column', gap: spacing.tight, padding: spacing.inset, borderRadius: radius.control, backgroundColor: colors.panel },
  changesHead: { color: colors.caution },
  foot: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.gap, paddingBlock: spacing.inset, paddingInline: spacing.row,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
  },
  approve: { color: colors.cream, backgroundColor: colors.accent },
  approveAgain: { color: colors.ground, backgroundColor: colors.caution },
  approved: { color: colors.pass, display: 'flex', alignItems: 'center', gap: spacing.tight, fontWeight: 600 },
  undo: { color: colors.dim, textDecorationLine: 'underline', textUnderlineOffset: '3px' },
  armed: { color: colors.caution },
  videoNote: {
    display: 'flex', alignItems: 'center', gap: spacing.gap, color: colors.dim, textDecoration: 'none',
    paddingBlock: spacing.hairline, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
});

/** How the scene's length is set, where no lines say it. */
function planDrivenBy(row: StoryboardScene): string {
  if (row.beats !== undefined) return `${row.beats} beats on the music, no lines.`;
  if (row.seconds !== undefined) return `${row.seconds} seconds, no lines.`;
  return '';
}

/** What times a cue that isn't on a word, in words: `8 frames after shutter`, `0.4 s into the scene`, `at the end`. */
export function planCueTimedBy(cue: StoryboardSceneCue | undefined, beats: boolean): string {
  const unit = (n: number) => (beats ? `beat ${n}` : `${n} s into the scene`);
  if (cue === undefined) return '';
  if (typeof cue === 'number') return unit(cue);
  if (cue === 'end') return 'at the scene’s end';
  const frames = 'frames' in cue && cue.frames ? `${cue.frames} frames ` : '';
  if ('after' in cue) return `${frames}after ${cue.after}`;
  if ('at' in cue) return `${frames}${frames ? 'after ' : ''}${cue.at === 'end' ? 'the scene’s end' : unit(cue.at)}`;
  return '';
}

/** A field of the scene's row: its label, a comment button, and its text, edited in place. */
function PlanSceneField({ label, target, threads, children }: { readonly label: string; readonly target: PlanTarget; readonly threads: readonly PlanPlacedThread[]; readonly children: React.ReactNode }) {
  const startNote = usePlanStartNote();
  return (
    <Box {...planTargetAttributes(target)} {...stylex.props(styles.field)}>
      <Box fz="sm" {...stylex.props(styles.label)}>
        <Text component="span" inherit>{label}</Text>
        <Group gap="tight" wrap="nowrap">
          <PlanThreadMarks threads={threads} />
          <IconButton name={`Comment on ${label.toLowerCase()}`} onClick={() => startNote(target, null)}><MessageSquarePlus size={14} /></IconButton>
        </Group>
      </Box>
      <Text component="div" size="prose" {...stylex.props(styles.value)}>{children}</Text>
    </Box>
  );
}

/** The cues not on a word (a beat after another cue, a time into the scene), each with what times it: click to play from it. */
function PlanSceneTimedCues({ scene, row, cues }: { readonly scene: PlanScene; readonly row: StoryboardScene; readonly cues: readonly PlanCue[] }) {
  const { timing, playback } = usePlanScreen();
  if (!cues.length) return null;
  const fps = timing?.fps ?? 30;
  return (
    <Box {...stylex.props(styles.field)}>
      <Text size="sm" {...stylex.props(styles.label)}>Also timed in this scene</Text>
      <Box {...stylex.props(styles.timed)}>
        {cues.map((cue) => (
          <UnstyledButton key={cue.name} onClick={() => playback.seek(cue.frame)} {...stylex.props(styles.timedRow)}>
            <Text component="span" size="xs" {...stylex.props(styles.mono)}>{formatReviewClock(cue.frame / fps)}</Text>
            <Text component="span" size="md" {...stylex.props(styles.timedName)}>{cue.name}</Text>
            <Text component="span" size="md" {...stylex.props(styles.timedHow)}>{planCueTimedBy(row.cues?.[cue.name], row.beats !== undefined) || `${formatPlanSeconds((cue.frame - scene.from) / fps)} into the scene`}</Text>
          </UnstyledButton>
        ))}
      </Box>
    </Box>
  );
}

/** Approve, Approve again once it changed, or Approved with Undo. Approving past open notes is one click; the count says so. */
function PlanSceneApprove({ scene }: { readonly scene: string }) {
  const { signoffs, signOff, takeBack, threads, signOffArmed } = usePlanScreen();
  const signoff = signoffs.get(scene);
  const open = planSceneOpenNoteCount(threads, scene);
  if (signOffArmed?.scene === scene) return <Text component="span" role="status" size="md" {...stylex.props(styles.armed)}>{signOffArmed.open} open {signOffArmed.open === 1 ? 'note' : 'notes'}: press S again to approve anyway</Text>;
  switch (signoff?.state) {
    case 'signed': return (
      <Group gap="inset" wrap="nowrap">
        <HotkeyTooltip name={signoff.at ? `Approved ${formatStudioClock(signoff.at)}` : 'Approved'}>
          <Text component="span" size="md" {...stylex.props(styles.approved)}><Check size={16} /> Approved</Text>
        </HotkeyTooltip>
        <HotkeyTooltip name="Take the approval back" hotkey="Take back sign-off">
          <UnstyledButton fz="sm" onClick={() => takeBack(scene)} {...stylex.props(styles.undo)}>Undo</UnstyledButton>
        </HotkeyTooltip>
      </Group>
    );
    case 'stale': return (
      <HotkeyTooltip name="This scene changed after you approved it: the changes are above" hotkey="Sign off scene">
        <Button onClick={() => signOff(scene)} {...stylex.props(styles.approveAgain)}>Approve the changes</Button>
      </HotkeyTooltip>
    );
    case 'unknown': return <Text component="span" size="md" {...stylex.props(styles.armed)}>Fix the timing problem above to approve.</Text>;
    default: return (
      <HotkeyTooltip name="Approve this scene and go to the next" hotkey="Sign off scene">
        <Button onClick={() => signOff(scene)} leftSection={<Check size={16} />} {...stylex.props(styles.approve)}>
          {open > 0 ? `Approve with ${open} open ${open === 1 ? 'note' : 'notes'}` : 'Approve scene'}
        </Button>
      </HotkeyTooltip>
    );
  }
}

/**
 * The scene under the playhead, ready to read and fix: where it sits, its title, its lines large and lit as they're
 * said, what's on screen, the motion and what it should get across (each edited in place and commentable), its other
 * timed moments, any timing problem, what changed since it was approved, and Approve.
 */
export function PlanScenePanel() {
  const { project, plan, timing, threads, videoNotes, render, focusedScene, signoffs, playback, setSearch } = usePlanScreen();
  const ids = Object.keys(plan.storyboard.scenes);
  const id = focusedScene ?? ids[0];
  const row = id === undefined ? undefined : plan.storyboard.scenes[id];
  if (id === undefined || !row) return <Box {...stylex.props(styles.panel)} />;
  const placed = timing?.scenes.find((s) => s.id === id) ?? null;
  const at = ids.indexOf(id);
  const go = (by: -1 | 1) => {
    const next = ids[at + by];
    if (next === undefined) return;
    setSearch({ scene: next });
    const scene = timing?.scenes.find((s) => s.id === next);
    if (scene) playback.seek(scene.from);
  };
  const onScene = (threads ?? []).filter((t) => !t.plan.unplaced && t.plan.scene === id);
  const onField = (field: string) => onScene.filter((t) => t.anchor.field === field);
  const diagnostics = plan.resolved.diagnostics.filter((d) => d.scene === id);
  const signoff = signoffs.get(id);
  const fps = timing?.fps ?? 30;
  const sceneCues = placed?.cues.filter((c) => c.word === null) ?? [];
  const video = videoNotes.get(id) ?? [];
  return (
    <Box component="aside" aria-label={`Scene ${at + 1}`} data-plan-scene={id} {...stylex.props(styles.panel)}>
      <FadeScroll>
        <Box {...stylex.props(styles.body)}>
          <Box {...stylex.props(styles.head)}>
            <Box {...planTargetAttributes({ field: 'scene', scene: id })}>
              <Text component="h2" size="heading" {...stylex.props(styles.title)}>{planSceneTitle(id)}</Text>
            </Box>
            <Box {...stylex.props(styles.where)}>
              {placed && (
                <HotkeyTooltip name={`Scene ${at + 1} of ${ids.length}, ${formatReviewClock(placed.from / fps)} to ${formatReviewClock(placed.to / fps)}`}>
                  <Text component="span" size="xs" {...stylex.props(styles.mono)}>{formatReviewClock(placed.from / fps)} · {formatPlanSeconds((placed.to - placed.from) / fps)}</Text>
                </HotkeyTooltip>
              )}
              <IconButton name="Previous scene" hotkey="Previous scene" onClick={() => go(-1)} disabled={at === 0}><ChevronLeft size={16} /></IconButton>
              <IconButton name="Next scene" hotkey="Next scene" onClick={() => go(1)} disabled={at === ids.length - 1}><ChevronRight size={16} /></IconButton>
            </Box>
          </Box>
          {diagnostics.map((d) => (
            <Text key={d.message} size="md" {...stylex.props(styles.problem)}>{[d.line && `Line ${d.line}`, d.cue && `Cue ${d.cue}`].filter(Boolean).join(', ')}{(d.line || d.cue) && ': '}{d.message}</Text>
          ))}
          {signoff?.state === 'stale' && (
            <Box {...stylex.props(styles.changes)}>
              <Text component="span" size="md" {...stylex.props(styles.changesHead)}>Changed since you approved it</Text>
              <PlanSceneChanges changes={signoff.changes ?? []} />
            </Box>
          )}
          <Box {...stylex.props(styles.lines)}>
            {Object.keys(row.lines ?? {}).map((line) => (
              <PlanLine key={line} scene={id} id={line} timed={placed?.lines.find((l) => l.id === line) ?? null} cues={placed?.cues ?? []}
                threads={onField('line').filter((t) => t.plan.line === line)} />
            ))}
            {!row.lines && <Text size="prose" {...stylex.props(styles.driven)}>{planDrivenBy(row)}</Text>}
          </Box>
          <PlanSceneField label="On screen" target={{ field: 'onScreen', scene: id }} threads={onField('onScreen')}>
            <PlanEditableText value={row.onScreen} target={{ field: 'onScreen', scene: id }} multiline><StudioInline text={row.onScreen} /></PlanEditableText>
          </PlanSceneField>
          <PlanSceneField label="Motion" target={{ field: 'motion', scene: id }} threads={onField('motion')}>
            <PlanEditableText value={row.motion} target={{ field: 'motion', scene: id }} multiline><StudioInline text={row.motion} /></PlanEditableText>
          </PlanSceneField>
          {(row.reads ?? []).length > 0 && (
            <PlanSceneField label="What the viewer should get" target={{ field: 'reads', scene: id }} threads={onField('reads')}>
              {(row.reads ?? []).map((read, index) => (
                <PlanEditableText key={read} value={read} target={{ field: 'reads', scene: id, index }} multiline>
                  <Text component="p" inherit {...stylex.props(styles.read)}><StudioInline text={read} /></Text>
                </PlanEditableText>
              ))}
            </PlanSceneField>
          )}
          {placed && <PlanSceneTimedCues scene={placed} row={row} cues={sceneCues} />}
          {video.length > 0 && render && (
            <Box {...stylex.props(styles.field)}>
              <Text size="sm" {...stylex.props(styles.label)}>Notes on the video in this scene</Text>
              {video.map((thread) => (
                <AnchorLink key={thread.id} to="/projects/$project/artifacts/$" params={{ project, _splat: render.path }} search={{ note: thread.id }} underline="never" fz="md" {...stylex.props(styles.videoNote)}>
                  <ReviewThreadKindIcon kind={thread.kind} size={14} />
                  <Text component="span" inherit>{thread.entries[0].text}</Text>
                </AnchorLink>
              ))}
            </Box>
          )}
        </Box>
      </FadeScroll>
      <Box {...stylex.props(styles.foot)}>
        <PlanSceneApprove scene={id} />
      </Box>
    </Box>
  );
}
