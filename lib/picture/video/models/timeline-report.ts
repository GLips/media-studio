// timeline-report.ts: the video as its composition laid it out (timeline.json), emitted once per render for the
// render pipeline, the checks and `studio sfx`, which read it in Node.

import type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';

/** What `studio gen video` asks for a previs scene, read from the timeline report. */
export type PrevisRequest = { blockout: '3d' | '2d'; prompt: string; references: readonly string[]; audio: boolean; from: number; duration: number };

/** What lib/output/render/engine/render-pipeline.ts needs about the timeline (for the sidecar and reports), emitted once as an artifact. */
export type TimelineReport = {
  title: string;
  fps: number;
  width: number;
  height: number;
  /** Whether it renders transparent (VideoFormat.transparent), which delivers it as WebM and HEVC .mov with alpha. */
  transparent: boolean;
  duration: number;
  /** The composition's length, which can run a little past `duration` (see VideoLayout.frames). */
  durationInFrames: number;
  /** `rung` only where the scene's binding declares one. */
  /**
   * `from` and `to` are its cut and the next one's, in frames, and `visible` the frames it's on screen, its crossfades
   * included; `start` and `dur` are its cuts in seconds.
   */
  scenes: { id: string; from: number; to: number; visible: { from: number; to: number }; start: number; dur: number; note?: string; rung?: SceneRung; lines: readonly string[]; previs?: PrevisRequest }[];
  /** Each voice line, with every word as it's spoken (spread by length over an estimated line), in video seconds. */
  cues: { id: string; start: number; end: number; text: string; voiced: boolean; words: { text: string; start: number; end: number }[] }[];
  /** The captions as .srt and .vtt, paged by the style's sidecar rule; null for a video with nothing to caption. */
  captions: { srt: string; vtt: string } | null;
  /** Where one scene dissolves into the next, in video seconds; a hard cut has none. */
  crossfades: { from: string; to: string; start: number; end: number }[];
  /** Each scene's `expect`, in video seconds. */
  expectations: TimelineExpectation[];
  /** Whether this render plays the project's cue list (see lib/timing/sound/models/cues.ts), which plays its clicks, keys and accents. */
  sfxCueList: boolean;
  /** Each of `VideoDef.sounds`, landing `at` video seconds, with the take it plays's recipe (`impact`, `whip`…). */
  sounds: { id: string; at: number; sound: string }[];
};
/** A scene's `expect` (see SceneExpectation), its `during` in video seconds. */
export type TimelineExpectation = { scene: string; start: number; end: number } & ({ see: string } | { hold: string; for: number; within?: number });
