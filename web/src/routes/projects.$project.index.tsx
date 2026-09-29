import { createFileRoute, redirect } from '@tanstack/react-router';
import { landingArtifactOf } from '#lib/output/review/models/review-artifact.ts';
import { ProjectEmptyPage, projectListingQueryOptions } from '#web/features/projects/index.ts';

/** A project opens on the newest thing it has made; one with nothing yet says how to make something. */
export const Route = createFileRoute('/projects/$project/')({
  loader: async ({ context, params }) => {
    const { artifacts } = await context.queryClient.fetchQuery(projectListingQueryOptions(params.project));
    const playsQuickTime = document.createElement('video').canPlayType('video/quicktime') !== '';
    const landing = landingArtifactOf(artifacts, { playsQuickTime });
    if (landing) throw redirect({ to: '/projects/$project/artifacts/$', params: { project: params.project, _splat: landing.path }, replace: true });
  },
  component: ProjectLandingRoute,
});

function ProjectLandingRoute() {
  const { project } = Route.useParams();
  return <ProjectEmptyPage project={project} />;
}
