// project-artifacts.ts: every media file a project holds (video, still, audio), newest first, found by one rule rather
// than a list of folders (project-media-rule.ts): walk the whole project folder, leaving out working matter. A file
// whose maker the studio knows carries what made it (ProjectMade), from the record its maker keeps: scene renders,
// generated footage and images (provenance.json, previs-clips.json), music (music/manifest.json), pictures in assets/.
// The app's switcher, project page, latest view and dashboard read this list; resolveProjectMedia decides what may be
// served.
//
// Negative space: captions (.srt) aren't listed; they're read with their video. Symlinks aren't followed, since
// resolveProjectMedia won't serve what they reach.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readPrevisClipList } from '#lib/footage/previs/engine/previs-clips.ts';
import { readPaidGenerationProvenance } from '#lib/platform/paid-generation/engine/paid-generation.ts';
import { readMusicManifest } from '#lib/timing/music/engine/music-track.ts';
import { PROJECT_FRAME_SEQUENCE_MIN, projectFolderIsWorkingMatter, projectFrameSequencePrefixOf } from '../models/project-media-rule.ts';
import { transparentPairOf, type ProjectArtifact, type ProjectMade } from '../models/review-artifact.ts';
import { projectFolderNamed, projectMediaTypeOf } from './project-media.ts';

type ListedKind = ProjectArtifact['kind'];
type FoundFile = { path: string; kind: ListedKind };

function listedKindOf(file: string): ListedKind | undefined {
  const kind = projectMediaTypeOf(file)?.kind;
  return kind === 'video' || kind === 'still' || kind === 'audio' ? kind : undefined;
}

/** The media files directly in `folder` (`out/wip/`, `''` for the root), less any run of numbered frames. */
function mediaIn(folder: string, names: readonly string[]): FoundFile[] {
  const files = names.flatMap((name) => {
    const kind = listedKindOf(name);
    return kind ? [{ path: folder + name, kind, sequence: projectFrameSequencePrefixOf(name) }] : [];
  });
  const runs = new Map<string, number>();
  for (const { sequence } of files) if (sequence !== null) runs.set(sequence, (runs.get(sequence) ?? 0) + 1);
  return files.filter((f) => f.sequence === null || (runs.get(f.sequence) ?? 0) < PROJECT_FRAME_SEQUENCE_MIN)
    .map(({ path, kind }) => ({ path, kind }));
}

/** Every media file under the project, by its `/`-separated path there. */
function walkProjectMedia(dir: string, folder = ''): FoundFile[] {
  const entries = readdirSync(join(dir, ...folder.split('/').filter(Boolean)), { withFileTypes: true });
  const here = mediaIn(folder, entries.filter((e) => e.isFile()).map((e) => e.name));
  const deeper = entries.filter((e) => e.isDirectory() && !projectFolderIsWorkingMatter(`${folder}${e.name}/`))
    .flatMap((e) => walkProjectMedia(dir, `${folder}${e.name}/`));
  return [...here, ...deeper];
}

/** Generated footage and images, by provenance.json, which says what made each and its cost. */
function generatedMadeIn(dir: string): [string, ProjectMade][] {
  const playing = new Map(Object.entries(readPrevisClipList(dir)).map(([scene, clip]) => [`generated/${clip.file}`, scene]));
  return Object.values(readPaidGenerationProvenance(dir)).flatMap(({ kind, name, model, cost, files, references }): [string, ProjectMade][] => {
    if (kind === 'image') return files.filter((path) => listedKindOf(path) === 'still').map((path) => [path, { as: 'image', name, model, cost }]);
    if (kind !== 'video') return [];
    const blockout = references.find((ref) => listedKindOf(ref.path) === 'video' && existsSync(join(dir, ref.path)))?.path ?? null;
    return files.filter((path) => listedKindOf(path) === 'video').map((path) => {
      const scene = playing.get(path);
      return [path, { as: 'footage', scene: scene ?? name, plays: scene !== undefined, blockout, model, cost }];
    });
  });
}

/** The project's music tracks; a generated one's cost from the generation whose model and prompt made it. */
function musicMadeIn(dir: string): [string, ProjectMade][] {
  const generations = Object.values(readPaidGenerationProvenance(dir));
  return Object.entries(readMusicManifest(join(dir, 'music'))).map(([name, track]): [string, ProjectMade] => {
    const made = generations.find((g) => g.kind === 'audio' && g.model === track.generated?.model && g.prompt === track.generated.prompt);
    return [`music/${track.file}`, {
      as: 'music', name, seconds: track.duration, bpm: track.bpm, lufs: track.lufs, model: track.generated?.model ?? null, cost: made?.cost ?? null, fitOf: track.fit?.source ?? null,
    }];
  });
}

/**
 * What made a file the project holds, by its path, when the studio knows: a scene rendered alone (`render --scene`
 * overwrites out/wip/slices/scene-<id>.mp4, so it's the scene's newest), a picture in assets/, or a maker's record.
 */
function madeOf(path: string, kind: ListedKind, records: ReadonlyMap<string, ProjectMade>): ProjectMade | undefined {
  const scene = /^out\/wip\/slices\/scene-(.+)\.(mp4|webm|mov)$/.exec(path)?.[1];
  if (scene) return { as: 'scene-render', scene };
  return records.get(path) ?? (path.startsWith('assets/') && kind === 'still' ? { as: 'asset' } : undefined);
}

/** The project's reviewable files, newest first. */
export const listProjectArtifacts = (project: string): ProjectArtifact[] => listProjectArtifactsIn(projectFolderNamed(project));

/** The reviewable files of the project in folder `dir`, newest first. */
export function listProjectArtifactsIn(dir: string): ProjectArtifact[] {
  const records = new Map([...generatedMadeIn(dir), ...musicMadeIn(dir)]);
  const found = walkProjectMedia(dir);
  const paths = new Set(found.map((f) => f.path));
  return found
    .map(({ path, kind }) => {
      const artifact: ProjectArtifact = { path, kind, modified: statSync(join(dir, ...path.split('/'))).mtime.toISOString() };
      const made = madeOf(path, kind, records), pair = transparentPairOf(path);
      if (pair && paths.has(pair)) artifact.pair = pair;
      if (made) artifact.made = made;
      return artifact;
    })
    .toSorted((a, b) => b.modified.localeCompare(a.modified));
}

/** What made the file at `path` in the project, when it's one listProjectArtifacts lists as made. */
export const readProjectMade = (project: string, path: string): ProjectMade | undefined =>
  listProjectArtifacts(project).find((artifact) => artifact.path === path)?.made;

/** `blockout-establish-c140caca1f17.mp4` → `blockout`: what compare calls a footage's reference. */
export const projectReferenceLabelOf = (path: string) => basename(path).split('-')[0];
