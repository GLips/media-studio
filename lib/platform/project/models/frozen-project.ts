// A sidecar lets a newer studio discover the pin without loading project code.

/** The record's file, in the project's folder: `work/projects/<p>/frozen.json`. */
export const FROZEN_PROJECT_RECORD = 'frozen.json';

export type FrozenProjectRecord = {
  /** The studio commit the project last passed on, whose code renders it. */
  engine: string;
  /** The workspace commit it was checked at, whose brands, styles and library it imports. */
  workspace: string;
};

const COMMIT = /^[0-9a-f]{40}$/;

/** A frozen.json's text, refused unless it names both commits in full. */
export function parseFrozenProjectRecord(text: string, file: string): FrozenProjectRecord {
  // SAFETY: shape-checked field by field below.
  const record = JSON.parse(text) as Partial<FrozenProjectRecord>;
  if (!record || typeof record.engine !== 'string' || !COMMIT.test(record.engine) || typeof record.workspace !== 'string' || !COMMIT.test(record.workspace)) {
    throw new Error(`${file} names no engine and workspace commit (each a full 40-character hash): \`studio thaw\` the project, then \`studio freeze\` it again`);
  }
  return { engine: record.engine, workspace: record.workspace };
}

export const formatFrozenProjectRecord = (record: FrozenProjectRecord) => `${JSON.stringify(record, null, 2)}\n`;

/** The project a workspace-relative path lies in, `projects/<p>/…`, or undefined for one outside every project. */
const projectOfWorkspacePath = (path: string): string | undefined => /^projects\/([^/]+)\/./.exec(path)?.[1];

/** The projects among `workspacePaths` (relative to work/) that hold a frozen.json. */
export function frozenProjectsInPaths(workspacePaths: Iterable<string>): Set<string> {
  const frozen = new Set<string>();
  for (const path of workspacePaths) {
    const project = projectOfWorkspacePath(path);
    if (project !== undefined && path === `projects/${project}/${FROZEN_PROJECT_RECORD}`) frozen.add(project);
  }
  return frozen;
}

/** Whether a workspace-relative path lies in one of the `frozen` projects. */
export function inFrozenProject(workspacePath: string, frozen: ReadonlySet<string>): boolean {
  const project = projectOfWorkspacePath(workspacePath);
  return project !== undefined && frozen.has(project);
}
