// photoshop-probed-ranges.ts: what vid-97's probes covered, field by field of a brush preset, so an import can say
// where a pack's brush goes past what the pipeline was identified on. Read off the probes themselves (as presets,
// photoshop-probe-preset.ts), so it widens as probes are added.
//
// A field counts only where it takes effect: texture fields with the texture on, a dual's with the dual on, a
// dynamic's minimum with its control on, a fade's steps with the fade. A preset keeps a disabled texture's settings,
// which paint nothing.

import type { PhotoshopDescriptor } from '#lib/picture/stamp-paint/models/photoshop-descriptor.ts';
import { photoshopProbePreset } from './photoshop-probe-preset.ts';
import { photoshopProbes } from './photoshop-probes.ts';

/** A field's probed values: the span of a number, or the set of an enum or flag. */
export type PhotoshopProbedRange = { kind: 'number'; min: number; max: number } | { kind: 'values'; values: Set<string> };

/** Names and identities, which say nothing of how a brush paints. */
const IGNORED = new Set(['_class', 'Nm  ', 'Idnt', 'sampledData']);

/** Groups of fields and the switch beside them that turns each on, in the preset or its dual. */
const SWITCHED: Readonly<Record<string, string>> = {
  Txtr: 'useTexture', textureScale: 'useTexture', textureBrightness: 'useTexture', textureContrast: 'useTexture', textureBlendMode: 'useTexture',
  textureDepth: 'useTexture', TxtC: 'useTexture', InvT: 'useTexture', textureDepthDynamics: 'useTexture', minimumDepth: 'useTexture',
  szVr: 'useTipDynamics', minimumDiameter: 'useTipDynamics', angleDynamics: 'useTipDynamics', roundnessDynamics: 'useTipDynamics', minimumRoundness: 'useTipDynamics',
  bothAxes: 'useScatter', 'Cnt ': 'useScatter', scatterDynamics: 'useScatter', countDynamics: 'useScatter',
  opVr: 'usePaintDynamics', prVr: 'usePaintDynamics',
};

type Leaf = { path: string; value: number | string };

/** Each field of `preset` that takes effect, as a number or a string, by its dotted path. */
function effectiveLeaves(preset: PhotoshopDescriptor): Leaf[] {
  const leaves: Leaf[] = [];
  const walk = (d: PhotoshopDescriptor, prefix: string) => {
    for (const [key, value] of Object.entries(d)) {
      if (IGNORED.has(key)) continue;
      const path = prefix + key;
      if ((!prefix || prefix === 'dualBrush.') && SWITCHED[key] && d[SWITCHED[key]] !== true) continue;
      if (prefix === 'dualBrush.' && key !== 'useDualBrush' && d.useDualBrush !== true) continue;
      // A variation's minimum means nothing with its control off, and its steps only under a fade.
      if (key === 'Mnm ' && numberOf(d.bVTy) === 0) continue;
      if (key === 'fStp' && numberOf(d.bVTy) !== 1) continue;
      if (typeof value === 'boolean') leaves.push({ path, value: String(value) });
      else if (typeof value === 'number') leaves.push({ path, value });
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const v = value as PhotoshopDescriptor;
        if ('_enum' in v) leaves.push({ path, value: String(v.value) });
        else if ('_long' in v) leaves.push({ path, value: Number(v._long) });
        else if ('_unit' in v) leaves.push({ path, value: Number(v.value) });
        else walk(v, `${path}.`);
      }
    }
  };
  walk(preset, '');
  return leaves;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && '_long' in value) return Number((value as { _long: unknown })._long);
  return undefined;
}

/** Every field the probes set, with what they set it to. */
export function photoshopProbedRanges(): Map<string, PhotoshopProbedRange> {
  const ranges = new Map<string, PhotoshopProbedRange>();
  for (const probe of photoshopProbes()) {
    for (const { path, value } of effectiveLeaves(photoshopProbePreset(probe.name, probe.settings))) {
      const known = ranges.get(path);
      if (typeof value === 'number') {
        if (known?.kind === 'number') known.min = Math.min(known.min, value), known.max = Math.max(known.max, value);
        else ranges.set(path, { kind: 'number', min: value, max: value });
      } else if (known?.kind === 'values') known.values.add(value);
      else ranges.set(path, { kind: 'values', values: new Set([value]) });
    }
  }
  return ranges;
}

/** Each field of `preset` that takes effect with a value the probes never gave it, and what they did give. */
export function photoshopUnprobedFields(preset: PhotoshopDescriptor, ranges: ReadonlyMap<string, PhotoshopProbedRange>): { path: string; value: number | string; probed: string }[] {
  return effectiveLeaves(preset).flatMap(({ path, value }) => {
    const range = ranges.get(path);
    if (!range) return [];
    if (range.kind === 'number') {
      return typeof value === 'number' && value >= range.min && value <= range.max ? [] : [{ path, value, probed: range.min === range.max ? `${range.min}` : `${range.min}..${range.max}` }];
    }
    return range.values.has(String(value)) ? [] : [{ path, value, probed: [...range.values].join(', ') }];
  });
}
