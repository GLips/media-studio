// paint-channels.ts: who writes what over a painted animation, and the check plan 1's timing contract makes before
// rendering. A writer is a channel on one concrete target over a half-open interval; two on one channel and target
// whose intervals overlap is an authoring error, named with both. Selections (a role, a subtree) expand to concrete
// targets before they reach here.
//
// Negative space: an ancestor and its descendant never conflict. Their deformations compose, each level's in turn,
// so a throat puffing inside a swaying body is two writers on two targets.

import type { PaintPlayInterval } from './paint-clock.ts';

/** What a play writes: a node's deform (a pin, its sway, its flutter), its rigid placement, or the camera's move or focus. */
export type PaintChannel = 'place' | 'deform' | 'camera';

/**
 * One writer: `channel` of `target` (a node's id, and for a pin its name) over its interval, `end` Infinity for one
 * that never stops. `origin` names where it was written, for errors.
 */
export type PaintChannelWriter = PaintPlayInterval & { readonly channel: PaintChannel; readonly target: string; readonly origin: string };

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
