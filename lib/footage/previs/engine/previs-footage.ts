// previs-footage.ts: a project's generated footage list. generated/footage.json is the list `studio gen video`
// keeps; generated/footage.ts, which the composition imports as `@footage`, is rewritten from it on every bundle.
//
// Imported by lib/output/render/engine/project-bundle.ts, so it stays free of the renderer and of import.meta (the Remotion CLI bundles
// that file to CommonJS).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** One scene's footage: its file (relative to generated/), where it starts in scene time, and the blockout it's from. */
export type PrevisFootageEntry = { file: string; from: number; duration: number; blockout: string };

const generatedDirFor = (project: string) => join(resolve(project), 'generated');
export const previsFootageModuleFor = (project: string) => join(generatedDirFor(project), 'footage.ts');
const previsFootageListFor = (project: string) => join(generatedDirFor(project), 'footage.json');

export function readPrevisFootageList(project: string): Record<string, PrevisFootageEntry> {
  const path = previsFootageListFor(project);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

export function writePrevisFootageEntry(project: string, sceneId: string, entry: PrevisFootageEntry) {
  const list = readPrevisFootageList(project);
  list[sceneId] = entry;
  writeFileSync(previsFootageListFor(project), JSON.stringify(list, null, 2));
  writePrevisFootageModule(project);
}

/**
 * Rewrites footage.ts from footage.json. An entry whose file is gone is left out, not imported: a missing import
 * would break every bundle of the project, the one that would render it again included.
 */
export function writePrevisFootageModule(project: string) {
  const dir = generatedDirFor(project);
  mkdirSync(dir, { recursive: true });
  const scenes = Object.entries(readPrevisFootageList(project)).filter(([, { file }]) => existsSync(join(dir, file)));
  const module = [
    '// Written from footage.json by `studio gen video` and every bundle. Edits here are lost.',
    ...scenes.map(([, { file }], i) => `import f${i} from ${JSON.stringify(`./${file}`)};`),
    '',
    'export const footage = {',
    ...scenes.map(([id, { from, duration }], i) => `  ${JSON.stringify(id)}: { src: f${i}, from: ${from}, duration: ${duration} },`),
    '};',
    '',
  ].join('\n');
  // Unchanged content isn't rewritten, so a Studio watching the file doesn't reload for nothing.
  const path = previsFootageModuleFor(project);
  if (!existsSync(path) || readFileSync(path, 'utf8') !== module) writeFileSync(path, module);
}
