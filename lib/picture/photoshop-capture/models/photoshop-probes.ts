// photoshop-probes.ts: the probes that read Photoshop's brush engine out one setting at a time, for vid-97 to identify
// its pipeline stage by stage (vid-100). Each probe is a plain base brush (a computed round tip, no dynamics, no
// randomness) with one thing varied, set on the brush tool by script: no brush file is written or loaded. What each
// one is for is in its `reads`.
//
// The two images a probe may borrow are the rig's own, defined into Photoshop at the start of a run: a ramp pattern
// (PHOTOSHOP_PROBE_RAMP, so a texture mode's transfer curve reads straight off one stroke) and an asymmetric sampled
// tip (PHOTOSHOP_PROBE_TIP, so angle and flip show which way they turn it).
//
// Units are Photoshop's own: sizes in pixels, angles in degrees, everything else in percent.
//
// Negative space: Build-up (Photoshop's airbrush, paint piling up while the pen dwells) needs time under a held pen,
// which a stroked path doesn't have, so no probe reads it; the manifest says so. Pen tilt and rotation aren't probed.

/** A tip Photoshop computes: a round or elliptical dab of a given hardness. */
export type PhotoshopComputedTip = { kind: 'computed'; diameter: number; hardness: number; angle: number; roundness: number; spacing: number; flipX: boolean; flipY: boolean };
/** The rig's sampled tip (PHOTOSHOP_PROBE_TIP), scaled to `diameter`. */
export type PhotoshopSampledTip = { kind: 'sampled'; diameter: number; angle: number; roundness: number; spacing: number; flipX: boolean; flipY: boolean };
export type PhotoshopTip = PhotoshopComputedTip | PhotoshopSampledTip;

/** What drives a dynamic: nothing, a fade over `fadeSteps` stamps, or pen pressure (a Brush Pose, or simulated pressure). */
export type PhotoshopControl = { control: 'off' | 'fade' | 'penPressure'; fadeSteps: number; minimum: number };

/** Photoshop's texture modes, by their stringIDs. */
export const PHOTOSHOP_TEXTURE_MODES = ['multiply', 'subtract', 'darken', 'overlay', 'colorDodge', 'colorBurn', 'linearBurn', 'hardMix', 'linearHeight', 'height'] as const;
/** Photoshop's dual brush modes, by their stringIDs. */
export const PHOTOSHOP_DUAL_MODES = ['multiply', 'darken', 'overlay', 'colorDodge', 'colorBurn', 'linearBurn', 'hardMix', 'linearHeight'] as const;

export type PhotoshopBrushSettings = {
  tip: PhotoshopTip;
  opacity: number;
  flow: number;
  /** Shape Dynamics' size control (jitter always 0). */
  size?: PhotoshopControl;
  /** Transfer's opacity and flow controls (jitter always 0). */
  transfer?: { opacity: PhotoshopControl; flow: PhotoshopControl };
  /** The ramp pattern as texture. `eachTip` is Texture Each Tip: per stamp when on, fixed to the canvas when off. */
  texture?: { mode: (typeof PHOTOSHOP_TEXTURE_MODES)[number]; depth: number; scale: number; eachTip: boolean; invert: boolean; brightness: number; contrast: number };
  /** A second computed tip, combined with the first by `mode` (no scatter, one count). */
  dual?: { tip: PhotoshopComputedTip; mode: (typeof PHOTOSHOP_DUAL_MODES)[number] };
  /** Randomness, only in the probes about it: size jitter and scatter, in percent. */
  jitter?: { size: number; scatter: number; bothAxes: boolean };
  wetEdges: boolean;
  noise: boolean;
};

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
  settings: PhotoshopBrushSettings;
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

const round = (diameter: number, hardness = 100, spacing = 5): PhotoshopComputedTip => ({ kind: 'computed', diameter, hardness, angle: 0, roundness: 100, spacing, flipX: false, flipY: false });
const sampled = (diameter: number, extra: Partial<PhotoshopSampledTip> = {}): PhotoshopSampledTip => ({ kind: 'sampled', diameter, angle: 0, roundness: 100, spacing: 5, flipX: false, flipY: false, ...extra });
const base = (tip: PhotoshopTip = round(64), extra: Partial<PhotoshopBrushSettings> = {}): PhotoshopBrushSettings => ({ tip, opacity: 100, flow: 100, wetEdges: false, noise: false, ...extra });
const mark = (kind: PhotoshopMarkKind, extra: Partial<PhotoshopMark> = {}): PhotoshopMark => ({ mark: kind, ground: 'clear', color: PHOTOSHOP_PROBE_INK, ...extra });
const pressure = (control: PhotoshopControl['control'], extra: Partial<PhotoshopControl> = {}): PhotoshopControl => ({ control, fadeSteps: 25, minimum: 0, ...extra });

/** The whole probe set, in capture order. Names are stable: vid-97 reads captures by them. */
export function photoshopProbes(): PhotoshopProbe[] {
  const probes: PhotoshopProbe[] = [];
  const add = (name: string, reads: string, settings: PhotoshopBrushSettings, marks: PhotoshopMark[], copies?: number) => probes.push({ name, reads, settings, marks, ...(copies ? { copies } : {}) });

  // The stamp.
  for (const hardness of [100, 75, 50, 25, 0]) add(`tip computed h${hardness}`, `a computed round tip's alpha profile at hardness ${hardness}%`, base(round(128, hardness)), [mark('stamp'), mark('line')]);
  for (const diameter of [3, 7.5, 16]) add(`tip computed d${diameter}`, `a small tip's filtering and subpixel coverage at ${diameter} px`, base(round(diameter)), [mark('stamp'), mark('line')]);
  add('tip computed ellipse', 'a computed tip at angle 30°, roundness 40%: which way angle turns and how roundness squashes', base({ ...round(128), angle: 30, roundness: 40 }), [mark('stamp'), mark('line')]);
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
        add(`texture ${mode} d${depth}${eachTip ? ' each tip' : ''}`, `the ramp as texture, ${mode} at depth ${depth}%, ${eachTip ? 'per stamp (Texture Each Tip)' : 'fixed to the canvas'}: the mode's transfer curve, alpha against ramp value`, base(round(96, 100, 5), {
          texture: { mode, depth, scale: 100, eachTip, invert: false, brightness: 0, contrast: 0 },
        }), [mark('line'), mark('stamp')]);
      }
    }
  }
  for (const depth of [0, 25, 75]) {
    add(`texture subtract d${depth} each tip`, `subtract at depth ${depth}%: how depth scales the texture`, base(round(96, 100, 5), { texture: { mode: 'subtract', depth, scale: 100, eachTip: true, invert: false, brightness: 0, contrast: 0 } }), [mark('line')]);
  }
  add('texture multiply d100 flow 25', 'texture under low flow: whether texture applies to each stamp before build-up or to the built stroke', base(round(96, 100, 5), { flow: 25, texture: { mode: 'multiply', depth: 100, scale: 100, eachTip: false, invert: false, brightness: 0, contrast: 0 } }), [mark('line'), mark('selfCross')]);
  add('texture multiply d100 each tip flow 25', 'the same with Texture Each Tip', base(round(96, 100, 5), { flow: 25, texture: { mode: 'multiply', depth: 100, scale: 100, eachTip: true, invert: false, brightness: 0, contrast: 0 } }), [mark('line'), mark('selfCross')]);
  add('texture multiply scale 50 invert', 'texture scale and invert', base(round(96, 100, 5), { texture: { mode: 'multiply', depth: 100, scale: 50, eachTip: false, invert: true, brightness: 0, contrast: 0 } }), [mark('line')]);
  add('texture multiply brightness 50 contrast 50', "texture brightness and contrast: how they remap the pattern's values", base(round(96, 100, 5), { texture: { mode: 'multiply', depth: 100, scale: 100, eachTip: false, invert: false, brightness: 50, contrast: 50 } }), [mark('line')]);

  // The dual brush: two known tips under each mode, the secondary's dabs apart and overlapping.
  for (const mode of PHOTOSHOP_DUAL_MODES) {
    for (const [label, spacing] of [['apart', 150], ['overlapping', 25]] as const) {
      add(`dual ${mode} ${label}`, `a soft 32 px secondary at ${spacing}% spacing inside a hard 96 px primary, ${mode}: the combine's operands and stage`, base(round(96, 100, 5), {
        dual: { tip: { ...round(32, 0, spacing) }, mode },
      }), [mark('stamp'), mark('line')]);
    }
  }
  add('dual multiply flow 25', 'the dual under low flow: combined per stamp before build-up, or on the built strokes', base(round(96, 100, 5), { flow: 25, dual: { tip: round(32, 0, 25), mode: 'multiply' } }), [mark('line'), mark('selfCross')]);

  // Wet edges on a known radius.
  for (const hardness of [100, 50, 0]) add(`wet edges h${hardness}`, `wet edges on a 128 px tip at hardness ${hardness}%: the edge weighting's profile`, base(round(128, hardness, 5), { wetEdges: true }), [mark('stamp'), mark('line'), mark('selfCross')]);
  add('wet edges flow 25', 'wet edges under low flow: per stamp or on the built stroke', base(round(128, 100, 5), { flow: 25, wetEdges: true }), [mark('line'), mark('twoCross')]);

  // Pressure: a Brush Pose's constant pressure against each response, simulated pressure's taper, and fades.
  const poses = [0.1, 0.25, 0.5, 0.75, 1].map((p) => mark('line', { pressure: p }));
  add('pressure size', 'size on pen pressure: diameter against pressure (a Brush Pose at 0.1 to 1), and simulated pressure along an S-curve', base(round(64, 100, 5), { size: pressure('penPressure') }), [...poses, mark('sCurve', { simulatePressure: true }), mark('line', { simulatePressure: true })]);
  add('pressure size minimum 30', 'size on pen pressure with a 30% minimum diameter', base(round(64, 100, 5), { size: pressure('penPressure', { minimum: 30 }) }), [...poses]);
  add('pressure opacity', 'opacity on pen pressure', base(round(64, 100, 5), { transfer: { opacity: pressure('penPressure'), flow: pressure('off') } }), [...poses, mark('line', { simulatePressure: true })]);
  add('pressure flow', 'flow on pen pressure', base(round(64, 100, 5), { transfer: { opacity: pressure('off'), flow: pressure('penPressure') } }), [...poses, mark('line', { simulatePressure: true })]);
  add('fade size 40', 'size faded over 40 stamps: the fade curve, stamp by stamp', base(round(64, 100, 10), { size: pressure('fade', { fadeSteps: 40 }) }), [mark('line')]);
  add('fade opacity 40', 'opacity faded over 40 stamps', base(round(64, 100, 10), { transfer: { opacity: pressure('fade', { fadeSteps: 40 }), flow: pressure('off') } }), [mark('line')]);
  add('fade flow 40', 'flow faded over 40 stamps', base(round(64, 100, 10), { transfer: { opacity: pressure('off'), flow: pressure('fade', { fadeSteps: 40 }) } }), [mark('line')]);

  // vid-97's second round: inputs painted alone beside what combines them, so a combine reads pixel for pixel off two
  // captures, with no model of either input in between.
  for (const hardness of [10, 40, 60, 90, 95]) add(`tip computed h${hardness}`, `a computed round tip's alpha profile at hardness ${hardness}%`, base(round(128, hardness)), [mark('stamp')]);
  for (const diameter of [32, 256]) for (const hardness of [0, 50, 90]) add(`tip computed d${diameter} h${hardness}`, `how the hardness ${hardness}% profile scales with diameter (${diameter} px)`, base(round(diameter, hardness)), [mark('stamp')]);
  for (const diameter of [1, 2, 5, 10, 32]) add(`tip computed d${diameter} h100`, `a hard tip's antialiased edge at ${diameter} px`, base(round(diameter)), [mark('stamp')]);
  const SOFT = round(240, 0);
  add('tip computed d240 h0', 'the soft stamp the texture curves are read against: coverage by radius', base(SOFT), [mark('stamp')]);
  const ramp = (mode: (typeof PHOTOSHOP_TEXTURE_MODES)[number], depth: number, extra: Partial<NonNullable<PhotoshopBrushSettings['texture']>> = {}) => ({ mode, depth, scale: 100, eachTip: false, invert: false, brightness: 0, contrast: 0, ...extra });
  for (const mode of PHOTOSHOP_TEXTURE_MODES) {
    for (const depth of [100, 50]) add(`texture ${mode} d${depth} soft`, `${mode} at depth ${depth}% on a soft stamp: the transfer curve over coverage (radius) and ramp value (x)`, base(SOFT, { texture: ramp(mode, depth) }), [mark('stamp')]);
  }
  for (const mode of ['height', 'linearHeight'] as const) for (const depth of [25, 75]) add(`texture ${mode} d${depth} soft`, `${mode} at depth ${depth}%: how depth enters the height modes`, base(SOFT, { texture: ramp(mode, depth) }), [mark('stamp')]);
  for (const [brightness, contrast] of [[-50, 0], [0, -50], [0, 100], [30, -30]] as const) {
    add(`texture multiply brightness ${brightness} contrast ${contrast}`, "texture brightness and contrast at their extremes: how they remap the pattern's values", base(round(96, 100, 5), { texture: ramp('multiply', 100, { brightness, contrast }) }), [mark('line')]);
  }
  const DUAL_PRIMARY = round(160, 0), DUAL_SECONDARY = round(48, 0, 150);
  add('dual base primary', "the dual probes' primary painted alone", base(DUAL_PRIMARY), [mark('line')]);
  add('dual base secondary', "the dual probes' secondary painted alone, as a primary", base(DUAL_SECONDARY), [mark('line')]);
  for (const mode of PHOTOSHOP_DUAL_MODES) add(`dual ${mode} soft`, `${mode} over a soft primary and a soft secondary: the combine over both coverages, against the two painted alone`, base(DUAL_PRIMARY, { dual: { tip: DUAL_SECONDARY, mode } }), [mark('line')]);
  // Which stage comes first, read off where two of them meet.
  add('order texture wet', 'canvas texture with wet edges: which applies first', base(round(128, 50, 5), { wetEdges: true, texture: ramp('multiply', 100) }), [mark('line')]);
  add('order texture each tip wet', 'Texture Each Tip with wet edges', base(round(128, 50, 5), { flow: 25, wetEdges: true, texture: ramp('subtract', 50, { eachTip: true }) }), [mark('line')]);
  add('order dual wet', 'the dual with wet edges', base(round(96, 100, 5), { wetEdges: true, dual: { tip: round(32, 0, 150), mode: 'multiply' } }), [mark('line')]);
  add('order dual texture', 'the dual with canvas texture (subtract): texture on the primary before the dual, or on the combined coverage', base(round(96, 100, 5), { texture: ramp('subtract', 100), dual: { tip: round(32, 0, 25), mode: 'multiply' } }), [mark('line')]);
  add('order dual texture each tip', 'the dual with Texture Each Tip (subtract, depth 50)', base(round(96, 100, 5), { texture: ramp('subtract', 50, { eachTip: true }), dual: { tip: round(32, 0, 25), mode: 'multiply' } }), [mark('line')]);
  add('order texture opacity', 'canvas texture (subtract) at opacity 50%: texture before or after the opacity', base(round(96, 100, 5), { opacity: 50, texture: ramp('subtract', 100) }), [mark('line')]);
  add('order wet opacity', 'wet edges at opacity 50%: wet edges before or after the opacity', base(round(128, 50, 5), { opacity: 50, wetEdges: true }), [mark('line'), mark('twoCross')]);
  add('order dual opacity', 'the dual (colorBurn) at opacity 50%', base(DUAL_PRIMARY, { opacity: 50, dual: { tip: DUAL_SECONDARY, mode: 'colorBurn' } }), [mark('line')]);

  // Randomness, captured several times over to compare by statistics.
  add('random size jitter 50', "size jitter 50%: the jitter's distribution", base(round(48, 100, 25), { jitter: { size: 50, scatter: 0, bothAxes: false } }), [mark('line')], 4);
  add('random scatter 100', 'scatter 100% on both axes: the scatter distribution', base(round(24, 100, 50), { jitter: { size: 0, scatter: 100, bothAxes: true } }), [mark('line')], 4);
  add('random noise', 'Noise on a soft tip: whether it varies between runs', base(round(96, 0, 5), { noise: true }), [mark('stamp'), mark('line')], 2);
  return probes;
}

/** The probes painted twice by default, to report the capture's own repeatability: one of each kind, randomness off. */
export const PHOTOSHOP_REPEAT_SAMPLE = [
  'tip computed h50', 'tip sampled angle 30', 'spacing 10 flow 25', 'cap opacity 50 flow 25', 'paint coloured opacity 50 flow 100',
  'texture linearHeight d100 each tip', 'dual colorBurn overlapping', 'wet edges h50', 'pressure size', 'random scatter 100',
] as const;
