import type { Range } from "@oxlint/plugins";

/**
 * Answers "did anything tagged X appear inside this node?" after the walk is over.
 *
 * Several rules claim something about a SUBTREE (a useEffect callback with a setState call but no
 * `await`), and a visitor sees the callback before anything inside it. Recording tagged ranges and
 * asking afterwards spares every rule a bespoke subtree walker.
 */
export interface RangeIndex {
  record(tag: string, range: Range): void;
  containedIn(tag: string, outer: Range): boolean;
}

export function createRangeIndex(): RangeIndex {
  const byTag = new Map<string, Range[]>();
  return {
    record(tag, range) {
      const ranges = byTag.get(tag);
      if (ranges === undefined) byTag.set(tag, [range]);
      else ranges.push(range);
    },
    containedIn(tag, outer) {
      const ranges = byTag.get(tag);
      if (ranges === undefined) return false;
      return ranges.some(([start, end]) => start >= outer[0] && end <= outer[1]);
    },
  };
}
