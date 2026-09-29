// project-media.ts: which files of a project the studio app may hand to a browser, and what they are. A project is a
// folder directly under work/projects/; a file in it is named by its path inside the project, and only a media file whose
// real path stays inside that project folder is ever served, so neither `..` nor a symlink reaches code or secrets.
//
// Negative space: nothing outside work/projects/ is served, so a file outside a project can't be reviewed.
import { existsSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { STUDIO_PROJECTS_DIR } from '#lib/platform/project/engine/studio-project.ts';

export type ProjectMediaKind = 'video' | 'still' | 'audio' | 'captions';

export const PROJECT_MEDIA_TYPES: Readonly<Record<string, { type: string; kind: ProjectMediaKind }>> = {
  '.mp4': { type: 'video/mp4', kind: 'video' }, '.webm': { type: 'video/webm', kind: 'video' }, '.mov': { type: 'video/quicktime', kind: 'video' },
  '.png': { type: 'image/png', kind: 'still' }, '.jpg': { type: 'image/jpeg', kind: 'still' }, '.jpeg': { type: 'image/jpeg', kind: 'still' },
  '.webp': { type: 'image/webp', kind: 'still' }, '.svg': { type: 'image/svg+xml', kind: 'still' },
  '.mp3': { type: 'audio/mpeg', kind: 'audio' }, '.wav': { type: 'audio/wav', kind: 'audio' }, '.m4a': { type: 'audio/mp4', kind: 'audio' },
  '.flac': { type: 'audio/flac', kind: 'audio' }, '.srt': { type: 'application/x-subrip', kind: 'captions' },
};

export const projectMediaTypeOf = (file: string) => PROJECT_MEDIA_TYPES[extname(file).toLowerCase()];

/** Thrown for a project or file a request names that isn't one the app serves: the web layer answers 404. */
export class ProjectMediaNotFound extends Error {}

/** A project's folder by its exact name under work/projects/, never a path or a fuzzy match. */
export function projectFolderNamed(project: string): string {
  const dir = join(STUDIO_PROJECTS_DIR, project);
  if (!project || project.includes('/') || project.includes('\\') || project.startsWith('.') || !existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new ProjectMediaNotFound(`no project named ${project} under work/projects/`);
  }
  return dir;
}

/** The absolute path of a media file inside a project, refused unless its real path stays in the project's folder. */
export function resolveProjectMedia(project: string, path: string): string {
  const dir = realpathSync(projectFolderNamed(project));
  const file = join(dir, ...path.split('/'));
  if (!projectMediaTypeOf(file) || !existsSync(file)) throw new ProjectMediaNotFound(`${project} has no media file ${path}`);
  const real = realpathSync(file);
  if (!real.startsWith(dir + sep) || !statSync(real).isFile()) throw new ProjectMediaNotFound(`${path} isn't a file inside ${project}`);
  return real;
}

/** A file's path inside its project, `/`-separated, as routes and notes name it. */
export const projectPathOf = (projectDir: string, file: string) => relative(projectDir, file).split(sep).join('/');
