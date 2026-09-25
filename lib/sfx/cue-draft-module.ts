// cue-draft-module.ts: where a project's cue list lives on disk, and generated/sfx-draft.ts, which the composition
// imports as `@sfx-draft` to audition the draft (`studio mix --sfx-draft`) whether or not the video imports it.
//
// Imported by lib/project-bundle.ts, so it stays free of the renderer and of import.meta (the Remotion CLI bundles
// that file to CommonJS).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The cue list an agent edits. */
export const sfxCueListFor = (project: string) => join(resolve(project), 'sfx', 'cues.json');
/** The rendered cue list a video imports, and the folder its sounds are in. */
export const sfxCueModuleFor = (project: string) => join(resolve(project), 'sfx', 'cues.ts');
export const sfxCueSoundsDirFor = (project: string) => join(resolve(project), 'sfx', 'cues');

/**
 * Rewrites generated/sfx-draft.ts to re-export the project's sfx/cues.ts, or null before there is one, so the import
 * always resolves. Returns its path.
 */
export function writeSfxDraftModule(project: string): string {
  const dir = join(resolve(project), 'generated'), path = join(dir, 'sfx-draft.ts');
  mkdirSync(dir, { recursive: true });
  const module = existsSync(sfxCueModuleFor(project))
    ? "// Written on every bundle. Edits here are lost.\nexport { default } from '../sfx/cues.ts';\n"
    : '// Written on every bundle: the project has no sfx/cues.ts yet (studio sfx draft). Edits here are lost.\nexport default null;\n';
  // Unchanged content isn't rewritten, so a Studio watching the file doesn't reload for nothing.
  if (!existsSync(path) || readFileSync(path, 'utf8') !== module) writeFileSync(path, module);
  return path;
}
