// project-storyboard.ts: a project's storyboard.ts loaded in Node, unresolved. It's a model, so it loads with no hooks;
// what it's timed against (the voice, the music) is the caller's to load. `studio voice` reads its script from it,
// and project-clock.ts resolves it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { VoiceScript } from '#lib/timing/voice/engine/voice-project.ts';
import type { Storyboard } from '../models/storyboard.ts';

/** The project's storyboard.ts `storyboard`, or undefined for a project with none. Throws if it exports none. */
export async function importProjectStoryboard(project: string): Promise<{ file: string; storyboard: Storyboard } | undefined> {
  const file = join(project, 'storyboard.ts');
  if (!existsSync(file)) return undefined;
  // SAFETY: storyboard.ts is a project's root module, its role to export `storyboard`; `scenes` is checked below.
  const { storyboard } = (await import(pathToFileURL(file).href)) as { storyboard?: Storyboard };
  if (!storyboard?.scenes) throw new Error(`${file} exports no \`storyboard\` made with defineStoryboard`);
  return { file, storyboard };
}

/** What `studio voice` reads for the project: its storyboard's voice, and its scenes' lines in plan order. */
export async function readProjectVoiceScript(project: string): Promise<VoiceScript> {
  const found = await importProjectStoryboard(project);
  if (!found) throw new Error(`${project} has no storyboard.ts: studio voice reads its lines`);
  const lines = Object.values(found.storyboard.scenes).flatMap((scene) => Object.entries(scene.lines ?? {})
    .map(([id, { text, paragraph }]) => ({ id, text, paragraph })));
  if (!lines.length) throw new Error(`${found.file} has no lines to voice`);
  if (found.storyboard.voice === undefined) throw new Error(`${found.file} names no voice: add \`voice\` (e.g. 'Callirrhoe') to read its lines in`);
  return { voice: found.storyboard.voice, lines };
}
