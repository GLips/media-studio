// plan-timing.ts: the resolved plan laid out on its frames, once per resolution, for the timing bar, the scene rows and
// playback: each scene's span, its lines and their words, its cues (a word cue knowing its word), the voiced scenes'
// leads, gaps and tails, and the flags a reviewer looks for before anything renders.
//
// Every frame here is a video frame of the resolved timeline, `to` exclusive.
import type { ProjectStoryboard } from '#web/features/storyboard/index.ts';
import type { StoryboardLineRead } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import type { StoryboardWordCue } from '#lib/timing/storyboard/models/storyboard.ts';
import { findScriptPhrase, type SpokenWord } from '#lib/timing/voice/models/voice-words.ts';

/** A silence longer than this, between two things said or before the first, is flagged. */
export const PLAN_SILENCE_FLAG_SECONDS = 0.5;
/** A stretch longer than this with nothing planned on it (no cut, cue, line being said, or move) is flagged as a hold. */
export const PLAN_HOLD_FLAG_SECONDS = 2;

/** A word as said and as captioned: `*emphasis*` and `` `keycap` `` marked, the markup itself left off `text`. */
export type PlanWord = { text: string; mark: 'emphasis' | 'keycap' | null; from: number; to: number };

export type PlanLine = { id: string; scene: string; read: StoryboardLineRead; from: number; to: number; words: readonly PlanWord[]; src: string | null };

/** A cue on its frame; a word cue with the word it sits on (its first, for a phrase). */
export type PlanCue = { name: string; frame: number; word: { line: string; k: number } | null };

export type PlanShade = { kind: 'lead' | 'gap' | 'tail'; from: number; to: number };

export type PlanScene = {
  id: string;
  /** Its place, from 1. */
  n: number;
  from: number;
  to: number;
  lines: readonly PlanLine[];
  cues: readonly PlanCue[];
  shades: readonly PlanShade[];
  /** A beat scene's beats' frames. */
  beats: readonly number[];
};

export type PlanFlag = { kind: 'silence' | 'hold'; from: number; to: number };

/** What plays: each recorded line at its second, and the grid's music from where the section starts. */
export type PlanAudio = { src: string; atSeconds: number; duration: number; what: string };

export type PlanTiming = {
  fps: number;
  end: number;
  scenes: readonly PlanScene[];
  lines: readonly PlanLine[];
  /** In the order they start. */
  flags: readonly PlanFlag[];
  audio: readonly PlanAudio[];
};

const KEYCAP = /^`([^`]+)`(.*)$/u;

/** A caption word without its markup, and which markup it had. */
function planWordMark(caption: string | undefined, spoken: string): Pick<PlanWord, 'text' | 'mark'> {
  if (caption === undefined) return { text: spoken, mark: null };
  const keycap = KEYCAP.exec(caption);
  if (keycap) return { text: `${keycap[1]}${keycap[2]}`, mark: 'keycap' };
  return caption.includes('*') ? { text: caption.replaceAll('*', ''), mark: 'emphasis' } : { text: caption, mark: null };
}

/** The word a cue sits on: its phrase's first, or the line's first for `{ at: 'start' }`; null when the line doesn't say it. */
function planCueWord(words: readonly SpokenWord[], at: StoryboardWordCue): number | null {
  if (typeof at === 'object' && 'at' in at) return 0;
  const { phrase, nth = 1 } = typeof at === 'string' ? { phrase: at } : at;
  // Null for a phrase the line no longer says: the resolver has already made it a diagnostic on the cue's scene.
  return findScriptPhrase(words.map((w) => w.text), phrase, nth)?.[0] ?? null;
}

/** The plan on its frames; null when it doesn't time. */
export function planTimingOf({ storyboard, resolved, music }: ProjectStoryboard): PlanTiming | null {
  const { timeline, voice } = resolved;
  if (!timeline) return null;
  const { fps } = timeline;
  const readOf = new Map(resolved.lines.map((l) => [l.line, l.read]));
  const scenes = timeline.scenes.map((placed): PlanScene => {
    const row = storyboard.scenes[placed.id];
    const lines = placed.lines.map(({ id, frame, duration }): PlanLine => {
      const said = voice[id];
      const captions = said.caption.split(/\s+/).filter(Boolean);
      const words = said.words.map((w, k): PlanWord => ({
        ...planWordMark(captions[k], w.text),
        from: frame + Math.round(w.start * fps),
        to: Math.max(frame + Math.round(w.end * fps), frame + Math.round(w.start * fps) + 1),
      }));
      return { id, scene: placed.id, read: readOf.get(id) ?? 'estimated', from: frame, to: frame + Math.round(duration * fps), words, src: said.src };
    });
    const wordOfCue = new Map<string, { line: string; k: number }>();
    for (const [id, line] of Object.entries(row?.lines ?? {})) {
      for (const [cue, at] of Object.entries(line.cues ?? {})) {
        const k = planCueWord(voice[id].words, at);
        if (k !== null) wordOfCue.set(cue, { line: id, k });
      }
    }
    const cues = Object.entries<number>(placed.cues).map(([name, frame]) => ({ name, frame, word: wordOfCue.get(name) ?? null })).toSorted((a, b) => a.frame - b.frame);
    return { id: placed.id, n: placed.n, from: placed.from, to: placed.to, lines, cues, shades: planShadesOf(placed.driver, placed.from, placed.to, lines), beats: placed.beatFrames };
  });
  const lines = scenes.flatMap((s) => s.lines);
  const audio: PlanAudio[] = timeline.audio.flatMap((placed): PlanAudio[] => {
    if (placed.kind === 'voice') {
      const src = voice[placed.line]?.src;
      return src ? [{ src, atSeconds: placed.atSeconds, duration: placed.duration, what: placed.line }] : [];
    }
    const grid = storyboard.grid, track = grid && 'music' in grid ? music[grid.music] : undefined;
    return track ? [{ src: track.src, atSeconds: placed.atSeconds, duration: track.duration, what: 'music' }] : [];
  });
  const moves = timeline.scenes.flatMap((s) => Object.values<{ from: number; to: number }>(s.moves));
  const events = [0, ...scenes.map((s) => s.from), ...scenes.flatMap((s) => s.cues.map((c) => c.frame)), ...lines.map((l) => l.from), timeline.end];
  const flags = [...planSilencesOf(lines, fps), ...planHoldsOf(events, [...moves, ...lines], fps)].toSorted((a, b) => a.from - b.from);
  return { fps, end: timeline.end, scenes, lines, flags, audio };
}

/** A voiced scene's lead before its first line, the gaps between its lines, and its tail after the last. */
function planShadesOf(driver: string, from: number, to: number, lines: readonly PlanLine[]): PlanShade[] {
  if (driver !== 'voice' || !lines.length) return [];
  const gaps = lines.slice(1).map((line, i): PlanShade => ({ kind: 'gap', from: lines[i].to, to: line.from }));
  const shades: PlanShade[] = [{ kind: 'lead', from, to: lines[0].from }, ...gaps, { kind: 'tail', from: lines[lines.length - 1].to, to }];
  return shades.filter((s) => s.to > s.from);
}

/**
 * Silences over 0.5 s before the first line and between lines, across scene cuts too. Not after the last: a held end
 * card is meant to sit in silence. A plan with no lines (music-led or silent) has no silences to flag.
 */
function planSilencesOf(lines: readonly PlanLine[], fps: number): PlanFlag[] {
  if (!lines.length) return [];
  const sorted = lines.toSorted((a, b) => a.from - b.from);
  const quiet = [{ from: 0, to: sorted[0].from }, ...sorted.slice(1).map((line, i) => ({ from: sorted[i].to, to: line.from }))];
  return quiet.filter((q) => (q.to - q.from) / fps > PLAN_SILENCE_FLAG_SECONDS).map((q): PlanFlag => ({ kind: 'silence', from: q.from, to: q.to }));
}

/**
 * Stretches over 2 s between planned events (cuts, cues, line starts), less what is running over them: a move, or a
 * line being said. Speech is itself something happening, so a long line holds nothing up.
 */
function planHoldsOf(events: readonly number[], covered: readonly { from: number; to: number }[], fps: number): PlanFlag[] {
  const frames = [...new Set(events)].toSorted((a, b) => a - b);
  const holds: PlanFlag[] = [];
  for (let i = 1; i < frames.length; i++) {
    let pieces = [{ from: frames[i - 1], to: frames[i] }];
    for (const m of covered) pieces = pieces.flatMap((p) => [{ from: p.from, to: Math.min(p.to, m.from) }, { from: Math.max(p.from, m.to), to: p.to }].filter((q) => q.to > q.from));
    holds.push(...pieces.filter((p) => (p.to - p.from) / fps > PLAN_HOLD_FLAG_SECONDS).map((p): PlanFlag => ({ kind: 'hold', from: p.from, to: p.to })));
  }
  return holds;
}

/**
 * The flag `F` (`by` 1) or `Shift+F` (`by` -1) steps to from `frame`: the first starting after it, or the last starting
 * before it; undefined past the last or before the first. Flags starting on one frame are one step.
 */
export function planFlagStepFrom(flags: readonly PlanFlag[], frame: number, by: 1 | -1): PlanFlag | undefined {
  return by === 1 ? flags.find((f) => f.from > frame) : flags.findLast((f) => f.from < frame);
}

/** The scene playing at `frame`: the last whose cut is at or before it; the first before any. */
export const planSceneIndexAt = (scenes: readonly PlanScene[], frame: number) => Math.max(0, scenes.findLastIndex((s) => s.from <= frame));

/** `23.8 s`: a length in seconds to a tenth. */
export const formatPlanSeconds = (seconds: number) => `${seconds.toFixed(1)} s`;
