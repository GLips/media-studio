// review-storyboard.ts: the storyboard behind the review screen's Board (`B`), and the timing marks on its dock, both
// read from the render's snapshot, so a card shows what was rendered at the rung each scene was on.
//
// A card per scene with its note, its rung and its stills. A timed video gets a still on each frame the timeline names
// in a scene, captioned in the plan's words, and one per voiced line from the middle of its words; a scene naming
// nothing gets one from its middle. A video without a clock gets a still per line, or one from each scene's middle.
//
// Every frame here is on the render's clock: a slice keeps only what's inside it.
import type { TimelineMoment } from '#lib/timing/timeline/models/scene-moments.ts';
import type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
import type { TimelineClockTable } from '#lib/timing/timeline/models/timeline.ts';

/** A voiced line under a still: its words and whether it's voiced yet or an estimate. */
export type ReviewStoryboardLine = { id: string; text: string; voiced: boolean };

export type ReviewStoryboardStill = { frame: number; moments: TimelineMoment[]; line?: ReviewStoryboardLine };

export type ReviewStoryboardCard = {
  id: string; n: number; note?: string; rung?: SceneRung;
  /** Its frames on the render, `to` exclusive. */
  from: number; to: number;
  /** A beat scene's length and the music's beat it cuts in on: `8 beats, in on the music's beat 3`. */
  timing?: string;
  stills: ReviewStoryboardStill[];
};

/**
 * What the scrubber marks under the scenes: every beat (`down` on the music's downbeats, none on a tempo-only grid)
 * and each cue, replay and landmark, with the scene it belongs to.
 */
export type ReviewTimingMarks = {
  beats: { frame: number; down: boolean }[];
  moments: (TimelineMoment & { scene: string })[];
};

/** The snapshot's side of it: the timeline report's scenes and lines, and a timed project's clock. */
export type ReviewStoryboardSources = {
  fps: number;
  /** The composition frames the render holds, `end` exclusive. */
  frames: { from: number; end: number };
  /** Each scene's cut and the next one's, in composition frames. */
  scenes: readonly { id: string; from: number; to: number; note?: string; rung?: SceneRung; lines: readonly string[] }[];
  lines: readonly { id: string; start: number; end: number; text: string; voiced: boolean }[];
  clock: TimelineClockTable | null;
};

export function reviewStoryboardOf({ fps, frames, scenes, lines, clock }: ReviewStoryboardSources): ReviewStoryboardCard[] {
  const onRender = (frame: number) => Math.round(frame) - frames.from;
  const length = frames.end - frames.from;
  const held = (frame: number) => frame >= 0 && frame < length;
  const lineStill = (line: ReviewStoryboardSources['lines'][number]): ReviewStoryboardStill => ({
    frame: onRender((line.start + line.end) / 2 * fps), moments: [], line: { id: line.id, text: line.text, voiced: line.voiced },
  });

  return scenes.flatMap((scene, i) => {
    // A video with no storyboard.ts of its own has no clock: its scenes name no moments.
    const bar = clock?.bars.find((b) => b.id === scene.id);
    const from = onRender(scene.from), to = onRender(scene.to);
    if (to <= 0 || from >= length) return [];
    const named = (bar?.moments ?? []).filter((m) => m.kind !== 'line');
    const stills = [
      ...[...new Set(named.map((m) => m.frame))].map((frame) => ({ frame: onRender(frame), moments: named.filter((m) => m.frame === frame) })),
      ...lines.filter((line) => scene.lines.includes(line.id)).map(lineStill),
    ].filter((s) => held(s.frame)).toSorted((a, b) => a.frame - b.frame);
    const middle = Math.min(Math.max(Math.round((Math.max(from, 0) + Math.min(to, length)) / 2), 0), length - 1);
    const timing = bar?.driver === 'beat'
      ? `${bar.beats} beats${bar.musicBeat !== null && bar.musicBeat !== 1 ? `, in on the music's beat ${bar.musicBeat}` : ''}`
      : undefined;
    return [{
      id: scene.id, n: i + 1, ...(scene.note && { note: scene.note }), ...(scene.rung && { rung: scene.rung }), from, to,
      ...(timing && { timing }), stills: stills.length ? stills : [{ frame: middle, moments: [] }],
    }];
  });
}

export function reviewTimingMarksOf({ frames, clock }: Pick<ReviewStoryboardSources, 'frames' | 'clock'>): ReviewTimingMarks {
  if (!clock) return { beats: [], moments: [] };
  const held = (frame: number) => frame >= frames.from && frame < frames.end;
  const down = new Set(clock.downbeats);
  return {
    beats: clock.beats.filter(held).map((frame) => ({ frame: frame - frames.from, down: down.has(frame) })),
    moments: clock.bars.flatMap((bar) => bar.moments.filter((m) => m.kind !== 'line' && held(m.frame))
      .map((m) => ({ ...m, frame: m.frame - frames.from, scene: bar.id }))),
  };
}

/** A row of the Board: a scene's card, or, for a render without a snapshot, one unnamed row across the whole file. */
export type ReviewBoardRow = Pick<ReviewStoryboardCard, 'from' | 'to' | 'stills'> & { scene?: Omit<ReviewStoryboardCard, 'from' | 'to' | 'stills'> };

/**
 * What the Board lays out: its rows, and the width over height every tile is drawn at, the render's own. Null aspect
 * means no snapshot gave the frame's size: the screen learns it from the first still that loads.
 */
export type ReviewBoardLayout = { aspect: number | null; rows: ReviewBoardRow[] };

/** How many stills the one row of a render without a snapshot gets, spread evenly across it. */
const REVIEW_BOARD_UNTIMED_STILLS = 12;

/**
 * The Board for a render: a row per storyboard card, tiles at the frame's aspect. Without a storyboard (no snapshot)
 * there are no scenes to row by, so it's one row of stills from the middles of equal slices of the file.
 */
export function reviewBoardOf({ storyboard, frameSize, durationInFrames }: {
  storyboard?: readonly ReviewStoryboardCard[]; frameSize: { w: number; h: number } | null; durationInFrames: number;
}): ReviewBoardLayout {
  const aspect = frameSize ? frameSize.w / frameSize.h : null;
  if (storyboard?.length) return { aspect, rows: storyboard.map(({ from, to, stills, ...scene }) => ({ from, to, stills, scene })) };
  if (durationInFrames <= 0) return { aspect, rows: [] };
  const slices = Math.min(REVIEW_BOARD_UNTIMED_STILLS, durationInFrames);
  const frames = [...new Set(Array.from({ length: slices }, (_, i) => Math.floor((i + 0.5) * durationInFrames / slices)))];
  return { aspect, rows: [{ from: 0, to: durationInFrames, stills: frames.map((frame) => ({ frame, moments: [] })) }] };
}
