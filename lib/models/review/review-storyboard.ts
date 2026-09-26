// review-storyboard.ts: the storyboard `studio review` shows beside a render, and the timing marks on its scrubber,
// both read from the render's own snapshot. Pure: lib/engine/review hands it the snapshot, the app draws it, and
// the stills are that render's frames, so a card shows what was rendered at the rung each scene was on.
//
// A card per scene with its note, its rung and its stills. A timed video (one with a clock) gets a still on each frame
// the timeline names in a scene (its cues, the replays landing there, its landmarks), captioned in timeline.ts's words,
// and one per voiced line from the middle of its words; a scene naming nothing gets one from its middle. A video
// without a clock gets a still per line, or one from each scene's middle.
//
// Every frame here is on the render's clock, from its first frame: a slice (`studio render --frames`) keeps only the
// cards, stills and marks inside it.
import type { TimelineMoment } from '#models/timeline/scene-moments.ts';
import type { SceneRung } from '#models/timeline/scene-rung.ts';
import type { TimelineClockTable } from '#models/timeline/timeline.ts';

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
  scenes: readonly { id: string; start: number; dur: number; note?: string; rung?: SceneRung; lines: readonly string[] }[];
  lines: readonly { id: string; start: number; end: number; text: string; voiced: boolean }[];
  clock: TimelineClockTable | null;
};

export function reviewStoryboardOf({ fps, frames, scenes, lines, clock }: ReviewStoryboardSources): ReviewStoryboardCard[] {
  const onRender = (frame: number) => Math.round(frame) - frames.from;
  const length = frames.end - frames.from;
  const held = (frame: number) => frame >= 0 && frame < length;
  // As scenesAt paints: frame f shows a scene from the first f with f/fps + 1e-6 past its start.
  const frameOf = (seconds: number) => Math.ceil((seconds - 1e-6) * fps);
  const lineStill = (line: ReviewStoryboardSources['lines'][number]): ReviewStoryboardStill => ({
    frame: onRender((line.start + line.end) / 2 * fps), moments: [], line: { id: line.id, text: line.text, voiced: line.voiced },
  });

  return scenes.flatMap((scene, i) => {
    // A scene bound outside timeline.ts has no bar: it's placed by the report, and names no moments.
    const bar = clock?.bars.find((b) => b.id === scene.id);
    const from = onRender(bar ? bar.from : frameOf(scene.start)), to = onRender(bar ? bar.to : frameOf(scene.start + scene.dur));
    if (to <= 0 || from >= length) return [];
    const named = (bar?.moments ?? []).filter((m) => m.kind !== 'line');
    const stills = [
      ...[...new Set(named.map((m) => m.frame))].map((frame) => ({ frame: onRender(frame), moments: named.filter((m) => m.frame === frame) })),
      ...lines.filter((line) => scene.lines.includes(line.id)).map(lineStill),
    ].filter((s) => held(s.frame)).sort((a, b) => a.frame - b.frame);
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
