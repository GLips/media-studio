// frame-costs-table.ts: what drawing code counted a frame cost (a painted shot's evaluations, solves, cache hits),
// carried on its frame's span in a render's trace and tabled for `studio profile --costs`: per label, each frame's
// costs, a run of frames that cost alike as one line, then the span's.
import type { TraceAttributes } from '#lib/platform/trace/models/trace-model.ts';

/** One count of a frame's costs, by `name`; one in `bytes` prints as MB. */
export type FrameCost = { readonly name: string; readonly value: number; readonly unit?: 'bytes' };

/**
 * What some work cost, counted rather than timed: `counts` add up over frames (solves, cache misses, bytes uploaded);
 * `levels` are a state as the frame ends (bytes kept), of which a span reports the most; `notes` say what a count
 * can't (where a solve started).
 */
export type FrameCosts = {
  readonly counts: readonly FrameCost[];
  readonly levels: readonly FrameCost[];
  readonly notes: readonly string[];
};

/** What `label`'s work cost in the video's `frame`. */
export type FrameCostsEntry = FrameCosts & { readonly frame: number; readonly label: string };

/** A level's name on a span, apart from its counts. */
const LEVEL_PREFIX = 'level ';

/**
 * `costs` as a frame span's attributes: each count, nought too, so frames tabled together keep their order; each level
 * behind LEVEL_PREFIX; the notes as one.
 */
export function frameCostsTraceAttributes({ counts, levels, notes }: FrameCosts): TraceAttributes {
  const entries: [string, TraceAttributes[string]][] = [
    ...counts.map(({ name, value, unit }): [string, TraceAttributes[string]] => [name, { value, unit: unit ?? 'times' }]),
    ...levels.map(({ name, value, unit }): [string, TraceAttributes[string]] => [`${LEVEL_PREFIX}${name}`, { value, unit: unit ?? 'values' }]),
    ...(notes.length ? [['notes', notes.join('\n')] satisfies [string, string]] : []),
  ];
  return Object.fromEntries(entries);
}

/** The costs a frame span's `attributes` carry (frameCostsTraceAttributes'), its other quantities (its time, its frame) left out. */
export function frameCostsOfTraceAttributes(attributes: TraceAttributes): FrameCosts {
  const counts: FrameCost[] = [], levels: FrameCost[] = [];
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === 'string') continue;
    const unit = value.unit === 'bytes' ? 'bytes' as const : undefined;
    if (name.startsWith(LEVEL_PREFIX)) levels.push({ name: name.slice(LEVEL_PREFIX.length), value: value.value, ...(unit && { unit }) });
    else if (value.unit === 'times' || unit) counts.push({ name, value: value.value, ...(unit && { unit }) });
  }
  const notes = attributes.notes;
  return { counts, levels, notes: typeof notes === 'string' ? notes.split('\n') : [] };
}

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
const frameTotal = (entries: readonly FrameCostsEntry[]): FrameCosts => ({
  counts: mergedCosts(entries.flatMap(({ counts }) => counts), sum),
  levels: mergedCosts(entries.flatMap(({ levels }) => levels), sum),
  notes: entries.flatMap(({ notes }) => notes),
});

const costText = ({ name, value, unit }: FrameCost) => `${name} ${unit === 'bytes' ? `${(value / 1e6).toFixed(1)} MB` : value}`;

/** `total` as one line's text: its non-zero counts, then its levels. */
function totalText({ counts, levels }: FrameCosts): string {
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
