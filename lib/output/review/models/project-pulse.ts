// project-pulse.ts: the pure side of a project's pulse (engine/project-pulse.ts), what every screen polls once a second
// and keys its other queries on. A query keyed on a beat refetches only when its part of the project moved.

/** What a project's summary is made from: the review's revision, its files' bytes and its script's. */
export type ProjectPulseFacts = {
  revision: number;
  files: readonly { path: string; hash: string }[];
  /**
   * The hashes (first 10 hex of each sha256) of every file the script is read from: voiceover.json, the take, what
   * whisper heard in it (audio/take.json) and the voiced lines' words (audio/manifest.json), each null when absent.
   * Null without a voiceover.json. `studio voice` writes them one after another, so each counts on its own.
   */
  script: { voiceover: string; take: string | null; heard: string | null; manifest: string | null } | null;
};

/** One string that changes whenever any file the script is read from does: a query key part, never parsed. */
export const projectScriptBeatOf = (script: ProjectPulseFacts['script']): string =>
  (script ? [script.voiceover, script.take, script.heard, script.manifest].map((hash) => hash ?? '').join(':') : '');

/** One string that changes whenever a project's summary would: a query key part, compared and never parsed. */
export function projectPulseBeatOf({ revision, files, script }: ProjectPulseFacts): string {
  const bytes = files.map((f) => `${f.path}:${f.hash}`).toSorted().join(',');
  return `${revision}|${bytes}|${projectScriptBeatOf(script)}`;
}

/** The hash of the file at `path` as the pulse last saw it; undefined for a file the pulse doesn't list. */
export const projectPulseHashOf = (pulse: Pick<ProjectPulseFacts, 'files'>, path: string): string | undefined =>
  pulse.files.find((f) => f.path === path)?.hash;
