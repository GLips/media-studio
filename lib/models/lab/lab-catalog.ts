// lab-catalog.ts: the shape of the lab's catalog, everything it shows that isn't code, which lib/engine/lab fills from
// the projects and the app draws. An export writes the same document as a file.
import type { SfxCueList } from '#sfx/cues.ts';
import type { SfxRequest } from '#sfx/library.ts';
import type { SpokenWord } from '#models/voice/voice-words.ts';

export type LabCatalog = {
  /**
   * True in `studio lab --export`'s static copy: read-only (the cue editor downloads its list instead of saving) and
   * with no projects to link to. False when the app serves it from this machine.
   */
  exported: boolean;
  gallery: LabGalleryItem[];
  music: LabMusicTrack[];
  /** The demo cue list, or null when its project has none (or the deploy left its video out). */
  sfxCues: LabSfxCuePayload | null;
};

type GeneratedMediaKind = 'image' | 'video' | 'audio';

export type LabGalleryItem = {
  id: string; project: string; name: string; kind: GeneratedMediaKind; model: string; prompt: string; params: Record<string, unknown>;
  cost: number | null; generatedAt: string | null; files: string[]; references: string[];
};

export type LabMusicTrack = {
  id: string; project: string; name: string; url: string; duration: number; bpm: number; beats: number[];
  /** Set when this track is itself a fit of another: the seams it was cut at. */
  fit?: { source: string; seams: number[] };
};

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

/** One cue's edits as the editor saves them; `sound: null` mutes it. */
export type LabSfxCueEdit = { id: string; sound?: SfxRequest | null; nudge?: number; volume?: number };
