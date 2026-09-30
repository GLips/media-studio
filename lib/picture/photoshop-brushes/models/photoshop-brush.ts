// photoshop-brush.ts: a Photoshop brush preset (photoshop-preset.ts, read from an .abr's `brushPreset` or a .tpl's tool
// preset) read into a StampBrush, the same shape a Procreate brush becomes, with a note for every setting that doesn't
// carry over as Photoshop means it. `setting` in a note is the field's path in the preset (`tipDynamics.size.jitter`).
//
// Photoshop's own meanings are better known than Procreate's (its dialog names each setting and its unit), so most
// settings carry over directly; the constants that aren't known are a PhotoshopReading, one set shared by every pack,
// to be fitted against Photoshop's renders (vid-97) as ProcreateReading is against Procreate's previews.
//
// Negative space: live-input settings (smoothing and its catch-up, pressure smoothing), the preset's own size (a
// deposit states its diameter), airbrush build-up while the pen rests (a path never rests) and the preview's settings
// aren't a brush's painting, and go unreported, save build-up, noted `inapplicable`. Tilt, stylus wheel, rotation and
// brush pose are `inapplicable` (a path has only pressure); fade controls, noise and roundness by pressure are
// `unsupported`; the Mixer Brush's settings are carried in `wetMix` and noted `unsupported` until vid-90.

import { PHOTOSHOP_POOLING } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { PHOTOSHOP_PIXEL_TIP_DIAMETER, photoshopComputedTipSpan } from './photoshop-computed-tip.ts';
import type { PhotoshopDynamic, PhotoshopPreset, PhotoshopPresetTip, PhotoshopScatter } from './photoshop-preset.ts';
import { PHOTOSHOP_READING } from './photoshop-reading.ts';
import {
  stampDynamics, type StampBlend, type StampBrush, type StampBrushAsset, type StampBrushColorDynamics, type StampBrushLayer, type StampBrushSupportNote, type StampBrushTip,
  type StampBrushWetMix, type StampDualBlend, type StampGrainBlend,
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

/**
 * One preset and where its images landed among the pack's assets: its tip's and its dual's (none when the file lacks
 * the sample the dual names; a brush whose own tip is missing isn't imported) with a sampled tip's own size in
 * pixels, and its texture's pattern with the pattern's width in pixels. `Preset` is the typed preset, or the .abr's
 * descriptor as a manifest stores it.
 */
export type PhotoshopBrushSource<Preset = PhotoshopPreset> = {
  preset: Preset;
  tip: StampBrushAsset;
  tipSample?: PhotoshopSampleSize;
  dualTip?: StampBrushAsset;
  dualTipSample?: PhotoshopSampleSize;
  pattern?: { image: StampBrushAsset; width: number };
};

/** A tool's own mode, which the deposit paints in. */
const BRUSH_BLENDS: Readonly<Record<string, StampBlend>> = { normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', colorBurn: 'colorBurn' };
/** Every mode Texture offers. */
const GRAIN_BLENDS: Readonly<Record<string, Extract<StampGrainBlend, { family: 'texture' }>['mode']>> = {
  multiply: 'multiply', subtract: 'subtract', darken: 'darken', overlay: 'overlay', colorDodge: 'colorDodge', colorBurn: 'colorBurn', linearBurn: 'linearBurn',
  hardMix: 'hardMix', linearHeight: 'linearHeight', height: 'height',
};
/** Every mode Dual Brush offers. */
const DUAL_BLENDS: Readonly<Record<string, Extract<StampDualBlend, { family: 'texture' }>['mode']>> = {
  multiply: 'multiply', darken: 'darken', overlay: 'overlay', colorDodge: 'colorDodge', colorBurn: 'colorBurn', linearBurn: 'linearBurn', hardMix: 'hardMix', linearHeight: 'linearHeight',
};

const CONTROL_NAMES: Readonly<Record<string, string>> = {
  fade: 'fade', penPressure: 'pen pressure', penTilt: 'pen tilt', stylusWheel: 'stylus wheel', initialDirection: 'initial direction', direction: 'direction', rotation: 'rotation',
};

/** A tip as an image to write: sampled, else round (a computed tip, or a bristle or erodible one read as round). */
export function photoshopTipImage(tip: PhotoshopPresetTip): PhotoshopTipImage {
  if (tip.kind === 'sampled') return { kind: 'sampled', id: tip.sampledData ?? '', flipX: tip.flipX, flipY: tip.flipY };
  const hardness = Math.round((tip.kind === 'erodible' ? tip.simulatedHardness : tip.hardness) ?? 100) / 100;
  return { kind: 'round', hardness, diameter: tip.diameter, span: photoshopComputedTipSpan(tip.diameter, hardness) };
}

export type PhotoshopSampleSize = { width: number; height: number };

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

const tipRoundness = (tip: PhotoshopPresetTip) => Math.min(1, Math.max(0.01, tip.roundness / 100));

/** A tip as the studio reads it: its image, roundness, a sample's centre, and a computed tip's span past its diameter. */
function tipOf(tip: PhotoshopPresetTip, image: StampBrushAsset, sample: PhotoshopSampleSize | undefined, prefix: string, note: Note): StampBrushTip {
  const drawn = photoshopTipImage(tip);
  const roundness = tipRoundness(tip), sampling = 'anisotropic';
  // The border widens the image past the diameter; a sample that isn't square takes its span from its width.
  if (drawn.kind === 'sampled') {
    return sample
      ? { image, roundness, sampling, span: (sample.width + 2 * PHOTOSHOP_SAMPLE_BORDER) / sample.width, center: [sampleCenter(sample.width, drawn.flipX), sampleCenter(sample.height, drawn.flipY)] }
      : { image, roundness, sampling };
  }
  if (drawn.diameter <= PHOTOSHOP_PIXEL_TIP_DIAMETER) note('approximated', `${prefix}tip.diameter`, `a ${drawn.diameter} px computed tip, which Photoshop draws in whole pixels, read by its profile`);
  return { image, roundness, sampling, span: drawn.span };
}

/** Photoshop's samples and patterns are lighter where more paint goes, so each is negated, a pattern unless inverted. */
export const photoshopPatternNegated = (preset: PhotoshopPreset) => !preset.texture?.invert;

const OFF: PhotoshopDynamic = { control: 'off', fadeSteps: 25, jitter: 0, minimum: 0 };
/** A dynamic as shares: its jitter (0..1 for most, beyond 1 for scatter) and its minimum (0..1). */
const shares = (d: PhotoshopDynamic = OFF) => ({ jitter: d.jitter / 100, control: d.control, minimum: d.minimum / 100 });

type Note = (level: StampBrushSupportNote['level'], setting: string, detail: string) => void;

/**
 * A dynamic's pressure response (StampBrushStamping's pressure), from its control and the minimum it falls to at no
 * pressure, noting any control a path can't drive.
 */
function pressureOf(path: string, what: string, control: string, minimum: number, note: Note): number {
  if (control === 'off') return 0;
  if (control === 'penPressure') return 1 - minimum;
  if (control === 'fade') note('unsupported', `${path}.control`, `${what} fades over a count of stamps; the studio fades a stroke only by its falloff and tapers`);
  else note('inapplicable', `${path}.control`, `${what} follows ${CONTROL_NAMES[control] ?? `control ${control}`}: an authored stroke has only pressure`);
  return 0;
}

/** Scatter and count, the main brush's or its dual's, read into the studio's scatter: its radius or lateral reach, and its count. */
function scatterOf(s: PhotoshopScatter | undefined, prefix: string, reading: PhotoshopReading, note: Note): StampBrushLayer['scatter'] {
  if (!s) return { count: 1, countJitter: 0, countPressure: 0, radius: 0, lateral: 0 };
  const scatter = shares(s.scatter), count = shares(s.countDynamics);
  const reach = scatter.jitter * reading.scatterSpan, both = s.bothAxes;
  if (reach > 0) note('approximated', `${prefix}scatter.scatter.jitter`, `${Math.round(scatter.jitter * 100)}% read as stamps strayed up to ${reach.toFixed(2)} diameters ${both ? 'every way' : 'across the stroke'}`);
  if (scatter.control === 'penPressure') note('unsupported', `${prefix}scatter.scatter.control`, 'scatter by pressure: the studio scatters alike at any pressure');
  else if (scatter.control !== 'off') pressureOf(`${prefix}scatter.scatter`, 'scatter', scatter.control, 0, note);
  const countPressure = pressureOf(`${prefix}scatter.countDynamics`, 'count', count.control, count.minimum, note);
  return { count: Math.max(1, Math.round(s.count)), countJitter: Math.min(1, count.jitter), countPressure, radius: both ? reach : 0, lateral: both ? 0 : reach };
}

/**
 * A tip's spacing in diameters, and its note when Photoshop's spacing is off (a stamp per pointer event). Stepped
 * as Photoshop steps (`eachStamp`), so no step is under a pixel, however small the spacing.
 */
function spacingOf(tip: PhotoshopPresetTip, prefix: string, note: Note) {
  // Photoshop steps by its percentage of the tip's short side: a squashed tip's stamps close up with its roundness.
  const spacing = (tip.spacing / 100) * tipRoundness(tip);
  if (!tip.spaced) note('approximated', `${prefix}tip.spaced`, `spacing off stamps once per pointer event; read as its ${tip.spacing}% spacing`);
  return spacing;
}

const NO_TAPER = { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 };
/** Photoshop turns a tip counter-clockwise; the studio's canvas runs y down, so a positive turn is clockwise. */
const degrees = (value: number) => (value ? (-value * Math.PI) / 180 : 0);

function readMainLayer(source: PhotoshopBrushSource, note: Note, reading: PhotoshopReading): StampBrushLayer {
  const p = source.preset, { tip } = p;
  if (tip.kind === 'erodible' || tip.kind === 'bristle') {
    note('unsupported', 'tip.kind', `a ${tip.kind === 'bristle' ? 'bristle' : 'erodible or airbrush'} tip, simulated as it paints; read as a round tip of its hardness`);
  }

  const shape = p.tipDynamics;
  const size = shares(shape?.size), angle = shares(shape?.angle), roundness = shares(shape?.roundness);
  // The options bar's pressure buttons drive size or opacity wholly by pressure, whatever the brush's dynamics say.
  const sizePressure = p.tool?.pressureOverridesSize ? 1 : pressureOf('tipDynamics.size', 'size', size.control, (shape?.minimumDiameter ?? 0) / 100, note);
  let follow = 0;
  if (angle.control === 'direction') follow = 1;
  else if (angle.control === 'initialDirection') {
    follow = 1;
    note('approximated', 'tipDynamics.angle.control', "initial direction read as following the stroke's direction throughout");
  } else if (angle.control === 'penPressure') note('unsupported', 'tipDynamics.angle.control', 'angle by pressure: the studio turns stamps alike at any pressure');
  else if (angle.control !== 'off') pressureOf('tipDynamics.angle', 'angle', angle.control, 0, note);
  if (angle.jitter > 0) note('approximated', 'tipDynamics.angle.jitter', `${Math.round(angle.jitter * 100)}% read as each stamp turned at random by up to ±${Math.round((angle.jitter * reading.angleJitterSpan * 180) / Math.PI)}°`);
  // vid-97's probes: jittered roundness falls evenly from full to the minimum (which Photoshop never lets under 1%).
  // Pressure is read down to the same minimum, as size's is.
  const minimumRoundness = (shape?.minimumRoundness ?? 0) / 100;
  const roundnessJitter = roundness.jitter * (1 - minimumRoundness);
  const roundnessPressure = pressureOf('tipDynamics.roundness', 'roundness', roundness.control, minimumRoundness, note);
  if (shape?.projection) note('inapplicable', 'tipDynamics.projection', "the tip's projection by pen tilt: an authored stroke has only pressure");

  const scatter = scatterOf(p.scatter, '', reading, note);

  const opacity = shares(p.transfer?.opacity), flow = shares(p.transfer?.flow);
  const opacityPressure = p.tool?.pressureOverridesOpacity ? 1 : pressureOf('transfer.opacity', 'opacity', opacity.control, opacity.minimum, note);
  const flowPressure = pressureOf('transfer.flow', 'flow', flow.control, flow.minimum, note);

  let grain: StampBrushLayer['grain'];
  const texture = p.texture;
  if (texture) {
    if (!source.pattern) {
      note('unsupported', 'texture.pattern', `the texture is Photoshop's pattern ${JSON.stringify(texture.pattern?.name ?? '')}, which the file doesn't hold; read as no texture`);
    } else {
      const blend = GRAIN_BLENDS[texture.mode];
      grain = {
        image: source.pattern.image,
        scale: (source.pattern.width * texture.scale) / 100 / tip.diameter,
        // Photoshop holds depth in 255ths.
        depth: Math.round((texture.depth / 100) * 255) / 255,
        blend: { family: 'texture', mode: blend ?? 'multiply' },
        // Brightness is in 255ths; both apply after invert, which the stored image already holds.
        brightness: texture.brightness / 255,
        contrast: texture.contrast / 100,
        contrastPivot: 'midGrey',
        tiling: 'repeat',
        offsetJitter: 0,
        // Each tip is textured where it lands, the pattern still fixed to the canvas: it neither moves, grows nor turns with the stamp.
        ...(texture.eachTip ? { kind: 'rolling' as const, zoom: 0, movement: 1, rotation: 0 } : { kind: 'canvas' as const }),
      };
      note('approximated', 'texture.scale', `the pattern tiles ${grain.scale.toFixed(2)} diameters across at the preset's ${tip.diameter} px; Photoshop keeps it that many pixels at any size`);
      if (!blend) note('unsupported', 'texture.mode', `${texture.mode} has no studio reading; read as multiply`);
      if (texture.eachTip && (texture.depthDynamics.jitter > 0 || texture.depthDynamics.control !== 'off')) note('unsupported', 'texture.depthDynamics, minimumDepth', 'texture depth varying stamp to stamp');
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
    tip: tipOf(tip, source.tip, source.tipSample, '', note),
    ...(grain && { grain }),
    spacing: spacingOf(tip, '', note),
    stepping: 'eachStamp',
    dynamics: stampDynamics({
      pressure: { size: sizePressure, opacity: opacityPressure, flow: flowPressure, roundness: roundnessPressure },
      random: { size: size.jitter, opacity: opacity.jitter, flow: flow.jitter, roundness: roundnessJitter },
    }),
    scatter,
    rotation: { angle: degrees(tip.angle), follow, jitter: angle.jitter * reading.angleJitterSpan, randomStart: false },
    flip: { x: !!shape?.flipX, y: !!shape?.flipY },
    blur: { amount: 0, jitter: 0 },
    taper: NO_TAPER,
    falloff: 0,
    flow: toolFlow,
    accumulation: { kind: 'buildToOpacity' },
    ...(p.wetEdges && { wetEdges: PHOTOSHOP_POOLING }),
  };
}

function readDualLayer(source: PhotoshopBrushSource, dual: NonNullable<PhotoshopPreset['dual']>, note: Note, reading: PhotoshopReading): StampBrush['dual'] {
  const blend = DUAL_BLENDS[dual.mode];
  if (!blend) note('unsupported', 'dual.mode', `${dual.mode} has no studio reading; read as multiply`);
  const scatter = scatterOf(dual.scatter, 'dual.', reading, note);
  const scale = (dual.tip.diameter / source.preset.tip.diameter) * reading.dualScale;
  if (dual.flip) note('approximated', 'dual.flip', "the dual's flip read as each of its stamps flipped across its width at random");
  return {
    tip: tipOf(dual.tip, source.dualTip!, source.dualTipSample, 'dual.', note),
    spacing: spacingOf(dual.tip, 'dual.', note),
    stepping: 'eachStamp',
    dynamics: [],
    scatter,
    rotation: { angle: degrees(dual.tip.angle), follow: 0, jitter: 0, randomStart: false },
    flip: { x: dual.flip, y: false },
    blur: { amount: 0, jitter: 0 },
    taper: NO_TAPER,
    falloff: 0,
    // The secondary builds as its own stroke at full flow, whatever the tool's.
    flow: 1,
    accumulation: { kind: 'buildToOpacity' },
    blend: { family: 'texture', mode: blend ?? 'multiply' },
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
  const secondary = swing.control === 'penPressure' ? 1 : 0;
  if (swing.control !== 'off' && swing.control !== 'penPressure') pressureOf('color.swing', 'foreground to background', swing.control, 0, note);
  const dynamics: StampBrushColorDynamics = {
    stamp: color.perTip ? varied : none,
    stroke: color.perTip ? none : varied,
    pressure: { hue: 0, saturation: 0, lightness: 0, secondary },
  };
  return Object.values(dynamics).some((group) => Object.values(group).some((v) => v !== 0)) ? dynamics : undefined;
}

/** A Mixer Brush's settings, carried for the wet-paint model (vid-90), and its other tools noted. */
function readTool(p: PhotoshopPreset, note: Note): { blend: StampBlend; wetMix?: StampBrushWetMix } {
  const { tool } = p;
  if (!tool) return { blend: 'normal' };
  const blend = BRUSH_BLENDS[tool.mode];
  if (!blend) note('unsupported', 'tool.mode', `the tool paints in ${tool.mode}; read as normal`);
  if (tool.opacity !== 100) note('approximated', 'tool.opacity', `the preset paints at ${tool.opacity}% opacity; a deposit states its own`);
  // A tool preset keeps the tool's own pressure dynamics beside the brush's, and they often differ; the brush's are read.
  const own = [['sizeDynamics', 'size', p.tipDynamics?.size], ['opacityDynamics', 'opacity', p.transfer?.opacity], ['flowDynamics', 'flow', p.transfer?.flow]] as const;
  for (const [key, what, brush] of own) {
    if (tool[key]?.control === 'penPressure' && brush?.control !== 'penPressure') {
      note('unsupported', `tool.${key}`, `the tool's own ${what} by pen pressure; the brush's dynamics are read, which don't set it`);
    }
  }
  if (tool.kind === 'PcTl') note('approximated', 'tool', "a pencil's hard, unsmoothed edge read as the brush's own");
  else if (tool.kind !== 'PbTl' && tool.kind !== 'MixB') note('inapplicable', 'tool', `a preset of another tool (${tool.kind}), which paints nothing new: its tip is read as a brush's`);
  if (tool.kind !== 'MixB') return { blend: blend ?? 'normal' };
  const wetMix: StampBrushWetMix = { load: (tool.dryness ?? 100) / 100, wetness: (tool.wetness ?? 0) / 100, mix: (tool.mix ?? 0) / 100, sampleAllLayers: !!tool.sampleAllLayers };
  note('unsupported', 'tool.wetness, dryness, mix, sampleAllLayers', `Mixer Brush wet ${Math.round(wetMix.wetness * 100)}%, load ${Math.round(wetMix.load * 100)}%, mix ${Math.round(wetMix.mix * 100)}%: carried in wetMix, not yet painted (vid-90)`);
  if (tool.autoFill !== undefined || tool.autoClean !== undefined) note('inapplicable', 'tool.autoFill, autoClean', 'refilling and cleaning the brush between strokes: every deposit starts loaded');
  return { blend: blend ?? 'normal', wetMix };
}

/** `source`'s preset read into a StampBrush named `name`, and what didn't carry over. */
export function normalizePhotoshopBrush(name: string, source: PhotoshopBrushSource, reading: PhotoshopReading = PHOTOSHOP_READING): { brush: StampBrush; support: StampBrushSupportNote[] } {
  const support: StampBrushSupportNote[] = [];
  const note: Note = (level, setting, detail) => support.push({ level, setting, detail });
  const { blend, wetMix } = readTool(source.preset, note);
  const color = readColorDynamics(source.preset.color, note, reading);
  const brush: StampBrush = { name, blend, ...(color && { color }), ...readMainLayer(source, note, reading) };
  const { dual } = source.preset;
  if (dual) {
    if (source.dualTip) brush.dual = readDualLayer(source, dual, note, reading);
    else note('unsupported', 'dual.tip', "the dual's tip isn't in the file; imported without its dual");
  }
  if (wetMix) brush.wetMix = wetMix;
  return { brush, support };
}
