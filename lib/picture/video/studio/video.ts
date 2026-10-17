// video.ts: a video as its project defines it (defineVideo): its storyboard resolved against the recorded voice and
// the music, each scene's picture bound to the clock that gives it, and its music bed and sounds. The schedule is the
// storyboard's alone (lib/timing/storyboard/); laidVideoOf only pairs each scene's picture with where the resolved
// timeline placed it (video-layout.ts).

import type { ReactNode } from 'react';
import { DEFAULT_VIDEO_FORMAT, type VideoFormat } from '#lib/picture/frame/models/frame.ts';
import type { MusicBed } from '#lib/timing/sound/models/mix.ts';
import { resolveStoryboard, storyboardDiagnosticsMessage, type StoryboardMusic } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import type { Storyboard, StoryboardTimelineScenes, TimelineOfStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { bindTimeline, type TimelineBinding } from '#lib/timing/timeline/models/bind-timeline.ts';
import type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
import type { Timeline } from '#lib/timing/timeline/models/timeline.ts';
import { videoLayoutOf, type SceneClock, type ScenePlacement, type SceneTimes, type VideoLayout } from '#lib/timing/timeline/models/video-layout.ts';
import type { RecordedVoice, Voice } from '#lib/timing/voice/models/voice-manifest.ts';
import type { SfxSound } from '#lib/timing/sound/studio/sfx.tsx';
import { captionTable, type CaptionTableRows, type CaptionTrack } from '#lib/picture/captions/models/caption-track.ts';
import type { CaptionStyle } from '#lib/picture/captions/studio/caption-style.tsx';

/**
 * What a scene promises; `studio check` fails if it isn't kept.
 * - `see`: the named highlight is drawn on screen, clear of tags and the caption, for all `during`.
 * - `hold`: the tracked element (motion name, or `owner/name`) is steady and visible for `for` seconds within
 *   `during`: centre and size within `within` px (default 2), values within 0.5%, 95% opaque, dissolves counted.
 */
export type SceneExpectation =
  | { see: string; during: { start: number; end: number } }
  | { hold: string; for: number; within?: number; during: { start: number; end: number } };

/**
 * A scene rendered into generated footage by `studio gen video`: the scene's own render is the blockout (see
 * blockout.tsx, flat-blockout.tsx) it sends as the reference video. Once footage exists the scene plays it, until the
 * next `studio gen video` replaces it; the Studio's `blockouts` prop shows the blockout again.
 */
export type ScenePrevis = {
  /**
   * Which blockout the render draws, so the request tells the model what it's looking at: `3d`, grey primitives under
   * a moving camera (`<Blockout>`), or `2d`, labelled flat pieces (`<FlatBlockout>`).
   */
  blockout: '3d' | '2d';
  /** The finished shot: what each blockout subject is, by its tint, plus light, lens and look. */
  prompt: string;
  /** Stills of the subjects, relative to the project, sent as reference images. */
  references?: readonly string[];
} & (
  | {
    /** Generate sound with the picture. Off by default: the voice and music carry a video's sound. */
    audio: true;
    /** Footage with sound can't be retimed: the sound would stretch with it. */
    retime?: never;
  }
  | {
    audio?: false;
    /**
     * Retimes the footage without paying for it again, as `fitTake` does a take: `[[sceneTime, blockoutTime], ...]`
     * plays the moment the blockout showed at `blockoutTime` at `sceneTime`.
     */
    retime?(s: SceneTimes): readonly (readonly [scene: number, blockout: number])[];
  }
);

/** A scene's picture, bound to its storyboard scene by `sceneForTimelineClock`. Its timing is the storyboard's. */
export type SceneDef = {
  id: string;
  /** How far up the fidelity ladder it is. Undeclared, the snapshot and review name no rung for it rather than guess one. */
  rung?: SceneRung;
  previs?: ScenePrevis;
  render(s: SceneClock): ReactNode;
  expect?(s: SceneTimes): readonly SceneExpectation[];
};

/** What a project's video.tsx states, beside its scenes: its look, its sound, how it renders. */
type VideoSettings = {
  title: string;
  /**
   * Its size, defaulting to 1920×1080: `{ width: 1080, height: 1920 }` for a vertical cut, `{ transparent: true }` for
   * an overlay. It plays at its storyboard's fps (`fps` on defineStoryboard); a rate named here must agree with it.
   */
  format?: Partial<VideoFormat>;
  /**
   * How many tabs render it at once, in place of the default (1 for a project that paints, 3 otherwise); a command's
   * --workers overrides it. Fewer for heavy three.js scenes: the tabs share one GPU, and each stage holds a WebGPU
   * device of its own.
   */
  renderWorkers?: number;
  /** A music bed under the whole video, ducked under the voice: `bed: { track: music.bed }`. See `studio music`. */
  bed?: MusicBed;
  /**
   * Play the project's sound-effect cue list, sfx/cues.json, which `studio sfx draft` writes. It plays the clicks,
   * keys, scene changes, camera moves and reveals, so the CursorPath and TakeCursor `<Sfx>` go silent; sounds a scene
   * places itself still play from their `<Sfx>`.
   */
  sfxCueList?: boolean;
  /**
   * Sounds on the video's own clock, each landing `at` video seconds: a music-led video's hits and whips, placed on
   * its beat grid. A cut doesn't stop one, as it stops an `<Sfx>` in a scene, so a whip can run up to its cut and
   * ring on past it.
   */
  sounds?: readonly VideoSound[];
  /**
   * Pins what `Date` says while the video renders, e.g. '2026-09-08T12:00:00' (local time unless it names a zone), so
   * host components that label "5 minutes ago" agree with captures made with the same `captureShots({ clock })`.
   */
  clock?: string;
};

/** What `defineVideo` takes: the storyboard, what it's timed against, and a binding per scene. */
export type VideoSpec<S extends Storyboard> = VideoSettings & {
  /**
   * How it's captioned: a `style` (`pillCaptions()` unless named, or `wordPopCaptions()`), and for a silent video a
   * `table` of rows per scene, each from a moment of its scene, which defineVideo times on the resolved storyboard. A
   * voiced video captions its lines. The .srt and .vtt page the same track by the style's sidecar rule.
   */
  captions?: { style?: CaptionStyle; table?: CaptionTableRows<StoryboardTimelineScenes<S['scenes']>> };
  /** The project's storyboard.ts `storyboard`: every scene, line and cue, and so where each falls. */
  storyboard: S;
  /** audio/manifest.ts's `voice`, the recorded lines; leave it out for a video with none yet. */
  voice?: RecordedVoice;
  /** music/index.ts's `music`, which a `{ music }` grid is fitted to. */
  music?: StoryboardMusic;
  /**
   * Each scene's picture, keyed by its storyboard id: a binding gets its scene's clock and, for a scene that replays
   * others, their bindings (bind-timeline.ts).
   */
  scenes: { readonly [K in keyof S['scenes'] & string]: TimelineBinding<TimelineOfStoryboard<S>, K, SceneDef> };
};

/** A video resolved: its storyboard's timeline, every line it places (estimated ones with no `src`), its scenes bound. */
export type VideoDef = VideoSettings & {
  /** Its caption style, and a silent video's table timed to the frame. */
  captions?: { style?: CaptionStyle; table?: CaptionTrack };
  storyboard: Storyboard;
  timeline: Timeline;
  voice: Voice;
  /** Its scenes, in the timeline's order. */
  scenes: readonly SceneDef[];
};

/** A sound in `VideoDef.sounds`. Given several takes, `id` picks one, as `<Sfx>`'s does. */
export type VideoSound = { at: number; sound: SfxSound | readonly SfxSound[]; id?: string | number; volume?: number };

/**
 * The project's video: its storyboard resolved against `voice` and `music`, and each scene bound to its clock. Throws,
 * listing every diagnostic, unless the storyboard resolves cleanly: a cue whose word has gone stops it here.
 */
export function defineVideo<const S extends Storyboard>({ storyboard, voice, music, scenes, captions, ...settings }: VideoSpec<S>): VideoDef {
  const { timeline, voice: placed, diagnostics } = resolveStoryboard(storyboard, { voice, music });
  if (!timeline || diagnostics.length) throw new Error(storyboardDiagnosticsMessage(`the storyboard of ${settings.title}`, diagnostics));
  const table = captions?.table && captionTable(timeline, captions.table);
  return {
    ...settings, ...(captions && { captions: { style: captions.style, table } }),
    storyboard, timeline, voice: placed, scenes: bindTimeline(timeline, scenes),
  };
}

/** The format the video renders at: its timeline's fps, and what it names or the defaults for the rest. */
export function videoFormatOf(video: VideoDef): VideoFormat {
  const { fps } = video.timeline, named = video.format?.fps;
  if (named !== undefined && named !== fps) throw new Error(`the video names ${named} fps, but its storyboard resolves at ${fps}: set the rate on defineStoryboard({ fps }) alone`);
  const format = { ...DEFAULT_VIDEO_FORMAT, ...video.format, fps };
  for (const key of ['width', 'height'] as const) {
    const value = format[key];
    if (!(Number.isInteger(value) && value > 0)) throw new Error(`the video's ${key} is ${value}: give it a whole number above 0`);
  }
  // H.264's, VP9's and HEVC's 4:2:0 frames are whole 2×2 blocks.
  if (format.width % 2 || format.height % 2) throw new Error(`the video is ${format.width}×${format.height}: it needs an even width and height`);
  return format;
}

/** A scene's picture where the timeline placed it, with its storyboard row's on-screen as its note. */
export type LaidScene = SceneDef & ScenePlacement & { note: string };
export type LaidVideo = Omit<VideoLayout, 'scenes'> & { scenes: readonly LaidScene[] };

/** Each of the video's scenes paired with its place on the timeline. defineVideo bound them in the timeline's order. */
export function laidVideoOf(video: VideoDef): LaidVideo {
  const layout = videoLayoutOf(video.timeline, video.voice);
  const scenes = layout.scenes.map((placed, k): LaidScene => Object.assign({}, video.scenes[k], placed, { note: video.storyboard.scenes[placed.id].onScreen }));
  return { ...layout, scenes };
}
