// timeline.ts: lays a video's scenes out against its voiced lines. Pure, so the composition, the Studio and the
// render script's reports all agree on where everything falls.
//
// A scene's length is lead + its lines (with `gap` between them) + tail, or `min` if that's longer. Rewording a line
// re-times the video on its own, which is why scene code anchors beats to `s.line(id)` rather than to seconds.
//
// Authoring is in seconds; frames only appear at the edges. A scene's clock is continuous time since its nominal start
// (the narration boundary), so it runs negative while the scene fades in over the previous one and past `dur` while
// the next fades in over it. Sequences only decide what's mounted.

import type { ReactNode } from 'react';
import { findSpokenPhrase, type SpokenWord } from '../voice-words.ts';
import { ease } from './motion.ts';

export type VoiceLine = {
  /** An imported WAV, or null for a line timed by `tts --estimate` that has no audio yet. */
  src: string | null;
  duration: number;
  text: string;
  /** Every script word, timed by whisper, or spread by length over an estimated line. */
  words: readonly SpokenWord[];
};
export type Voice = Readonly<Record<string, VoiceLine>>;

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

/** What a scene draws from: its own time and its lines. `Id` is the scene's declared line ids. */
export type SceneClock<Id extends string = string> = {
  /** Seconds since the scene's nominal start. Negative while fading in, past `dur` while fading out. */
  t: number;
  dur: number;
  line(id: Id): LineSpan;
};

type SceneTiming = {
  /** Seconds before the first line. Default 0.5. */
  lead?: number;
  /** Seconds between lines. Default 0.35. */
  gap?: number;
  /** Seconds after the last line. Default 0.6. */
  tail?: number;
  /** The scene lasts at least this long. */
  min?: number;
  /** A hard cut from the previous scene instead of a crossfade. */
  cut?: boolean;
};

export type SceneDef = SceneTiming & {
  id: string;
  lines: readonly string[];
  // Method syntax on purpose: a scene's render takes a clock narrowed to its own line ids, which a function-typed
  // property would reject as a wider parameter.
  render(s: SceneClock): ReactNode;
};

/**
 * A scene: its voice lines, its timing, and what it draws. `render` may call hooks; it runs as a component.
 *
 *   defineScene({ id: 'ladder', lines: ['ladder'], lead: 0.3, render: (s) => <Ladder s={s} /> })
 */
export function defineScene<const L extends readonly string[] = readonly []>(
  scene: SceneTiming & { id: string; lines?: L; render: (s: SceneClock<L[number]>) => ReactNode },
): SceneDef {
  return { ...scene, lines: scene.lines ?? [] } as SceneDef;
}

export type VideoDef = {
  title: string;
  voice: Voice;
  scenes: readonly SceneDef[];
  /** Crossfade length in seconds, centred on each cut. Default 0.5. */
  xfade?: number;
};

export const defineVideo = (video: VideoDef): VideoDef => video;

export type LaidScene = SceneDef & {
  /** Nominal start, in seconds: where its narration layout begins. */
  start: number;
  dur: number;
  /** The crossfade into this scene, in seconds; 0 for a hard cut or the first scene. */
  xfade: number;
  spans: Readonly<Record<string, { start: number; end: number; words: readonly SpokenWord[] }>>;
};
export type VoiceCue = { id: string; src: string | null; start: number; end: number; text: string };
export type Timeline = { duration: number; scenes: LaidScene[]; cues: VoiceCue[] };

export function layoutVideo(video: VideoDef): Timeline {
  const xfade = video.xfade ?? 0.5;
  if (!Number.isFinite(xfade) || xfade < 0) throw new Error(`xfade is ${xfade}`);
  const cues: VoiceCue[] = [];
  const seen = new Set<string>();
  const sceneOfLine = new Map<string, string>();
  let start = 0;
  const scenes = video.scenes.map((scene, i): LaidScene => {
    if (seen.has(scene.id)) throw new Error(`two scenes are called "${scene.id}"`);
    seen.add(scene.id);
    const { lead = 0.5, gap = 0.35, tail = 0.6, min = 0 } = scene;
    for (const [name, value] of Object.entries({ lead, gap, tail, min })) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`scene ${scene.id}: ${name} is ${value}`);
    }
    const spans: Record<string, { start: number; end: number; words: readonly SpokenWord[] }> = {};
    let cursor = lead;
    scene.lines.forEach((id, j) => {
      const voiced = video.voice[id];
      if (!voiced) throw new Error(`scene ${scene.id}: line "${id}" isn't in audio/manifest.ts. Add it to voiceover.json and run npm run tts.`);
      if (!Number.isFinite(voiced.duration) || voiced.duration <= 0) throw new Error(`line "${id}" lasts ${voiced.duration}s`);
      const owner = sceneOfLine.get(id);
      if (owner) throw new Error(`scene ${scene.id}: line "${id}" is already spoken in scene ${owner}`);
      sceneOfLine.set(id, scene.id);
      if (j > 0) cursor += gap;
      spans[id] = { start: cursor, end: cursor + voiced.duration, words: voiced.words };
      cues.push({ id, src: voiced.src, start: start + cursor, end: start + cursor + voiced.duration, text: voiced.text });
      cursor += voiced.duration;
    });
    const dur = Math.max(cursor + tail, min);
    const laid = { ...scene, start, dur, spans, xfade: scene.cut || i === 0 ? 0 : xfade };
    start += dur;
    return laid;
  });
  // A scene shorter than its two half-fades would have the next fade start before the previous one ends, and
  // scenesAt paints at most two scenes.
  scenes.forEach((scene, i) => {
    const out = scenes[i + 1]?.xfade ?? 0;
    if (scene.xfade / 2 + out / 2 > scene.dur) throw new Error(`scene ${scene.id} lasts ${scene.dur.toFixed(2)}s, shorter than its fades (${((scene.xfade + out) / 2).toFixed(2)}s): lengthen it or make a cut`);
  });
  return { duration: start, scenes, cues };
}

/** Voice starts are rounded to a frame, which can push the last line past the timeline's end; the video covers it. */
export const totalFrames = (tl: Timeline, fps: number) =>
  Math.ceil(Math.max(tl.duration, ...tl.cues.map((c) => Math.round(c.start * fps) / fps + (c.end - c.start))) * fps);

export function sceneClock(scene: LaidScene, t: number): SceneClock {
  return {
    t: t - scene.start,
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

/**
 * The scenes painted at time `t`, bottom first, each with its opacity. A crossfade straddles its cut: the outgoing
 * scene keeps playing at full opacity under the incoming one as it fades up.
 */
export function scenesAt(tl: Timeline, t: number): { scene: LaidScene; alpha: number }[] {
  const { scenes } = tl;
  const i = Math.max(0, scenes.findIndex((s, j) => t >= s.start && (t < s.start + s.dur || j === scenes.length - 1)));
  const scene = scenes[i], prev = scenes[i - 1], next = scenes[i + 1];
  if (prev && scene.xfade && t - scene.start < scene.xfade / 2) {
    return [{ scene: prev, alpha: 1 }, { scene, alpha: ease((t - scene.start + scene.xfade / 2) / scene.xfade) }];
  }
  if (next && next.xfade && next.start - t < next.xfade / 2) {
    return [{ scene, alpha: 1 }, { scene: next, alpha: ease((t - next.start + next.xfade / 2) / next.xfade) }];
  }
  return [{ scene, alpha: 1 }];
}

/** Seconds a scene is on screen for, crossfades included. */
export function visibleSpan(tl: Timeline, i: number): { start: number; end: number } {
  const scene = tl.scenes[i], next = tl.scenes[i + 1];
  return { start: scene.start - scene.xfade / 2, end: scene.start + scene.dur + (next ? next.xfade / 2 : 0) };
}
