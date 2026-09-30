// photoshop-brush.ts: a Photoshop brush preset (photoshop-preset.ts, from an .abr or a .tpl) read into a StampBrush,
// noting every setting that doesn't carry over as Photoshop means it, by its path (`tipDynamics.size.jitter`).
//
// Photoshop's dialog names each setting and unit, so most carry over directly; unknown constants are a shared
// PhotoshopReading. Pressure's several sources are resolved here once (photoshopPressureAmounts).
//
// Negative space: live-input, preview and preset-size settings (a deposit states its diameter) and a canvas
// texture's depth dynamics (Photoshop ignores them too) go unreported. Build-up, tilt, stylus wheel, rotation and pose
// are `inapplicable` (a path paints those controls as off). Mixer Brush wet mixing (vid-90) is `unsupported`; an
// airbrush is its spray (photoshop-airbrush.ts), and erodible and bristle tips are pressed (photoshop-erodible.ts,
// photoshop-bristle.ts).

import { PHOTOSHOP_POOLING } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { drawPhotoshopAirbrushGrain, drawPhotoshopAirbrushSpray, photoshopAirbrushImage, photoshopAirbrushMode, photoshopAirbrushReading } from './photoshop-airbrush.ts';
import { drawPhotoshopComputedTip, PHOTOSHOP_PIXEL_TIP_DIAMETER, photoshopComputedTipSpan } from './photoshop-computed-tip.ts';
import { photoshopBristleStampTip } from './photoshop-bristle.ts';
import { photoshopErodibleStampTip } from './photoshop-erodible.ts';
import {
  photoshopControlMinimum, photoshopModeName, type PhotoshopBlendMode, type PhotoshopControl, type PhotoshopDualMode, type PhotoshopDynamic, type PhotoshopKnownTip,
  type PhotoshopPaintablePreset, type PhotoshopPreset, type PhotoshopScatter, type PhotoshopTextureMode,
} from './photoshop-preset.ts';
import { PHOTOSHOP_READING } from './photoshop-reading.ts';
import {
  stampDynamicsOf, type StampBlend, type StampBrush, type StampBrushAsset, type StampBrushColorDynamics, type StampBrushLayer, type StampBrushSupportNote, type StampBrushTip,
  type StampDualBlend, type StampGrainBlend, type StampScaleResponse,
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
export type PhotoshopTipImage =
  | { kind: 'sampled'; id: string; flipX: boolean; flipY: boolean }
  | { kind: 'round'; hardness: number; diameter: number; span: number }
  | { kind: 'spray'; hardness: number }
  | { kind: 'grain' };
/** A tip image the importer draws, not one the file holds. */
export type PhotoshopDrawnTipImage = Exclude<PhotoshopTipImage, { kind: 'sampled' }>;

export type PhotoshopSampleSize = { width: number; height: number };

/**
 * Where a tip's images landed among the pack's assets: a round tip's drawing; a sample, with its own size in pixels
 * (its centre is read from it); an erodible tip's footprint, its contact image (photoshop-erodible.ts) and its height
 * map (`gridSize`² little-endian 32-bit floats, as the .abr holds them) they were drawn from; a bristle tip's footprint
 * and contact image (photoshop-bristle.ts).
 */
export type PhotoshopTipAsset =
  | { kind: 'round'; image: StampBrushAsset }
  | { kind: 'sampled'; image: StampBrushAsset; sample: PhotoshopSampleSize }
  | { kind: 'erodible'; image: StampBrushAsset; contact: StampBrushAsset; heightMap: StampBrushAsset }
  | { kind: 'bristle'; image: StampBrushAsset; contact: StampBrushAsset };

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

/** A tip as an image to write: sampled, an airbrush's, else round (a computed tip; a pressed one when drawn as round). */
export function photoshopTipImage(tip: PhotoshopKnownTip): PhotoshopTipImage {
  const { geometry } = tip;
  if (tip.kind === 'sampled') return { kind: 'sampled', id: tip.sample, flipX: geometry.flipX, flipY: geometry.flipY };
  if (tip.kind === 'airbrush') {
    const image = photoshopAirbrushImage(tip);
    return image.kind === 'round' ? { ...image, span: photoshopComputedTipSpan(image.diameter, image.hardness) } : image;
  }
  const hardness = photoshopRoundTipHardness(tip);
  return { kind: 'round', hardness, diameter: geometry.diameter, span: photoshopComputedTipSpan(geometry.diameter, hardness) };
}

/** A drawn tip image, dark is paint, a texel a pixel at its diameter where that's under `max` texels, and a name for its file. */
export function drawPhotoshopTipImage(image: PhotoshopDrawnTipImage, max: number): { key: string; size: number; pixels: Uint8Array } {
  if (image.kind === 'round') return { key: `round-${Math.round(image.hardness * 100)}-${String(image.diameter).replace('.', '-')}`, ...drawPhotoshopComputedTip(image.diameter, image.hardness, image.span, max) };
  if (image.kind === 'spray') return { key: `spray-${Math.round(image.hardness * 100)}`, ...drawPhotoshopAirbrushSpray(image.hardness) };
  return { key: 'grain', ...drawPhotoshopAirbrushGrain() };
}

/** Which asset a tip lands as: a sample as itself, an erodible or bristle tip pressed, any other as a round drawing. */
export function photoshopTipAssetKind(tip: PhotoshopKnownTip): PhotoshopTipAsset['kind'] {
  return tip.kind === 'sampled' || tip.kind === 'erodible' || tip.kind === 'bristle' ? tip.kind : 'round';
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

/** Photoshop's Noise: each stamp's paint overlaid by uniform noise at 2/3 (tipNoise). */
const PHOTOSHOP_NOISE_DEPTH = 2 / 3;

const tipRoundness = (tip: PhotoshopKnownTip) => Math.min(1, Math.max(0.01, tip.geometry.roundness / 100));

/**
 * A tip as the studio reads it: its image, roundness, a sample's centre, and a round tip's span past its diameter. A
 * sampled preset tip always has a sampled asset (readStampPaintPack holds a manifest to it).
 */
function tipOf(tip: PhotoshopKnownTip, asset: PhotoshopTipAsset, prefix: string, note: Note): StampBrushTip {
  const roundness = tipRoundness(tip), sampling = 'anisotropic', { geometry } = tip;
  // The border widens the image past the diameter. A sample's diameter is its longer side, and its stamp keeps its
  // proportions, so a tall sample's width is a share of the diameter.
  if (asset.kind === 'sampled') {
    const { sample } = asset;
    return { image: asset.image, roundness, sampling, span: (sample.width + 2 * PHOTOSHOP_SAMPLE_BORDER) / Math.max(sample.width, sample.height), center: [sampleCenter(sample.width, geometry.flipX), sampleCenter(sample.height, geometry.flipY)] };
  }
  if (tip.kind === 'sampled') throw new Error(`photoshop: a sampled tip given a ${asset.kind} image`);
  if (asset.kind === 'erodible' && tip.kind === 'erodible') return { roundness, sampling, ...photoshopErodibleStampTip(tip, asset.image, asset.contact) };
  if (asset.kind === 'bristle' && tip.kind === 'bristle') return { roundness, sampling, ...photoshopBristleStampTip(tip, asset.image, asset.contact) };
  if (tip.kind === 'computed' && geometry.diameter <= PHOTOSHOP_PIXEL_TIP_DIAMETER) note('approximated', `${prefix}tip.geometry.diameter`, `a ${geometry.diameter} px computed tip, drawn as Photoshop draws it at its size, rounded up to whole pixels; the stamps its dynamics shrink are scaled from that, not redrawn`);
  if (tip.kind === 'airbrush') return { image: asset.image, roundness, sampling, ...photoshopAirbrushReading(tip).tip };
  return { image: asset.image, roundness, sampling, span: photoshopComputedTipSpan(geometry.diameter, photoshopRoundTipHardness(tip)) };
}

/** Photoshop's samples and patterns are lighter where more paint goes, so each is negated, a pattern unless inverted. */
export const photoshopPatternNegated = (preset: PhotoshopPreset) => !preset.texture?.invert;

const OFF: PhotoshopDynamic = { control: { kind: 'off' }, jitter: 0 };
/** A dynamic as shares: its jitter (0..1 for most, beyond 1 for scatter) and its control's minimum (0..1). */
const shares = (d: PhotoshopDynamic = OFF) => ({ jitter: d.jitter / 100, control: d.control, minimum: photoshopControlMinimum(d.control) / 100 });

type Note = (level: StampBrushSupportNote['level'], setting: string, detail: string) => void;

/**
 * What a stroke can drive a dynamic by: pressure, or fade over its `steps`. Tilt, stylus wheel and rotation read full
 * on a stroked path, painting as off does (the vid-105 probes), so they drive nothing.
 */
type PhotoshopDriver = { sensor: 'pressure' } | { sensor: 'fade'; steps: number };

/** The driver of a dynamic `what` at `path`, noting a control a stroke can't drive; direction is angle's alone. */
function driverOf(path: string, what: string, control: PhotoshopControl, note: Note): PhotoshopDriver | undefined {
  switch (control.kind) {
    case 'off': return undefined;
    case 'penPressure': return { sensor: 'pressure' };
    case 'fade': return { sensor: 'fade', steps: control.steps };
    case 'penTilt': case 'stylusWheel': case 'rotation':
      note('inapplicable', `${path}.control`, `${what} follows ${CONTROL_NAMES[control.kind]}: an authored stroke has only pressure, and Photoshop paints a path as off`);
      return undefined;
    case 'direction': case 'initialDirection':
      note('unsupported', `${path}.control`, `${what} follows ${CONTROL_NAMES[control.kind]}, which the studio reads only for angle`);
      return undefined;
    case 'unsupported':
      note('unsupported', `${path}.control`, `${what} follows control ${control.code}, which the studio doesn't read`);
      return undefined;
    default:
      return undefined;
  }
}

const linear = (amount: number): StampScaleResponse => ({ kind: 'linear', amount });
type PhotoshopScaleBindings = { pressure?: StampScaleResponse; fade?: StampScaleResponse & { steps: number } };

/** `response` bound to `driver`'s sensor. */
function scaleBindingsOf(driver: PhotoshopDriver | undefined, response: StampScaleResponse): PhotoshopScaleBindings {
  if (!driver) return {};
  return driver.sensor === 'pressure' ? { pressure: response } : { fade: { ...response, steps: driver.steps } };
}

/**
 * How Photoshop's pen was driving the brush where it painted. `lingeringPose`: a Brush Pose's size and opacity
 * overrides were still in force, outlasting the posed stroke they were set for until the brush was next applied, as
 * when the capture rig paints a reference S-curve after a posed line (vid-97's pressure check). A painting has none.
 */
export type PhotoshopPressureContext = { lingeringPose: boolean };
export const PHOTOSHOP_PEN_PRESSURE: PhotoshopPressureContext = { lingeringPose: false };

/** Whether a lingering pose sets the brush's opacity: it does a brush tool's preset's, and drops its opacity jitter. */
const photoshopPoseSetsOpacity = (p: PhotoshopPaintablePreset, context: PhotoshopPressureContext) => context.lingeringPose && (!p.tool || p.tool.kind === 'PbTl');

/**
 * Size, opacity and flow's controls. Pressure: a lingering pose over the options bar's buttons (each drives wholly)
 * over the brush's own. Under a pose a size amount a counts twice (1 − (1 − m)²(1 − p)); opacity's is unprobed, read
 * as not. A fade stands. The tool's szVr, opVr and prVr repeat the brush's, so aren't read.
 */
function photoshopTransferBindings(p: PhotoshopPaintablePreset, context: PhotoshopPressureContext, note: Note) {
  const size = shares(p.tipDynamics?.size), opacity = shares(p.transfer?.opacity), flow = shares(p.transfer?.flow);
  const minimumDiameter = (p.tipDynamics?.minimumDiameter ?? 0) / 100;
  const own = {
    size: scaleBindingsOf(driverOf('tipDynamics.size', 'size', size.control, note), linear(1 - minimumDiameter)),
    opacity: scaleBindingsOf(driverOf('transfer.opacity', 'opacity', opacity.control, note), linear(1 - opacity.minimum)),
    flow: scaleBindingsOf(driverOf('transfer.flow', 'flow', flow.control, note), linear(1 - flow.minimum)),
  };
  const buttons = {
    ...own,
    ...(p.tool?.pressureOverridesSize && { size: { ...own.size, pressure: linear(1) } }),
    ...(p.tool?.pressureOverridesOpacity && { opacity: { ...own.opacity, pressure: linear(1) } }),
  };
  if (!context.lingeringPose) return buttons;
  // A preset of another tool (mixer, smudge, eraser, pencil) keeps its own opacity under a lingering pose, though its
  // size follows it: Kyle's references of them hold full paint to a simulated stroke's ends. Read from the pack
  // references alone; unprobed.
  const posedOpacity = photoshopPoseSetsOpacity(p, context) ? { ...buttons.opacity, pressure: linear(1) } : buttons.opacity;
  // A pose sizes no airbrush's spray, erodible or bristle tip (the vid-105 probes: widths hold at every pose).
  if (p.tip.kind === 'airbrush' || p.tip.kind === 'erodible' || p.tip.kind === 'bristle') return { ...buttons, opacity: posedOpacity };
  const sizeAmount = buttons.size.pressure?.kind === 'linear' ? buttons.size.pressure.amount : 0;
  return { ...buttons, size: { ...buttons.size, pressure: linear(sizeAmount > 0 ? sizeAmount ** 2 : 1) }, opacity: posedOpacity };
}

/**
 * Scatter on pen pressure keeps p² of its reach, over signal s = 1 − p (the vid-105 probes: spreads at poses 0.25 to 1
 * fit p², where p leaves the low poses too wide). A fade shrinks it linearly.
 */
const SCATTER_BY_PRESSURE: StampScaleResponse = { kind: 'curve', points: Array.from({ length: 9 }, (_, i) => [i / 8, (1 - i / 8) ** 2] as const) };

/**
 * Scatter and count, the main brush's or its dual's: the studio's scatter (its radius or lateral reach, and its
 * count), and the bindings of each. Scatter's control scales its reach, in the deposit's diameters, down to none.
 */
function scatterOf(s: PhotoshopScatter | undefined, prefix: string, reading: PhotoshopReading, note: Note) {
  if (!s) return { scatter: { count: 1, radius: 0, lateral: 0 }, reach: {}, count: {} };
  const scatter = shares(s.scatter), count = shares(s.countDynamics);
  const reach = scatter.jitter * reading.scatterSpan, both = s.bothAxes;
  if (reach > 0) note('approximated', `${prefix}scatter.scatter.jitter`, `${Math.round(scatter.jitter * 100)}% read as stamps strayed up to ${reach.toFixed(2)} diameters ${both ? 'every way' : 'across the stroke'}`);
  const scatterDriver = driverOf(`${prefix}scatter.scatter`, 'scatter', scatter.control, note);
  const countDriver = driverOf(`${prefix}scatter.countDynamics`, 'count', count.control, note);
  return {
    scatter: { count: Math.max(1, Math.round(s.count)), radius: both ? reach : 0, lateral: both ? 0 : reach } satisfies StampBrushLayer['scatter'],
    reach: reach > 0 ? scaleBindingsOf(scatterDriver, scatterDriver?.sensor === 'pressure' ? SCATTER_BY_PRESSURE : linear(1)) : {},
    count: { ...scaleBindingsOf(countDriver, linear(1 - count.minimum)), random: { ...linear(Math.min(1, count.jitter)), around: true } },
  };
}

/**
 * A tip's spacing in diameters, and its note when Photoshop's spacing is off (a stamp per pointer event). Stepped
 * as Photoshop steps (`eachStamp`), so no step is under a pixel, however small the spacing.
 */
function spacingOf(tip: PhotoshopKnownTip, asset: PhotoshopTipAsset, prefix: string, note: Note) {
  // Photoshop steps by a share of the tip's short side, whole pixels at the preset's diameter. A sample's short side is
  // its image's narrower one, its roundness left out (`tip sampled roundness 50 steps`, docs/photoshop-capture.md).
  const { diameter } = tip.geometry;
  const share = asset.kind === 'sampled' ? Math.min(asset.sample.width, asset.sample.height) / Math.max(asset.sample.width, asset.sample.height) : tipRoundness(tip);
  const short = share === 1 ? 1 : Math.max(1, Math.round(diameter * share)) / diameter;
  const spacing = (tip.geometry.spacing / 100) * short;
  if (!tip.geometry.spaced) note('approximated', `${prefix}tip.geometry.spaced`, `spacing off stamps once per pointer event; read as its ${tip.geometry.spacing}% spacing`);
  return spacing;
}

const NO_TAPER = { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 };
/** Photoshop turns a tip counter-clockwise; the studio's canvas runs y down, so a positive turn is clockwise. */
const degrees = (value: number) => (value ? (-value * Math.PI) / 180 : 0);

function readMainLayer(source: PhotoshopBrushSource, note: Note, reading: PhotoshopReading, context: PhotoshopPressureContext): StampBrushLayer {
  const p = source.preset, { tip } = p;
  if (tip.kind === 'bristle') note('approximated', 'tip.bristle', "a bristle tip, pressed into the paper and laid across the stroke's first heading; its splay building along a stroke isn't drawn, and clumping is unprobed");
  if (tip.kind === 'erodible') {
    note('approximated', 'tip.erodible', `an erodible tip, pressed into the paper by its heights, unworn: Photoshop wears it along a stroke${tip.simulatedHardness < 100 ? ` (hardness ${Math.round(tip.simulatedHardness)}% wears it)` : ''}, which isn't simulated`);
    if (tip.lengthRatio !== 100) note('unprobed', 'tip.lengthRatio', `length ratio ${Math.round(tip.lengthRatio)}%: every capture has it at 100`);
  }
  const airbrush = tip.kind === 'airbrush' ? photoshopAirbrushReading(tip) : undefined;
  if (tip.kind === 'airbrush') {
    const sprays = { smooth: 'smoothly', grain: 'grains', splat: 'drops' }[photoshopAirbrushMode(tip)];
    note('approximated', 'tip.airbrush', `an airbrush spraying ${sprays}, wider as pressure falls; its cutoff angle and streakiness show in no capture, and granularity between 0 and 100 is unprobed`);
    if (p.scatter && airbrush?.scatter) note('unsupported', 'scatter', "an airbrush's own scattering, read as its spray's alone");
  }

  const shape = p.tipDynamics;
  const size = shares(shape?.size), angle = shares(shape?.angle), roundness = shares(shape?.roundness);
  const transfer = photoshopTransferBindings(p, context, note);
  // An angle control turns a whole turn over its range: pressure by p × 360° (the vid-105 probes), fade from a whole
  // turn at its first step to none at its last. Counter-clockwise, as Photoshop's angle turns; its sign is unprobed.
  const angleControl = angle.control.kind === 'direction' || angle.control.kind === 'initialDirection' ? undefined : driverOf('tipDynamics.angle', 'angle', angle.control, note);
  const whole = { kind: 'linear', amount: -2 * Math.PI } as const;
  if (angle.jitter > 0) note('approximated', 'tipDynamics.angle.jitter', `${Math.round(angle.jitter * 100)}% read as each stamp turned at random by up to ±${Math.round((angle.jitter * reading.angleJitterSpan * 180) / Math.PI)}°`);
  // vid-97's probes: jittered roundness falls evenly from full to the minimum (which Photoshop never lets under 1%).
  // Pressure is read down to the same minimum, as size's is.
  const minimumRoundness = (shape?.minimumRoundness ?? 0) / 100;
  const roundnessControl = scaleBindingsOf(driverOf('tipDynamics.roundness', 'roundness', roundness.control, note), linear(1 - minimumRoundness));
  if (shape?.projection) note('inapplicable', 'tipDynamics.projection', "the tip's projection by pen tilt: an authored stroke has only pressure");

  const { scatter, reach, count } = scatterOf(p.scatter, '', reading, note);
  const opacity = shares(p.transfer?.opacity), flow = shares(p.transfer?.flow);

  let grain: StampBrushLayer['grain'];
  let grainDepth = {};
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
        // Brightness is in 255ths, and darkens the pattern before invert, so an inverted one's takes paint away (Kyle's
        // pastel settings, the `texture height d5 by pressure pastel` probes). Contrast, about mid grey, reads alike.
        brightness: ((texture.invert ? -1 : 1) * texture.brightness) / 255,
        contrast: texture.contrast / 100,
        contrastPivot: 'midGrey',
        tiling: 'repeat',
        offsetJitter: 0,
        // Each tip is textured where it lands, the pattern still fixed to the canvas: it neither moves, grows nor turns with the stamp.
        ...(texture.eachTip ? { kind: 'rolling' as const, zoom: 0, movement: 1, rotation: 0 } : { kind: 'canvas' as const }),
      };
      note('approximated', 'texture.scale', `the pattern tiles ${grain.scale.toFixed(2)} diameters across at the preset's ${tip.geometry.diameter} px; Photoshop keeps it that many pixels at any size`);
      if (typeof mode !== 'string') note('unsupported', 'texture.mode', `${photoshopModeName(mode)} has no studio reading; read as multiply`);
      if (texture.eachTip) {
        // A stamp's depth is the grain's times its share. Outside the height modes it runs the other way from the other
        // dynamics: full pressure paints the minimum depth, and a fade climbs from it. A height relief's runs with
        // pressure, depth × p (the vid-105 probes). Jitter takes a stamp's depth down toward the minimum.
        const relief = mode === 'height' || mode === 'linearHeight';
        const depth = shares(texture.depthDynamics), minimum = texture.minimumDepth / 100;
        const response: StampScaleResponse = relief ? linear(1 - minimum) : { kind: 'curve', points: [[0, minimum], [1, 1]] };
        const control = scaleBindingsOf(driverOf('texture.depthDynamics', 'texture depth', depth.control, note), response);
        grainDepth = { ...control, random: linear(depth.jitter * (1 - minimum)) };
        if (relief && (depth.jitter > 0 || minimum > 0 || depth.control.kind === 'fade')) {
          note('approximated', 'texture.depthDynamics', `${mode}'s depth by pressure is probed at minimum 0; its minimum, fade and jitter are read as pressure's`);
        }
      }
      if (texture.protect) note('inapplicable', 'texture.protect', "protect texture lays one brush's pattern on every brush in Photoshop; each studio brush keeps its own");
    }
  }

  // Photoshop paints a tool's flow in 255ths: 25% lays 64/255.
  const toolFlow = p.tool?.flow !== undefined ? Math.round((p.tool.flow / 100) * 255) / 255 : 1;
  if (p.buildUp) note('inapplicable', 'buildUp', 'build-up keeps painting while the pen rests: an authored stroke never rests');
  if (p.pose) {
    note(p.pose.overridePressure ? 'unsupported' : 'inapplicable', 'pose', p.pose.overridePressure
      ? `the pose sets pressure to ${Math.round(p.pose.pressure)}% whatever the stroke's; the studio paints with the stroke's`
      : 'a brush pose sets tilt and angle: an authored stroke has only pressure');
  }

  return {
    // Noise breaks the brush's own tip, not its dual's (the `random noise` probe has no dual to say otherwise).
    tip: { ...tipOf(tip, source.tip, '', note), ...(p.noise && { noise: PHOTOSHOP_NOISE_DEPTH }) },
    ...(grain && { grain }),
    // An airbrush steps by its preset's diameter, whatever its spray's.
    spacing: airbrush?.spacing ?? spacingOf(tip, source.tip, '', note),
    stepping: airbrush ? 'spread' : 'eachStamp',
    dynamics: stampDynamicsOf({
      size: { ...transfer.size, random: { ...linear(size.jitter), around: true }, ...airbrush?.dynamics.size },
      // A pose's opacity drops the jitter: the `random opacity jitter … posed` probes paint alike copy for copy under it.
      opacity: { ...transfer.opacity, ...(!photoshopPoseSetsOpacity(p, context) && { random: linear(opacity.jitter) }) },
      flow: { ...transfer.flow, random: linear(flow.jitter), ...airbrush?.dynamics.flow },
      roundness: { ...roundnessControl, random: linear(roundness.jitter * (1 - minimumRoundness)) },
      count,
      scatter: { ...(!airbrush?.scatter && reach), ...airbrush?.dynamics.scatter },
      grainDepth,
      rotation: {
        ...(angle.control.kind === 'direction' && { direction: linear(1) }),
        // A bristle tip faces across the stroke's first heading and holds it (the vid-105 probes' S-curves).
        ...((angle.control.kind === 'initialDirection' || (tip.kind === 'bristle' && angle.control.kind !== 'direction')) && { initialDirection: linear(1) }),
        ...(angleControl?.sensor === 'pressure' && { pressure: whole }),
        ...(angleControl?.sensor === 'fade' && { fade: { ...whole, steps: angleControl.steps } }),
        random: linear(angle.jitter * reading.angleJitterSpan),
      },
    }),
    scatter: airbrush?.scatter ?? scatter,
    rotation: { angle: degrees(tip.geometry.angle), randomStart: false },
    flip: { x: !!shape?.flipX, y: !!shape?.flipY },
    blur: { amount: 0, jitter: 0 },
    taper: NO_TAPER,
    falloff: 0,
    flow: toolFlow * (airbrush?.flow ?? 1),
    accumulation: { kind: 'buildToOpacity' },
    ...(p.wetEdges && { wetEdges: PHOTOSHOP_POOLING }),
  };
}

type PhotoshopDual = NonNullable<PhotoshopPreset['dual']>;

function readDualLayer(source: PhotoshopBrushSource, dual: PhotoshopDual, tip: PhotoshopKnownTip, image: PhotoshopTipAsset, note: Note, reading: PhotoshopReading): StampBrush['dual'] {
  const { mode } = dual;
  if (typeof mode !== 'string') note('unsupported', 'dual.mode', `${photoshopModeName(mode)} has no studio reading; read as multiply`);
  const { scatter, reach, count } = scatterOf(dual.scatter, 'dual.', reading, note);
  const scale = (tip.geometry.diameter / source.preset.tip.geometry.diameter) * reading.dualScale;
  if (dual.flip) note('approximated', 'dual.flip', "the dual's flip read as each of its stamps flipped across its width at random");
  return {
    tip: tipOf(tip, image, 'dual.', note),
    spacing: spacingOf(tip, image, 'dual.', note),
    stepping: 'eachStamp',
    // Photoshop turns each dual dab a random way, whatever its settings (the `dual wide …` probes); a round one's
    // turn doesn't show.
    dynamics: stampDynamicsOf({ count, scatter: reach, rotation: { random: { kind: 'linear', amount: Math.PI } } }),
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
  if (swing.control.kind === 'fade') note('unsupported', 'color.swing.control', 'foreground to background over a fade: the studio moves toward the secondary colour by pressure only');
  else if (swing.control.kind !== 'penPressure') driverOf('color.swing', 'foreground to background', swing.control, note);
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
