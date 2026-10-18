import { Box, Code, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { ReviewThreadSplit } from '#web/features/review/index.ts';
import { useProjectStoryboard, type ProjectStoryboard } from '#web/features/storyboard/index.ts';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';
import { PlanBriefDrawer } from './plan-brief.tsx';
import { PlanHeader } from './plan-header.tsx';
import { PlanScenePanel } from './plan-scene-panel.tsx';
import { PlanSceneStrip } from './plan-scene-strip.tsx';
import { PlanScreenProvider, type PlanScreenValue } from './plan-screen-context.tsx';
import { PlanSelectionComment } from './plan-selection-comment.tsx';
import { PlanStage } from './plan-stage.tsx';
import { PlanThread } from './plan-thread.tsx';
import { planSceneIndexAt } from './plan-timing.ts';
import { usePlanHotkeys } from './use-plan-hotkeys.ts';
import { usePlanScreenValue } from './use-plan-screen-value.ts';

const styles = stylex.create({
  body: { display: 'grid', height: '100%', minHeight: 0, gridTemplateRows: 'auto minmax(0, 1fr) auto' },
  main: { display: 'grid', minHeight: 0, gridTemplateColumns: 'minmax(0, 1fr) minmax(440px, 560px)' },
  problems: { paddingBlock: spacing.gap, paddingInline: spacing.inset, display: 'flex', flexDirection: 'column', gap: spacing.tight },
  problem: {
    color: colors.danger, fontFamily: fonts.mono,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  },
  crumb: { color: colors.cream, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  quiet: { padding: spacing.inset, color: colors.dim, maxWidth: '72ch' },
});

/** Opening a note (its mark, the questions button, the thread) brings its scene into the panel and its words under the playhead. */
function usePlanNoteFocus({ search, threads, playback, setSearch }: PlanScreenValue) {
  const sought = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (search.note === undefined) sought.current = undefined;
    if (search.note === undefined || search.note === sought.current) return;
    const thread = threads?.find((t) => t.id === search.note);
    if (!thread) return;
    sought.current = search.note;
    if ('frame' in thread.placement) playback.seek(thread.placement.frame);
    const scene = thread.plan.scene;
    if (scene !== null && scene !== search.scene) setSearch({ scene });
  }, [search.note, search.scene, threads, playback, setSearch]);
}

/** While playing, the scene panel follows the playhead. */
function usePlanSceneFollow({ playback, timing, focusedScene, setSearch }: PlanScreenValue) {
  useEffect(() => {
    if (!timing) return undefined;
    return playback.onTick((frame) => {
      if (!playback.getState().playing) return;
      const scene = timing.scenes[planSceneIndexAt(timing.scenes, frame)]?.id;
      if (scene !== undefined && scene !== focusedScene) setSearch({ scene });
    });
  }, [playback, timing, focusedScene, setSearch]);
}

function PlanScreenBody({ project, plan, error }: { readonly project: string; readonly plan: ProjectStoryboard; readonly error: string | null }) {
  const screen = usePlanScreenValue(project, plan);
  const pageRef = useRef<HTMLDivElement>(null);
  const briefRef = useRef<HTMLDivElement>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  usePlanHotkeys(screen, pageRef);
  usePlanNoteFocus(screen);
  usePlanSceneFollow(screen);
  const general = plan.resolved.diagnostics.filter((d) => d.scene === undefined);
  return (
    <PlanScreenProvider value={screen}>
      <StudioShell start={<PlanHeader onOpenBrief={() => setBriefOpen(!briefOpen)} />}>
        <ReviewThreadSplit rootRef={screen.playback.attachRoot} thread={<PlanThread />}>
          <Box ref={pageRef} {...stylex.props(styles.body)}>
            <Box {...stylex.props(styles.problems)}>
              {error !== null && <Text component="pre" size="xs" {...stylex.props(styles.problem)}>storyboard.ts doesn't load, so this is its last version that did:{'\n'}{error}</Text>}
              {general.map((d) => <Text key={d.message} size="xs" {...stylex.props(styles.problem)}>{d.message}</Text>)}
            </Box>
            <Box {...stylex.props(styles.main)}>
              <PlanStage />
              <PlanScenePanel />
            </Box>
            <PlanSceneStrip />
          </Box>
        </ReviewThreadSplit>
        <PlanBriefDrawer opened={briefOpen} onClose={() => setBriefOpen(false)} root={briefRef} />
        <PlanSelectionComment root={pageRef} />
        <PlanSelectionComment root={briefRef} />
      </StudioShell>
    </PlanScreenProvider>
  );
}

const planCrumbOf = (project: string) => <Text component="span" size="sm" {...stylex.props(styles.crumb)}>{project} / plan</Text>;

/**
 * A project's plan, its storyboard.ts, reviewed before anything renders: the video plays on the plan's own clock
 * beside the scene under the playhead, whose text is edited in place and commented on word by word, each scene
 * approved in turn. The storyboard resolves here in the browser and re-times whenever it changes on disk.
 */
export function PlanScreen({ project }: { readonly project: string }) {
  const load = useProjectStoryboard(project);
  switch (load.state) {
    case 'ready': return <PlanScreenBody project={project} plan={load.plan} error={load.error} />;
    case 'none': return (
      <StudioShell start={planCrumbOf(project)}>
        <Text size="md" {...stylex.props(styles.quiet)}>{project} has no plan yet. An agent writes it in storyboard.ts at kickoff, and it shows here as soon as it does.</Text>
      </StudioShell>
    );
    case 'failed': return (
      <StudioShell start={planCrumbOf(project)}>
        <Stack gap="gap" {...stylex.props(styles.problems)}>
          <Text size="md" {...stylex.props(styles.quiet)}>storyboard.ts doesn't load:</Text>
          <Code block {...stylex.props(styles.problem)}>{load.error}</Code>
        </Stack>
      </StudioShell>
    );
    default: return <StudioShell start={planCrumbOf(project)} />;
  }
}
