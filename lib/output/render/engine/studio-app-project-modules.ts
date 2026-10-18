// studio-app-project-modules.ts: the studio app's Vite plugin for playing projects live in the browser (the
// video-preview feature), standing in for what project-bundle.ts gives a Remotion bundle. A bundle holds one project;
// the app plays any, so each bundle-time module is found per project here:
// - `<project>/video.tsx?studio-project-modules`: the project's generated footage and cue list, rewritten on load by
//   the writers a bundle runs, so a project never bundled still plays;
// - `@brand`, from a project's file: that project's generated/brand.ts, rewritten the same way;
// - `@stamp-paint-styles`: every workspace style (one page plays any project, and the shot code reads styles by name).
//
// Typed by shape rather than by Vite's types: only lib/platform/web/engine/ imports vite, and it can't import the
// writers here.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writePrevisFootageModule, previsFootageModuleFor } from '#lib/footage/previs/engine/previs-footage.ts';
import { writeProjectBrandModule } from '#lib/picture/brand/engine/project-brand.ts';
import { workspaceStampPaintStylesModule } from '#lib/paint/style/engine/project-styles.ts';
import { STUDIO_PROJECTS_DIR, STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { sfxCueListFor, writeSfxCueModule } from '#lib/output/sfx-cues/engine/cue-module.ts';

/** The query the video-preview feature globs each project's video.tsx with, to import its generated modules. */
const STUDIO_PROJECT_MODULES_QUERY = '?studio-project-modules';

const STAMP_PAINT_STYLES_ID = '\0studio-app:stamp-paint-styles';
const PROJECT_FILE = new RegExp(`^${STUDIO_PROJECTS_DIR.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/`);
const projectOfFile = (file: string | undefined) => (file === undefined ? undefined : PROJECT_FILE.exec(file)?.[1]);

type StudioAppPluginContext = { addWatchFile: (file: string) => void };
type StudioAppDevServer = { watcher: { add: (paths: string | readonly string[]) => void } };

/** Assignable to Vite's Plugin; vite.config.ts types it as one. */
export type StudioAppProjectModulesPlugin = {
  name: string;
  enforce: 'pre';
  configureServer: (server: StudioAppDevServer) => void;
  resolveId: (id: string, importer: string | undefined) => string | undefined;
  load: (this: StudioAppPluginContext, id: string) => string | undefined;
};

/**
 * The project's generated footage and cue list as one module. A writer's failure (a cue that won't render) becomes
 * the module's error, so the page's import rejects with its message rather than Vite's bare "failed to fetch".
 */
function projectModulesSource(context: StudioAppPluginContext, project: string): string {
  const dir = join(STUDIO_PROJECTS_DIR, project);
  // Only once it exists: Vite resolves a watched file as an import. generated/footage.ts needs no watch, since
  // `studio gen video` rewrites it and it's imported.
  if (existsSync(sfxCueListFor(dir))) context.addWatchFile(sfxCueListFor(dir));
  let sfxCues: string;
  try {
    writePrevisFootageModule(dir);
    sfxCues = writeSfxCueModule(dir);
  } catch (error) {
    return `throw new Error(${JSON.stringify(`${project}'s generated modules: ${error instanceof Error ? error.message : String(error)}`)});\n`;
  }
  return `export { footage } from ${JSON.stringify(previsFootageModuleFor(dir))};\nexport { default as sfxCues } from ${JSON.stringify(sfxCues)};\n`;
}

export function studioAppProjectModulesPlugin(): StudioAppProjectModulesPlugin {
  return {
    name: 'studio-app-project-modules',
    enforce: 'pre',
    // Vite watches only its root (web/), so a video.tsx made after the server starts would miss the feature's globs.
    configureServer(server) {
      server.watcher.add(join(STUDIO_PROJECTS_DIR, '*', 'video.tsx'));
    },
    resolveId(id, importer) {
      if (id === '@stamp-paint-styles') return STAMP_PAINT_STYLES_ID;
      const project = projectOfFile(importer);
      // Outside a project nothing names a kit, so Vite reports the import as unresolved.
      if (id === '@brand' && project) return writeProjectBrandModule(join(STUDIO_PROJECTS_DIR, project));
      return undefined;
    },
    load(id) {
      if (id === STAMP_PAINT_STYLES_ID) {
        const { source, styleFiles } = workspaceStampPaintStylesModule(STUDIO_STYLES_DIR);
        for (const file of styleFiles) this.addWatchFile(file);
        return source;
      }
      const project = id.endsWith(`/video.tsx${STUDIO_PROJECT_MODULES_QUERY}`) ? projectOfFile(id) : undefined;
      return project ? projectModulesSource(this, project) : undefined;
    },
  };
}
