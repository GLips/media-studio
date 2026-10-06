// stamp-brush-profile.ts: a brush's footprint as measured when its pack is imported (vid-119), so nothing guesses
// half its diameter. `edge` is how far a firm, untapered stroke's paint reaches from its centreline (its visible
// offset), per side and heading, sampled at diameters, read between them by interpolation and never past them. `support`, how far its tips' faintest paint can land, is
// read from the samples either side.
//
// `studio brushes import` measures it through the GPU renderer (lib/paint/brush-packs) and keeps it in the pack's
// manifest; a pack's brush carries it once resolved.
//
// Negative space: no pressure axis, as a fill's edges are firm, and no CPU twin of the renderer's accumulation.

import type {
  StampBrush, StampBrushEdgeSample, StampBrushMeasuredProfile, StampBrushProfile, StampBrushSupportSample, StampTipSupport,
} from './stamp-brush.ts';

/**
 * The measurement's version: the probes, how they're read, what the renderer and the tip generators lay for them,
 * and how a profile keeps what they read. It changes whenever any of those changes what a profile holds, and every
 * profile measured before is refused until its pack is imported again.
 */
export const STAMP_BRUSH_PROFILE_PROTOCOL = 9;

/** Headings a stroke is probed at, evenly round from 0 (left to right, y down), `k` × 2π / 8 radians each. */
export const STAMP_BRUSH_PROFILE_HEADINGS = 8;

/** Pixels a visible offset is rounded to: steady diffs between imports, not a claim two GPUs agree. */
export const STAMP_BRUSH_PROFILE_PRECISION = 0.25;

/** Pixels within which every heading's and side's offsets read as one, and interpolation between samples holds. */
export const STAMP_BRUSH_PROFILE_TOLERANCE = 0.5;

/** The heading of probe `k`, radians. */
export const stampBrushProfileHeading = (k: number) => (k * 2 * Math.PI) / STAMP_BRUSH_PROFILE_HEADINGS;

/** A brush's settings as its profile depends on them: all but its name, its media (a style's) and its profile. */
export function stampBrushProfileSettings(brush: StampBrush): string {
  const { name: _name, media: _media, profile: _profile, ...settings } = brush;
  return JSON.stringify(settings);
}

/** A 53-bit hash of `text` (cyrb53), in hex: pure, so the importer and a brush's boundary key a profile alike. */
export function stampBrushProfileHash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A hash of the brush's settings (stampBrushProfileSettings), as its profile's key holds it. */
export const stampBrushProfileSettingsHash = (brush: StampBrush) => stampBrushProfileHash(stampBrushProfileSettings(brush));

/** `profile` when it's measured, else why a brush holding it can't plan, in words the brush's name goes before. */
function measuredOrWhy(profile: StampBrushProfile): StampBrushMeasuredProfile | string {
  if (profile.kind === 'refused') return `has no profile to plan with: ${profile.why}`;
  if (profile.kind === 'unmeasured') return 'has no profile; resolve it from its imported pack, or state one for a brush no pack holds (stampBrushStatedProfile)';
  return profile;
}

/** The diameters `profile` supports, px: its first sample's to its last's. */
export const stampBrushProfileRange = ({ samples }: StampBrushMeasuredProfile) => ({ min: samples[0].diameter, max: samples.at(-1)!.diameter });

/** Why `profile` can't be read at `diameter`, in words its brush's name goes before; null when it spans it. */
function rangeProblem(profile: StampBrushMeasuredProfile, diameter: number): string | null {
  const { min, max } = stampBrushProfileRange(profile);
  return diameter >= min && diameter <= max ? null : `is measured from ${min} to ${max} px, not at ${diameter}`;
}

/**
 * Why `brush` can't plan by its profile at `diameter`, in words its name goes before, and what's at fault: the brush,
 * with no profile measured, or the diameter, outside it. Null when it can. Planning refuses by the same two rules
 * (stampBrushMeasuredProfile, then bracket), so a check calling this refuses exactly what planning would.
 */
export function stampBrushDiameterProblem(brush: StampBrush, diameter: number): { readonly field: 'brush' | 'diameter'; readonly message: string } | null {
  const profile = measuredOrWhy(brush.profile);
  if (typeof profile === 'string') return { field: 'brush', message: profile };
  const outside = rangeProblem(profile, diameter);
  return outside === null ? null : { field: 'diameter', message: outside };
}

/**
 * `brush`'s measured profile, as its boundary settled it; refuses a brush whose profile was refused, saying why, or
 * that has none (read from its source alone, or a brush no pack holds that states none).
 */
export function stampBrushMeasuredProfile(brush: StampBrush): StampBrushMeasuredProfile {
  const profile = measuredOrWhy(brush.profile);
  if (typeof profile === 'string') throw new Error(`stamp brush: ${brush.name} ${profile}`);
  return profile;
}

/** The samples either side of `diameter` and how far it is between them; refuses one outside the profile. */
function bracket(profile: StampBrushMeasuredProfile, diameter: number, brush: string) {
  const outside = rangeProblem(profile, diameter);
  if (outside !== null) throw new Error(`stamp brush: ${brush} ${outside}`);
  const above = profile.samples.findIndex((sample) => sample.diameter >= diameter), below = Math.max(0, above - 1);
  const hi = profile.samples[above], lo = profile.samples[below];
  return { lo, hi, k: hi.diameter === lo.diameter ? 0 : (diameter - lo.diameter) / (hi.diameter - lo.diameter) };
}

/**
 * `values` taken evenly round from angle 0 (k turns in their count), read at `angle` radians: linear between the two
 * either side. The one way a profile's headings and a footprint's ways are read between.
 */
export function stampBrushRoundAt(values: ArrayLike<number>, angle: number): number {
  const n = values.length, turns = ((((angle / (2 * Math.PI)) * n) % n) + n) % n, i = Math.floor(turns) % n, t = turns - Math.floor(turns);
  return values[i] + (values[(i + 1) % n] - values[i]) * t;
}

/** Ways a stroke's reach is read toward, evenly round: four to each probed heading, so a footprint's ways hold them. */
export const STAMP_BRUSH_EDGE_WAYS = 4 * STAMP_BRUSH_PROFILE_HEADINGS;

/**
 * How far a firm stroke at one diameter reaches toward each of STAMP_BRUSH_EDGE_WAYS ways (way k at k turns in that
 * many, y down), px, by the side facing it: `right[k]` as it heads a quarter turn back from way k, `left[k]` a quarter
 * turn on.
 */
export type StampBrushEdgeReach = { readonly left: Float64Array; readonly right: Float64Array };

/** A reach by heading (radians) and side, read toward every way (StampBrushEdgeReach). */
export function stampBrushEdgeReachOf(reach: (heading: number, side: keyof StampBrushEdgeSample) => number): StampBrushEdgeReach {
  const left = new Float64Array(STAMP_BRUSH_EDGE_WAYS), right = new Float64Array(STAMP_BRUSH_EDGE_WAYS);
  for (let k = 0; k < STAMP_BRUSH_EDGE_WAYS; k++) {
    const way = (k * 2 * Math.PI) / STAMP_BRUSH_EDGE_WAYS;
    right[k] = reach(way - Math.PI / 2, 'right');
    left[k] = reach(way + Math.PI / 2, 'left');
  }
  return { left, right };
}

/** Each sample's edge toward every way, read round its probed headings once. */
const sampleEdgeReach = new WeakMap<StampBrushEdgeSample, StampBrushEdgeReach>();
const edgeReachOf = (edge: StampBrushEdgeSample) =>
  sampleEdgeReach.get(edge) ?? sampleEdgeReach.set(edge, stampBrushEdgeReachOf((heading, side) => stampBrushRoundAt(edge[side], heading))).get(edge)!;

/**
 * The visible offset at `diameter` toward every way (StampBrushEdgeReach), px: round between the probed headings, then
 * linear between samples. A brush that reads alike every way gives the same toward every way and side.
 */
export function stampBrushEdgeReach(profile: StampBrushMeasuredProfile, diameter: number, brush: string): StampBrushEdgeReach {
  const { lo, hi, k } = bracket(profile, diameter, brush), below = edgeReachOf(lo.edge), above = edgeReachOf(hi.edge);
  const blend = (low: Float64Array, high: Float64Array) => low.map((v, w) => v + (high[w] - v) * k);
  return { left: blend(below.left, above.left), right: blend(below.right, above.right) };
}

/**
 * The visible offset at `diameter` as one figure: both sides' mean over every heading, each linear between samples,
 * px. Summed in place, as a fill's plan asks thousands of times.
 */
export function stampBrushEdgeOffsetMean(profile: StampBrushMeasuredProfile, diameter: number, brush: string): number {
  const { lo, hi, k } = bracket(profile, diameter, brush), n = STAMP_BRUSH_PROFILE_HEADINGS;
  let sum = 0;
  for (const side of ['left', 'right'] as const) {
    for (let i = 0; i < n; i++) {
      const v = lo.edge[side][i];
      sum += v + (hi.edge[side][i] - v) * k;
    }
  }
  return sum / (2 * n);
}

/** How wide a firm stroke at `diameter` reads, px: twice its mean visible offset, as `studio brushes describe` prints it. */
export const stampBrushVisibleWidth = (profile: StampBrushMeasuredProfile, diameter: number, brush: string): number =>
  2 * stampBrushEdgeOffsetMean(profile, diameter, brush);

/** A layer's tip support at the samples either side of a diameter: a bound takes the larger of the two. */
export type StampTipSupportAround = readonly [StampTipSupport, StampTipSupport];

/** Each layer's support around `diameter` (StampTipSupportAround): its main tip's, and its dual's when it has one. */
export function stampBrushSupportAround(profile: StampBrushMeasuredProfile, diameter: number, brush: string): { main: StampTipSupportAround; dual: StampTipSupportAround | null } {
  const { lo: { support: lo }, hi: { support: hi } } = bracket(profile, diameter, brush);
  // A profile measures a dual's support exactly when its brush has a dual (it's keyed to the settings): both or neither.
  return { main: [lo.main, hi.main], dual: lo.dual && hi.dual ? [lo.dual, hi.dual] : null };
}

/** `offset` px at every heading and side. */
export const stampBrushEvenEdge = (offset: number): StampBrushEdgeSample => {
  const even = Array.from({ length: STAMP_BRUSH_PROFILE_HEADINGS }, () => offset);
  return { left: even, right: even };
};

/**
 * A profile stated for a brush no import measures (the gate's drawn tips, a test's): a visible offset of `offset`
 * diameters at every heading, and `support` (stampTipSupportOf its tips, its dual's exactly when it has one) at
 * every diameter from 1 to 1024 px, keyed to the brush's settings and what it states: caches read only the key.
 */
export function stampBrushStatedProfile(brush: StampBrush, offset: number, support: StampBrushSupportSample): StampBrushMeasuredProfile {
  if (!support.dual !== !brush.dual) throw new Error(`stamp brush: ${brush.name}'s stated support ${support.dual ? 'has' : 'lacks'} a dual's, and the brush ${brush.dual ? 'has' : 'lacks'} one`);
  return {
    kind: 'measured',
    key: {
      protocol: STAMP_BRUSH_PROFILE_PROTOCOL, settings: stampBrushProfileSettingsHash(brush), assets: `stated ${stampBrushProfileHash(JSON.stringify({ offset, support }))}`, medium: 'stated',
    },
    provenance: { adapter: 'stated', browser: 'stated', renderer: 'stated', seeds: [], measuredAt: 'stated' },
    samples: [1, 1024].map((diameter) => ({ diameter, edge: stampBrushEvenEdge(offset * diameter), edgeNoise: 0, support })),
  };
}
