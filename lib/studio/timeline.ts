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
import type { MusicBed } from './mix.ts';
import { ease } from './motion.ts';

export type VoiceLine = {
  /** An imported WAV, or null for a line timed by `studio voice --read=estimate` that has no audio yet. */
  src: string | null;
  duration: number;
  text: string;
  /** Every script word, timed by whisper, or spread by length over an estimated line. */
  words: readonly SpokenWord[];
  /** Integrated loudness as it plays in the mix; null for an estimated line. */
  lufs: number | null;
  /** The pause the take left before this line, after the one before it in the script; null for the first or an estimate. */
  pauseBefore: number | null;
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

/** A scene's length and where its lines fall, in scene seconds. `Id` is the scene's declared line ids. */
export type SceneTimes<Id extends string = string> = {
  dur: number;
  line(id: Id): LineSpan;
};

/** What a scene draws from: its own time, and its times. */
export type SceneClock<Id extends string = string> = SceneTimes<Id> & {
  /** Seconds since the scene's nominal start. Negative while fading in, past `dur` while fading out. */
  t: number;
};

/**
 * Show what you say: the highlight named `see` is drawn, fully on screen and clear of tags and the caption for all of
 * `during`, e.g. `{ see: 'matches', during: s.line('combo-a').word('seventeen') }`. The render fails otherwise.
 */
export type SceneExpectation = { see: string; during: { start: number; end: number } };

type SceneTiming = {
  /** Seconds before the first line. Default 0.5. */
  lead?: number;
  /**
   * Seconds between lines. By default a scene keeps the pause the take left between them, so it plays as it was
   * read; 0.35 for estimated lines. A number sets every gap; `{ 'bulk-search': 1.5 }` sets the gap before that line,
   * for a picture that needs time the read didn't leave.
   */
  gap?: number | Readonly<Record<string, number>>;
  /** Seconds after the last line. Default 0.6. */
  tail?: number;
  /** The scene lasts at least this long. */
  min?: number;
  /** A hard cut from the previous scene instead of a crossfade. */
  cut?: boolean;
};

/**
 * A scene rendered into generated footage by `studio gen video`: the scene's own render is the blockout (see
 * blockout.tsx) it sends as the reference video. Once footage exists the scene plays it, until the next
 * `studio gen video` replaces it; the Studio's `blockouts` prop shows the blockout again.
 */
export type ScenePrevis<Id extends string = string> = {
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
    retime?(s: SceneTimes<Id>): readonly (readonly [scene: number, blockout: number])[];
  }
);

export type SceneDef = SceneTiming & {
  id: string;
  /** What the shot shows and why, in a sentence, for the storyboard. */
  note?: string;
  previs?: ScenePrevis;
  lines: readonly string[];
  // Method syntax on purpose: a scene's render takes a clock narrowed to its own line ids, which a function-typed
  // property would reject as a wider parameter.
  render(s: SceneClock): ReactNode;
  expect?(s: SceneTimes): readonly SceneExpectation[];
};

/**
 * A scene: its voice lines, its timing, and what it draws. `render` may call hooks; it runs as a component.
 *
 *   defineScene({ id: 'ladder', lines: ['ladder'], lead: 0.3, render: (s) => <Ladder s={s} /> })
 */
export function defineScene<const L extends readonly string[] = readonly []>(
  scene: SceneTiming & {
    id: string;
    note?: string;
    previs?: ScenePrevis<L[number]>;
    lines?: L;
    render: (s: SceneClock<L[number]>) => ReactNode;
    expect?: (s: SceneTimes<L[number]>) => readonly SceneExpectation[];
  },
): SceneDef {
  return { ...scene, lines: scene.lines ?? [] } as SceneDef;
}

export type VideoDef = {
  title: string;
  voice: Voice;
  scenes: readonly SceneDef[];
  /** Crossfade length in seconds, centred on each cut. Default 0.5. */
  xfade?: number;
  /** A music bed under the whole video, ducked under the voice. See `studio music`. */
  music?: MusicBed;
  /**
   * Pins what `Date` says while the video renders, e.g. '2026-09-08T12:00:00' (local time unless it names a zone), so
   * host components that label "5 minutes ago" agree with captures made with the same `captureShots({ clock })`.
   */
  clock?: string;
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
export type VoiceCue = {
  id: string;
  src: string | null;
  start: number;
  end: number;
  /** Where its caption ends: at the next line's start if that's in the same scene, else `end`. */
  captionEnd: number;
  text: string;
  lufs: number | null;
};
export type Timeline = { duration: number; scenes: LaidScene[]; cues: VoiceCue[] };

export function layoutVideo(video: VideoDef): Timeline {
  const xfade = video.xfade ?? 0.5;
  if (!Number.isFinite(xfade) || xfade < 0) throw new Error(`xfade is ${xfade}`);
  const cues: VoiceCue[] = [];
  const seen = new Set<string>();
  const sceneOfLine = new Map<string, string>();
  const scriptOrder = Object.keys(video.voice);
  let start = 0;
  const scenes = video.scenes.map((scene, i): LaidScene => {
    if (seen.has(scene.id)) throw new Error(`two scenes are called "${scene.id}"`);
    seen.add(scene.id);
    const { lead = 0.5, tail = 0.6, min = 0 } = scene;
    const gaps = typeof scene.gap === 'number' ? Object.fromEntries(scene.lines.slice(1).map((id) => [id, scene.gap as number])) : scene.gap ?? {};
    for (const id of Object.keys(gaps)) if (!scene.lines.slice(1).includes(id)) throw new Error(`scene ${scene.id}: gap before "${id}", which isn't one of its lines after the first`);
    for (const [name, value] of Object.entries({ lead, tail, min, ...Object.fromEntries(Object.entries(gaps).map(([id, g]) => [`gap before ${id}`, g])) })) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`scene ${scene.id}: ${name} is ${value}`);
    }
    const spans: Record<string, { start: number; end: number; words: readonly SpokenWord[] }> = {};
    let cursor = lead;
    scene.lines.forEach((id, j) => {
      const voiced = video.voice[id];
      if (!voiced) throw new Error(`scene ${scene.id}: line "${id}" isn't in audio/manifest.ts. Add it to voiceover.json and run studio voice.`);
      if (!Number.isFinite(voiced.duration) || voiced.duration <= 0) throw new Error(`line "${id}" lasts ${voiced.duration}s`);
      const owner = sceneOfLine.get(id);
      if (owner) throw new Error(`scene ${scene.id}: line "${id}" is already spoken in scene ${owner}`);
      sceneOfLine.set(id, scene.id);
      // The take's pause only belongs between lines that followed each other in the read.
      const readAfterPrevious = j > 0 && scriptOrder[scriptOrder.indexOf(id) - 1] === scene.lines[j - 1];
      if (j > 0) cursor += gaps[id] ?? (readAfterPrevious ? voiced.pauseBefore : null) ?? 0.35;
      spans[id] = { start: cursor, end: cursor + voiced.duration, words: voiced.words };
      // Within a scene a caption holds through the pause until the next line starts, so a line split for pacing
      // ("…filter, / search, / and…") doesn't flash a one-word caption on and off.
      if (j > 0) cues[cues.length - 1].captionEnd = start + cursor;
      const end = start + cursor + voiced.duration;
      cues.push({ id, src: voiced.src, start: start + cursor, end, captionEnd: end, text: voiced.text, lufs: voiced.lufs });
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

export const sceneClock = (scene: LaidScene, t: number): SceneClock => ({ ...sceneTimes(scene), t: t - scene.start });

export function sceneTimes(scene: LaidScene): SceneTimes {
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
