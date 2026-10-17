// project-pulse.ts: the pure side of a project's pulse (engine/project-pulse.ts), what every screen polls once a second
// and keys its other queries on. A query keyed on a beat refetches only when its part of the project moved.

/** What a project's summary is made from: the review's revision, its files' bytes and its plan's. */
export type ProjectPulseFacts = {
  revision: number;
  files: readonly { path: string; hash: string }[];
  /**
   * The hashes (first 10 hex of each sha256) of the files the plan is timed from: storyboard.ts, the voiced lines
   * (audio/manifest.json) and the take they were cut from, each null when absent. Null without a storyboard.ts.
   */
  plan: { storyboard: string; manifest: string | null; take: string | null } | null;
};

/** One string that changes whenever any file the plan is timed from does: a query key part, never parsed. */
export const projectPlanBeatOf = (plan: ProjectPulseFacts['plan']): string =>
  (plan ? [plan.storyboard, plan.manifest, plan.take].map((hash) => hash ?? '').join(':') : '');

/** One string that changes whenever a project's summary would: a query key part, compared and never parsed. */
export function projectPulseBeatOf({ revision, files, plan }: ProjectPulseFacts): string {
  const bytes = files.map((f) => `${f.path}:${f.hash}`).toSorted().join(',');
  return `${revision}|${bytes}|${projectPlanBeatOf(plan)}`;
}

/** The hash of the file at `path` as the pulse last saw it; undefined for a file the pulse doesn't list. */
export const projectPulseHashOf = (pulse: Pick<ProjectPulseFacts, 'files'>, path: string): string | undefined =>
  pulse.files.find((f) => f.path === path)?.hash;
