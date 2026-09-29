// video-layout.ts: a video laid out on its resolved timeline, in the seconds its scenes draw in. Every instant is one
// of the timeline's frames divided by the fps, never a sum of lengths, so a scene's start is exactly its cut's frame and
// the frame a scene paints on is decided in whole frames.
//
// A scene's clock counts seconds from its cut, so it runs negative while the scene fades in over the one before and
// past `dur` while the next fades in over it.

import { motionCurves } from '#lib/picture/motion/models/motion.ts';
import type { Voice } from '#lib/timing/voice/models/voice-manifest.ts';
import { findSpokenPhrase, type SpokenWord } from '#lib/timing/voice/models/voice-words.ts';
import type { Timeline } from './timeline.ts';

/** A voiced line's place in its scene, in scene seconds. */
export type LineSpan = {
  start: number;
  end: number;
  /**
   * The moment a fraction `f` of the way through the line: for beats between words, or spread across the line.
   * Anchor to a spoken word with `word()` instead.
   */
  at(f: number): number;
  /**
   * When a word or phrase of the line is spoken, e.g. `s.line('pick').word('marked-down price').start`. Case and
   * punctuation don't matter; `nth` picks a later occurrence. The anchor to reach for when a beat lands on a word.
   */
  word(phrase: string, nth?: number): { start: number; end: number };
};

/** A scene's length and where its lines fall, in scene seconds. */
export type SceneTimes = {
  dur: number;
  line(id: string): LineSpan;
};

/** What a scene draws from: its own time, and its times. */
export type SceneClock = SceneTimes & {
  /** Seconds since the scene's cut. Negative while fading in, past `dur` while fading out. */
  t: number;
};

/** One scene where the video plays it. */
export type ScenePlacement = {
  id: string;
  /** Its cut and the next scene's (or the video's end), in video frames. */
  from: number;
  to: number;
  /** The frames it's on screen: its cut to the next, widened by a crossfade either side. */
  visible: { from: number; to: number };
  /** Its cut and its length to the next cut, in seconds. */
  start: number;
  dur: number;
  /** The crossfade into it, in seconds, centred on its cut; 0 for a hard cut or the first scene. */
  xfade: number;
  /** Its lines, in scene seconds, with their words from each line's start. */
  spans: Readonly<Record<string, { start: number; end: number; words: readonly SpokenWord[] }>>;
};

export type VoiceCue = {
  id: string;
  src: string | null;
  /** In video seconds, from its first frame. */
  start: number;
  end: number;
  text: string;
  lufs: number | null;
};

export type VideoLayout = {
  fps: number;
  /** The composition's length: the timeline's end, which its last line ends by. */
  frames: number;
  scenes: readonly ScenePlacement[];
  cues: readonly VoiceCue[];
};

/** The video's scenes and voice lines where `timeline` puts them; `voice` holds each placed line's audio and text. */
export function videoLayoutOf(timeline: Timeline, voice: Voice): VideoLayout {
  const { fps } = timeline;
  const cues: VoiceCue[] = [];
  const scenes = timeline.scenes.map((placed, k): ScenePlacement => {
    const spans: Record<string, ScenePlacement['spans'][string]> = {};
    placed.lines.forEach(({ id, frame, duration }) => {
      const line = voice[id];
      if (!line) throw new Error(`scene ${placed.id} speaks line ${id}, which the video's voice doesn't have: pass defineVideo the manifest its timeline reads`);
      const start = (frame - placed.from) / fps;
      spans[id] = { start, end: start + duration, words: line.words };
      cues.push({ id, src: line.src, start: frame / fps, end: frame / fps + duration, text: line.text, lufs: line.lufs });
    });
    return {
      id: placed.id, from: placed.from, to: placed.to, visible: placed.visible,
      start: placed.from / fps, dur: (placed.to - placed.from) / fps, xfade: k === 0 ? 0 : placed.crossfade, spans,
    };
  });
  // scenesAtFrame paints at most two scenes, so a scene shorter than its two half-fades can't be shown.
  scenes.forEach((scene, k) => {
    const out = scenes[k + 1]?.xfade ?? 0;
    if (scene.xfade / 2 + out / 2 > scene.dur) throw new Error(`scene ${scene.id} lasts ${scene.dur.toFixed(2)}s, shorter than its fades (${((scene.xfade + out) / 2).toFixed(2)}s): lengthen it or make a cut`);
  });
  return { fps, frames: timeline.end, scenes, cues };
}

/**
 * The scenes painted on `frame`, bottom first, by index, each with its opacity. A crossfade straddles its cut: the
 * outgoing scene keeps playing at full opacity under the incoming one as it fades up. Which scenes paint is read off
 * their `visible` frames, the ones they're mounted on, so a fade still short of opaque always has its outgoing scene
 * under it.
 */
export function scenesAtFrame({ scenes, fps }: VideoLayout, frame: number): { k: number; alpha: number }[] {
  const k = Math.max(0, scenes.findIndex((s, j) => frame >= s.from && (frame < s.to || j === scenes.length - 1)));
  const fadeInto = (j: number) => {
    const { from, xfade } = scenes[j];
    return motionCurves.dissolve((frame - from + (xfade * fps) / 2) / (xfade * fps));
  };
  if (k > 0 && scenes[k].xfade && frame < scenes[k - 1].visible.to) return [{ k: k - 1, alpha: 1 }, { k, alpha: fadeInto(k) }];
  const next = scenes[k + 1];
  if (next?.xfade && frame >= next.visible.from) return [{ k, alpha: 1 }, { k: k + 1, alpha: fadeInto(k + 1) }];
  return [{ k, alpha: 1 }];
}

export function sceneTimes(scene: ScenePlacement): SceneTimes {
  return {
    dur: scene.dur,
    line: (id) => {
      const span = scene.spans[id];
      if (!span) throw new Error(`scene ${scene.id} has no line "${id}"`);
      return {
        start: span.start,
        end: span.end,
        at: (f) => span.start + (span.end - span.start) * f,
        word: (phrase, nth) => {
          const w = findSpokenPhrase(span.words, phrase, nth);
          return { start: span.start + w.start, end: span.start + w.end };
        },
      };
    },
  };
}

/** The clock scene `scene` draws on at video second `t`. */
export const sceneClockAt = (scene: ScenePlacement, t: number): SceneClock => ({ ...sceneTimes(scene), t: t - scene.start });
