// photoshop-brush.ts: a Photoshop brush preset (a `brushPreset` descriptor from an .abr, or a .tpl's tool preset
// carrying its tool options) read into a StampBrush, the same shape a Procreate brush becomes, with a note for every
// setting that doesn't carry over as Photoshop means it. Photoshop's descriptor keys stop here: nothing past this file
// reads them. `setting` in a note is the key's path in the preset (`szVr.jitter`, `toolOptions.Opct`).
//
// Photoshop's own meanings are better known than Procreate's (its dialog names each setting and its unit), so most
// settings carry over directly; the constants that aren't known are a PhotoshopReading, one set shared by every pack,
// to be fitted against Photoshop's renders (vid-97) as ProcreateReading is against Procreate's previews.
//
// Negative space: live-input settings (smoothing and its catch-up, pressure smoothing), the preset's own size
// (`Dmtr`: a deposit states its diameter), airbrush build-up while the pen rests (`Rpt `: a path never rests) and the
// preview's settings aren't a brush's painting, and go unreported, save build-up, noted `inapplicable`. Tilt, stylus
// wheel, rotation and brush pose are `inapplicable` (a path has only pressure); fade controls, noise and roundness
// jitter are `unsupported`; the Mixer Brush's settings are carried in `wetMix` and noted `unsupported` until vid-90.

import { photoshopEnum, photoshopFlag, photoshopNumber, photoshopObject, type PhotoshopDescriptor } from './photoshop-descriptor.ts';
import { PHOTOSHOP_READING } from './photoshop-reading.ts';
import type { StampBlend, StampBrush, StampBrushAsset, StampBrushColorDynamics, StampBrushLayer, StampBrushWetMix, StampDualBlend, StampGrainBlend } from './stamp-brush.ts';
import { STAMP_MIN_SPACING } from './stamp-placement.ts';
import type { StampBrushSupportNote } from './style.ts';

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
  /** How far a texture's brightness of 100 raises the grain's paint (StampBrushGrain's brightness). */
  grainBrightness: number;
  /** How far a texture's contrast of 100 stretches the grain about its mean; -50 flattens it whatever this is. */
  grainContrast: number;
  /** A texture's depth is textureDepth (0..1) to this power. */
  grainDepthCurve: number;
  /** A wet edge's rim width (a fraction of the stamp's radius), how dark it gathers and how steeply it rises. */
  wetEdgeWidth: number;
  wetEdgeRim: number;
  wetEdgeSharpness: number;
  /** The share of its flow a wet-edged brush lays inside its rim: Photoshop's wet edges pale the body. */
  wetEdgeBody: number;
  /** A dual's stamps are this times the ratio of the dual tip's diameter to the main tip's. */
  dualScale: number;
};

/** A Photoshop tip as an image: a sampled one by its id in the file, or a round one drawn to its hardness (0..1). */
export type PhotoshopTipImage = { kind: 'sampled'; id: string; flipX: boolean; flipY: boolean } | { kind: 'round'; hardness: number };

/**
 * One preset and where its images landed among the pack's assets: its tip's and its dual's (none when the file lacks
 * the sample the preset names), and its texture's pattern with the pattern's width in pixels.
 */
export type PhotoshopBrushSource = {
  preset: PhotoshopDescriptor;
  tip?: StampBrushAsset;
  dualTip?: StampBrushAsset;
  pattern?: { image: StampBrushAsset; width: number };
};

/** Photoshop's blend modes by the enum values its descriptors write. */
const PHOTOSHOP_BLEND_NAMES: Readonly<Record<string, string>> = {
  Nrml: 'Normal', Dslv: 'Dissolve', Dstt: 'Dissolve', Drkn: 'Darken', Mltp: 'Multiply', CBrn: 'Color Burn', linearBurn: 'Linear Burn',
  darkerColor: 'Darker Color', Lghn: 'Lighten', Scrn: 'Screen', CDdg: 'Color Dodge', linearDodge: 'Linear Dodge (Add)', lighterColor: 'Lighter Color',
  Ovrl: 'Overlay', SftL: 'Soft Light', HrdL: 'Hard Light', vividLight: 'Vivid Light', linearLight: 'Linear Light', pinLight: 'Pin Light', hardMix: 'Hard Mix',
  Dfrn: 'Difference', Xclu: 'Exclusion', blendSubtraction: 'Subtract', blendDivide: 'Divide', Sbtr: 'Subtract', H: 'Hue', 'H   ': 'Hue', Strt: 'Saturation',
  Clr: 'Color', 'Clr ': 'Color', Lmns: 'Luminosity', Hght: 'Height', linearHeight: 'Linear Height', Bhnd: 'Behind', Clar: 'Clear',
};
const blendName = (mode: string | undefined) => `${mode} (${PHOTOSHOP_BLEND_NAMES[mode ?? ''] ?? 'unknown'})`;
/** A tool's own mode, which the deposit paints in. */
const BRUSH_BLENDS: Readonly<Record<string, StampBlend>> = { Nrml: 'normal', Mltp: 'multiply', Scrn: 'screen', Ovrl: 'overlay', Drkn: 'darken', Lghn: 'lighten', CBrn: 'colorBurn' };
/** Every mode Texture offers. */
const GRAIN_BLENDS: Readonly<Record<string, StampGrainBlend>> = {
  Mltp: 'multiply', Sbtr: 'subtract', Drkn: 'darken', Ovrl: 'multiply', CDdg: 'colorDodge', CBrn: 'colorBurn', linearBurn: 'linearBurn', hardMix: 'hardMix',
  linearHeight: 'linearHeight', Hght: 'height',
};
/** Every mode Dual Brush offers. */
const DUAL_BLENDS: Readonly<Record<string, StampDualBlend>> = {
  Mltp: 'multiply', Drkn: 'darken', Ovrl: 'overlay', CDdg: 'colorDodge', CBrn: 'colorBurn', linearBurn: 'linearBurn', hardMix: 'hardMix', linearHeight: 'linearHeight',
};

/** A dynamic's control (`bVTy`), as Photoshop numbers them. */
const CONTROL_OFF = 0, CONTROL_FADE = 1, CONTROL_PRESSURE = 2, CONTROL_INITIAL_DIRECTION = 5, CONTROL_DIRECTION = 6;
const CONTROL_NAMES = ['off', 'fade', 'pen pressure', 'pen tilt', 'stylus wheel', 'initial direction', 'direction', 'rotation'];

/** A tip's descriptor as an image to write: sampled, else round (a computed tip, or a bristle or erodible one read as round). */
export function photoshopTipImage(tip: PhotoshopDescriptor): PhotoshopTipImage {
  if (tip._class === 'sampledBrush') return { kind: 'sampled', id: String(tip.sampledData ?? ''), flipX: photoshopFlag(tip, 'flipX'), flipY: photoshopFlag(tip, 'flipY') };
  const hardness = tip._class === 'dTips' ? photoshopNumber(tip, 'dtipsHardness', 100) : photoshopNumber(tip, 'Hrdn', 100);
  return { kind: 'round', hardness: Math.round(hardness) / 100 };
}

/**
 * A round tip at `hardness`, `size` pixels square, dark is paint: solid out to `hardness` of its radius, then easing
 * to nothing at the rim on a half cosine, the shape of Photoshop's soft round within a few percent.
 */
export function photoshopRoundTip(hardness: number, size: number): Uint8Array {
  const out = new Uint8Array(size * size), half = size / 2, feather = Math.max(1 - hardness, 1 / half);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const t = Math.min(1, Math.max(0, (r - (1 - feather)) / feather));
      out[y * size + x] = Math.round(255 * (1 - (0.5 + 0.5 * Math.cos(Math.PI * t))));
    }
  }
  return out;
}

/** Photoshop's samples and patterns are lighter where more paint goes, so each is negated, a pattern unless inverted. */
export const photoshopPatternNegated = (preset: PhotoshopDescriptor) => !photoshopFlag(preset, 'InvT');

/** A dynamic (`brVr`): its jitter (0..1 for most, beyond 1 for scatter), its control and its minimum (0..1). */
function dynamic(d: PhotoshopDescriptor | undefined) {
  return { jitter: photoshopNumber(d, 'jitter') / 100, control: photoshopNumber(d, 'bVTy'), minimum: photoshopNumber(d, 'Mnm ') / 100 };
}

type Note = (level: StampBrushSupportNote['level'], setting: string, detail: string) => void;

/**
 * A dynamic's pressure response (StampBrushStamping's pressure), from its control and the minimum it falls to at no
 * pressure, noting any control a path can't drive.
 */
function pressureOf(key: string, what: string, control: number, minimum: number, note: Note): number {
  if (control === CONTROL_OFF) return 0;
  if (control === CONTROL_PRESSURE) return 1 - minimum;
  if (control === CONTROL_FADE) note('unsupported', `${key}.bVTy`, `${what} fades over a count of stamps; the studio fades a stroke only by its falloff and tapers`);
  else note('inapplicable', `${key}.bVTy`, `${what} follows ${CONTROL_NAMES[control] ?? `control ${control}`}: an authored stroke has only pressure`);
  return 0;
}

/** Scatter and count, the main brush's or its dual's, read into the studio's lateral jitter, scatter radius and count. */
function scatterOf(d: PhotoshopDescriptor | undefined, prefix: string, on: boolean, reading: PhotoshopReading, note: Note) {
  if (!on) return { lateral: 0, scatter: { count: 1, countJitter: 0, radius: 0 } };
  const scatter = dynamic(photoshopObject(d, 'scatterDynamics')), count = dynamic(photoshopObject(d, 'countDynamics'));
  const reach = scatter.jitter * reading.scatterSpan, both = photoshopFlag(d, 'bothAxes');
  if (reach > 0) note('approximated', `${prefix}scatterDynamics.jitter`, `${Math.round(scatter.jitter * 100)}% read as stamps strayed up to ${reach.toFixed(2)} diameters ${both ? 'every way' : 'across the stroke'}`);
  if (scatter.control === CONTROL_PRESSURE) note('unsupported', `${prefix}scatterDynamics.bVTy`, 'scatter by pressure: the studio scatters alike at any pressure');
  else if (scatter.control !== CONTROL_OFF) pressureOf(`${prefix}scatterDynamics`, 'scatter', scatter.control, 0, note);
  if (count.control === CONTROL_PRESSURE) note('unsupported', `${prefix}countDynamics.bVTy`, 'count by pressure: the studio counts alike at any pressure');
  else if (count.control !== CONTROL_OFF) pressureOf(`${prefix}countDynamics`, 'count', count.control, 0, note);
  return {
    lateral: both ? 0 : reach,
    scatter: { count: Math.max(1, Math.round(photoshopNumber(d, 'Cnt ', 1))), countJitter: Math.min(1, count.jitter), radius: both ? reach : 0 },
  };
}

/** A tip's spacing in diameters, and its note when Photoshop's spacing is off (a stamp per pointer event). */
function spacingOf(tip: PhotoshopDescriptor, prefix: string, note: Note) {
  const spacing = photoshopNumber(tip, 'Spcn', 25) / 100;
  if (!photoshopFlag(tip, 'Intr')) note('approximated', `${prefix}Brsh.Intr`, `spacing off stamps once per pointer event; read as its ${Math.round(spacing * 100)}% spacing`);
  if (spacing < STAMP_MIN_SPACING) note('approximated', `${prefix}Brsh.Spcn`, `${Math.round(spacing * 100)}% stamps closer than the studio's closest spacing, ${STAMP_MIN_SPACING}`);
  return Math.max(spacing, STAMP_MIN_SPACING);
}

const NO_TAPER = { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 };
/** Photoshop turns a tip counter-clockwise; the studio's canvas runs y down, so a positive turn is clockwise. */
const degrees = (value: number) => (value ? (-value * Math.PI) / 180 : 0);

function readMainLayer(source: PhotoshopBrushSource, notes: StampBrushSupportNote[], reading: PhotoshopReading): StampBrushLayer {
  const p = source.preset, tip = photoshopObject(p, 'Brsh')!;
  const note: Note = (level, setting, detail) => notes.push({ level, setting, detail });
  if (tip._class === 'dTips' || tip._class === 'dBrush') {
    note('unsupported', 'Brsh', `a ${tip._class === 'dBrush' ? 'bristle' : 'erodible or airbrush'} tip, simulated as it paints; read as a round tip of its hardness`);
  }

  const tipDynamics = photoshopFlag(p, 'useTipDynamics');
  const size = tipDynamics ? dynamic(photoshopObject(p, 'szVr')) : dynamic(undefined);
  const angle = tipDynamics ? dynamic(photoshopObject(p, 'angleDynamics')) : dynamic(undefined);
  const roundness = tipDynamics ? dynamic(photoshopObject(p, 'roundnessDynamics')) : dynamic(undefined);
  // The options bar's pressure buttons drive size or opacity wholly by pressure, whatever the brush's dynamics say.
  const overrides = photoshopObject(p, 'toolOptions');
  const sizePressure = photoshopFlag(overrides, 'usePressureOverridesSize') ? 1 : pressureOf('szVr', 'size', size.control, photoshopNumber(p, 'minimumDiameter') / 100, note);
  let follow = 0;
  if (angle.control === CONTROL_DIRECTION) follow = 1;
  else if (angle.control === CONTROL_INITIAL_DIRECTION) {
    follow = 1;
    note('approximated', 'angleDynamics.bVTy', "initial direction read as following the stroke's direction throughout");
  } else if (angle.control === CONTROL_PRESSURE) note('unsupported', 'angleDynamics.bVTy', 'angle by pressure: the studio turns stamps alike at any pressure');
  else if (angle.control !== CONTROL_OFF) pressureOf('angleDynamics', 'angle', angle.control, 0, note);
  if (angle.jitter > 0) note('approximated', 'angleDynamics.jitter', `${Math.round(angle.jitter * 100)}% read as each stamp turned at random by up to ±${Math.round((angle.jitter * reading.angleJitterSpan * 180) / Math.PI)}°`);
  if (roundness.jitter > 0 || roundness.control !== CONTROL_OFF) note('unsupported', 'roundnessDynamics', "roundness varying stamp to stamp: every stamp keeps the tip's roundness");
  if (tipDynamics && photoshopFlag(p, 'brushProjection')) note('inapplicable', 'brushProjection', "the tip's projection by pen tilt: an authored stroke has only pressure");

  const { lateral, scatter } = scatterOf(p, '', photoshopFlag(p, 'useScatter'), reading, note);

  const paint = photoshopFlag(p, 'usePaintDynamics');
  const opacity = paint ? dynamic(photoshopObject(p, 'opVr')) : dynamic(undefined), flow = paint ? dynamic(photoshopObject(p, 'prVr')) : dynamic(undefined);
  const opacityPressure = photoshopFlag(overrides, 'usePressureOverridesOpacity') ? 1 : pressureOf('opVr', 'opacity', opacity.control, opacity.minimum, note);
  const flowPressure = pressureOf('prVr', 'flow', flow.control, flow.minimum, note);

  let grain: StampBrushLayer['grain'];
  if (photoshopFlag(p, 'useTexture')) {
    const pattern = photoshopObject(p, 'Txtr');
    if (!source.pattern) {
      note('unsupported', 'Txtr', `the texture is Photoshop's pattern ${JSON.stringify(pattern?.['Nm  '] ?? '')}, which the file doesn't hold; read as no texture`);
    } else {
      const mode = photoshopEnum(p, 'textureBlendMode'), blend = GRAIN_BLENDS[mode ?? ''];
      const eachTip = photoshopFlag(p, 'TxtC');
      const diameter = photoshopNumber(tip, 'Dmtr', 100);
      const brightness = photoshopNumber(p, 'textureBrightness') / 100, contrast = photoshopNumber(p, 'textureContrast') / 100;
      grain = {
        image: source.pattern.image,
        scale: (source.pattern.width * photoshopNumber(p, 'textureScale', 100)) / 100 / diameter,
        mode: eachTip ? 'rolling' : 'texturized',
        depth: (photoshopNumber(p, 'textureDepth', 100) / 100) ** reading.grainDepthCurve,
        blend: blend ?? 'multiply',
        brightness: brightness * reading.grainBrightness * (photoshopPatternNegated(p) ? 1 : -1),
        stretch: contrast > 0 ? 1 + (reading.grainContrast - 1) * contrast : 1 + 2 * contrast,
        offsetJitter: 0,
        // Each tip is textured where it lands, the pattern still fixed to the canvas: it neither moves, grows nor turns with the stamp.
        zoom: 0, movement: 1, rotation: 0,
      };
      note('approximated', 'textureScale', `the pattern tiles ${grain.scale.toFixed(2)} diameters across at the preset's ${diameter} px; Photoshop keeps it that many pixels at any size`);
      if (!blend) note('unsupported', 'textureBlendMode', `${blendName(mode)} has no studio reading; read as multiply`);
      else if (mode === 'Ovrl') note('approximated', 'textureBlendMode', 'overlay read as multiply');
      if (brightness || contrast) note('approximated', 'textureBrightness, textureContrast', "the pattern's brightness and contrast, read about its own mean");
      const depthJitter = dynamic(photoshopObject(p, 'textureDepthDynamics'));
      if (eachTip && (depthJitter.jitter > 0 || depthJitter.control !== CONTROL_OFF)) note('unsupported', 'textureDepthDynamics, minimumDepth', 'texture depth varying stamp to stamp');
      if (photoshopFlag(p, 'protectTexture')) note('inapplicable', 'protectTexture', "protect texture lays one brush's pattern on every brush in Photoshop; each studio brush keeps its own");
    }
  }

  const tool = photoshopObject(p, 'toolOptions');
  const toolFlow = tool && tool.flow !== undefined ? photoshopNumber(tool, 'flow', 100) / 100 : 1;
  const wet = photoshopFlag(p, 'Wtdg');
  if (wet) note('approximated', 'Wtdg', `wet edges read as a rim ${reading.wetEdgeWidth.toFixed(3)} of the radius wide over a body at ${Math.round(reading.wetEdgeBody * 100)}% of its flow`);
  if (photoshopFlag(p, 'Nose')) note('unsupported', 'Nose', "noise on the tip's soft edge");
  if (photoshopFlag(p, 'Rpt ')) note('inapplicable', 'Rpt ', 'build-up keeps painting while the pen rests: an authored stroke never rests');
  if (photoshopFlag(p, 'useBrushPose')) {
    note(photoshopFlag(p, 'overridePosePressure') ? 'unsupported' : 'inapplicable', 'useBrushPose', photoshopFlag(p, 'overridePosePressure')
      ? `the pose sets pressure to ${Math.round(photoshopNumber(p, 'brushPosePressure'))}% whatever the stroke's; the studio paints with the stroke's`
      : 'a brush pose sets tilt and angle: an authored stroke has only pressure');
  }

  return {
    tip: { image: source.tip!, roundness: Math.min(1, Math.max(0.01, photoshopNumber(tip, 'Rndn', 100) / 100)) },
    ...(grain && { grain }),
    spacing: spacingOf(tip, '', note),
    jitter: { lateral, size: size.jitter, opacity: opacity.jitter, flow: flow.jitter },
    scatter,
    rotation: { angle: degrees(photoshopNumber(tip, 'Angl')), follow, jitter: angle.jitter * reading.angleJitterSpan, randomStart: false },
    flip: { x: tipDynamics && photoshopFlag(p, 'flipX'), y: tipDynamics && photoshopFlag(p, 'flipY') },
    blur: { amount: 0, jitter: 0 },
    taper: NO_TAPER,
    falloff: 0,
    flow: toolFlow * (wet ? reading.wetEdgeBody : 1),
    pressure: { size: sizePressure, opacity: opacityPressure, flow: flowPressure },
    // Flow lays each stamp over the ones before, up to the deposit's opacity: Photoshop's stroke caps at opacity, not at a stamp.
    accumulation: 'build',
    ...(wet && { wetEdge: { width: reading.wetEdgeWidth, rim: reading.wetEdgeRim, sharpness: reading.wetEdgeSharpness } }),
  };
}

function readDualLayer(source: PhotoshopBrushSource, notes: StampBrushSupportNote[], reading: PhotoshopReading): StampBrush['dual'] {
  const p = source.preset, dual = photoshopObject(p, 'dualBrush')!, tip = photoshopObject(dual, 'Brsh')!;
  const note: Note = (level, setting, detail) => notes.push({ level, setting, detail });
  const mode = photoshopEnum(dual, 'BlnM'), blend = DUAL_BLENDS[mode ?? ''];
  if (!blend) note('unsupported', 'dualBrush.BlnM', `${blendName(mode)} has no studio reading; read as multiply`);
  const { lateral, scatter } = scatterOf(dual, 'dualBrush.', photoshopFlag(dual, 'useScatter'), reading, note);
  const scale = (photoshopNumber(tip, 'Dmtr', 100) / photoshopNumber(photoshopObject(p, 'Brsh'), 'Dmtr', 100)) * reading.dualScale;
  if (photoshopFlag(dual, 'Flip')) note('approximated', 'dualBrush.Flip', "the dual's flip read as each of its stamps flipped across its width at random");
  return {
    tip: { image: source.dualTip!, roundness: Math.min(1, Math.max(0.01, photoshopNumber(tip, 'Rndn', 100) / 100)) },
    spacing: spacingOf(tip, 'dualBrush.', note),
    jitter: { lateral, size: 0, opacity: 0, flow: 0 },
    scatter,
    rotation: { angle: degrees(photoshopNumber(tip, 'Angl')), follow: 0, jitter: 0, randomStart: false },
    flip: { x: photoshopFlag(dual, 'Flip'), y: false },
    blur: { amount: 0, jitter: 0 },
    taper: NO_TAPER,
    falloff: 0,
    flow: 1,
    pressure: { size: 0, opacity: 0, flow: 0 },
    accumulation: 'build',
    blend: blend ?? 'multiply',
    scale,
  };
}

function readColorDynamics(p: PhotoshopDescriptor, note: Note, reading: PhotoshopReading): StampBrushColorDynamics | undefined {
  if (!photoshopFlag(p, 'useColorDynamics')) return undefined;
  const pct = (key: string) => photoshopNumber(p, key) / 100;
  const swing = dynamic(photoshopObject(p, 'clVr'));
  const varied = { hue: pct('H   ') * reading.hueJitterShare, saturation: pct('Strt'), lightness: pct('Brgh'), darkness: pct('Brgh') };
  const none = { hue: 0, saturation: 0, lightness: 0, darkness: 0 };
  const perTip = p.colorDynamicsPerTip !== false;
  if (pct('Brgh')) note('approximated', 'Brgh', 'brightness jitter read as lightening and darkening alike');
  if (pct('purity')) note('unsupported', 'purity', `a ${Math.round(pct('purity') * 100)}% shift in saturation, stroke-wide`);
  if (swing.jitter > 0) note('unsupported', 'clVr.jitter', 'stamps strayed toward the background colour at random: the studio moves toward the secondary colour by pressure only');
  const secondary = swing.control === CONTROL_PRESSURE ? 1 : 0;
  if (swing.control !== CONTROL_OFF && swing.control !== CONTROL_PRESSURE) pressureOf('clVr', 'foreground to background', swing.control, 0, note);
  const color: StampBrushColorDynamics = {
    stamp: perTip ? varied : none,
    stroke: perTip ? none : varied,
    pressure: { hue: 0, saturation: 0, lightness: 0, secondary },
  };
  return Object.values(color).some((group) => Object.values(group).some((v) => v !== 0)) ? color : undefined;
}

/** A Mixer Brush's settings, carried for the wet-paint model (vid-90), and its other tools noted. */
function readTool(p: PhotoshopDescriptor, note: Note): { blend: StampBlend; wetMix?: StampBrushWetMix } {
  const tool = photoshopObject(p, 'toolOptions');
  if (!tool) return { blend: 'normal' };
  const mode = photoshopEnum(tool, 'Md  '), blend = BRUSH_BLENDS[mode ?? 'Nrml'];
  if (!blend) note('unsupported', 'toolOptions.Md', `the tool paints in ${blendName(mode)}; read as normal`);
  const opacity = photoshopNumber(tool, 'Opct', 100);
  if (opacity !== 100) note('approximated', 'toolOptions.Opct', `the preset paints at ${opacity}% opacity; a deposit states its own`);
  // A tool preset keeps the tool's own pressure dynamics beside the brush's, and they often differ; the brush's are read.
  for (const [key, what] of [['szVr', 'size'], ['opVr', 'opacity'], ['prVr', 'flow']] as const) {
    if (dynamic(photoshopObject(tool, key)).control === CONTROL_PRESSURE && dynamic(photoshopObject(p, key)).control !== CONTROL_PRESSURE) {
      note('unsupported', `toolOptions.${key}`, `the tool's own ${what} by pen pressure; the brush's dynamics are read, which don't set it`);
    }
  }
  if (tool._class === 'PcTl') note('approximated', 'toolOptions', "a pencil's hard, unsmoothed edge read as the brush's own");
  else if (tool._class !== 'PbTl' && tool._class !== 'MixB') note('inapplicable', 'toolOptions', `a preset of another tool (${tool._class}), which paints nothing new: its tip is read as a brush's`);
  if (tool._class !== 'MixB') return { blend: blend ?? 'normal' };
  const wetMix: StampBrushWetMix = {
    load: photoshopNumber(tool, 'dryness', 100) / 100, wetness: photoshopNumber(tool, 'wetness') / 100, mix: photoshopNumber(tool, 'mix') / 100,
    sampleAllLayers: photoshopFlag(tool, 'sampleAllLayers'),
  };
  note('unsupported', 'toolOptions.wetness, dryness, mix, sampleAllLayers', `Mixer Brush wet ${Math.round(wetMix.wetness * 100)}%, load ${Math.round(wetMix.load * 100)}%, mix ${Math.round(wetMix.mix * 100)}%: carried in wetMix, not yet painted (vid-90)`);
  if (tool.autoFill !== undefined || tool.autoClean !== undefined) note('inapplicable', 'toolOptions.autoFill, autoClean', 'refilling and cleaning the brush between strokes: every deposit starts loaded');
  return { blend: blend ?? 'normal', wetMix };
}

/**
 * `source`'s preset read into a StampBrush named `name`, and what didn't carry over. A preset whose tip or dual tip
 * the file lacks throws: the importer skips those before it asks.
 */
export function normalizePhotoshopBrush(name: string, source: PhotoshopBrushSource, reading: PhotoshopReading = PHOTOSHOP_READING): { brush: StampBrush; support: StampBrushSupportNote[] } {
  const support: StampBrushSupportNote[] = [];
  const note: Note = (level, setting, detail) => support.push({ level, setting, detail });
  if (!source.tip) throw new Error(`photoshop brush ${JSON.stringify(name)}: its tip isn't among the pack's images`);
  const { blend, wetMix } = readTool(source.preset, note);
  const color = readColorDynamics(source.preset, note, reading);
  const brush: StampBrush = { name, blend, ...(color && { color }), ...readMainLayer(source, support, reading) };
  const dual = photoshopObject(source.preset, 'dualBrush');
  if (photoshopFlag(dual, 'useDualBrush')) {
    if (source.dualTip) brush.dual = readDualLayer(source, support, reading);
    else note('unsupported', 'dualBrush.Brsh', "the dual's tip isn't in the file; imported without its dual");
  }
  if (wetMix) brush.wetMix = wetMix;
  return { brush, support };
}
