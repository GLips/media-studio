// bind-timeline.ts: a composition's scenes bound to its resolved timeline, in video.tsx. Each scene key gets exactly one
// binding, which receives its scene's clock (frames from the scene's own origin) and, for a scene that replays others,
// those scenes' bindings with the replay's mapping from its frames to theirs. Scenes never import one another: the composition hands a replayed scene over.
//
// Negative space: a binding can't override the schedule, and a replay carries no audio. What a scene sounds like is
// its own binding's business, and a replayed scene plays silent.

import type { CueName, CueNamesOf, MoveNamesOf, ReplayTable, ResolvedSceneClock, SceneSpan, Timeline } from './timeline.ts';
type ScenesOf<T> = T extends Timeline<infer Scenes, infer _Replays> ? Scenes : never;
type ReplaysOf<T> = T extends Timeline<infer _Scenes, infer Replays> ? Replays : never;

/** The clock `defineTimeline` resolved for scene `K` of timeline `T`: its own cues and moves, and every cue by name. */
export type TimelineSceneClock<T, K extends keyof ScenesOf<T> & string> =
  ResolvedSceneClock<K, CueNamesOf<ScenesOf<T>[K]>, MoveNamesOf<ScenesOf<T>[K]>, CueName<ScenesOf<T>>>;

/** A replay handed to the scene that plays it: the replayed scene's binding, and which of its frames plays on the player's frame `f`. */
export type BoundReplay<Bound> = { name: string; source: Bound; sourceId: string; rate: number; sourceFrame(f: number): number };

type ReplayNames<T, K> = K extends keyof ReplaysOf<T> ? keyof NonNullable<ReplaysOf<T>[K]> & string : never;

/** What a scene's binding receives: its clock, and its replays by the names the timeline declares. */
export type TimelineBinding<T, K extends keyof ScenesOf<T> & string, Bound> =
  (clock: TimelineSceneClock<T, K>, replays: { readonly [R in ReplayNames<T, K>]: BoundReplay<NoInfer<Bound>> }) => Bound;

/**
 * Binds every scene, replayed scenes before the scenes that replay them; returns the bindings in the timeline's order.
 * Throws on a missing or unknown key, or replays that form a cycle.
 */
export function bindTimeline<const T extends Timeline<Readonly<Record<string, SceneSpan>>, ReplayTable<Readonly<Record<string, SceneSpan>>>>, Bound>(
  timeline: T,
  bindings: { readonly [K in keyof ScenesOf<T> & string]: TimelineBinding<T, K, Bound> },
): Bound[] {
  const given = Object.keys(bindings);
  const missing = timeline.keys.filter((key) => !given.includes(key));
  const unknown = given.filter((key) => !timeline.keys.includes(key));
  if (missing.length || unknown.length) {
    throw new Error(`bindTimeline: bind exactly the timeline's scenes${missing.length ? `; missing ${missing.join(', ')}` : ''}${unknown.length ? `; no scene ${unknown.join(', ')}` : ''}`);
  }
  const bound = new Map<string, Bound>();
  const bind = (key: string, chain: readonly string[]): Bound => {
    const done = bound.get(key);
    if (done !== undefined) return done;
    if (chain.includes(key)) throw new Error(`bindTimeline: replays ${[...chain, key].join(' → ')} form a cycle`);
    const replays = Object.fromEntries(timeline.replays.filter((replay) => replay.target === key).map((replay): [string, BoundReplay<Bound>] => [
      replay.name,
      {
        name: replay.name, source: bind(replay.source, [...chain, key]), sourceId: replay.source, rate: replay.rate,
        // The replay's ends are video frames; each scene counts from its own origin.
        sourceFrame: (f) => replay.from - timeline.scene(replay.source).origin + (f + timeline.scene(key).origin - replay.to) * replay.rate,
      },
    ]));
    const binding = (bindings as unknown as Record<string, (clock: ResolvedSceneClock, replays: Record<string, BoundReplay<Bound>>) => Bound>)[key];
    const result = binding(timeline.clock(key), replays);
    bound.set(key, result);
    return result;
  };
  return timeline.keys.map((key) => bind(key, []));
}
