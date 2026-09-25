// manifest.ts: everything the Studio Lab shows that isn't code, as one JSON file: the generated-media gallery, the
// image bake-off, the music tracks and the demo cue list, plus the media files they point at. The dev server builds
// it on each request; `studio lab --export` writes it once and copies exactly the files it lists, so what a deploy
// includes is decided here and nowhere else.
//
// Media URLs are relative (`media/<repo path>`), so an exported lab works from any folder of any host, or absolute
// under a `mediaBase` (an R2 bucket, say) when the files live apart from the page.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readSfxCueList } from '../lib/sfx/cue-module.ts';
import type { SfxCueList } from '../lib/sfx/cues.ts';
import { STUDIO_PROJECTS_DIR, STUDIO_ROOT } from '../lib/engine/project/studio-project.ts';
import { loadRenderSnapshot } from '../lib/engine/snapshot/render-snapshot.ts';
import type { SpokenWord } from '../lib/voice-words.ts';

const SCRATCH_DIR = join(STUDIO_ROOT, 'scratch');
const IMAGE_BAKEOFF_DIR = join(SCRATCH_DIR, 'image-bakeoff');

/** The project the cue editor opens: the one `studio sfx draft` was tuned on. */
export const LAB_SFX_CUE_DEMO_PROJECT = '2026-09-simple-buy-box-story';

export const LAB_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

export type LabManifest = {
  /** True only when a local `studio lab` is serving it: the cue editor can save. An exported lab is read-only. */
  writable: boolean;
  gallery: LabGalleryItem[];
  bakeoff: LabImageBakeoff | null;
  music: LabMusicTrack[];
  /** The demo cue list, or null when its project has none (or the deploy left its video out). */
  sfxCues: LabSfxCuePayload | null;
};

/** Decides which media files go in: a deploy's filter, by path from the repo root. */
export type LabMediaFilter = (repoPath: string) => boolean;

/**
 * The manifest, and the files its URLs name: path under the media root (`media/…`) → absolute path. With `wavAsFlac`
 * a WAV's path ends `.flac` instead, and whoever copies the files encodes it.
 */
export function buildLabManifest({ writable, include = () => true, mediaBase = '', wavAsFlac = false }: { writable: boolean; include?: LabMediaFilter; mediaBase?: string; wavAsFlac?: boolean }) {
  const files = new Map<string, string>();
  const media = labMediaRegister(include, files, mediaBase, wavAsFlac);
  const manifest: LabManifest = {
    writable,
    gallery: listLabGeneratedMedia(media),
    bakeoff: readLabImageBakeoff(media),
    music: listLabMusicTracks(media),
    sfxCues: readLabSfxCuePayload(join(STUDIO_PROJECTS_DIR, LAB_SFX_CUE_DEMO_PROJECT), media),
  };
  return { manifest, files };
}

/** Registers a media file and returns its URL, or null when it's missing or the deploy leaves it out. */
export type LabMediaRegister = (file: string) => string | null;

/**
 * A register that records each file it hands out in `files`, keyed by its path under the media root (`media/…`).
 * Its URL is that path, under `mediaBase` when the media is hosted elsewhere.
 */
export function labMediaRegister(include: LabMediaFilter, files: Map<string, string>, mediaBase = '', wavAsFlac = false): LabMediaRegister {
  return (file) => {
    const repoPath = relative(STUDIO_ROOT, file).split(sep);
    if (!existsSync(file) || !include(repoPath.join('/'))) return null;
    const path = `media/${repoPath.map(encodeURIComponent).join('/')}`;
    const key = wavAsFlac ? path.replace(/\.wav$/, '.flac') : path;
    files.set(key, file);
    return mediaBase + key;
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

export type LabGalleryItem = {
  id: string; where: string; name: string; kind: ProvenanceEntry['kind']; model: string; prompt: string; params: Record<string, unknown>;
  cost: number | null; generatedAt: string | null; files: string[]; references: string[];
};

/**
 * Everything `studio gen` has made, read from each generated/provenance.json in projects/ and scratch/. An entry
 * whose files are all gone, or all left out of a deploy, is dropped.
 */
function listLabGeneratedMedia(media: LabMediaRegister): LabGalleryItem[] {
  return [...subdirs(STUDIO_PROJECTS_DIR), ...subdirs(SCRATCH_DIR)].flatMap((folder) => {
    const provenance = join(folder, 'generated', 'provenance.json');
    if (!existsSync(provenance)) return [];
    return Object.entries(readJson<Record<string, ProvenanceEntry>>(provenance)).flatMap(([key, e]): LabGalleryItem[] => {
      const files = e.files.map((f) => media(join(folder, f))).filter((u) => u !== null);
      if (!files.length) return [];
      return [{
        id: `${relative(STUDIO_ROOT, folder)}/${key}`, where: relative(STUDIO_ROOT, folder), name: e.name, kind: e.kind,
        model: e.model, prompt: e.prompt, params: e.params ?? {}, cost: e.cost ?? null, generatedAt: e.generatedAt ?? null, files,
        references: (e.references ?? []).map((r) => media(join(folder, r.path))).filter((u) => u !== null),
      }];
    });
  });
}

// ---------- the image bake-off ----------

export type LabBakeoffBrief = { id: string; label: string; aspect: string; purpose: string; good: string; prompt: string; ref: string | null };
export type LabBakeoffModel = { short: string; id: string; name: string; price: string; rank: string; takes: string; why: string; missing: string | null };
export type LabBakeoffCell = { tag: 'good' | 'mixed' | 'bad'; text: string; seconds: number | null; size: string | null };

export type LabImageBakeoff = {
  briefs: LabBakeoffBrief[]; models: LabBakeoffModel[];
  /** Keyed `${brief}-${model short}`, which is also the gallery item's name. */
  cells: Record<string, LabBakeoffCell>;
  /** The reviewer's closing verdict, as the HTML the bake-off's own page shows. */
  recommendation: string;
};

/** scratch/image-bakeoff's briefs, models and per-image review, joined. Null when that folder is gone. */
function readLabImageBakeoff(media: LabMediaRegister): LabImageBakeoff | null {
  const read = <T,>(name: string) => readJson<T>(join(IMAGE_BAKEOFF_DIR, name));
  if (!existsSync(join(IMAGE_BAKEOFF_DIR, 'notes.json'))) return null;
  const sets = read<{ sets: (Omit<LabBakeoffBrief, 'ref'> & { ref?: string })[]; models: { id: string; short: string }[] }>('sets.json');
  const notes = read<{
    models: Record<string, Omit<LabBakeoffModel, 'short' | 'id' | 'missing'>>; missing: Record<string, string>;
    cells: Record<string, { tag: LabBakeoffCell['tag']; text: string }>; recommendation: string;
  }>('notes.json');
  const runs = read<Record<string, { seconds?: number; size?: string }>>('runs.json');
  return {
    briefs: sets.sets.map((s) => ({ ...s, ref: s.ref ? media(join(IMAGE_BAKEOFF_DIR, s.ref)) : null })),
    models: sets.models.map((m) => ({ short: m.short, id: m.id, ...notes.models[m.short], missing: notes.missing[m.short] ?? null })),
    cells: Object.fromEntries(Object.entries(notes.cells).map(([key, c]) => [key, { ...c, seconds: runs[key]?.seconds ?? null, size: runs[key]?.size ?? null }])),
    recommendation: notes.recommendation,
  };
}

// ---------- music ----------

export type LabMusicTrack = {
  id: string; project: string; name: string; url: string; duration: number; bpm: number; beats: number[];
  /** Set when this track is itself a fit of another: the seams it was cut at. */
  fit?: { source: string; seams: number[] };
};

/** Every track `studio music` has written to a project's music/manifest.json, bar those a deploy leaves out. */
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

// ---------- the cue list ----------

export type LabSfxCueScene = { id: string; start: number; end: number };

/** What the cue editor loads: the list, the words its rules judge accents against, and the video to play it over. */
export type LabSfxCuePayload = {
  project: string;
  list: SfxCueList;
  words: SpokenWord[];
  scenes: LabSfxCueScene[];
  duration: number;
  /** The rendered video's URL, or null when it hasn't been rendered or a deploy left it out. */
  video: string | null;
  /** A hash of cues.json as loaded: a save sends it back, and is refused if the file has changed since. */
  revision: string;
};

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
