import { useLocation } from '@tanstack/react-router';
import { Inbox, Library } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';
import { StudioSidebarFrame, StudioSidebarLink, StudioSidebarSection } from '#web/shared/ui/studio-sidebar.tsx';
import { projectsRenderedFirst, useProjectsAwaiting, type ProjectAwaiting } from './use-projects-awaiting.ts';

const ICON_SIZE = 14;

/** Awaiting you with its count, the library, then every project with what waits in it; none listed until they load. */
function StudioSidebarItems({ projects }: { readonly projects: readonly ProjectAwaiting[] }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const waiting = projects.reduce((sum, project) => sum + project.waiting, 0);
  return (
    <>
      <StudioSidebarLink to="/" icon={<Inbox size={ICON_SIZE} />} label="Awaiting you" waiting={waiting} current={pathname === '/'} />
      <StudioSidebarLink to="/library" icon={<Library size={ICON_SIZE} />} label="Library" current={pathname.replace(/\/$/, '') === '/library'} />
      {projects.length > 0 && <StudioSidebarSection count={projects.length}>Projects</StudioSidebarSection>}
      {projectsRenderedFirst(projects).map(({ summary: { project }, waiting: inProject }) => (
        <StudioSidebarLink key={project} to="/projects/$project" params={{ project }} label={project} waiting={inProject} />
      ))}
    </>
  );
}

function StudioSidebarLoaded() {
  return <StudioSidebarItems projects={useProjectsAwaiting().projects} />;
}

/**
 * The index's and the library's frame: the studio's sidebar beside the page. Its projects suspend on their own, so
 * the page's loading state shows beside the sidebar's first two items instead of replacing the frame.
 */
export function StudioSidebarLayout({ children }: { readonly children: ReactNode }) {
  return (
    <StudioSidebarFrame sidebar={<Suspense fallback={<StudioSidebarItems projects={[]} />}><StudioSidebarLoaded /></Suspense>}>
      {children}
    </StudioSidebarFrame>
  );
}
