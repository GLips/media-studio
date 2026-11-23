// previs-clips.ts: a project's previs clips, the footage `studio gen video` renders for its previs scenes.
// generated/previs-clips.json is the list it keeps; generated/previs-clips.ts, which the composition imports as
// `@previs-clips`, is rewritten from it on every bundle.
//
// Imported by lib/output/render/engine/project-bundle.ts, so it stays free of the renderer and of import.meta (the Remotion CLI bundles
// that file to CommonJS).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** One scene's previs clip: its file (relative to generated/), where it starts in scene time, the blockout it's from and the OpenRouter model that made it. */
export type PrevisClipEntry = { file: string; from: number; duration: number; blockout: string; model: string };

const generatedDirFor = (project: string) => join(resolve(project), 'generated');
export const previsClipsModuleFor = (project: string) => join(generatedDirFor(project), 'previs-clips.ts');
const previsClipListFor = (project: string) => join(generatedDirFor(project), 'previs-clips.json');

export function readPrevisClipList(project: string): Record<string, PrevisClipEntry> {
  const path = previsClipListFor(project);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

export function writePrevisClipEntry(project: string, sceneId: string, entry: PrevisClipEntry) {
  const list = readPrevisClipList(project);
  list[sceneId] = entry;
  writeFileSync(previsClipListFor(project), JSON.stringify(list, null, 2));
  writePrevisClipsModule(project);
}

/**
 * Rewrites previs-clips.ts from previs-clips.json. An entry whose file is gone is left out, not imported: a missing import
 * would break every bundle of the project, the one that would render it again included.
 */
export function writePrevisClipsModule(project: string) {
  const dir = generatedDirFor(project);
  mkdirSync(dir, { recursive: true });
  const scenes = Object.entries(readPrevisClipList(project)).filter(([, { file }]) => existsSync(join(dir, file)));
  const module = [
    '// Written from previs-clips.json by `studio gen video` and every bundle. Edits here are lost.',
    ...scenes.map(([, { file }], i) => `import f${i} from ${JSON.stringify(`./${file}`)};`),
    '',
    'export const previsClips = {',
    ...scenes.map(([id, { from, duration }], i) => `  ${JSON.stringify(id)}: { src: f${i}, from: ${from}, duration: ${duration} },`),
    '};',
    '',
  ].join('\n');
  // Unchanged content isn't rewritten, so a Studio watching the file doesn't reload for nothing.
  const path = previsClipsModuleFor(project);
  if (!existsSync(path) || readFileSync(path, 'utf8') !== module) writeFileSync(path, module);
}
