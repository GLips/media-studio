// storyboard-sign-off.ts: what a scene's sign-off covers, as a hash. A sign-off (`{ on: 'plan', scene, hash }` in
// review.json) stays current while this hash does, and goes stale when its row or its own timing changes.
//
// It hashes what sets the scene's own timing, not the frames that come out: its row, its lines' reads (length, word
// times, the pause before each line after the first), and the plan's fps and grid. Frames are rounded on the video's
// clock, so a scene starting a fraction of a frame later shifts a cue by one, and an earlier edit would stale it.
//
// SHA-256 over canonical JSON, computed here so the page and node agree.

import { textSha256Hex } from '#lib/platform/hash/models/sha256.ts';
import type { ResolvedStoryboard } from './resolve-storyboard.ts';
import type { Storyboard } from './storyboard.ts';

/** JSON values, as the canonical form writes them. */
export type CanonicalJsonValue = string | number | boolean | null | undefined | readonly CanonicalJsonValue[] | { readonly [key: string]: CanonicalJsonValue };

/** Scene `scene`'s sign-off hash, or null when the plan doesn't time (a broken timeline can't say what's signed). */
export function storyboardSceneHash<const S extends Storyboard>(storyboard: S, resolved: ResolvedStoryboard<S>, scene: keyof S['scenes'] & string): string | null {
  const row = storyboard.scenes[scene];
  if (!resolved.timeline || !row) return null;
  const { lines, ...rest } = row;
  const lineIds = Object.keys(lines ?? {});
  const reads = lineIds.map((id, i) => {
    const { duration, words, pauseBefore } = resolved.voice[id];
    return { duration, words: words.map(({ start, end }) => [start, end]), pauseBefore: i === 0 ? null : pauseBefore };
  });
  const content = { row: { ...rest, lines: Object.entries(lines ?? {}) }, reads, fps: storyboard.fps, grid: storyboard.grid };
  return textSha256Hex(canonicalJson(content)).slice(0, 16);
}

/** JSON with every object's keys sorted and undefined members dropped: the same text in the browser and in Node. */
export function canonicalJson(value: CanonicalJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)));
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
