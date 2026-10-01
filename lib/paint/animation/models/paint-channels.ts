// paint-channels.ts: who writes what over a painted animation, and the checks plan 1's timing contract makes before
// rendering. A writer is a channel on one concrete target over a half-open interval; two on one channel and target
// whose intervals overlap is an authoring error, named with both. Selections (a role, a subtree) expand to concrete
// targets before they reach here.
//
// Negative space: an ancestor and its descendant never conflict. Their deformations compose (own first, then each
// ancestor's), so a throat puffing inside a swaying body is two writers on two targets.

import { paintAnimationFrameAt } from '#lib/paint/painting/models/stamp-group-motion.ts';

/** What an animation writes, each read by its own step of a frame (the contract's composition order). */
export type PaintChannel = 'reveal' | 'place' | 'deform' | 'boil' | 'color' | 'clock';

/**
 * One writer: `channel` of the part or group `target` (its hierarchical ID) from `start` up to `end` seconds of scene
 * time, half open; `end` is Infinity for a loop that never stops. `origin` names where it was written, for errors.
 */
export type PaintChannelWriter = { channel: PaintChannel; target: string; start: number; end: number; origin: string };

/** Every pair of writers on one channel of one target whose intervals overlap, as messages naming both. */
export function paintChannelConflicts(writers: readonly PaintChannelWriter[]): string[] {
  const byLane = new Map<string, PaintChannelWriter[]>();
  for (const writer of writers) byLane.set(`${writer.channel} ${writer.target}`, [...(byLane.get(`${writer.channel} ${writer.target}`) ?? []), writer]);
  return [...byLane.values()].flatMap((lane) => {
    const sorted = lane.toSorted((a, b) => a.start - b.start);
    // Sorted by start, an overlap shows between neighbours or with an earlier writer still running: track the latest end.
    let running = sorted[0];
    return sorted.slice(1).flatMap((writer) => {
      const clash = writer.start < running.end ? [`${writer.origin} writes ${writer.channel} on ${writer.target} from ${writer.start}s while ${running.origin} still does (${Number.isFinite(running.end) ? `until ${running.end}s` : 'without end'})`] : [];
      if (writer.end > running.end) running = writer;
      return clash;
    });
  });
}

/**
 * A stroke's boil epoch at its part's time `time` (the scene's, through the part's holds): 0, its seed as written, until the first grid step after its reveal
 * ends at `revealEnd`, so it doesn't pop to a new seed as it finishes; then one more every `every` animation frames,
 * on the grid, so a part's boiling strokes change together.
 */
export function paintStrokeBoilEpoch(time: number, revealEnd: number, every: number, animationFps: number): number {
  if (time < revealEnd) return 0;
  return Math.floor(paintAnimationFrameAt(time, animationFps) / every) - Math.floor(paintAnimationFrameAt(revealEnd, animationFps) / every);
}
