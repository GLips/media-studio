// review-notes.ts: the notes `studio review` pins on a render or a still, what each is about, and the markdown Graham
// pastes back into a chat. Pure: lib/output/review/engine/ reads the artifacts, and the app's review screen calls these.
//
// A note's context comes only from artifacts a project already has: the render's snapshot for the scene, the
// moment, the video-clock sounds and what's under the point, sfx/cues.json for the cue list, and on a still, a
// variant sheet's .cells.json for the variant under the point. A source that's missing leaves its field off the note;
// one that's there and holds nothing near gives an empty list.
//
// A note written on another render moves to its moment's frame on this one (placeReviewNotes), so a retime doesn't
// leave it on a frame that now shows something else. review-moment.ts says what a moment is.
import type { MotionTracks } from '#lib/picture/motion/models/motion-tracks.ts';
import type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
import { formatReviewMomentPlace, placeReviewMoment, reviewMomentAt, type ReviewMoment, type ReviewTiming } from './review-moment.ts';

export const REVIEW_NOTES_VERSION = 3;

/** How close, in frames, a sound must land to a note for the note to name it. */
export const REVIEW_SOUND_REACH_FRAMES = 3;

export type ReviewMediaKind = 'video' | 'still';

/** A sound the render plays, as a marker under the scrubber: from `defineVideo({ sounds })` or the cue list. */
export type ReviewSoundMarker = { id: string; at: number; frame: number; sound: string; source: 'video' | 'cue-list' };

/** A scene's visible span, its crossfades included, so a note in a dissolve names both scenes. */
export type ReviewScene = { id: string; start: number; dur: number; rung?: SceneRung };

/**
 * One cell of a variant sheet (`studio still --sheet`), from the `.cells.json` beside it: the variant, where it sits on
 * each axis, and whether the still check refused it. `rect` is 0–1 across the sheet.
 */
export type ReviewStillCell = { variant: string; axes: Readonly<Record<string, string>>; refused: boolean; rect: { x: number; y: number; w: number; h: number } };
export type ReviewStillCellsFile = { version: 1; cells: ReviewStillCell[] };

/** What a note says about its moment. Each field is absent when its source artifact is. */
export type ReviewNoteContext = {
  /** On a variant sheet, the cell under the point. */
  cell?: { variant: string; axes: Readonly<Record<string, string>>; refused: boolean };
  scenes?: string[];
  sounds?: { id: string; sound: string; frame: number; targeted?: true }[];
  /** The motion-tagged elements under the point, smallest first. */
  elements?: { id: string; kind?: string }[];
  /** Its (first) frame's place in the video's structure, read off the render it was written on. */
  moment?: ReviewMoment;
};

/**
 * Which render a file is: a re-render to the same path keeps the path and changes the hash. `hash` is the first 10
 * hex digits of the file's SHA-256, `modified` its mtime as ISO.
 */
export type ReviewRenderStamp = { hash: string; modified: string };

/**
 * One note. `frame` (and `end`, for a range) is absent on a still; `x`/`y` (0–1 across the frame) are absent on a
 * range marked without a point or a note aimed at a sound marker. `cue` is the sound marker it was aimed at.
 * `render` is the hash of the render it's on; a note without one can't say which render it's about. `movedFrom` is
 * the render and frame it was written on, once it's been moved to its moment on a later render; `unplaced` says why
 * its moment isn't on the render being reviewed, and leaves it on its old frame.
 */
export type ReviewNote = {
  id: string; frame?: number; end?: number; x?: number; y?: number; cue?: string; render?: string;
  movedFrom?: { render: string; frame: number }; unplaced?: string; text: string; context: ReviewNoteContext;
};

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
  /** The frame in composition pixels, which the motion tracks measure in; null where there's no snapshot to say. */
  frameSize: { w: number; h: number } | null;
  scenes?: readonly ReviewScene[];
  sounds?: readonly ReviewSoundMarker[];
  motion?: MotionTracks;
  cells?: readonly ReviewStillCell[];
  /** The render's structure, from its snapshot, for the note's moment. */
  timing?: ReviewTiming;
};

/** The frame a moment in video seconds shows. The epsilon keeps a sound placed on a frame from rounding to the one before. */
export const reviewFrameAt = (seconds: number, fps: number) => Math.floor(seconds * fps + 1e-6);

export function reviewNoteContext(note: Pick<ReviewNote, 'frame' | 'end' | 'x' | 'y' | 'cue'>, sources: ReviewContextSources): ReviewNoteContext {
  if (note.frame === undefined) {
    const { x, y } = note;
    const hit = x === undefined || y === undefined ? undefined
      : sources.cells?.find(({ rect: r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return hit ? { cell: { variant: hit.variant, axes: hit.axes, refused: hit.refused } } : {};
  }
  const first = note.frame, last = note.end ?? note.frame, { fps } = sources;
  const context: ReviewNoteContext = {};
  if (sources.scenes) {
    // As lib/picture/composition/studio/timeline.ts's scenesAt paints: frame f shows a scene from the first f with f/fps + 1e-6 past its start.
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
  if (sources.timing) {
    const moment = reviewMomentAt(first + sources.timing.startsAt, sources.timing);
    if (moment) context.moment = moment;
  }
  if (sources.motion && sources.frameSize && note.x !== undefined && note.y !== undefined) {
    context.elements = reviewElementsUnder(sources.motion, first, note.x * sources.frameSize.w, note.y * sources.frameSize.h, sources.frameSize);
  }
  return context;
}

/**
 * The notes on `render`: each written on another render with a moment moves to that moment's frame here, a range
 * keeping its length and a point its x/y, its context read again on this render but its moment kept as written. A
 * moment this render doesn't hold, or holds outside its frames, leaves the note where it was with `unplaced` saying so.
 */
export function placeReviewNotes(notes: readonly ReviewNote[], { render, durationInFrames, sources }: {
  render: ReviewRenderStamp; durationInFrames: number; sources: ReviewContextSources & { timing: ReviewTiming };
}): ReviewNote[] {
  return notes.map((note) => {
    const { moment } = note.context;
    if (reviewNoteRenderOf(note, render) !== 'other' || !moment || note.frame === undefined) return note;
    const { unplaced: _, ...rest } = note;
    const placed = placeReviewMoment(moment, sources.timing);
    const frame = 'frame' in placed ? placed.frame - sources.timing.startsAt : undefined;
    if (frame === undefined || frame < 0 || frame >= durationInFrames) {
      return { ...rest, unplaced: 'gone' in placed ? placed.gone : `it falls on f${frame}, outside this render's 0–${durationInFrames - 1}` };
    }
    const shift = frame - note.frame;
    const moved: ReviewNote = {
      ...rest, frame, ...(note.end !== undefined && { end: Math.min(note.end + shift, durationInFrames - 1) }), render: render.hash,
      ...(shift !== 0 && { movedFrom: note.movedFrom ?? { render: note.render!, frame: note.frame } }),
    };
    return { ...moved, context: { ...reviewNoteContext(moved, sources), moment } };
  });
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

/** `headline short, crop card`: a variant by its place on each axis. */
export const formatStillAxes = (axes: Readonly<Record<string, string>>) => Object.entries(axes).map(([a, v]) => `${a} ${v}`).join(', ');

/** `f304 (0:10.13)`: the frame, then minutes, seconds and hundredths, so a timecode reads as video time. */
export function formatReviewMoment(frame: number, fps: number): string {
  const seconds = frame / fps, m = Math.floor(seconds / 60);
  return `f${frame} (${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')})`;
}

/** Whether a note is about `render`: written on it, on another render, or on one it didn't record. */
export function reviewNoteRenderOf(note: Pick<ReviewNote, 'render'>, render: ReviewRenderStamp): 'this' | 'other' | 'unrecorded' {
  return note.render === undefined ? 'unrecorded' : note.render === render.hash ? 'this' : 'other';
}

/**
 * The notes as markdown for a chat: one numbered item per note in time order, led by its moment then its frame, its
 * context as sub-bullets. Given the render on screen, the head names it and a note from any other render says so.
 */
export function formatReviewNotesMarkdown(file: Pick<ReviewNotesFile, 'media' | 'kind' | 'fps' | 'notes'>, { title, savedTo, render }: { title?: string; savedTo?: string; render?: ReviewRenderStamp }): string {
  const fps = file.fps ?? 30;
  const head = [
    `## Review notes${title ? `: ${title}` : ''}`,
    [`\`${file.media}\``, render && `render \`${render.hash}\` modified ${render.modified}`, file.kind === 'video' && `${fps} fps`, savedTo && `saved to \`${savedTo}\``].filter(Boolean).join(' · '),
    '',
  ];
  const notes = [...file.notes].sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
  const items = notes.map((note, i) => {
    const when = note.frame === undefined ? ''
      : note.end !== undefined && note.end !== note.frame ? `${formatReviewMoment(note.frame, fps)}–${formatReviewMoment(note.end, fps)}`
      : formatReviewMoment(note.frame, fps);
    const where = note.x !== undefined && note.y !== undefined ? `at (${note.x.toFixed(2)}, ${note.y.toFixed(2)})` : '';
    const { cell, scenes, sounds, elements, moment } = note.context;
    const at = [when, note.movedFrom && !note.unplaced && `here (f${note.movedFrom.frame} on render \`${note.movedFrom.render}\`)`].filter(Boolean).join(' ');
    const lead = [moment ? `**${formatReviewMomentPlace(moment)}**, ${at}` : when && `**${when}**`, where].filter(Boolean).join(' ');
    const sub = [
      render && { this: '', other: `written on render \`${note.render}\`, not this one${note.unplaced ? `, and its moment isn't here: ${note.unplaced}` : ''}`, unrecorded: 'render not recorded' }[reviewNoteRenderOf(note, render)],
      cell && `variant: \`${cell.variant}\` (${formatStillAxes(cell.axes)})${cell.refused ? ', refused by the still check' : ''}`,
      scenes?.length && `scene: ${scenes.join(' → ')}`,
      sounds?.length && `sound: ${sounds.map((s) => `${s.sound} \`${s.id}\` at f${s.frame}${s.targeted ? ' (aimed at)' : ''}`).join('; ')}`,
      elements?.length && `under the point: ${elements.map((e) => `\`${e.id}\`${e.kind ? ` (${e.kind})` : ''}`).join(' inside ')}`,
    ].filter(Boolean).map((line) => `   - ${line}`);
    return [`${i + 1}. ${lead ? `${lead}: ` : ''}${note.text.trim().replace(/\n+/g, ' ')}`, ...sub].join('\n');
  });
  return [...head, ...(items.length ? items : ['(no notes)'])].join('\n') + '\n';
}
