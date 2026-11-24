import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Inbox, Library } from 'lucide-react';
import { Fragment, Suspense, useState, type ReactNode } from 'react';
import { StudioSidebarBody, StudioSidebarFrame, StudioSidebarLink, StudioSidebarSection } from '#web/shared/ui/studio-sidebar.tsx';
import { TextInput } from '#web/shared/ui/text-input.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectDateSplitOf, projectMonthLabelOf } from './project-name.tsx';
import { projectsRenderedFirst, useProjectsAwaiting, type ProjectAwaiting } from './use-projects-awaiting.ts';

const ICON_SIZE = 14;

/** The sidebar's project filter, which the index's `/` focuses (projects-dashboard-page.tsx). */
export const STUDIO_PROJECT_FILTER_ID = 'studio-project-filter';

const styles = stylex.create({
  filter: { paddingInline: spacing.gap, paddingBlockEnd: spacing.tight },
  // Outlined on the sidebar's panel, not filled: a filled box reads as a second surface stacked on it.
  filterInput: { backgroundColor: 'transparent', borderColor: colors.line, color: colors.cream },
  none: { paddingInline: spacing.gap, paddingBlock: spacing.tight, color: colors.dim },
});

/** The filter as last typed, kept as the reader moves between sidebar pages, each of which mounts its own sidebar. */
const sidebarFilter = { text: '' };

const projectMatchesFilter = (project: string, filter: string) => project.toLowerCase().includes(filter.trim().toLowerCase());

/** A month's projects in the sidebar; `month` is null for the names with no date, listed last. */
type ProjectMonthGroup = { month: string | null; projects: ProjectAwaiting[] };

/** Projects by the month their name opens with, newest first and undated last, each keeping the order it was given. */
function projectMonthGroupsOf(projects: readonly ProjectAwaiting[]): ProjectMonthGroup[] {
  const byMonth = new Map<string | null, ProjectAwaiting[]>();
  for (const project of projects) {
    const { month } = projectDateSplitOf(project.summary.project);
    byMonth.set(month, [...(byMonth.get(month) ?? []), project]);
  }
  return [...byMonth]
    .map(([month, inMonth]) => ({ month, projects: inMonth }))
    .toSorted((a, b) => (b.month ?? '').localeCompare(a.month ?? ''));
}

type StudioSidebarProps = { readonly projects: readonly ProjectAwaiting[] };

/**
 * Awaiting you with its count, the library, then every project with what waits in it under its month, narrowed by the
 * filter, which matches the whole name. The projects are listed once they load; until then the first two stand alone.
 */
function StudioSidebar({ projects }: StudioSidebarProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const [filter, setFilterState] = useState(sidebarFilter.text);
  const setFilter = (text: string) => {
    sidebarFilter.text = text;
    setFilterState(text);
  };
  const waiting = projects.reduce((sum, project) => sum + project.waiting, 0);
  const shown = projectMonthGroupsOf(projectsRenderedFirst(projects).filter(({ summary }) => projectMatchesFilter(summary.project, filter)));
  const head = (
    <>
      <StudioSidebarLink to="/" icon={<Inbox size={ICON_SIZE} />} label="Awaiting you" waiting={waiting} current={pathname === '/'} />
      <StudioSidebarLink to="/library" icon={<Library size={ICON_SIZE} />} label="Library" current={pathname.replace(/\/$/, '') === '/library'} />
      {projects.length > 0 && (
        <>
          <StudioSidebarSection count={projects.length}>Projects</StudioSidebarSection>
          <TextInput
            id={STUDIO_PROJECT_FILTER_ID}
            size="xs"
            aria-label="Filter projects"
            placeholder="Filter projects"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            onKeyDown={(event) => {
              const first = shown[0]?.projects[0];
              if (event.key === 'Enter' && first) void navigate({ to: '/projects/$project', params: { project: first.summary.project } });
              else if (event.key === 'Escape') {
                setFilter('');
                event.currentTarget.blur();
              }
            }}
            classNames={{ input: stylex.props(styles.filterInput).className }}
            {...stylex.props(styles.filter)}
          />
        </>
      )}
    </>
  );
  const list = (
    <>
      {shown.map(({ month, projects: inMonth }) => (
        <Fragment key={month ?? 'undated'}>
          <StudioSidebarSection nested>{month === null ? 'Undated' : projectMonthLabelOf(month)}</StudioSidebarSection>
          {inMonth.map(({ summary: { project }, waiting: inProject }) => (
            <StudioSidebarLink key={project} to="/projects/$project" params={{ project }} title={project} current={pathname.replace(/\/$/, '') === `/projects/${encodeURIComponent(project)}`} label={projectDateSplitOf(project).rest} waiting={inProject} />
          ))}
        </Fragment>
      ))}
      {projects.length > 0 && shown.length === 0 && <Text size="sm" {...stylex.props(styles.none)}>No project matches “{filter.trim()}”</Text>}
    </>
  );
  return <StudioSidebarBody head={head} list={list} />;
}

function StudioSidebarLoaded() {
  return <StudioSidebar projects={useProjectsAwaiting().projects} />;
}

/**
 * The index's, the library's and a project page's frame: the studio's sidebar beside the page. Its projects suspend on their own, so
 * the page's loading state shows beside the sidebar's first two items instead of replacing the frame.
 */
export function StudioSidebarLayout({ children }: { readonly children: ReactNode }) {
  const sidebar = <Suspense fallback={<StudioSidebar projects={[]} />}><StudioSidebarLoaded /></Suspense>;
  return <StudioSidebarFrame sidebar={sidebar}>{children}</StudioSidebarFrame>;
}
