// photoshop-probes.ts: the probes that read Photoshop's brush engine out one setting at a time, for vid-97 to identify
// its pipeline stage by stage (vid-100). Each probe is a brush preset (photoshop-preset.ts): a plain base brush (a
// computed round tip, no dynamics, no randomness) with one thing varied, set on the brush tool by script
// (photoshopPresetScript), and read by the importer as a pack's preset is: no brush file is written or loaded. What
// each one is for is in its `reads`.
//
// The two images a probe may borrow are the rig's own, defined into Photoshop at the start of a run: a ramp pattern
// (PHOTOSHOP_PROBE_RAMP, so a texture mode's transfer curve reads straight off one stroke) and an asymmetric sampled
// tip (PHOTOSHOP_PROBE_TIP, so angle and flip show which way they turn it).
//
// Units are Photoshop's own: sizes in pixels, angles in degrees, everything else in percent.
//
// Negative space: Build-up (Photoshop's airbrush, paint piling up while the pen dwells) needs time under a held pen,
// which a stroked path doesn't have, so no probe reads it; the manifest says so. Pen tilt and rotation aren't probed.
// A Brush Pose isn't in a probe's preset: a pose is a mark's (docs/photoshop-capture.md), given a renderer as the
// stroke's pressure.

import {
  PHOTOSHOP_DUAL_MODES, PHOTOSHOP_TEXTURE_MODES, photoshopControlMinimum, type PhotoshopControl, type PhotoshopDualMode, type PhotoshopDynamic, type PhotoshopKnownTip,
  type PhotoshopPaintablePreset, type PhotoshopTextureMode, type PhotoshopTipGeometry, type PhotoshopToolOptions,
} from './photoshop-preset.ts';

/** A probe's preset: a known tip, and the brush tool's options, which set its opacity and flow. */
export type PhotoshopProbePreset = PhotoshopPaintablePreset & { tool: PhotoshopToolOptions };

/** A mark a probe paints in a cell of the capture sheet (models/photoshop-capture-plan.ts draws each). */
export type PhotoshopMarkKind = 'stamp' | 'line' | 'sCurve' | 'twoCross' | 'selfCross' | 'overlap';
/** What a mark is painted over: the transparent sheet, or a patch filled on the sheet's one layer first. */
export type PhotoshopGround = 'clear' | 'white' | 'grey' | 'black';

export type PhotoshopMark = {
  mark: PhotoshopMarkKind;
  ground: PhotoshopGround;
  color: readonly [number, number, number];
  /** A Brush Pose: the stroke painted at this constant pen pressure, 0..1, which overrides size and opacity. */
  pressure?: number;
  /** Photoshop's "simulate pressure" on the stroked path: a known taper at each end. */
  simulatePressure?: boolean;
};

export type PhotoshopProbe = {
  name: string;
  /** What its capture reads out. */
  reads: string;
  preset: PhotoshopProbePreset;
  marks: PhotoshopMark[];
  /** How many times each mark is painted, for probes about randomness, compared by statistics. */
  copies?: number;
};

export const PHOTOSHOP_PROBE_INK = [0, 0, 0] as const;
const NEUTRAL = [128, 128, 128] as const, COLOURED = [40, 90, 220] as const;

/** The ramp pattern: 256 wide, black to white left to right, so its phase is the same in every 256-pixel cell. */
export const PHOTOSHOP_PROBE_RAMP = { name: 'studio-probe-ramp', width: 256, height: 64 } as const;
/** The ramp's value, 0..1, at column `x`. */
export const photoshopProbeRampValue = (x: number) => x / (PHOTOSHOP_PROBE_RAMP.width - 1);

/**
 * The sampled tip: a rounded square whose paint ramps from 0.2 on the left to full on the right, with a solid square
 * notch in its top-left corner, so angle, roundness, flip and the tip's grey levels all show in one stamp. The image
 * is `size` square; Photoshop trims the blank border when it defines the tip, leaving it `native` wide.
 */
export const PHOTOSHOP_PROBE_TIP = { name: 'studio-probe-tip', size: 128, native: 112 } as const;
/** The tip's paint (dark is paint in Photoshop's tip, so the image is 1 minus this), 0..1, at (x, y). */
export function photoshopProbeTipPaint(x: number, y: number): number {
  const s = PHOTOSHOP_PROBE_TIP.size, inset = 8, radius = 20;
  if (x >= inset && x < inset + 28 && y >= inset && y < inset + 28) return 1;
  const cx = Math.min(Math.max(x + 0.5, inset + radius), s - inset - radius), cy = Math.min(Math.max(y + 0.5, inset + radius), s - inset - radius);
  if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) return 0;
  return 0.2 + (0.8 * (x - inset)) / (s - 2 * inset - 1);
}

/** The sampled tip's id: the one sample a probe preset names, which the rig and the reference map to its tip image. */
export const PHOTOSHOP_PROBE_SAMPLE_ID = 'studio-probe-tip';

type ComputedTip = Extract<PhotoshopKnownTip, { kind: 'computed' }>;
type SampledTip = Extract<PhotoshopKnownTip, { kind: 'sampled' }>;

const geometry = (diameter: number, spacing: number, extra: Partial<PhotoshopTipGeometry>): PhotoshopTipGeometry =>
  ({ diameter, angle: 0, roundness: 100, spacing, spaced: true, flipX: false, flipY: false, ...extra });
const round = (diameter: number, hardness = 100, spacing = 5, extra: Partial<PhotoshopTipGeometry> = {}): ComputedTip => ({ kind: 'computed', hardness, geometry: geometry(diameter, spacing, extra) });
/** The rig's sampled tip (PHOTOSHOP_PROBE_TIP), scaled to `diameter`. */
const sampled = (diameter: number, extra: Partial<PhotoshopTipGeometry> = {}): SampledTip => ({ kind: 'sampled', sample: PHOTOSHOP_PROBE_SAMPLE_ID, geometry: geometry(diameter, 5, extra) });

const OFF: PhotoshopDynamic = { control: { kind: 'off' }, jitter: 0 };
const jitter = (percent: number): PhotoshopDynamic => ({ control: { kind: 'off' }, jitter: percent });
const driven = (control: PhotoshopControl): PhotoshopDynamic => ({ control, jitter: 0 });
const pressure = (minimum = 0): PhotoshopControl => ({ kind: 'penPressure', minimum });
const fade = (steps: number): PhotoshopControl => ({ kind: 'fade', steps, minimum: 0 });

type ProbeParts = Partial<Omit<PhotoshopProbePreset, 'tip' | 'tool'>>;
/** A plain brush of `tip` at the tool's `opacity` and `flow`, with `parts` varied. */
const base = (tip: PhotoshopKnownTip, { opacity = 100, flow = 100, ...parts }: ProbeParts & { opacity?: number; flow?: number } = {}): PhotoshopProbePreset =>
  ({ tip, wetEdges: false, noise: false, buildUp: false, ...parts, tool: { kind: 'PbTl', mode: 'normal', opacity, flow } });
/** Shape Dynamics with only what's given varied; Photoshop keeps a minimum roundness of at least 1%. */
const shape = (d: { size?: PhotoshopDynamic; minimumDiameter?: number; angle?: PhotoshopDynamic; roundness?: PhotoshopDynamic; minimumRoundness?: number }): ProbeParts => ({
  tipDynamics: {
    size: d.size ?? OFF, minimumDiameter: d.minimumDiameter ?? 0, angle: d.angle ?? OFF, roundness: d.roundness ?? OFF, minimumRoundness: Math.max(1, d.minimumRoundness ?? 0),
    flipX: false, flipY: false, projection: false,
  },
});
/** Size on `control`, falling to its minimum diameter. */
const sizeBy = (control: PhotoshopControl) => shape({ size: driven(control), minimumDiameter: photoshopControlMinimum(control) });
const transferBy = (opacity: PhotoshopControl, flow: PhotoshopControl): ProbeParts => ({ transfer: { opacity: driven(opacity), flow: driven(flow) } });
const noControl: PhotoshopControl = { kind: 'off' };
/** Scatter (percent) with `count` stamps a step, the count driven by `countControl`; count only takes effect with Scatter on. */
const scattered = ({ scatter = 0, bothAxes = false, count = 1, countControl = noControl }: { scatter?: number; bothAxes?: boolean; count?: number; countControl?: PhotoshopControl }): ProbeParts =>
  ({ scatter: { scatter: jitter(scatter), bothAxes, count, countDynamics: driven(countControl) } });
/** The ramp pattern as texture. `eachTip` is Texture Each Tip: per stamp when on, fixed to the canvas when off. */
const ramp = (mode: PhotoshopTextureMode, depth: number, extra: { scale?: number; eachTip?: boolean; invert?: boolean; brightness?: number; contrast?: number } = {}): ProbeParts => ({
  texture: {
    pattern: { name: PHOTOSHOP_PROBE_RAMP.name, id: PHOTOSHOP_PROBE_RAMP.name }, scale: 100, brightness: 0, contrast: 0, mode, depth, eachTip: false, invert: false,
    depthDynamics: OFF, minimumDepth: 0, protect: false, ...extra,
  },
});
/** A second tip, combined with the first by `mode`, with its own scatter (percent) and count. */
const dual = (tip: PhotoshopKnownTip, mode: PhotoshopDualMode, { scatter = 0, bothAxes = false, count = 1 } = {}): ProbeParts =>
  ({ dual: { mode, flip: false, tip, scatter: { scatter: jitter(scatter), bothAxes, count, countDynamics: OFF } } });
const mark = (kind: PhotoshopMarkKind, extra: Partial<PhotoshopMark> = {}): PhotoshopMark => ({ mark: kind, ground: 'clear', color: PHOTOSHOP_PROBE_INK, ...extra });

/** The whole probe set, in capture order. Names are stable: vid-97 reads captures by them. */
export function photoshopProbes(): PhotoshopProbe[] {
  const probes: PhotoshopProbe[] = [];
  const add = (name: string, reads: string, preset: PhotoshopProbePreset, marks: PhotoshopMark[], copies?: number) => probes.push({ name, reads, preset: { name, ...preset }, marks, ...(copies ? { copies } : {}) });

  // The stamp.
  for (const hardness of [100, 75, 50, 25, 0]) add(`tip computed h${hardness}`, `a computed round tip's alpha profile at hardness ${hardness}%`, base(round(128, hardness)), [mark('stamp'), mark('line')]);
  for (const diameter of [3, 7.5, 16]) add(`tip computed d${diameter}`, `a small tip's filtering and subpixel coverage at ${diameter} px`, base(round(diameter)), [mark('stamp'), mark('line')]);
  add('tip computed ellipse', 'a computed tip at angle 30°, roundness 40%: which way angle turns and how roundness squashes', base(round(128, 100, 5, { angle: 30, roundness: 40 })), [mark('stamp'), mark('line')]);
  add('tip sampled native', `the sampled tip at its own ${PHOTOSHOP_PROBE_TIP.native} px: its grey levels as Photoshop's paint`, base(sampled(PHOTOSHOP_PROBE_TIP.native)), [mark('stamp'), mark('line')]);
  for (const diameter of [48, 200]) add(`tip sampled d${diameter}`, `the sampled tip scaled to ${diameter} px: its resampling filter`, base(sampled(diameter)), [mark('stamp')]);
  add('tip sampled angle 30', 'the sampled tip at angle 30°: the direction of rotation', base(sampled(128, { angle: 30 })), [mark('stamp'), mark('line')]);
  add('tip sampled roundness 50', 'the sampled tip at roundness 50%: which axis squashes', base(sampled(128, { roundness: 50 })), [mark('stamp')]);
  add('tip sampled flip x', 'the sampled tip flipped in x', base(sampled(128, { flipX: true })), [mark('stamp')]);
  add('tip sampled flip y', 'the sampled tip flipped in y', base(sampled(128, { flipY: true })), [mark('stamp')]);
  add('tip sampled angle 30 flip x', 'rotation and flip together: which is applied first', base(sampled(128, { angle: 30, flipX: true })), [mark('stamp')]);

  // Build-up: spacing against flow, and the opacity cap within a stroke and across strokes.
  for (const spacing of [1, 5, 10, 25, 50, 100]) {
    for (const flow of [5, 25, 50, 100]) {
      add(`spacing ${spacing} flow ${flow}`, `stamps at ${spacing}% spacing and ${flow}% flow: how flow builds per stamp (alpha against stamp count)`, base(round(48, 50, spacing), { flow }), [mark('line')]);
    }
  }
  for (const [opacity, flow] of [[50, 25], [50, 100], [100, 25], [25, 10]] as const) {
    add(`cap opacity ${opacity} flow ${flow}`, `opacity ${opacity}% over flow ${flow}%: one stroke crossing itself (capped once per stroke?) against two strokes crossing (each capped, then composited)`, base(round(64, 50, 5), { opacity, flow }), [mark('line'), mark('selfCross'), mark('twoCross'), mark('overlap')]);
  }

  // Colour space and precision: paint over black, white and grey, and low-flow overlaps.
  for (const [label, color] of [['neutral', NEUTRAL], ['coloured', COLOURED], ['black', PHOTOSHOP_PROBE_INK]] as const) {
    for (const [opacity, flow] of [[50, 100], [100, 30]] as const) {
      add(`paint ${label} opacity ${opacity} flow ${flow}`, `${label} paint at opacity ${opacity}%, flow ${flow}%, over clear, white, grey and black: gamma-encoded or linear mixing, premultiplied alpha`, base(round(64, 100, 5), { opacity, flow }), [
        mark('line', { color }), mark('line', { color, ground: 'white' }), mark('line', { color, ground: 'grey' }), mark('line', { color, ground: 'black' }), mark('twoCross', { color, ground: 'white' }),
      ]);
    }
  }

  // Texture: the ramp under each mode and depth, per stamp and fixed to the canvas.
  for (const mode of PHOTOSHOP_TEXTURE_MODES) {
    for (const depth of [100, 50]) {
      for (const eachTip of [false, true]) {
        add(`texture ${mode} d${depth}${eachTip ? ' each tip' : ''}`, `the ramp as texture, ${mode} at depth ${depth}%, ${eachTip ? 'per stamp (Texture Each Tip)' : 'fixed to the canvas'}: the mode's transfer curve, alpha against ramp value`, base(round(96, 100, 5), ramp(mode, depth, { eachTip })), [mark('line'), mark('stamp')]);
      }
    }
  }
  for (const depth of [0, 25, 75]) {
    add(`texture subtract d${depth} each tip`, `subtract at depth ${depth}%: how depth scales the texture`, base(round(96, 100, 5), ramp('subtract', depth, { eachTip: true })), [mark('line')]);
  }
  add('texture multiply d100 flow 25', 'texture under low flow: whether texture applies to each stamp before build-up or to the built stroke', base(round(96, 100, 5), { flow: 25, ...ramp('multiply', 100) }), [mark('line'), mark('selfCross')]);
  add('texture multiply d100 each tip flow 25', 'the same with Texture Each Tip', base(round(96, 100, 5), { flow: 25, ...ramp('multiply', 100, { eachTip: true }) }), [mark('line'), mark('selfCross')]);
  add('texture multiply scale 50 invert', 'texture scale and invert', base(round(96, 100, 5), ramp('multiply', 100, { scale: 50, invert: true })), [mark('line')]);
  add('texture multiply brightness 50 contrast 50', "texture brightness and contrast: how they remap the pattern's values", base(round(96, 100, 5), ramp('multiply', 100, { brightness: 50, contrast: 50 })), [mark('line')]);

  // The dual brush: two known tips under each mode, the secondary's dabs apart and overlapping.
  for (const mode of PHOTOSHOP_DUAL_MODES) {
    for (const [label, spacing] of [['apart', 150], ['overlapping', 25]] as const) {
      add(`dual ${mode} ${label}`, `a soft 32 px secondary at ${spacing}% spacing inside a hard 96 px primary, ${mode}: the combine's operands and stage`, base(round(96, 100, 5), dual(round(32, 0, spacing), mode)), [mark('stamp'), mark('line')]);
    }
  }
  add('dual multiply flow 25', 'the dual under low flow: combined per stamp before build-up, or on the built strokes', base(round(96, 100, 5), { flow: 25, ...dual(round(32, 0, 25), 'multiply') }), [mark('line'), mark('selfCross')]);

  // Wet edges on a known radius.
  for (const hardness of [100, 50, 0]) add(`wet edges h${hardness}`, `wet edges on a 128 px tip at hardness ${hardness}%: the edge weighting's profile`, base(round(128, hardness, 5), { wetEdges: true }), [mark('stamp'), mark('line'), mark('selfCross')]);
  add('wet edges flow 25', 'wet edges under low flow: per stamp or on the built stroke', base(round(128, 100, 5), { flow: 25, wetEdges: true }), [mark('line'), mark('twoCross')]);

  // Pressure: a Brush Pose's constant pressure against each response, simulated pressure's taper, and fades.
  const poses = [0.1, 0.25, 0.5, 0.75, 1].map((p) => mark('line', { pressure: p }));
  add('pressure size', 'size on pen pressure: diameter against pressure (a Brush Pose at 0.1 to 1), and simulated pressure along an S-curve', base(round(64, 100, 5), sizeBy(pressure())), [...poses, mark('sCurve', { simulatePressure: true }), mark('line', { simulatePressure: true })]);
  add('pressure size minimum 30', 'size on pen pressure with a 30% minimum diameter', base(round(64, 100, 5), sizeBy(pressure(30))), [...poses]);
  add('pressure opacity', 'opacity on pen pressure', base(round(64, 100, 5), transferBy(pressure(), noControl)), [...poses, mark('line', { simulatePressure: true })]);
  add('pressure flow', 'flow on pen pressure', base(round(64, 100, 5), transferBy(noControl, pressure())), [...poses, mark('line', { simulatePressure: true })]);
  add('fade size 40', 'size faded over 40 stamps: the fade curve, stamp by stamp', base(round(64, 100, 10), sizeBy(fade(40))), [mark('line')]);
  add('fade opacity 40', 'opacity faded over 40 stamps', base(round(64, 100, 10), transferBy(fade(40), noControl)), [mark('line')]);
  add('fade flow 40', 'flow faded over 40 stamps', base(round(64, 100, 10), transferBy(noControl, fade(40))), [mark('line')]);

  // vid-97's second round: inputs painted alone beside what combines them, so a combine reads pixel for pixel off two
  // captures, with no model of either input in between.
  for (const hardness of [10, 40, 60, 90, 95]) add(`tip computed h${hardness}`, `a computed round tip's alpha profile at hardness ${hardness}%`, base(round(128, hardness)), [mark('stamp')]);
  for (const diameter of [32, 256]) for (const hardness of [0, 50, 90]) add(`tip computed d${diameter} h${hardness}`, `how the hardness ${hardness}% profile scales with diameter (${diameter} px)`, base(round(diameter, hardness)), [mark('stamp')]);
  for (const diameter of [1, 2, 5, 10, 32]) add(`tip computed d${diameter} h100`, `a hard tip's antialiased edge at ${diameter} px`, base(round(diameter)), [mark('stamp')]);
  const SOFT = round(240, 0);
  add('tip computed d240 h0', 'the soft stamp the texture curves are read against: coverage by radius', base(SOFT), [mark('stamp')]);
  for (const mode of PHOTOSHOP_TEXTURE_MODES) {
    for (const depth of [100, 50]) add(`texture ${mode} d${depth} soft`, `${mode} at depth ${depth}% on a soft stamp: the transfer curve over coverage (radius) and ramp value (x)`, base(SOFT, ramp(mode, depth)), [mark('stamp')]);
  }
  for (const mode of ['height', 'linearHeight'] as const) for (const depth of [25, 75]) add(`texture ${mode} d${depth} soft`, `${mode} at depth ${depth}%: how depth enters the height modes`, base(SOFT, ramp(mode, depth)), [mark('stamp')]);
  for (const [brightness, contrast] of [[-50, 0], [0, -50], [0, 100], [30, -30]] as const) {
    add(`texture multiply brightness ${brightness} contrast ${contrast}`, "texture brightness and contrast at their extremes: how they remap the pattern's values", base(round(96, 100, 5), ramp('multiply', 100, { brightness, contrast })), [mark('line')]);
  }
  const DUAL_PRIMARY = round(160, 0), DUAL_SECONDARY = round(48, 0, 150);
  add('dual base primary', "the dual probes' primary painted alone", base(DUAL_PRIMARY), [mark('line')]);
  add('dual base secondary', "the dual probes' secondary painted alone, as a primary", base(DUAL_SECONDARY), [mark('line')]);
  for (const mode of PHOTOSHOP_DUAL_MODES) add(`dual ${mode} soft`, `${mode} over a soft primary and a soft secondary: the combine over both coverages, against the two painted alone`, base(DUAL_PRIMARY, dual(DUAL_SECONDARY, mode)), [mark('line')]);
  // A soft primary spaced a diameter apart ranges its coverage from nothing to full along the line, against a
  // secondary on another period, so the combine reads over its whole domain, not only at full primary coverage.
  const SPACED_PRIMARY = round(160, 0, 100);
  add('dual base primary spaced', "the spaced dual probes' primary painted alone", base(SPACED_PRIMARY), [mark('line')]);
  for (const mode of PHOTOSHOP_DUAL_MODES) add(`dual ${mode} spaced`, `${mode} over a primary whose coverage ranges 0..1: the combine inside the primary`, base(SPACED_PRIMARY, dual(DUAL_SECONDARY, mode)), [mark('line')]);
  // Which stage comes first, read off where two of them meet.
  add('order texture wet', 'canvas texture with wet edges: which applies first', base(round(128, 50, 5), { wetEdges: true, ...ramp('multiply', 100) }), [mark('line')]);
  add('order texture each tip wet', 'Texture Each Tip with wet edges', base(round(128, 50, 5), { flow: 25, wetEdges: true, ...ramp('subtract', 50, { eachTip: true }) }), [mark('line')]);
  add('order dual wet', 'the dual with wet edges', base(round(96, 100, 5), { wetEdges: true, ...dual(round(32, 0, 150), 'multiply') }), [mark('line')]);
  add('order dual texture', 'the dual with canvas texture (subtract): texture on the primary before the dual, or on the combined coverage', base(round(96, 100, 5), { ...ramp('subtract', 100), ...dual(round(32, 0, 25), 'multiply') }), [mark('line')]);
  add('order dual texture each tip', 'the dual with Texture Each Tip (subtract, depth 50)', base(round(96, 100, 5), { ...ramp('subtract', 50, { eachTip: true }), ...dual(round(32, 0, 25), 'multiply') }), [mark('line')]);
  add('order texture opacity', 'canvas texture (subtract) at opacity 50%: texture before or after the opacity', base(round(96, 100, 5), { opacity: 50, ...ramp('subtract', 100) }), [mark('line')]);
  add('order wet opacity', 'wet edges at opacity 50%: wet edges before or after the opacity', base(round(128, 50, 5), { opacity: 50, wetEdges: true }), [mark('line'), mark('twoCross')]);
  add('order dual opacity', 'the dual (colorBurn) at opacity 50%', base(DUAL_PRIMARY, { opacity: 50, ...dual(DUAL_SECONDARY, 'colorBurn') }), [mark('line')]);

  // Randomness, captured several times over to compare by statistics.
  add('random size jitter 50', "size jitter 50%: the jitter's distribution", base(round(48, 100, 25), shape({ size: jitter(50) })), [mark('line')], 4);
  add('random scatter 100', 'scatter 100% on both axes: the scatter distribution', base(round(24, 100, 50), scattered({ scatter: 100, bothAxes: true })), [mark('line')], 4);
  add('random noise', 'Noise on a soft tip: whether it varies between runs', base(round(96, 0, 5), { noise: true }), [mark('stamp'), mark('line')], 2);

  // vid-97's third round: the randomness and counts the packs use that the first two rounds held still. Stamps two
  // diameters apart, so each one's angle, roundness and place read on its own.
  const ellipse = round(48, 100, 200, { roundness: 30 });
  for (const angle of [25, 50]) {
    add(`random angle jitter ${angle}`, `angle jitter ${angle}% on a 30% ellipse: the spread of stamp angles (mod 180°)`, base(ellipse, shape({ angle: jitter(angle) })), [mark('line')], 4);
  }
  add('random angle jitter 100 sampled', 'angle jitter 100% on the asymmetric sampled tip: the whole span, direction included', base(sampled(48, { spacing: 200 }), shape({ angle: jitter(100) })), [mark('line')], 4);
  add('random roundness jitter 50', 'roundness jitter 50% on a round tip: the spread of stamp roundness', base(round(48, 100, 200), shape({ roundness: jitter(50) })), [mark('line')], 4);
  add('random roundness jitter 100 minimum 25', 'roundness jitter 100% with a 25% minimum: where the minimum holds it', base(round(48, 100, 200), shape({ roundness: jitter(100), minimumRoundness: 25 })), [mark('line')], 4);
  add('random scatter 100 count 4', 'scatter 100% on both axes with 4 stamps a step: whether each stamp scatters on its own', base(round(24, 100, 200), scattered({ scatter: 100, bothAxes: true, count: 4 })), [mark('line')], 4);
  add('count 4 flow 25', 'count 4 with no scatter at flow 25%: whether the stamps a step pile up as 4 stamps build', base(round(48, 50, 25), { flow: 25, ...scattered({ count: 4 }) }), [mark('line')]);
  // The dual inside a hard primary wider than its scatter reaches: multiply at full primary paints the secondary alone.
  const WIDE = round(200, 100, 5), DOTS = round(16, 100, 200);
  add('dual base dots', 'the dual scatter probes\' secondary painted alone, as a primary', base(DOTS), [mark('line')]);
  add('random dual scatter 100', "the dual's scatter 100% on both axes: its distribution, and whose diameter it goes by", base(WIDE, dual(DOTS, 'multiply', { scatter: 100, bothAxes: true })), [mark('line')], 4);
  add('random dual scatter 100 one axis', "the dual's scatter 100% across the stroke only", base(WIDE, dual(DOTS, 'multiply', { scatter: 100, bothAxes: false })), [mark('line')], 4);
  add('random dual scatter 100 count 4', "the dual's scatter with 4 stamps a step", base(WIDE, dual(DOTS, 'multiply', { scatter: 100, bothAxes: true, count: 4 })), [mark('line')], 4);
  // Count by pen pressure, which Kyle's washes use: at flow 25%, stamps two diameters apart, each stamp's alpha says how
  // many of the step's 4 landed (1 − 0.75^k) at each Brush Pose pressure, and along a simulated-pressure S-curve.
  const counted = (minimum: number) => base(round(48, 100, 200), { flow: 25, ...scattered({ count: 4, countControl: pressure(minimum) }) });
  const posedLines = [0.25, 0.5, 0.75, 1].map((p) => mark('line', { pressure: p }));
  add('count 4 by pressure', 'count 4 on pen pressure at flow 25%: how many stamps a step keeps at each pressure', counted(0), [mark('sCurve', { simulatePressure: true }), ...posedLines]);
  add('count 4 by pressure minimum 50', 'count 4 on pen pressure with a 50% minimum: where the minimum holds it', counted(50), posedLines.slice(0, 2));
  // Count 2 on pen pressure where stamps overlap, alone, with flow on pressure and with a dual, each beside count 2
  // fixed: along a simulated S-curve it keeps one stamp a step throughout, as simulated pressure never reaches 1.
  const dense = (count: PhotoshopControl, extra: ProbeParts = {}) => base(round(64, 50, 10), { flow: 20, ...scattered({ count: 2, countControl: count }), ...extra });
  const flowPressed = transferBy(noControl, pressure());
  const withDual = dual(round(48, 0, 150), 'multiply');
  for (const [suffix, extra] of [['', {}], [' flow by pressure', flowPressed], [' dual', withDual]] as const) {
    for (const [label, control] of [['fixed', noControl], ['by pressure', pressure()]] as const) {
      add(`count 2 ${label} dense${suffix}`, `count 2 ${label} at 10% spacing${suffix}: count by pressure where stamps overlap`, dense(control, extra), [mark('sCurve', { simulatePressure: true })]);
    }
  }
  for (const pose of [1, 0.5]) {
    add(`count 2 by pressure dense after pose ${pose}`, `count 2 on pen pressure, an S-curve after a posed line at ${pose}: whether count keeps the pose's pressure`, dense(pressure()), [mark('line', { pressure: pose }), mark('sCurve', { simulatePressure: true })]);
  }
  // Texture brightness past ±50, where Kyle's packs mostly sit (-150..150): whether it still shifts the ramp's values
  // as an addition, under the modes those packs use.
  for (const mode of ['subtract', 'overlay'] as const) for (const brightness of [-150, -100, -65, 100, 150]) {
    add(`texture ${mode} brightness ${brightness}`, `${mode} at brightness ${brightness}: how brightness past ±50 remaps the pattern's values`, base(round(96, 100, 5), ramp(mode, 100, { brightness })), [mark('line')]);
  }
  add('dual count 4', "the dual's count 4 with no scatter: whether its stamps a step pile up, against the dual probes' secondary alone", base(WIDE, dual(DUAL_SECONDARY, 'multiply', { count: 4 })), [mark('line')]);

  // Simulated pressure against what painted before it (docs/photoshop-capture.md): run on their own, in this order, so
  // the first S-curve is its sheet's first mark and the others follow a posed line or a probe applied fresh.
  const sim = mark('sCurve', { simulatePressure: true });
  add('pressure check plain', 'no dynamics: an S-curve first on its sheet, then after a posed line (pose 0.5)', base(round(64, 100, 5)), [sim, mark('line', { pressure: 0.5 }), sim]);
  add('pressure check size', 'size on pen pressure: an S-curve right after the probe is applied, then after a posed line', base(round(64, 100, 5), sizeBy(pressure())), [sim, mark('line', { pressure: 0.5 }), sim]);
  add('pressure check size minimum 30', 'size on pen pressure with a 30% minimum: an S-curve after a posed line, where the minimum may count twice', base(round(64, 100, 5), sizeBy(pressure(30))), [mark('line', { pressure: 1 }), sim]);
  add('pressure check reapplied', 'no dynamics, applied fresh after a posed probe: whether the pose outlasts a new brush', base(round(64, 100, 5)), [sim]);

  // A stroke's opacity falling over paint it built at a higher one (vid-108): whether a later, fainter stamp lowers
  // what's built, or never does. Along a line each pixel takes about ten stamps, each fainter than the one before; the
  // self-crossing curve comes back over its loop about 64 stamps after it first passed, by then at its minimum.
  add('fade opacity 40 flow 25', 'opacity faded over 40 stamps at flow 25%: whether a fainter stamp lowers the paint stronger ones built', base(round(64, 100, 10), { flow: 25, ...transferBy(fade(40), noControl) }), [mark('line')]);
  add('fade opacity 130 minimum 20 flow 50', 'opacity faded over 130 stamps to 20% at flow 50%, crossing its own loop: the later pass at 20% over paint built near 60%', base(round(64, 100, 10), { flow: 50, ...transferBy({ kind: 'fade', steps: 130, minimum: 20 }, noControl) }), [mark('selfCross'), mark('line')]);

  // vid-105: the controls the packs drive angle, scatter, texture depth, roundness and count by, and what a stroked
  // path gives the controls it has no input for (tilt, the stylus wheel, rotation). Stamps apart, so each reads alone.
  const sCurve = mark('sCurve'), line = mark('line'), simLine = mark('line', { simulatePressure: true });
  const angleBy = (control: PhotoshopControl) => base(ellipse, shape({ angle: driven(control) }));
  add('angle by pressure', 'angle on pen pressure: the turn against pressure (Brush Pose 0.25 to 1), and along simulated pressure', angleBy(pressure()), [...posedLines, simLine]);
  add('angle initial direction', "angle on initial direction along an S-curve: the stroke's first heading held, or followed", angleBy({ kind: 'initialDirection' }), [sCurve]);
  add('angle direction', 'angle on direction along the same S-curve, beside initial direction', angleBy({ kind: 'direction' }), [sCurve]);
  for (const [label, control] of [['tilt', { kind: 'penTilt', minimum: 0 }], ['stylus wheel', { kind: 'stylusWheel', minimum: 0 }], ['rotation', { kind: 'rotation', minimum: 0 }]] as const) {
    add(`angle by ${label}`, `angle on ${label}: what a stroked path, which has no ${label}, gives it`, angleBy(control), [line]);
  }
  add('angle fade 20', 'angle faded over 20 stamps: the turn stamp by stamp', angleBy(fade(20)), [line]);
  add('roundness fade 20', 'roundness faded over 20 stamps on a round tip, to its minimum 25%', base(round(48, 100, 200), shape({ roundness: driven(fade(20)), minimumRoundness: 25 })), [line]);
  const scatterBy = (control: PhotoshopControl): ProbeParts => ({ scatter: { scatter: { control, jitter: 100 }, bothAxes: true, count: 1, countDynamics: OFF } });
  add('scatter by pressure', 'scatter 100% on pen pressure: its reach against pressure, and along simulated pressure', base(round(24, 100, 50), scatterBy(pressure())), [...posedLines, simLine], 2);
  add('scatter fade 40', 'scatter 100% faded over 40 stamps', base(round(24, 100, 50), scatterBy(fade(40))), [line], 2);
  add('scatter by tilt', 'scatter 100% on pen tilt: what a stroked path gives it', base(round(24, 100, 50), scatterBy({ kind: 'penTilt', minimum: 0 })), [line], 2);
  add('count 4 fade 10', 'count 4 faded over 10 steps at flow 25%: how many a step keeps as it fades', base(round(48, 100, 200), { flow: 25, ...scattered({ count: 4, countControl: fade(10) }) }), [line]);
  for (const [label, control] of [['tilt', { kind: 'penTilt', minimum: 0 }]] as const) {
    add(`size by ${label}`, `size on ${label}: what a stroked path gives it`, base(round(64, 100, 5), sizeBy(control)), [line]);
    add(`flow by ${label}`, `flow on ${label}: what a stroked path gives it`, base(round(64, 100, 5), transferBy(noControl, control)), [line]);
  }
  // Texture depth per stamp, the subtract ramp at depth 100 under a hard tip, stamps apart so each shows its depth.
  type DepthProbe = { minimumDepth?: number; eachTip?: boolean; spacing?: number; mode?: PhotoshopTextureMode; depth?: number; brightness?: number; contrast?: number; parts?: ProbeParts };
  const depthBy = (depthDynamics: PhotoshopDynamic, { minimumDepth = 0, eachTip = true, spacing = 150, mode = 'subtract', depth = 100, brightness = 0, contrast = 0, parts = {} }: DepthProbe = {}) => {
    const { texture } = ramp(mode, depth, { eachTip, brightness, contrast });
    return base(round(96, 100, spacing), { ...parts, texture: { ...texture!, depthDynamics, minimumDepth } });
  };
  add('texture depth by pressure', 'Texture Each Tip depth on pen pressure: depth against pressure, and along simulated pressure', depthBy(driven(pressure())), [...posedLines, simLine]);
  add('texture depth by pressure minimum 50', 'depth on pen pressure with a 50% minimum depth', depthBy(driven(pressure()), { minimumDepth: 50 }), posedLines.slice(0, 2));
  add('texture depth jitter 100', "depth jitter 100%: each stamp's depth drawn at random", depthBy(jitter(100)), [line], 2);
  add('texture depth jitter 100 minimum 50', 'depth jitter 100% with a 50% minimum depth', depthBy(jitter(100), { minimumDepth: 50 }), [line], 2);
  add('texture depth fade 20', 'depth faded over 20 stamps', depthBy(driven(fade(20))), [line]);
  // Beside what else a brush like Kyle's Magic 1 has: whether any of them keeps a depth control from taking hold.
  add('texture depth by pressure brightness', 'depth on pen pressure, the pattern brightened 20 and its contrast 40', depthBy(driven(pressure()), { brightness: 20, contrast: 40 }), [...posedLines, simLine]);
  add('texture depth by pressure dual', 'depth on pen pressure beside a colour burn dual', depthBy(driven(pressure()), { parts: dual(round(72, 0, 16), 'colorBurn') }), [...posedLines, simLine]);
  add('texture depth by pressure count', 'depth on pen pressure with count 4 on pen pressure', depthBy(driven(pressure()), { parts: scattered({ count: 4, countControl: pressure() }) }), [...posedLines, simLine]);
  // Height modes read depth as a relief's: whether a depth control takes the relief shallower, or the texture away.
  add('texture depth by pressure height 19', 'depth 19% on pen pressure in height mode', depthBy(driven(pressure()), { mode: 'height', depth: 19 }), [...posedLines, simLine]);
  add('texture depth by pressure linearHeight 19', 'depth 19% on pen pressure in linear height mode', depthBy(driven(pressure()), { mode: 'linearHeight', depth: 19 }), [...posedLines, simLine]);
  add('texture depth by pressure canvas', 'depth on pen pressure with Texture Each Tip off: whether the canvas texture takes it', depthBy(driven(pressure()), { eachTip: false, spacing: 5 }), posedLines.slice(0, 2));
  // Count 3 on pen pressure where stamps overlap, fresh and after posed lines (Kyle's Medium Wash Slow).
  const dense3 = base(round(64, 50, 10), { flow: 20, ...scattered({ count: 3, countControl: pressure() }) });
  add('count 3 by pressure dense', 'count 3 on pen pressure at 10% spacing along a simulated S-curve, fresh', dense3, [mark('sCurve', { simulatePressure: true })]);
  add('count 3 by pressure dense after poses', 'count 3 on pen pressure: posed lines at 0.25, 0.5 and 1, then a simulated S-curve, as a reference sheet paints', dense3, [...[0.25, 0.5, 1].map((p) => mark('line', { pressure: p })), mark('sCurve', { simulatePressure: true })]);
  // A stamp's own opacity against the dual (Kyle's Brutus): whether the dual combines with paint the opacity already
  // capped, or with the flow's build before the opacity. Overlay tells them apart: it darkens paint under a half.
  for (const mode of ['overlay', 'multiply'] as const) {
    add(`dual ${mode} opacity by pressure`, `the dual (${mode}) with opacity on pen pressure: whether the combine sees the paint before or after its opacity`, base(DUAL_PRIMARY, { ...transferBy(pressure(), noControl), ...dual(DUAL_SECONDARY, mode) }), posedLines);
  }
  add('dual overlay opacity 50', 'the dual (overlay) at tool opacity 50%, beside opacity on pen pressure', base(DUAL_PRIMARY, { opacity: 50, ...dual(DUAL_SECONDARY, 'overlay') }), [line]);
  // Brutus's dynamics on the rig's sampled tip, alone and with an overlay dual, as a reference sheet paints them.
  const pressedAll = (parts: ProbeParts) => base(sampled(128, { spacing: 2 }), {
    opacity: 90, flow: 20, ...transferBy(pressure(), pressure()), ...parts,
    ...shape({ size: driven(pressure()), roundness: driven(pressure()), minimumRoundness: 1, angle: driven({ kind: 'initialDirection' }) }),
  });
  const sheetMarks = [...[0.25, 0.5, 1].map((p) => mark('line', { pressure: p })), mark('sCurve', { simulatePressure: true })];
  add('pressure all', 'size, roundness, opacity and flow on pen pressure, angle on initial direction, flow 20%: posed lines, then a simulated S-curve', pressedAll({}), sheetMarks);
  add('pressure all dual overlay', 'the same with an overlay dual', pressedAll(dual(round(200, 0, 12), 'overlay')), sheetMarks);

  // The tips Photoshop simulates as it paints (bristle, erodible, airbrush), at the settings the packs use: a stamp,
  // lines at Brush Pose pressures, a line and an S-curve under simulated pressure.
  const simulated = [mark('stamp'), mark('line', { pressure: 0.5 }), mark('line', { pressure: 1 }), simLine, mark('sCurve', { simulatePressure: true })];
  const bristle = (shapeCode: number, density: number, length: number, thickness: number, stiffness: number, diameter = 36, spacing = 2): PhotoshopKnownTip =>
    ({ kind: 'bristle', shape: shapeCode, density, length, clumping: 0.25, thickness, stiffness, physics: true, geometry: geometry(diameter, spacing, {}) });
  for (const [label, tip] of [
    ['round point', bristle(0, 0.31, 1.37, 0.01, 0.85, 25)], ['round blunt', bristle(1, 0.16, 1.37, 0.01, 0.56, 25)], ['round fan', bristle(4, 0.66, 0.25, 0.01, 0.88, 25)],
    ['flat point', bristle(5, 0.34, 1.1, 0.01, 0.69)], ['flat blunt', bristle(6, 0.28, 1, 0.58, 0.87, 60, 1)], ['flat blunt sparse', bristle(6, 0.05, 0.25, 0.01, 0.74, 60)],
    ['flat curve', bristle(7, 0.46, 0.33, 0.01, 0.8)], ['flat angle', bristle(8, 0.37, 0.25, 2, 0.48, 60)], ['flat fan', bristle(9, 0.66, 0.62, 0.5, 0.68, 25)],
  ] as const) add(`tip bristle ${label}`, `a bristle tip, ${label}: its footprint, and the streaks it drags along a stroke`, base(tip), simulated);
  const erodible = (shapeCode: number, hardness: number, diameter: number, gridSize: number, spacing = 2): PhotoshopKnownTip =>
    ({ kind: 'erodible', shape: shapeCode, simulatedHardness: hardness, lengthRatio: 100, gridSize, customized: false, physics: true, geometry: geometry(diameter, spacing, {}) });
  for (const [label, tip] of [
    ['point h48', erodible(0, 48, 100, 11)], ['point h100', erodible(0, 100, 100, 5)], ['round h48', erodible(2, 48, 100, 11)], ['square h48', erodible(3, 48, 100, 11)], ['triangle h92', erodible(4, 92, 100, 13)],
    ['point h48 d25', erodible(0, 48, 25, 11)],
  ] as const) add(`tip erodible ${label}`, `an erodible tip, ${label}: the footprint pressure presses into the paper, and whether it wears along a stroke`, base(tip), [...simulated, mark('line', { pressure: 0.25 })]);
  const airbrush = (hardness: number, granularity: number, splatSize: number, splatCount: number, cutoffAngle: number, diameter = 50, spacing = 1): PhotoshopKnownTip =>
    ({ kind: 'airbrush', shape: 5, simulatedHardness: hardness, lengthRatio: 100, cutoffAngle, granularity, streakiness: 1, splatSize, splatCount, physics: true, geometry: geometry(diameter, spacing, {}) });
  for (const [label, tip] of [
    ['soft', airbrush(1, 0, 1, 200, 45)], ['hard', airbrush(100, 0, 1, 200, 1)], ['soft grainy', airbrush(1, 100, 1, 200, 45)], ['hard grainy sparse', airbrush(100, 100, 1, 9, 1)],
    ['splat big', airbrush(1, 100, 43, 12, 45, 30, 43)], ['splat fine', airbrush(1, 100, 3, 19, 45, 30, 43)],
  ] as const) add(`tip airbrush ${label}`, `an airbrush tip, ${label}: its spray's profile and grain`, base(tip), simulated, label.includes('grainy') || label.includes('splat') ? 2 : undefined);
  return probes;
}

/** The probes painted twice by default, to report the capture's own repeatability: one of each kind, randomness off. */
export const PHOTOSHOP_REPEAT_SAMPLE = [
  'tip computed h50', 'tip sampled angle 30', 'spacing 10 flow 25', 'cap opacity 50 flow 25', 'paint coloured opacity 50 flow 100',
  'texture linearHeight d100 each tip', 'dual colorBurn overlapping', 'wet edges h50', 'pressure size', 'random scatter 100',
] as const;
