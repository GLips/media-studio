// photoshop-probed-ranges.ts: what vid-97's probes covered, field by field of a brush preset, so an import can say
// where a pack's brush goes past what the pipeline was identified on. Read off the probes' own presets, so it widens
// as probes are added. A field counts only where it takes effect
// (photoshopPresetLeaves): a group switched off holds none.

import { photoshopPresetLeaves, type PhotoshopPreset } from './photoshop-preset.ts';
import { photoshopProbes } from './photoshop-probes.ts';

/** A field's probed values: the span of a number, or the set of a flag, code or mode. */
export type PhotoshopProbedRange = { kind: 'number'; min: number; max: number } | { kind: 'values'; values: Set<string> };

/** Every field the probes set, with what they set it to. */
export function photoshopProbedRanges(): Map<string, PhotoshopProbedRange> {
  const ranges = new Map<string, PhotoshopProbedRange>();
  for (const probe of photoshopProbes()) {
    for (const { path, value } of photoshopPresetLeaves(probe.preset)) {
      const known = ranges.get(path);
      if (typeof value === 'number') {
        if (known?.kind === 'number') {
          known.min = Math.min(known.min, value);
          known.max = Math.max(known.max, value);
        } else ranges.set(path, { kind: 'number', min: value, max: value });
      } else if (known?.kind === 'values') known.values.add(value);
      else ranges.set(path, { kind: 'values', values: new Set([value]) });
    }
  }
  return ranges;
}

/** Each field of `preset` that takes effect with a value the probes never gave it, and what they did give. */
export function photoshopUnprobedFields(preset: PhotoshopPreset, ranges: ReadonlyMap<string, PhotoshopProbedRange>): { path: string; value: number | string; probed: string }[] {
  return photoshopPresetLeaves(preset).flatMap(({ path, value }) => {
    const range = ranges.get(path);
    if (!range) return [];
    if (range.kind === 'number') {
      return typeof value === 'number' && value >= range.min && value <= range.max ? [] : [{ path, value, probed: range.min === range.max ? `${range.min}` : `${range.min}..${range.max}` }];
    }
    return range.values.has(String(value)) ? [] : [{ path, value, probed: [...range.values].join(', ') }];
  });
}
