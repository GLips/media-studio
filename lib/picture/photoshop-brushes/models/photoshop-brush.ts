// photoshop-brush.ts: a Photoshop brush preset (photoshop-preset.ts, from an .abr or a .tpl) read into a StampBrush,
// with a note for every setting that doesn't carry over as Photoshop means it, by its path (`tipDynamics.size.jitter`).
//
// Photoshop's dialog names each setting and unit, so most carry over directly; unknown constants are a shared
// PhotoshopReading. Pressure's several sources are resolved here once (photoshopPressureAmounts).
//
// Negative space: live-input, preview and preset-size settings (a deposit states its diameter) go unreported;
// build-up (a path never rests), tilt, stylus wheel, rotation and pose are `inapplicable`. Fade, noise, bristle,
// erodible and airbrush tips (read as round) and Mixer Brush wet mixing (left to the wet-paint model) are `unsupported`.

import { PHOTOSHOP_POOLING } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { PHOTOSHOP_PIXEL_TIP_DIAMETER, photoshopComputedTipSpan } from './photoshop-computed-tip.ts';
import {
  photoshopControlMinimum, photoshopModeName, type PhotoshopBlendMode, type PhotoshopControl, type PhotoshopDualMode, type PhotoshopDynamic, type PhotoshopKnownTip,
  type PhotoshopPaintablePreset, type PhotoshopPreset, type PhotoshopScatter, type PhotoshopTextureMode,
} from './photoshop-preset.ts';
import { PHOTOSHOP_READING } from './photoshop-reading.ts';
import {
  stampLinearDynamics, type StampBlend, type StampBrush, type StampBrushAsset, type StampBrushColorDynamics, type StampBrushLayer, type StampBrushSupportNote, type StampBrushTip,
  type StampDualBlend, type StampGrainBlend,
} from '#lib/picture/stamp-paint/models/stamp-brush.ts';

/**
 * The constants that turn Photoshop's settings into the studio's where Photoshop's meaning isn't published. Each is a
 * scale or a curve on one reading, the same for every brush of every pack.
 */
export type PhotoshopReading = {
  /** How far, in diameters, a stamp strays at 100% scatter. */
  scatterSpan: number;
  /** How far, in radians either way, a stamp turns at 100% angle jitter. */
  angleJitterSpan: number;
  /** The share of the colour wheel a stamp's hue strays by at 100% hue jitter. */
  hueJitterShare: number;
  /** A dual's stamps are this times the ratio of the dual tip's diameter to the main tip's. */
  dualScale: number;
};

/**
 * A Photoshop tip as an image: a sampled one by its id in the file, or a computed round one drawn at its hardness
 * (0..1) and diameter (px) over `span` diameters (photoshop-computed-tip.ts).
 */
export type PhotoshopTipImage = { kind: 'sampled'; id: string; flipX: boolean; flipY: boolean } | { kind: 'round'; hardness: number; diameter: number; span: number };

export type PhotoshopSampleSize = { width: number; height: number };

/**
 * Where a tip's images landed among the pack's assets: a round tip's drawing; a sample, with its own size in pixels
 * (its centre is read from it); an erodible tip's round drawing and its height map (`gridSize`² little-endian 32-bit
 * floats, as the .abr holds them), which only a simulation of its wear reads.
 */
export type PhotoshopTipAsset =
  | { kind: 'round'; image: StampBrushAsset }
  | { kind: 'sampled'; image: StampBrushAsset; sample: PhotoshopSampleSize }
  | { kind: 'erodible'; image: StampBrushAsset; heightMap: StampBrushAsset };

/**
 * One preset and where its images landed among the pack's assets. `dualTip` is absent when the file lacks the sample
 * the dual names or its class isn't read; a brush missing its own tip isn't imported. `Preset` is the typed preset, or
 * the .abr's descriptor as a manifest stores it.
 */
export type PhotoshopBrushSource<Preset = PhotoshopPaintablePreset> = {
  preset: Preset;
  tip: PhotoshopTipAsset;
  dualTip?: PhotoshopTipAsset;
  pattern?: { image: StampBrushAsset; width: number };
};

/** A tool's own mode, which the deposit paints in; null where the studio has none. */
const BRUSH_BLENDS = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', colorBurn: 'colorBurn',
  dissolve: null, linearBurn: null, darkerColor: null, colorDodge: null, linearDodge: null, lighterColor: null, softLight: null, hardLight: null, vividLight: null,
  linearLight: null, pinLight: null, hardMix: null, difference: null, exclusion: null, subtract: null, divide: null, hue: null, saturation: null, color: null,
  luminosity: null, height: null, linearHeight: null, behind: null, clear: null,
} as const satisfies Record<PhotoshopBlendMode, StampBlend | null>;
/** Every mode Texture offers. */
const GRAIN_BLENDS = {
  multiply: 'multiply', subtract: 'subtract', darken: 'darken', overlay: 'overlay', colorDodge: 'colorDodge', colorBurn: 'colorBurn', linearBurn: 'linearBurn',
  hardMix: 'hardMix', linearHeight: 'linearHeight', height: 'height',
} as const satisfies Record<PhotoshopTextureMode, Extract<StampGrainBlend, { family: 'texture' }>['mode']>;
/** Every mode Dual Brush offers. */
const DUAL_BLENDS = {
  multiply: 'multiply', darken: 'darken', overlay: 'overlay', colorDodge: 'colorDodge', colorBurn: 'colorBurn', linearBurn: 'linearBurn', hardMix: 'hardMix', linearHeight: 'linearHeight',
} as const satisfies Record<PhotoshopDualMode, Extract<StampDualBlend, { family: 'texture' }>['mode']>;

const CONTROL_NAMES = {
  fade: 'fade', penPressure: 'pen pressure', penTilt: 'pen tilt', stylusWheel: 'stylus wheel', initialDirection: 'initial direction', direction: 'direction', rotation: 'rotation',
} as const satisfies Record<Exclude<PhotoshopControl['kind'], 'off' | 'unsupported'>, string>;

/** A round tip's hardness, 0..1: a computed tip's own, a simulated tip's by its simulated hardness, a bristle tip's full. */
function photoshopRoundTipHardness(tip: Exclude<PhotoshopKnownTip, { kind: 'sampled' }>): number {
  if (tip.kind === 'computed') return Math.round(tip.hardness) / 100;
  if (tip.kind === 'erodible' || tip.kind === 'airbrush') return Math.round(tip.simulatedHardness) / 100;
  return 1;
}

/** A tip as an image to write: sampled, else round (a computed tip, or a bristle, erodible or airbrush one read as round). */
export function photoshopTipImage(tip: PhotoshopKnownTip): PhotoshopTipImage {
  const { geometry } = tip;
  if (tip.kind === 'sampled') return { kind: 'sampled', id: tip.sample, flipX: geometry.flipX, flipY: geometry.flipY };
  const hardness = photoshopRoundTipHardness(tip);
  return { kind: 'round', hardness, diameter: geometry.diameter, span: photoshopComputedTipSpan(geometry.diameter, hardness) };
}

/** Which asset a tip lands as: a sample as itself, an erodible tip with its height map, any other as a round drawing. */
export function photoshopTipAssetKind(tip: PhotoshopKnownTip): PhotoshopTipAsset['kind'] {
  return tip.kind === 'sampled' || tip.kind === 'erodible' ? tip.kind : 'round';
}

/**
 * A sample is stored with a blank texel around it (PHOTOSHOP_SAMPLE_BORDER): Photoshop reads past a sample's edge as
 * blank, where a GPU sampler clamped to the edge would repeat it, painting a half pixel too much on each side.
 */
export const PHOTOSHOP_SAMPLE_BORDER = 1;

/** `sample` (0 where it lays no paint) inside its blank border. */
export function photoshopSampleWithBorder(sample: { width: number; height: number; pixels: Uint8Array }) {
  const b = PHOTOSHOP_SAMPLE_BORDER, width = sample.width + 2 * b, height = sample.height + 2 * b, pixels = new Uint8Array(width * height);
  for (let y = 0; y < sample.height; y++) pixels.set(sample.pixels.subarray(y * sample.width, (y + 1) * sample.width), (y + b) * width + b);
  return { width, height, pixels };
}

/**
 * Photoshop centres a sample on its middle texel, floor(size / 2), mirrored with the sample when it's flipped: as a
 * share of the stored image, border included.
 */
const sampleCenter = (size: number, flip: boolean) => {
  const center = (Math.floor(size / 2) + 0.5 + PHOTOSHOP_SAMPLE_BORDER) / (size + 2 * PHOTOSHOP_SAMPLE_BORDER);
  return flip ? 1 - center : center;
};

const tipRoundness = (tip: PhotoshopKnownTip) => Math.min(1, Math.max(0.01, tip.geometry.roundness / 100));

/**
 * A tip as the studio reads it: its image, roundness, a sample's centre, and a round tip's span past its diameter. A
 * sampled preset tip always has a sampled asset (readStampPaintPack holds a manifest to it).
 */
function tipOf(tip: PhotoshopKnownTip, asset: PhotoshopTipAsset, prefix: string, note: Note): StampBrushTip {
  const roundness = tipRoundness(tip), sampling = 'anisotropic', { geometry } = tip;
  // The border widens the image past the diameter; a sample that isn't square takes its span from its width.
  if (asset.kind === 'sampled') {
    const { sample } = asset;
    return { image: asset.image, roundness, sampling, span: (sample.width + 2 * PHOTOSHOP_SAMPLE_BORDER) / sample.width, center: [sampleCenter(sample.width, geometry.flipX), sampleCenter(sample.height, geometry.flipY)] };
  }
  if (tip.kind === 'sampled') throw new Error(`photoshop: a sampled tip given a ${asset.kind} image`);
  if (geometry.diameter <= PHOTOSHOP_PIXEL_TIP_DIAMETER) note('approximated', `${prefix}tip.geometry.diameter`, `a ${geometry.diameter} px computed tip, which Photoshop draws in whole pixels, read by its profile`);
  return { image: asset.image, roundness, sampling, span: photoshopComputedTipSpan(geometry.diameter, photoshopRoundTipHardness(tip)) };
}

/** Photoshop's samples and patterns are lighter where more paint goes, so each is negated, a pattern unless inverted. */
export const photoshopPatternNegated = (preset: PhotoshopPreset) => !preset.texture?.invert;

const OFF: PhotoshopDynamic = { control: { kind: 'off' }, jitter: 0 };
/** A dynamic as shares: its jitter (0..1 for most, beyond 1 for scatter) and its control's minimum (0..1). */
const shares = (d: PhotoshopDynamic = OFF) => ({ jitter: d.jitter / 100, control: d.control, minimum: photoshopControlMinimum(d.control) / 100 });

type Note = (level: StampBrushSupportNote['level'], setting: string, detail: string) => void;

/**
 * A dynamic's pressure response (its linear pressure amount), from its control and the minimum it falls to at no
 * pressure, noting any control a path can't drive.
 */
function pressureOf(path: string, what: string, control: PhotoshopControl, minimum: number, note: Note): number {
  if (control.kind === 'off') return 0;
  if (control.kind === 'penPressure') return 1 - minimum;
  if (control.kind === 'fade') note('unsupported', `${path}.control`, `${what} fades over a count of stamps; the studio fades a stroke only by its falloff and tapers`);
  else note('inapplicable', `${path}.control`, `${what} follows ${control.kind === 'unsupported' ? `control ${control.code}` : CONTROL_NAMES[control.kind]}: an authored stroke has only pressure`);
  return 0;
}

/**
 * How Photoshop's pen was driving the brush where it painted. `lingeringPose`: a Brush Pose's size and opacity
 * overrides were still in force, outlasting the posed stroke they were set for until the brush was next applied, as
 * when the capture rig paints a reference S-curve after a posed line (vid-97's pressure check). A painting has none.
 */
export type PhotoshopPressureContext = { lingeringPose: boolean };
export const PHOTOSHOP_PEN_PRESSURE: PhotoshopPressureContext = { lingeringPose: false };

/**
 * Pressure's linear amounts on size, opacity and flow: a lingering pose over the options bar's buttons (each drives
 * wholly) over the brush's dynamics. A pose drives both wholly, but the size amount a beneath counts twice (minimum m
 * gives 1 − (1 − m)²(1 − p)); opacity's is unprobed, read as not. Tool szVr, opVr, prVr are noted, not read.
 */
function photoshopPressureAmounts(p: PhotoshopPaintablePreset, context: PhotoshopPressureContext, note: Note): { size: number; opacity: number; flow: number } {
  const size = shares(p.tipDynamics?.size), opacity = shares(p.transfer?.opacity), flow = shares(p.transfer?.flow);
  const buttons = {
    size: p.tool?.pressureOverridesSize ? 1 : pressureOf('tipDynamics.size', 'size', size.control, (p.tipDynamics?.minimumDiameter ?? 0) / 100, note),
    opacity: p.tool?.pressureOverridesOpacity ? 1 : pressureOf('transfer.opacity', 'opacity', opacity.control, opacity.minimum, note),
    flow: pressureOf('transfer.flow', 'flow', flow.control, flow.minimum, note),
  };
  if (p.tool) {
    // A tool preset keeps the tool's own pressure dynamics beside the brush's, and they often differ.
    const own = [['sizeDynamics', 'size', p.tipDynamics?.size], ['opacityDynamics', 'opacity', p.transfer?.opacity], ['flowDynamics', 'flow', p.transfer?.flow]] as const;
    for (const [key, what, brush] of own) {
      if (p.tool[key]?.control.kind === 'penPressure' && brush?.control.kind !== 'penPressure') {
        note('unsupported', `tool.${key}`, `the tool's own ${what} by pen pressure; the brush's dynamics are read, which don't set it`);
      }
    }
  }
  if (!context.lingeringPose) return buttons;
  return { ...buttons, size: buttons.size > 0 ? buttons.size ** 2 : 1, opacity: 1 };
}

/**
 * Scatter and count, the main brush's or its dual's: the studio's scatter (its radius or lateral reach, and its count)
 * and the count's linear dynamics.
 */
function scatterOf(s: PhotoshopScatter | undefined, prefix: string, reading: PhotoshopReading, note: Note): { scatter: StampBrushLayer['scatter']; count: { pressure: number; random: number } } {
  if (!s) return { scatter: { count: 1, radius: 0, lateral: 0 }, count: { pressure: 0, random: 0 } };
  const scatter = shares(s.scatter), count = shares(s.countDynamics);
  const reach = scatter.jitter * reading.scatterSpan, both = s.bothAxes;
  if (reach > 0) note('approximated', `${prefix}scatter.scatter.jitter`, `${Math.round(scatter.jitter * 100)}% read as stamps strayed up to ${reach.toFixed(2)} diameters ${both ? 'every way' : 'across the stroke'}`);
  if (scatter.control.kind === 'penPressure') note('unsupported', `${prefix}scatter.scatter.control`, 'scatter by pressure: the studio scatters alike at any pressure');
  else if (scatter.control.kind !== 'off') pressureOf(`${prefix}scatter.scatter`, 'scatter', scatter.control, 0, note);
  const countPressure = pressureOf(`${prefix}scatter.countDynamics`, 'count', count.control, count.minimum, note);
  return {
    scatter: { count: Math.max(1, Math.round(s.count)), radius: both ? reach : 0, lateral: both ? 0 : reach },
    count: { pressure: countPressure, random: Math.min(1, count.jitter) },
  };
}

/**
 * A tip's spacing in diameters, and its note when Photoshop's spacing is off (a stamp per pointer event). Stepped
 * as Photoshop steps (`eachStamp`), so no step is under a pixel, however small the spacing.
 */
function spacingOf(tip: PhotoshopKnownTip, prefix: string, note: Note) {
  // Photoshop steps by its percentage of the tip's short side: a squashed tip's stamps close up with its roundness.
  const spacing = (tip.geometry.spacing / 100) * tipRoundness(tip);
  if (!tip.geometry.spaced) note('approximated', `${prefix}tip.geometry.spaced`, `spacing off stamps once per pointer event; read as its ${tip.geometry.spacing}% spacing`);
  return spacing;
}

const NO_TAPER = { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 };
/** Photoshop turns a tip counter-clockwise; the studio's canvas runs y down, so a positive turn is clockwise. */
const degrees = (value: number) => (value ? (-value * Math.PI) / 180 : 0);

function readMainLayer(source: PhotoshopBrushSource, note: Note, reading: PhotoshopReading, context: PhotoshopPressureContext): StampBrushLayer {
  const p = source.preset, { tip } = p;
  if (tip.kind === 'erodible' || tip.kind === 'airbrush' || tip.kind === 'bristle') {
    note('unsupported', 'tip.kind', `${tip.kind === 'bristle' ? 'a bristle' : `an ${tip.kind}`} tip, simulated as it paints; read as a round tip of its hardness`);
  }

  const shape = p.tipDynamics;
  const size = shares(shape?.size), angle = shares(shape?.angle), roundness = shares(shape?.roundness);
  const pressure = photoshopPressureAmounts(p, context, note);
  let follow = 0;
  if (angle.control.kind === 'direction') follow = 1;
  else if (angle.control.kind === 'initialDirection') {
    follow = 1;
    note('approximated', 'tipDynamics.angle.control', "initial direction read as following the stroke's direction throughout");
  } else if (angle.control.kind === 'penPressure') note('unsupported', 'tipDynamics.angle.control', 'angle by pressure: the studio turns stamps alike at any pressure');
  else if (angle.control.kind !== 'off') pressureOf('tipDynamics.angle', 'angle', angle.control, 0, note);
  if (angle.jitter > 0) note('approximated', 'tipDynamics.angle.jitter', `${Math.round(angle.jitter * 100)}% read as each stamp turned at random by up to ±${Math.round((angle.jitter * reading.angleJitterSpan * 180) / Math.PI)}°`);
  // vid-97's probes: jittered roundness falls evenly from full to the minimum (which Photoshop never lets under 1%).
  // Pressure is read down to the same minimum, as size's is.
  const minimumRoundness = (shape?.minimumRoundness ?? 0) / 100;
  const roundnessJitter = roundness.jitter * (1 - minimumRoundness);
  const roundnessPressure = pressureOf('tipDynamics.roundness', 'roundness', roundness.control, minimumRoundness, note);
  if (shape?.projection) note('inapplicable', 'tipDynamics.projection', "the tip's projection by pen tilt: an authored stroke has only pressure");

  const { scatter, count } = scatterOf(p.scatter, '', reading, note);
  const opacity = shares(p.transfer?.opacity), flow = shares(p.transfer?.flow);

  let grain: StampBrushLayer['grain'];
  const texture = p.texture;
  if (texture) {
    if (!source.pattern) {
      note('unsupported', 'texture.pattern', `the texture is Photoshop's pattern ${JSON.stringify(texture.pattern?.name ?? '')}, which the file doesn't hold; read as no texture`);
    } else {
      const { mode } = texture;
      grain = {
        image: source.pattern.image,
        scale: (source.pattern.width * texture.scale) / 100 / tip.geometry.diameter,
        // Photoshop holds depth in 255ths.
        depth: Math.round((texture.depth / 100) * 255) / 255,
        blend: { family: 'texture', mode: typeof mode === 'string' ? GRAIN_BLENDS[mode] : 'multiply' },
        // Brightness is in 255ths; both apply after invert, which the stored image already holds.
        brightness: texture.brightness / 255,
        contrast: texture.contrast / 100,
        contrastPivot: 'midGrey',
        tiling: 'repeat',
        offsetJitter: 0,
        // Each tip is textured where it lands, the pattern still fixed to the canvas: it neither moves, grows nor turns with the stamp.
        ...(texture.eachTip ? { kind: 'rolling' as const, zoom: 0, movement: 1, rotation: 0 } : { kind: 'canvas' as const }),
      };
      note('approximated', 'texture.scale', `the pattern tiles ${grain.scale.toFixed(2)} diameters across at the preset's ${tip.geometry.diameter} px; Photoshop keeps it that many pixels at any size`);
      if (typeof mode !== 'string') note('unsupported', 'texture.mode', `${photoshopModeName(mode)} has no studio reading; read as multiply`);
      if (texture.eachTip && (texture.depthDynamics.jitter > 0 || texture.depthDynamics.control.kind !== 'off')) note('unsupported', 'texture.depthDynamics, minimumDepth', 'texture depth varying stamp to stamp');
      if (texture.protect) note('inapplicable', 'texture.protect', "protect texture lays one brush's pattern on every brush in Photoshop; each studio brush keeps its own");
    }
  }

  // Photoshop paints a tool's flow in 255ths: 25% lays 64/255.
  const toolFlow = p.tool?.flow !== undefined ? Math.round((p.tool.flow / 100) * 255) / 255 : 1;
  if (p.noise) note('unsupported', 'noise', "noise on the tip's soft edge");
  if (p.buildUp) note('inapplicable', 'buildUp', 'build-up keeps painting while the pen rests: an authored stroke never rests');
  if (p.pose) {
    note(p.pose.overridePressure ? 'unsupported' : 'inapplicable', 'pose', p.pose.overridePressure
      ? `the pose sets pressure to ${Math.round(p.pose.pressure)}% whatever the stroke's; the studio paints with the stroke's`
      : 'a brush pose sets tilt and angle: an authored stroke has only pressure');
  }

  return {
    tip: tipOf(tip, source.tip, '', note),
    ...(grain && { grain }),
    spacing: spacingOf(tip, '', note),
    stepping: 'eachStamp',
    dynamics: stampLinearDynamics({
      size: { pressure: pressure.size, random: size.jitter },
      opacity: { pressure: pressure.opacity, random: opacity.jitter },
      flow: { pressure: pressure.flow, random: flow.jitter },
      roundness: { pressure: roundnessPressure, random: roundnessJitter },
      count,
      rotation: { direction: follow, random: angle.jitter * reading.angleJitterSpan },
    }),
    scatter,
    rotation: { angle: degrees(tip.geometry.angle), randomStart: false },
    flip: { x: !!shape?.flipX, y: !!shape?.flipY },
    blur: { amount: 0, jitter: 0 },
    taper: NO_TAPER,
    falloff: 0,
    flow: toolFlow,
    accumulation: { kind: 'buildToOpacity' },
    ...(p.wetEdges && { wetEdges: PHOTOSHOP_POOLING }),
  };
}

type PhotoshopDual = NonNullable<PhotoshopPreset['dual']>;

function readDualLayer(source: PhotoshopBrushSource, dual: PhotoshopDual, tip: PhotoshopKnownTip, image: PhotoshopTipAsset, note: Note, reading: PhotoshopReading): StampBrush['dual'] {
  const { mode } = dual;
  if (typeof mode !== 'string') note('unsupported', 'dual.mode', `${photoshopModeName(mode)} has no studio reading; read as multiply`);
  const { scatter, count } = scatterOf(dual.scatter, 'dual.', reading, note);
  const scale = (tip.geometry.diameter / source.preset.tip.geometry.diameter) * reading.dualScale;
  if (dual.flip) note('approximated', 'dual.flip', "the dual's flip read as each of its stamps flipped across its width at random");
  return {
    tip: tipOf(tip, image, 'dual.', note),
    spacing: spacingOf(tip, 'dual.', note),
    stepping: 'eachStamp',
    dynamics: stampLinearDynamics({ count }),
    scatter,
    rotation: { angle: degrees(tip.geometry.angle), randomStart: false },
    flip: { x: dual.flip, y: false },
    blur: { amount: 0, jitter: 0 },
    taper: NO_TAPER,
    falloff: 0,
    // The secondary builds as its own stroke at full flow, whatever the tool's.
    flow: 1,
    accumulation: { kind: 'buildToOpacity' },
    blend: { family: 'texture', mode: typeof mode === 'string' ? DUAL_BLENDS[mode] : 'multiply' },
    scale,
  };
}

function readColorDynamics(color: PhotoshopPreset['color'], note: Note, reading: PhotoshopReading): StampBrushColorDynamics | undefined {
  if (!color) return undefined;
  const swing = shares(color.swing);
  const varied = { hue: (color.hue / 100) * reading.hueJitterShare, saturation: color.saturation / 100, lightness: color.brightness / 100, darkness: color.brightness / 100 };
  const none = { hue: 0, saturation: 0, lightness: 0, darkness: 0 };
  if (color.brightness) note('approximated', 'color.brightness', 'brightness jitter read as lightening and darkening alike');
  if (color.purity) note('unsupported', 'color.purity', `a ${Math.round(color.purity)}% shift in saturation, stroke-wide`);
  if (swing.jitter > 0) note('unsupported', 'color.swing.jitter', 'stamps strayed toward the background colour at random: the studio moves toward the secondary colour by pressure only');
  const secondary = swing.control.kind === 'penPressure' ? 1 : 0;
  if (swing.control.kind !== 'off' && swing.control.kind !== 'penPressure') pressureOf('color.swing', 'foreground to background', swing.control, 0, note);
  const dynamics: StampBrushColorDynamics = {
    stamp: color.perTip ? varied : none,
    stroke: color.perTip ? none : varied,
    pressure: { hue: 0, saturation: 0, lightness: 0, secondary },
  };
  return Object.values(dynamics).some((group) => Object.values(group).some((v) => v !== 0)) ? dynamics : undefined;
}

/** The tool's own blend, and what else of the tool doesn't carry over; its pressure is photoshopPressureAmounts'. */
function readTool(p: PhotoshopPreset, note: Note): StampBlend {
  const { tool } = p;
  if (!tool) return 'normal';
  const blend = typeof tool.mode === 'string' ? BRUSH_BLENDS[tool.mode] : null;
  if (!blend) note('unsupported', 'tool.mode', `the tool paints in ${photoshopModeName(tool.mode)}; read as normal`);
  if (tool.opacity !== 100) note('approximated', 'tool.opacity', `the preset paints at ${tool.opacity}% opacity; a deposit states its own`);
  if (tool.kind === 'PcTl') note('approximated', 'tool', "a pencil's hard, unsmoothed edge read as the brush's own");
  else if (tool.kind === 'unsupported') note('inapplicable', 'tool', `a preset of another tool (${tool.classId}), which paints nothing new: its tip is read as a brush's`);
  if (tool.kind === 'MixB') {
    const pct = (value: number | undefined, unset: number) => Math.round(value ?? unset);
    note('unsupported', 'tool.wetness, dryness, mix, sampleAllLayers', `Mixer Brush wet ${pct(tool.wetness, 0)}%, load ${pct(tool.dryness, 100)}%, mix ${pct(tool.mix, 0)}%: wet mixing isn't yet painted (vid-90)`);
    if (tool.autoFill !== undefined || tool.autoClean !== undefined) note('inapplicable', 'tool.autoFill, autoClean', 'refilling and cleaning the brush between strokes: every deposit starts loaded');
  }
  return blend ?? 'normal';
}

/**
 * `source`'s preset read into a StampBrush named `name`, and what didn't carry over, its pressure as the pen drove it
 * under `context` (a painting's is plain pen pressure).
 */
export function normalizePhotoshopBrush(
  name: string, source: PhotoshopBrushSource, reading: PhotoshopReading = PHOTOSHOP_READING, context: PhotoshopPressureContext = PHOTOSHOP_PEN_PRESSURE,
): { brush: StampBrush; support: StampBrushSupportNote[] } {
  const support: StampBrushSupportNote[] = [];
  const note: Note = (level, setting, detail) => support.push({ level, setting, detail });
  const blend = readTool(source.preset, note);
  const color = readColorDynamics(source.preset.color, note, reading);
  const brush: StampBrush = { name, blend, ...(color && { color }), ...readMainLayer(source, note, reading, context) };
  const { dual } = source.preset;
  if (dual) {
    const { tip } = dual;
    if (tip.kind === 'unsupported') note('unsupported', 'dual.tip.kind', `the dual's tip is a ${tip.classId}, a class the studio doesn't read; imported without its dual`);
    else if (source.dualTip) brush.dual = readDualLayer(source, dual, tip, source.dualTip, note, reading);
    else note('unsupported', 'dual.tip', "the dual's tip isn't in the file; imported without its dual");
  }
  return { brush, support };
}
