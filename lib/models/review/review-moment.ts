// review-moment.ts: where a review note sits in a video's structure, which a retime keeps and a frame number doesn't.
// Pure: the review server builds a render's timing from its snapshot, and review-notes.ts records and places moments.
//
// A moment is read off the render the note was written on, and placed on another render through that render's own
// timing, so the two snapshots are the only clocks involved: never the project's current code.
//
// The anchor, most specific first: the spoken word under the frame, the scene's last beat at or before it, or else
// the scene's cut. A named cue within reach rides along and places the note ahead of its anchor: a cue keeps its name
// when its scene's beats are re-cut, and a beat number doesn't.
//
// Negative space: a moment is one instant. A range note places its first frame and keeps its length.
import type { TimelineClockTable } from '#models/timeline/timeline.ts';

/** How close, in frames, a cue must land to a note for the note's moment to name it. */
export const REVIEW_CUE_REACH_FRAMES = 3;

/** A render's structure in composition frames, from its snapshot. `to` is exclusive. */
export type ReviewTiming = {
  /** The composition frame the render's first frame is: past 0 on a slice. */
  startsAt: number;
  /** Each scene from its cut to the next; `bar` is its place in a timed project's timeline, `beats` its beats' frames. */
  scenes: readonly { id: string; bar: number | null; from: number; to: number; beats: readonly number[] }[];
  /** A timed project's cues by qualified name (`pay-less.stamp`). */
  cues: Readonly<Record<string, number>>;
  /** Each voiced line, with the frame each word starts on. */
  lines: readonly { id: string; scene: string; from: number; to: number; words: readonly { text: string; from: number }[] }[];
};

/**
 * A note's moment. `frames` counts on from the anchor; `beat` is counted from the scene's beat 0, as the timeline's
 * cues are, and `word` from the line's first word, 0. `bar` is the scene's place when the render had a clock.
 */
export type ReviewMoment = { scene: string; bar?: number; cue?: { name: string; frames: number } } & (
  | { kind: 'beat'; beat: number; frames: number }
  | { kind: 'word'; line: string; word: number; text: string; frames: number }
  | { kind: 'scene'; frames: number }
);

/** Where a moment lands on a render, in composition frames, or why it doesn't. */
export type ReviewMomentPlacement = { frame: number } | { gone: string };

/** What the timing is built from: the snapshot's timeline report and, on a timed project, its clock. */
export type ReviewTimingSources = {
  fps: number;
  startsAt: number;
  scenes: readonly { id: string; start: number; dur: number }[];
  lines: readonly { id: string; start: number; end: number; words: readonly { text: string; start: number }[] }[];
  clock: TimelineClockTable | null;
};

/** A render's timing: a timed project's from its clock, any other's scenes from its timeline report. */
export function reviewTimingOf({ fps, startsAt, scenes, lines, clock }: ReviewTimingSources): ReviewTiming {
  // As scenesAt paints: frame f shows a scene from the first f with f/fps + 1e-6 past its start.
  const frameOf = (seconds: number) => Math.ceil((seconds - 1e-6) * fps);
  const placed = clock
    ? clock.bars.map((b) => ({ id: b.id, bar: b.n, from: b.from, to: b.to, beats: b.beatFrames }))
    : scenes.map((s) => ({ id: s.id, bar: null, from: frameOf(s.start), to: frameOf(s.start + s.dur), beats: [] }));
  return {
    startsAt, scenes: placed, cues: clock?.cues ?? {},
    lines: lines.filter((l) => l.words.length).map((l) => {
      const from = frameOf(l.start);
      return {
        id: l.id, scene: placed.find((s) => s.from <= from && from < s.to)?.id ?? '', from, to: frameOf(l.end),
        words: l.words.map((w) => ({ text: w.text, from: frameOf(w.start) })),
      };
    }),
  };
}

/** The moment on composition frame `frame`, or none off every scene. */
export function reviewMomentAt(frame: number, timing: ReviewTiming): ReviewMoment | undefined {
  const scene = timing.scenes.find((s) => s.from <= frame && frame < s.to);
  if (!scene) return undefined;
  const nearest = Object.entries(timing.cues)
    .filter(([, at]) => Math.abs(at - frame) <= REVIEW_CUE_REACH_FRAMES)
    .sort(([, a], [, b]) => Math.abs(a - frame) - Math.abs(b - frame))[0];
  const base = { scene: scene.id, ...(scene.bar !== null && { bar: scene.bar }), ...(nearest && { cue: { name: nearest[0], frames: frame - nearest[1] } }) };
  const line = timing.lines.find((l) => l.from <= frame && frame < l.to);
  const word = line ? line.words.findLastIndex((w) => w.from <= frame) : -1;
  if (line && word >= 0) return { ...base, kind: 'word', line: line.id, word, text: line.words[word].text, frames: frame - line.words[word].from };
  const beat = scene.beats.findLastIndex((b) => b <= frame);
  if (beat >= 0) return { ...base, kind: 'beat', beat, frames: frame - scene.beats[beat] };
  return { ...base, kind: 'scene', frames: frame - scene.from };
}

/** The composition frame `moment` is on in `timing`: by its cue where the render has it, else by its anchor. */
export function placeReviewMoment(moment: ReviewMoment, timing: ReviewTiming): ReviewMomentPlacement {
  const cue = moment.cue && timing.cues[moment.cue.name];
  if (cue !== undefined && moment.cue) return { frame: cue + moment.cue.frames };
  const scene = timing.scenes.find((s) => s.id === moment.scene);
  if (!scene) return { gone: `scene ${moment.scene} isn't in this render` };
  if (moment.kind === 'beat') {
    const at = scene.beats[moment.beat];
    return at === undefined ? { gone: `${sceneName(moment.scene, scene.bar)} has ${scene.beats.length} beats now, not beat ${moment.beat + 1}` } : { frame: at + moment.frames };
  }
  if (moment.kind === 'word') {
    const line = timing.lines.find((l) => l.id === moment.line);
    if (!line) return { gone: `line ${moment.line} isn't spoken in this render` };
    // A re-read line can gain or lose words before this one: the same word nearest its old place.
    const same = line.words.map((w, i) => ({ ...w, i })).filter((w) => w.text === moment.text).sort((a, b) => Math.abs(a.i - moment.word) - Math.abs(b.i - moment.word))[0];
    return same ? { frame: same.from + moment.frames } : { gone: `line ${moment.line} no longer says "${moment.text}"` };
  }
  const frame = scene.from + moment.frames;
  return frame < scene.to ? { frame } : { gone: `${sceneName(moment.scene, scene.bar)} is ${scene.to - scene.from} frames now, and this was ${moment.frames} in` };
}

const sceneName = (id: string, bar: number | null | undefined) => (bar ? `bar ${bar} (${id})` : `scene ${id}`);
const past = (frames: number) => (frames ? ` +${frames}f` : '');

/** `bar 8 · beat 7 · pay-less.stamp`: the moment as a person counts it, beats and words from 1. */
export function formatReviewMomentPlace(moment: ReviewMoment): string {
  const where = moment.kind === 'beat' ? `${moment.bar ? `bar ${moment.bar}` : moment.scene} · beat ${moment.beat + 1}${past(moment.frames)}`
    : moment.kind === 'word' ? `${sceneName(moment.scene, moment.bar)} · line ${moment.line} · word ${moment.word + 1} "${moment.text}"${past(moment.frames)}`
    : `${sceneName(moment.scene, moment.bar)}${past(moment.frames)}`;
  const cue = moment.cue && `${moment.cue.name}${moment.cue.frames > 0 ? ` +${moment.cue.frames}f` : moment.cue.frames < 0 ? ` ${moment.cue.frames}f` : ''}`;
  return cue ? `${where} · ${cue}` : where;
}
