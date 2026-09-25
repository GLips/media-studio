// review-notes.ts: the notes `studio review` pins on a render or a still, what each is about, and the markdown Graham
// pastes back into a chat. Pure: lab/review/server.ts reads the artifacts, and the page (lab/review/app) calls these.
//
// A note's context comes only from artifacts a project already has: out/check/timeline.json for the scene and the
// video-clock sounds, sfx/cues.json for the cue list, out/check/motion.json for what's under the point. A source
// that's missing leaves its field off the note; one that's there and holds nothing near gives an empty list.
import type { MotionTracks } from './motion-tracks.ts';

export const REVIEW_NOTES_VERSION = 1;

/** How close, in frames, a sound must land to a note for the note to name it. */
export const REVIEW_SOUND_REACH_FRAMES = 3;

export type ReviewMediaKind = 'video' | 'still';

/** A sound the render plays, as a marker under the scrubber: from `defineVideo({ sounds })` or the cue list. */
export type ReviewSoundMarker = { id: string; at: number; frame: number; sound: string; source: 'video' | 'cue-list' };

/** A scene's visible span, its crossfades included, so a note in a dissolve names both scenes. */
export type ReviewScene = { id: string; start: number; dur: number };

/** What a note says about its moment. Each field is absent when its source artifact is. */
export type ReviewNoteContext = {
  scenes?: string[];
  sounds?: { id: string; sound: string; frame: number; targeted?: true }[];
  /** The motion-tagged elements under the point, smallest first. */
  elements?: { id: string; kind?: string }[];
};

/**
 * One note. `frame` (and `end`, for a range) is absent on a still; `x`/`y` (0–1 across the frame) are absent on a
 * range marked without a point or a note aimed at a sound marker. `cue` is the sound marker it was aimed at.
 */
export type ReviewNote = { id: string; frame?: number; end?: number; x?: number; y?: number; cue?: string; text: string; context: ReviewNoteContext };

/** review/notes-<render>.json in the project, which an agent reads without the paste. */
export type ReviewNotesFile = {
  version: typeof REVIEW_NOTES_VERSION;
  /** The reviewed file, from the repo root. */
  media: string;
  kind: ReviewMediaKind;
  fps?: number;
  saved: string;
  notes: ReviewNote[];
};

export type ReviewContextSources = {
  fps: number;
  /** Composition pixels, which motion.json measures in. */
  frameSize: { w: number; h: number };
  scenes?: readonly ReviewScene[];
  sounds?: readonly ReviewSoundMarker[];
  motion?: MotionTracks;
};

/** The frame a moment in video seconds shows. The epsilon keeps a sound placed on a frame from rounding to the one before. */
export const reviewFrameAt = (seconds: number, fps: number) => Math.floor(seconds * fps + 1e-6);

export function reviewNoteContext(note: Pick<ReviewNote, 'frame' | 'end' | 'x' | 'y' | 'cue'>, sources: ReviewContextSources): ReviewNoteContext {
  if (note.frame === undefined) return {};
  const first = note.frame, last = note.end ?? note.frame, { fps } = sources;
  const context: ReviewNoteContext = {};
  if (sources.scenes) {
    // As lib/studio/timeline.ts's scenesAt paints: frame f shows a scene from the first f with f/fps + 1e-6 past its start.
    const firstShowing = (t: number) => Math.ceil((t - 1e-6) * fps);
    context.scenes = sources.scenes
      .filter((s) => firstShowing(s.start) <= last && firstShowing(s.start + s.dur) > first)
      .map((s) => s.id);
  }
  if (sources.sounds) {
    const reach = REVIEW_SOUND_REACH_FRAMES;
    context.sounds = sources.sounds
      .filter((s) => s.id === note.cue || (s.frame >= first - reach && s.frame <= last + reach))
      .map((s) => ({ id: s.id, sound: s.sound, frame: s.frame, ...(s.id === note.cue && { targeted: true as const }) }));
  }
  if (sources.motion && note.x !== undefined && note.y !== undefined) {
    context.elements = reviewElementsUnder(sources.motion, first, note.x * sources.frameSize.w, note.y * sources.frameSize.h, sources.frameSize);
  }
  return context;
}

/**
 * The tagged elements whose box holds the point on `frame`, smallest first, at most three. Cameras and anything
 * nearly frame-filling are left out: they're under every point, so naming them says nothing.
 */
export function reviewElementsUnder(motion: MotionTracks, frame: number, px: number, py: number, frameSize: { w: number; h: number }) {
  const hits: { id: string; kind?: string; area: number }[] = [];
  for (const track of motion.tracks) {
    if (track.kind === 'camera') continue;
    const segment = track.segments.find((s) => s.start <= frame && frame <= s.end);
    if (!segment) continue;
    const i = frame - segment.start, { x, y, w, h, opacity } = segment.screen;
    if (!(opacity[i] > 0.05 && w[i] > 0 && h[i] > 0) || w[i] * h[i] > 0.9 * frameSize.w * frameSize.h) continue;
    if (Math.abs(px - x[i]) <= w[i] / 2 && Math.abs(py - y[i]) <= h[i] / 2) hits.push({ id: track.id, kind: track.kind, area: w[i] * h[i] });
  }
  return hits.sort((a, b) => a.area - b.area).slice(0, 3).map(({ id, kind }) => (kind ? { id, kind } : { id }));
}

/** `f304 (0:10.13)`: the frame, then minutes, seconds and hundredths, so a timecode reads as video time. */
export function formatReviewMoment(frame: number, fps: number): string {
  const seconds = frame / fps, m = Math.floor(seconds / 60);
  return `f${frame} (${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')})`;
}

/** The notes as markdown for a chat: one numbered item per note in time order, its context as sub-bullets. */
export function formatReviewNotesMarkdown(file: Pick<ReviewNotesFile, 'media' | 'kind' | 'fps' | 'notes'>, { title, savedTo }: { title?: string; savedTo?: string }): string {
  const fps = file.fps ?? 30;
  const head = [`## Review notes${title ? `: ${title}` : ''}`, [`\`${file.media}\``, file.kind === 'video' && `${fps} fps`, savedTo && `saved to \`${savedTo}\``].filter(Boolean).join(' · '), ''];
  const notes = [...file.notes].sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
  const items = notes.map((note, i) => {
    const when = note.frame === undefined ? ''
      : note.end !== undefined && note.end !== note.frame ? `${formatReviewMoment(note.frame, fps)}–${formatReviewMoment(note.end, fps)}`
      : formatReviewMoment(note.frame, fps);
    const where = note.x !== undefined && note.y !== undefined ? `at (${note.x.toFixed(2)}, ${note.y.toFixed(2)})` : '';
    const lead = [when && `**${when}**`, where].filter(Boolean).join(' ');
    const { scenes, sounds, elements } = note.context;
    const sub = [
      scenes?.length && `scene: ${scenes.join(' → ')}`,
      sounds?.length && `sound: ${sounds.map((s) => `${s.sound} \`${s.id}\` at f${s.frame}${s.targeted ? ' (aimed at)' : ''}`).join('; ')}`,
      elements?.length && `under the point: ${elements.map((e) => `\`${e.id}\`${e.kind ? ` (${e.kind})` : ''}`).join(' inside ')}`,
    ].filter(Boolean).map((line) => `   - ${line}`);
    return [`${i + 1}. ${lead ? `${lead}: ` : ''}${note.text.trim().replace(/\n+/g, ' ')}`, ...sub].join('\n');
  });
  return [...head, ...(items.length ? items : ['(no notes)'])].join('\n') + '\n';
}
