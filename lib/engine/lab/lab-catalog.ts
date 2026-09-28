// lab-catalog.ts: everything the lab shows that isn't code, as one JSON document: the generated-media gallery, the
// music tracks and every project's cue list, plus the media files they point at. The app serves it fresh on each request;
// `studio lab --export` writes it once and copies exactly the files it lists, so what a deploy includes is decided
// here and nowhere else.
//
// Every file is a project's. Served, its URL is the app's one media door (`/media/<project>?path=…`), shared with the
// review screen; exported, it's `/media/<project>/<path>`, where the export copies it.
//
// Negative space: nothing outside work/projects/ is read. The scratch workspace is gitignored, so what it holds exists on one machine,
// and third-party reference footage (the reel in .agent_cache/) is never a project's, so an export can't carry it.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readSfxCueList } from '#sfx/cue-module.ts';
import { STUDIO_PROJECTS_DIR } from '#engine/project/studio-project.ts';
import { loadRenderSnapshot } from '#engine/snapshot/render-snapshot.ts';
import type { LabCatalog, LabGalleryItem, LabMusicTrack, LabSfxCuePayload } from '#models/lab/lab-catalog.ts';

/** Registers a media file and returns its URL, or null when it's missing. */
export type LabMediaRegister = (file: string) => string | null;

/**
 * The catalog, and the files its URLs name: URL path → absolute path. `exported` lays the URLs out as the export's own
 * files (`media/<project>/<path>`), and a WAV's ends `.flac`, which whoever copies the files encodes.
 */
export function buildLabCatalog({ exported }: { exported: boolean }) {
  const files = new Map<string, string>();
  const media = labMediaRegister(files, exported);
  const catalog: LabCatalog = {
    exported,
    gallery: listLabGeneratedMedia(media),
    music: listLabMusicTracks(media),
    sfxCues: subdirs(STUDIO_PROJECTS_DIR).flatMap((folder) => readLabSfxCuePayload(folder, media) ?? []),
  };
  return { catalog, files };
}

export function labMediaRegister(files: Map<string, string>, exported: boolean): LabMediaRegister {
  return (file) => {
    const [project, ...path] = relative(STUDIO_PROJECTS_DIR, file).split(sep);
    if (!existsSync(file) || project === '..') return null;
    const url = exported
      ? `/media/${[project, ...path].map(encodeURIComponent).join('/')}`.replace(/\.wav$/, '.flac')
      : `/media/${encodeURIComponent(project)}?${new URLSearchParams({ path: path.join('/') })}`;
    files.set(url, file);
    return url;
  };
}

/** A folder's children that are folders, or none when it doesn't exist. */
const subdirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name)) : []);
const readJson = <T,>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;

// ---------- generated media ----------

type ProvenanceEntry = {
  name: string; kind: 'image' | 'video' | 'audio'; model: string; prompt: string; params?: Record<string, unknown>;
  references?: { path: string }[]; files: string[]; cost?: number; generatedAt?: string;
};

/**
 * Everything `studio gen` has made, read from each project's generated/provenance.json. An entry whose files are all
 * gone is dropped.
 */
function listLabGeneratedMedia(media: LabMediaRegister): LabGalleryItem[] {
  return subdirs(STUDIO_PROJECTS_DIR).flatMap((folder) => {
    const provenance = join(folder, 'generated', 'provenance.json');
    if (!existsSync(provenance)) return [];
    const project = relative(STUDIO_PROJECTS_DIR, folder);
    return Object.entries(readJson<Record<string, ProvenanceEntry>>(provenance)).flatMap(([key, e]): LabGalleryItem[] => {
      const files = e.files.map((f) => media(join(folder, f))).filter((u) => u !== null);
      if (!files.length) return [];
      return [{
        id: `${project}/${key}`, project, name: e.name, kind: e.kind, model: e.model, prompt: e.prompt, params: e.params ?? {},
        cost: e.cost ?? null, generatedAt: e.generatedAt ?? null, files,
        references: (e.references ?? []).map((r) => media(join(folder, r.path))).filter((u) => u !== null),
      }];
    });
  });
}

// ---------- music ----------

/** Every track `studio music` has written to a project's music/manifest.json whose file is there. */
function listLabMusicTracks(media: LabMediaRegister): LabMusicTrack[] {
  return subdirs(STUDIO_PROJECTS_DIR).flatMap((folder) => {
    const manifest = join(folder, 'music', 'manifest.json');
    if (!existsSync(manifest)) return [];
    const tracks = readJson<Record<string, { file: string; duration: number; bpm: number; beats: number[]; fit?: { source: string; seams: number[] } }>>(manifest);
    const project = relative(STUDIO_PROJECTS_DIR, folder);
    return Object.entries(tracks).flatMap(([name, t]): LabMusicTrack[] => {
      const url = media(join(folder, 'music', t.file));
      if (!url) return [];
      return [{
        id: `${project}/${name}`, project, name, url, duration: t.duration, bpm: t.bpm, beats: t.beats,
        ...(t.fit && { fit: { source: t.fit.source, seams: t.fit.seams } }),
      }];
    });
  });
}

// ---------- the cue lists ----------

export const labSfxCueRevision = (project: string) =>
  createHash('sha256').update(readFileSync(join(project, 'sfx', 'cues.json'))).digest('hex').slice(0, 16);

/**
 * A project's cue list as the editor loads it, or null when the project has none. Its words and scenes are the
 * rendered video's, from its snapshot, so they line up with the video it plays under the list.
 */
export function readLabSfxCuePayload(project: string, media: LabMediaRegister): LabSfxCuePayload | null {
  const list = existsSync(project) ? readSfxCueList(project) : null;
  if (!list) return null;
  const rendered = join(project, 'out', 'video.mp4');
  const loaded = existsSync(rendered) ? loadRenderSnapshot(rendered) : null;
  const timeline = loaded?.kind === 'snapshot' ? loaded.snapshot.timeline : null;
  const lastCue = Math.max(0, ...list.cues.map((c) => c.event.at));
  return {
    project: relative(STUDIO_PROJECTS_DIR, project),
    list,
    words: timeline?.cues.flatMap((c) => c.words) ?? [],
    scenes: timeline?.scenes.map((s) => ({ id: s.id, start: s.start, end: s.start + s.dur })) ?? [],
    duration: timeline?.duration ?? lastCue + 2,
    video: media(rendered),
    revision: labSfxCueRevision(project),
  };
}
