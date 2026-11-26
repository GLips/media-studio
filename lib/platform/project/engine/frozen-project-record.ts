// frozen-project-record.ts: reads a project's frozen.json from disk (the record's shape is
// lib/platform/project/models/frozen-project.ts). Node builtins only: lint's typecheck and test launchers read it too.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FROZEN_PROJECT_RECORD, parseFrozenProjectRecord, type FrozenProjectRecord } from '#lib/platform/project/models/frozen-project.ts';
import { listStudioProjects, STUDIO_PROJECTS_DIR } from './studio-project.ts';

/** The project's frozen record, or undefined for an active project. */
export function readFrozenProjectRecord(projectDir: string): FrozenProjectRecord | undefined {
  const file = join(projectDir, FROZEN_PROJECT_RECORD);
  return existsSync(file) ? parseFrozenProjectRecord(readFileSync(file, 'utf8'), file) : undefined;
}

/** The active projects in work/projects/, by folder name; none in a workspace with none or no projects. */
export function activeStudioProjects(): string[] {
  return listStudioProjects().filter((name) => !readFrozenProjectRecord(join(STUDIO_PROJECTS_DIR, name)));
}
