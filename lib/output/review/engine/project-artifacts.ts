// project-artifacts.ts: what a project has made that a person reviews, newest first: its renders in out/ and out/wip/
// (render-cuts.ts), its stills in out/, out/wip/, out/stills/ and out/still-sheets/, and what it made toward them, each
// with what made it (ProjectMade) from the record its maker keeps: scene renders, generated footage and images
// (provenance.json, previs-clips.json), music (music/manifest.json), pictures in assets/. The app's switcher, project
// page and dashboard read this list; resolveProjectMedia decides what may be served.
//
// Negative space: generated audio isn't listed: a track is reviewed as its copy in music/, a sound effect in its cue
// list. A blockout shows beside its footage, not alone; a frames slice only as the render a reply names.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readPrevisClipList } from '#lib/footage/previs/engine/previs-clips.ts';
import { listProjectOutVideos } from '#lib/output/render/engine/render-cuts.ts';
import { readPaidGenerationProvenance } from '#lib/platform/paid-generation/engine/paid-generation.ts';
import { readMusicManifest } from '#lib/timing/music/engine/music-track.ts';
import { transparentPairOf, type ProjectArtifact, type ProjectMade } from '../models/review-artifact.ts';
import { projectFolderNamed, projectMediaTypeOf, projectPathOf } from './project-media.ts';

const STILL_FOLDERS = ['out', 'out/wip', 'out/stills', 'out/still-sheets'] as const;

/** A file the project holds, by its path there, before its mtime is read. */
type FoundFile = Omit<ProjectArtifact, 'modified' | 'pair'>;

const mediaKindOf = (file: string) => projectMediaTypeOf(file)?.kind;

function stillsIn(dir: string, folder: string): FoundFile[] {
  const at = join(dir, ...folder.split('/'));
  if (!existsSync(at)) return [];
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) =>
    (entry.isFile() && mediaKindOf(entry.name) === 'still' ? [{ path: projectPathOf(dir, join(at, entry.name)), kind: 'still' as const }] : []));
}

/** Each scene rendered alone: `render --scene` overwrites scene-<id>.mp4, so the file is the scene's newest render. */
function sceneRendersIn(dir: string): FoundFile[] {
  const at = join(dir, 'out', 'wip', 'slices');
  if (!existsSync(at)) return [];
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const scene = /^scene-(.+)\.(mp4|webm|mov)$/.exec(entry.name)?.[1];
    return entry.isFile() && scene ? [{ path: `out/wip/slices/${entry.name}`, kind: 'video' as const, made: { as: 'scene-render', scene } satisfies ProjectMade }] : [];
  });
}

/** Generated footage and images, by provenance.json, which says what made each and its cost. */
function generatedIn(dir: string): FoundFile[] {
  const playing = new Map(Object.entries(readPrevisClipList(dir)).map(([scene, clip]) => [`generated/${clip.file}`, scene]));
  return Object.values(readPaidGenerationProvenance(dir)).flatMap(({ kind, name, model, cost, files, references }): FoundFile[] => {
    const present = files.filter((path) => existsSync(join(dir, ...path.split('/'))));
    if (kind === 'image') {
      return present.filter((path) => mediaKindOf(path) === 'still').map((path) => ({ path, kind: 'still', made: { as: 'image', name, model, cost } }));
    }
    if (kind !== 'video') return [];
    const blockout = references.find((ref) => mediaKindOf(ref.path) === 'video' && existsSync(join(dir, ref.path)))?.path ?? null;
    return present.filter((path) => mediaKindOf(path) === 'video').map((path) => {
      const scene = playing.get(path);
      return { path, kind: 'video', made: { as: 'footage', scene: scene ?? name, plays: scene !== undefined, blockout, model, cost } };
    });
  });
}

/** The project's music tracks; a generated one's cost from the generation whose model and prompt made it. */
function musicIn(dir: string): FoundFile[] {
  const generations = Object.values(readPaidGenerationProvenance(dir));
  return Object.entries(readMusicManifest(join(dir, 'music'))).flatMap(([name, track]): FoundFile[] => {
    const path = `music/${track.file}`;
    if (!existsSync(join(dir, 'music', track.file))) return [];
    const made = generations.find((g) => g.kind === 'audio' && g.model === track.generated?.model && g.prompt === track.generated.prompt);
    return [{
      path, kind: 'audio',
      made: { as: 'music', name, seconds: track.duration, bpm: track.bpm, lufs: track.lufs, model: track.generated?.model ?? null, cost: made?.cost ?? null, fitOf: track.fit?.source ?? null },
    }];
  });
}

/** The pictures in assets/, however deep; a dot folder (a cache) is skipped. */
function assetsIn(dir: string): FoundFile[] {
  const walk = (at: string): FoundFile[] => readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const file = join(at, entry.name);
    if (entry.isDirectory()) return walk(file);
    return entry.isFile() && mediaKindOf(entry.name) === 'still' ? [{ path: projectPathOf(dir, file), kind: 'still' as const, made: { as: 'asset' } satisfies ProjectMade }] : [];
  });
  const assets = join(dir, 'assets');
  return existsSync(assets) ? walk(assets) : [];
}

/** The project's reviewable files, newest first. */
export const listProjectArtifacts = (project: string): ProjectArtifact[] => listProjectArtifactsIn(projectFolderNamed(project));

/** The reviewable files of the project in folder `dir`, newest first. */
export function listProjectArtifactsIn(dir: string): ProjectArtifact[] {
  const renders = listProjectOutVideos(dir).map(({ path }): FoundFile => ({ path, kind: 'video' }));
  const found = [...renders, ...STILL_FOLDERS.flatMap((folder) => stillsIn(dir, folder)), ...sceneRendersIn(dir), ...generatedIn(dir), ...musicIn(dir), ...assetsIn(dir)]
    .map((file): ProjectArtifact => Object.assign(file, { modified: statSync(join(dir, ...file.path.split('/'))).mtime.toISOString() }));
  const paths = new Set(found.map((a) => a.path));
  return found
    .map((artifact) => {
      const pair = transparentPairOf(artifact.path);
      return pair && paths.has(pair) ? { ...artifact, pair } : artifact;
    })
    .toSorted((a, b) => b.modified.localeCompare(a.modified));
}

/** What made the file at `path` in the project, when it's one listProjectArtifacts lists as made. */
export const readProjectMade = (project: string, path: string): ProjectMade | undefined =>
  listProjectArtifacts(project).find((artifact) => artifact.path === path)?.made;

/** `blockout-establish-c140caca1f17.mp4` → `blockout`: what compare calls a footage's reference. */
export const projectReferenceLabelOf = (path: string) => basename(path).split('-')[0];
