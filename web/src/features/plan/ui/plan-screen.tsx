import { Box, Code, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, type RefObject } from 'react';
import { ReviewThreadSplit } from '#web/features/review/index.ts';
import { useProjectStoryboard, type ProjectStoryboard } from '#web/features/storyboard/index.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, fonts, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { PlanBrief } from './plan-brief.tsx';
import { PlanHeader } from './plan-header.tsx';
import { PlanLeftOut } from './plan-left-out.tsx';
import { PlanSceneTable } from './plan-scene-table.tsx';
import { PlanScreenProvider, type PlanScreenValue } from './plan-screen-context.tsx';
import { PlanThread } from './plan-thread.tsx';
import { PlanTimingBar } from './plan-timing-bar.tsx';
import { planSceneIndexAt } from './plan-timing.ts';
import { usePlanHotkeys } from './use-plan-hotkeys.ts';
import { usePlanScreenValue } from './use-plan-screen-value.ts';

const styles = stylex.create({
  body: { display: 'grid', height: '100%', minHeight: 0, gridTemplateRows: 'auto minmax(0, 1fr)' },
  page: { paddingBottom: spacing.inset },
  top: { padding: spacing.gap, display: 'flex', flexDirection: 'column', gap: spacing.gap },
  problem: {
    color: colors.danger, fontFamily: fonts.mono, lineHeight: typography.lineHeight,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', paddingInline: spacing.tight,
  },
  crumb: { color: colors.cream, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  project: { color: colors.dim },
  quiet: { padding: spacing.inset, color: colors.dim, maxWidth: '72ch' },
});

/**
 * Opening a note, from its mark, its row under a scene or the thread, brings its scene into focus and view and the
 * playhead to its words. Once per opening: the review's polls don't pull the page back.
 */
function usePlanNoteFocus(screen: PlanScreenValue, body: RefObject<HTMLElement | null>) {
  const { search, threads, playback, setSearch } = screen;
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
    const at = scene === null ? null : body.current?.querySelector(`[data-plan-scene="${CSS.escape(scene)}"]`);
    at?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [search.note, search.scene, threads, playback, setSearch, body]);
}

/** While playing, the scene in focus follows the playhead, so `S` and the cream rule are on the scene being heard. */
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
  const bodyRef = useRef<HTMLDivElement>(null);
  usePlanHotkeys(screen, bodyRef);
  usePlanNoteFocus(screen, bodyRef);
  usePlanSceneFollow(screen);
  const general = plan.resolved.diagnostics.filter((d) => d.scene === undefined);
  return (
    <PlanScreenProvider value={screen}>
      <StudioShell start={<PlanHeader />}>
        <ReviewThreadSplit rootRef={screen.playback.attachRoot} thread={<PlanThread />}>
          <Box {...stylex.props(styles.body)}>
            <PlanTimingBar />
            <FadeScroll viewportRef={bodyRef}>
              <Box {...stylex.props(styles.page)}>
                {(error !== null || general.length > 0) && (
                  <Stack gap="tight" {...stylex.props(styles.top)}>
                    {error !== null && <Text component="pre" size="xs" {...stylex.props(styles.problem)}>storyboard.ts doesn't load, so this is its last version that did:{'\n'}{error}</Text>}
                    {general.map((d) => <Text key={d.message} size="xs" {...stylex.props(styles.problem)}>⚠ {d.message}</Text>)}
                  </Stack>
                )}
                <Box {...stylex.props(styles.top)}><PlanBrief /></Box>
                <PlanSceneTable />
                <PlanLeftOut />
              </Box>
            </FadeScroll>
          </Box>
        </ReviewThreadSplit>
      </StudioShell>
    </PlanScreenProvider>
  );
}

/** The bar's crumb where there's no plan to head it. */
const planCrumbOf = (project: string) => (
  <Text component="span" size="sm" {...stylex.props(styles.crumb)}><Text component="span" inherit {...stylex.props(styles.project)}>{project} / </Text>plan</Text>
);

/**
 * A project's plan, its storyboard.ts as one timed page read before anything renders: the brief, the whole video to
 * scale, a row per scene with its lines and cells, and the left-out list; notes on any of it and a sign-off per scene.
 * The storyboard is imported and resolved here in the browser and re-timed whenever it changes on disk.
 */
export function PlanScreen({ project }: { readonly project: string }) {
  const load = useProjectStoryboard(project);
  switch (load.state) {
    case 'ready': return <PlanScreenBody project={project} plan={load.plan} error={load.error} />;
    case 'none': return (
      <StudioShell start={planCrumbOf(project)}>
        <Text size="md" {...stylex.props(styles.quiet)}>{project} has no storyboard.ts yet: its plan is written there, at the kickoff's scene-table step, and shows here once it is.</Text>
      </StudioShell>
    );
    case 'failed': return (
      <StudioShell start={planCrumbOf(project)}>
        <Stack gap="gap" {...stylex.props(styles.top)}>
          <Text size="md" {...stylex.props(styles.quiet)}>storyboard.ts doesn't load:</Text>
          <Code block {...stylex.props(styles.problem)}>{load.error}</Code>
        </Stack>
      </StudioShell>
    );
    default: return <StudioShell start={planCrumbOf(project)} />;
  }
}
