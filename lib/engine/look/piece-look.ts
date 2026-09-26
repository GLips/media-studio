// piece-look.ts: `studio look --graph=models`. Loads a timed project's scene models (`bars/<id>-model.ts`,
// `scenes/<id>-model.ts`, or one inside a scene's folder), binds each `definePieceTracks` to its scene's clock from
// timeline.ts, and samples its pieces over the frames asked: a table a piece and a graph, with no render.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rasterizeSvgs } from '#engine/capture/html-raster.ts';
import { readProjectTimeline } from '#engine/timeline/project-clock.ts';
import { buildPieceGraph } from '#models/motion/piece-graph.ts';
import { formatPieceTables, isPieceTracksDefinition, samplePieceTracks, type PieceTracksDefinition } from '#models/motion/piece-tracks.ts';

const SCENE_DIRS = ['bars', 'scenes'];
const MODEL_FILE = /-model\.ts$/;

/** Every scene model file in `project`: beside its scene file, or in its scene's folder. */
function sceneModelFiles(project: string): string[] {
  return SCENE_DIRS.flatMap((dir) => {
    const root = join(project, dir);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isFile()) return MODEL_FILE.test(entry.name) ? [join(root, entry.name)] : [];
      if (!entry.isDirectory()) return [];
      return readdirSync(join(root, entry.name)).filter((name) => MODEL_FILE.test(name)).map((name) => join(root, entry.name, name));
    });
  }).sort();
}

/**
 * Samples every piece track of `project`'s scene models over `frames` (those of `tracks`, ids or parts of them, if
 * given): prints a table a piece, and writes it beside a graph at `out` (a .png). Returns the lines to print.
 */
export async function lookPieceModels(project: string, { frames, tracks, out }: { frames: readonly number[]; tracks?: readonly string[]; out: string }): Promise<string[]> {
  const timeline = await readProjectTimeline(project);
  if (!timeline) throw new Error(`${project} has no timeline.ts: --graph=models binds each scene model to its scene's clock`);
  const files = sceneModelFiles(project);
  const definitions: PieceTracksDefinition[] = [];
  for (const file of files) {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    definitions.push(...Object.values(module).filter(isPieceTracksDefinition));
  }
  if (!definitions.length) {
    throw new Error(`${project} has no piece tracks: a scene model (bars/<id>-model.ts) exports one made with definePieceTracks`);
  }
  const scenes = definitions.map((d) => {
    if (!timeline.keys.includes(d.scene)) throw new Error(`piece tracks for scene ${d.scene}, which timeline.ts doesn't have: its scenes are ${timeline.keys.join(', ')}`);
    return { scene: timeline.scene(d.scene), pieces: d.bind(timeline.clock(d.scene)) };
  });
  const sampled = samplePieceTracks(scenes, frames, tracks);
  if (!sampled.length) {
    const all = scenes.flatMap(({ scene, pieces }) => Object.keys(pieces.tracks).map((name) => `${scene.id}/${name} (${scene.from}–${scene.to - 1})`));
    throw new Error(`no piece track plays frames ${frames[0]}–${frames.at(-1)}${tracks?.length ? ` matching ${tracks.join(', ')}` : ''}: there are ${all.join(', ')}`);
  }

  const table = formatPieceTables(sampled, (f) => timeline.beatAtFrame(f));
  const shown = scenes.find(({ scene }) => sampled.some((p) => p.scene === scene.id));
  const keepClear = shown?.pieces.keepClear;
  const keepClearAt = keepClear && ((f: number) => keepClear(f - shown.scene.origin));
  const graph = buildPieceGraph(sampled, {
    frames, beatFrames: timeline.beatFrames, keepClearAt,
    title: `${relative(process.cwd(), project) || project}: ${sampled.map((p) => p.id).join(', ')}`,
  });
  await rasterizeSvgs([{ svg: graph.svg, width: graph.width, height: graph.height, out }]);
  const tableFile = out.replace(/\.[^./]+$/, '') + '.txt';
  writeFileSync(tableFile, `${table.join('\n')}\n`);
  return [...table, `models: ${files.map((f) => relative(project, f)).join(', ')}`, out, tableFile];
}
