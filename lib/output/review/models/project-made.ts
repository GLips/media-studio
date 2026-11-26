// project-made.ts: how the studio app names what the project made beyond its renders and stills (ProjectMade):
// generated footage by its scene, a track by its name and measurements, an image by its name, each with what made it
// and its cost.
import type { ProjectArtifact, ProjectMade } from './review-artifact.ts';
import type { ProjectPageRung } from './review-dashboard.ts';

/** The heading over each made rung on the project's page. */
export const PROJECT_MADE_RUNG_LABELS: Partial<Record<ProjectPageRung, string>> = {
  'scene-renders': 'scenes rendered alone', footage: 'generated footage', music: 'music', images: 'images',
};

/** `bytedance/seedance-2.5` → `seedance-2.5`: the provider is noise beside the model on a row. */
const modelNameOf = (model: string) => model.slice(model.lastIndexOf('/') + 1);

const costOf = (cost: number | null) => (cost === null ? [] : [`$${cost.toFixed(2)}`]);

/** A made file's name on its row or tile: the scene, track or image it is; null for a file named by its path. */
export function projectMadeTitleOf(made: ProjectMade, path: string): string {
  switch (made.as) {
    case 'footage': case 'scene-render': return made.scene;
    case 'music': case 'image': return made.name;
    default: return path.slice('assets/'.length);
  }
}

/** What made it, after its name: `seedance-2.5 · $1.11 · from blockout-establish-c140….mp4`. */
export function projectMadeDetailOf(made: ProjectMade): string | undefined {
  switch (made.as) {
    case 'footage': return [modelNameOf(made.model), ...costOf(made.cost), ...(made.blockout ? [`from ${made.blockout.slice(made.blockout.lastIndexOf('/') + 1)}`] : [])].join(' · ');
    case 'image': return [modelNameOf(made.model), ...costOf(made.cost)].join(' · ');
    case 'music': return [
      `${made.seconds.toFixed(1)} s`, `${Math.round(made.bpm)} BPM`, `${made.lufs.toFixed(1)} LUFS`,
      ...(made.fitOf ? [`fit from ${made.fitOf}`] : []), ...(made.model ? [modelNameOf(made.model)] : []), ...costOf(made.cost),
    ].join(' · ');
    default: return undefined;
  }
}

/** The verb a file's age reads with: `generated 2h ago`, `rendered 5m ago`. */
export function projectFileAgeWordOf({ kind, made }: Pick<ProjectArtifact, 'kind' | 'made'>): string {
  if (made?.as === 'footage' || made?.as === 'image' || (made?.as === 'music' && made.model)) return 'generated';
  if (made?.as === 'music' || made?.as === 'asset') return 'added';
  return kind === 'video' ? 'rendered' : 'made';
}
