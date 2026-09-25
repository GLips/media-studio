// studio-project.ts: where the studio lives, and which project a command-line argument means.
//
// The `studio` CLI runs from any directory, so everything that reads or writes studio files goes through
// STUDIO_ROOT rather than the working directory.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const STUDIO_ROOT = resolve(import.meta.dirname, '../../..');
export const STUDIO_PROJECTS_DIR = join(STUDIO_ROOT, 'projects');

export function listStudioProjects(): string[] {
  return readdirSync(STUDIO_PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/**
 * The absolute directory a project argument names, tried in order: a folder in projects/ by its full name, by its
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
    : `no project matches "${arg}", and it isn't a folder. The projects are:${listed(names)}`);
}

/** Like resolveStudioProject, but the project must have `file` (e.g. video.tsx) to be of use to the command. */
export function resolveStudioProjectWith(arg: string, file: string): string {
  const dir = resolveStudioProject(arg);
  if (!existsSync(join(dir, file))) throw new Error(`${basename(dir)} has no ${file}`);
  return dir;
}
