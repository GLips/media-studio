// frame-costs-table.ts: the costs a profiling render logged (FrameCostsEntry), tabled for `studio profile --costs`:
// per label, each frame's costs, a run of frames that cost alike as one line, then the span's.

import type { FrameCost, FrameCostsEntry } from './frame-profile-entry.ts';

/** A frame's costs under one label, or a span's: counts summed, levels as given (a frame's summed, a span's most). */
type FrameCostsTotal = { readonly counts: readonly FrameCost[]; readonly levels: readonly FrameCost[]; readonly notes: readonly string[] };

/** `costs` merged by name in first-seen order, each name's values combined by `combine`. */
function mergedCosts(costs: readonly FrameCost[], combine: (a: number, b: number) => number): FrameCost[] {
  const merged = new Map<string, FrameCost>();
  for (const cost of costs) {
    const before = merged.get(cost.name);
    merged.set(cost.name, before ? { ...before, value: combine(before.value, cost.value) } : cost);
  }
  return [...merged.values()];
}

const sum = (a: number, b: number) => a + b;

/** One frame's entries of a label as one: two paintings drawn in a frame add their counts and their levels alike. */
const frameTotal = (entries: readonly FrameCostsEntry[]): FrameCostsTotal => ({
  counts: mergedCosts(entries.flatMap(({ counts }) => counts), sum),
  levels: mergedCosts(entries.flatMap(({ levels }) => levels), sum),
  notes: entries.flatMap(({ notes }) => notes),
});

const costText = ({ name, value, unit }: FrameCost) => `${name} ${unit === 'bytes' ? `${(value / 1e6).toFixed(1)} MB` : value}`;

/** `total` as one line's text: its non-zero counts, then its levels. */
function totalText({ counts, levels }: FrameCostsTotal): string {
  const counted = counts.filter(({ value }) => value !== 0).map(costText).join(', ') || 'nothing counted';
  return levels.length ? `${counted}; ${levels.map(costText).join(', ')}` : counted;
}

/** `entries` tabled: per label, a line a frame (or a run of frames costing alike), its notes under it, then the span's. */
export function frameCostsTable(entries: readonly FrameCostsEntry[]): string[] {
  const lines: string[] = [];
  for (const label of new Set(entries.map((entry) => entry.label))) {
    const byFrame = new Map<number, FrameCostsEntry[]>();
    for (const entry of entries) if (entry.label === label) byFrame.set(entry.frame, [...(byFrame.get(entry.frame) ?? []), entry]);
    const frames = [...byFrame].toSorted(([a], [b]) => a - b).map(([frame, ofFrame]) => ({ frame, total: frameTotal(ofFrame) }));
    lines.push(`  ${label}:`);
    for (let i = 0; i < frames.length;) {
      const { frame, total } = frames[i], text = JSON.stringify(total);
      let last = i;
      while (last + 1 < frames.length && frames[last + 1].frame === frames[last].frame + 1 && JSON.stringify(frames[last + 1].total) === text) last++;
      const span = last > i ? `frames ${frame}–${frames[last].frame}, each` : `frame ${frame}`;
      lines.push(`    ${span}: ${totalText(total)}`, ...total.notes.map((note) => `      ${note}`));
      i = last + 1;
    }
    const totals = frames.map(({ total }) => total);
    const span = {
      counts: mergedCosts(totals.flatMap(({ counts }) => counts), sum),
      levels: mergedCosts(totals.flatMap(({ levels }) => levels), Math.max).map(({ name, value, unit }) => ({ name: `most ${name}`, value, unit })),
      notes: [],
    };
    lines.push(`    over ${frames.length} frame${frames.length === 1 ? '' : 's'}: ${totalText(span)}`);
  }
  return lines;
}
