// studio-project.ts: where the studio lives, and which project a command-line argument means.
//
// The `studio` CLI runs from any directory, so everything that reads or writes studio files goes through
// STUDIO_ROOT rather than the working directory.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProjectCapability, ProjectDeclaration } from '../models/capability.ts';

export const STUDIO_ROOT = resolve(import.meta.dirname, '../../../..');
/**
 * Your own work: projects, brand kits and hosts.json, in a git repository of its own that the studio's repository
 * ignores (lib/platform/project/engine/studio-workspace.ts). A fresh clone has none until `studio workspace init`.
 */
export const STUDIO_WORKSPACE_DIR = join(STUDIO_ROOT, 'work');
export const STUDIO_PROJECTS_DIR = join(STUDIO_WORKSPACE_DIR, 'projects');
export const STUDIO_BRANDS_DIR = join(STUDIO_WORKSPACE_DIR, 'brands');

/** The project folders' names; none in a workspace with no projects yet. */
export function listStudioProjects(): string[] {
  if (!existsSync(STUDIO_PROJECTS_DIR)) return [];
  return readdirSync(STUDIO_PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/**
 * The absolute directory a project argument names, tried in order: a folder in work/projects/ by its full name, by its
 * slug (the name after the `yyyy-mm-` prefix), by a unique part of its name, and last a path from the working directory.
 */
export function resolveStudioProject(arg: string): string {
  const names = listStudioProjects();
  if (names.includes(arg)) return join(STUDIO_PROJECTS_DIR, arg);
  const bySlug = names.filter((n) => n.replace(/^\d{4}-\d{2}-/, '') === arg);
  if (bySlug.length === 1) return join(STUDIO_PROJECTS_DIR, bySlug[0]);
  const matches = names.filter((n) => n.includes(arg));
  if (matches.length === 1) return join(STUDIO_PROJECTS_DIR, matches[0]);
  const path = resolve(arg);
  if (existsSync(path) && statSync(path).isDirectory()) return path;
  const listed = (list: string[]) => list.map((n) => `\n  ${n}`).join('');
  throw new Error(matches.length
    ? `"${arg}" matches more than one project:${listed(matches)}`
    : `no project matches "${arg}", and it isn't a folder. ${names.length ? `The projects are:${listed(names)}` : 'There are no projects in work/projects/ yet: `studio new` starts one'}`);
}

/** Like resolveStudioProject, but the project must have `file` (e.g. video.tsx) to be of use to the command. */
export function resolveStudioProjectWith(arg: string, file: string): string {
  const dir = resolveStudioProject(arg);
  if (!existsSync(join(dir, file))) throw new Error(`${basename(dir)} has no ${file}`);
  return dir;
}

/**
 * What the project's project.ts declares it is (check:arch holds that to what it binds), or undefined for an older
 * project with none.
 */
export async function readProjectCapability(project: string): Promise<ProjectCapability | undefined> {
  const file = join(project, 'project.ts');
  if (!existsSync(file)) return undefined;
  const { default: declaration } = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default: ProjectDeclaration };
  return declaration.capability;
}
