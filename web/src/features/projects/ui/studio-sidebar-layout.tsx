import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Inbox, Library } from 'lucide-react';
import { Suspense, useState, type ReactNode } from 'react';
import { StudioSidebarBody, StudioSidebarFrame, StudioSidebarLink, StudioSidebarSection } from '#web/shared/ui/studio-sidebar.tsx';
import { TextInput } from '#web/shared/ui/text-input.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectName } from './project-name.tsx';
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

const projectMatchesFilter = (project: string, filter: string) => project.toLowerCase().includes(filter.trim().toLowerCase());

type StudioSidebarProps = { readonly projects: readonly ProjectAwaiting[] };

/**
 * Awaiting you with its count, the library, then every project with what waits in it, narrowed by the filter. The
 * projects are listed once they load; until then the first two items stand alone.
 */
function StudioSidebar({ projects }: StudioSidebarProps) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const waiting = projects.reduce((sum, project) => sum + project.waiting, 0);
  const shown = projectsRenderedFirst(projects).filter(({ summary }) => projectMatchesFilter(summary.project, filter));
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
              const first = shown[0];
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
      {shown.map(({ summary: { project }, waiting: inProject }) => (
        <StudioSidebarLink key={project} to="/projects/$project" params={{ project }} title={project} label={<ProjectName project={project} />} waiting={inProject} />
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
 * The index's and the library's frame: the studio's sidebar beside the page. Its projects suspend on their own, so
 * the page's loading state shows beside the sidebar's first two items instead of replacing the frame.
 */
export function StudioSidebarLayout({ children }: { readonly children: ReactNode }) {
  const sidebar = <Suspense fallback={<StudioSidebar projects={[]} />}><StudioSidebarLoaded /></Suspense>;
  return <StudioSidebarFrame sidebar={sidebar}>{children}</StudioSidebarFrame>;
}
