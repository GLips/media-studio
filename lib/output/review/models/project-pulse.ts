// project-pulse.ts: the pure side of a project's pulse (engine/project-pulse.ts), what every screen polls once a second
// and keys its other queries on. A query keyed on a beat refetches only when its part of the project moved.

/** What a project's summary is made from: the review's revision, its files' bytes and its script's. */
export type ProjectPulseFacts = {
  revision: number;
  files: readonly { path: string; hash: string }[];
  /** voiceover.json's hash and the take's, each the first 10 hex of its sha256; null without a voiceover.json. */
  script: { voiceover: string; take: string | null } | null;
};

/** One string that changes whenever a project's summary would: a query key part, compared and never parsed. */
export function projectPulseBeatOf({ revision, files, script }: ProjectPulseFacts): string {
  const bytes = files.map((f) => `${f.path}:${f.hash}`).toSorted().join(',');
  return `${revision}|${bytes}|${script ? `${script.voiceover}:${script.take ?? ''}` : ''}`;
}

/** The hash of the file at `path` as the pulse last saw it; undefined for a file the pulse doesn't list. */
export const projectPulseHashOf = (pulse: Pick<ProjectPulseFacts, 'files'>, path: string): string | undefined =>
  pulse.files.find((f) => f.path === path)?.hash;
