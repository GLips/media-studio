// procreate-brush.ts: a Procreate brush (its Brush.archive settings, and its Sub01 when it's a dual brush) read into a
// StampBrush, with a note for every setting that doesn't carry over as Procreate means it. Procreate's field names
// stop here: nothing past this file reads them.
//
// Several readings are the studio's own (taper length, rotation scatter, grain scale, brightness and contrast, rim
// width and sharpness, flow and depth curves, how far each glaze mode builds, combine modes, dual size, falloff span), each noted as `approximated`
// where it applies. Their constants are a ProcreateReading, fitted against the whole pack at once by `studio brushes
// fit` (lib/picture/brush-fidelity/engine/brush-reading-fit.ts) and checked in as procreate-reading.ts, shared by every
// pack: a reading that fits one pack's previews by tuning brush by brush would fit no other pack.
//
// Where Photoshop's captures (vid-97) showed a way of painting that differs from what vid-89 fitted these previews with,
// a brush reads vid-89's: `build` stamps over each other without limit, grain and dual blends as `layer` formulas, grain
// contrast about its mean, grain tiled mirrored, tips sampled isotropically. Procreate's own are still to be identified.
//
// Negative space: live-input settings (stabilization, smoothing, prediction, pressure smoothing), the size and opacity
// sliders' positions and limits (paintSize, paintOpacity, maxSize, minSize, maxOpacity: a deposit states its own
// diameter and opacity), the finger taper (taperStartLength…: a stroke with pressure is a pencil stroke), smudge and erase settings and the
// preview's own settings aren't a brush's painting, and go unreported. Tilt, azimuth and speed are noted `inapplicable`
// (a path has none); wet mixing is noted `unsupported`, left to the wet-paint model.

import {
  stampDynamics, type StampBlend, type StampBrush, type StampBrushAsset, type StampBrushColorDynamics, type StampBrushLayer, type StampBrushSupportNote, type StampDualBlend, type StampGrainBlend,
} from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { STAMP_MIN_SPACING } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { PROCREATE_READING } from './procreate-reading.ts';

/**
 * The constants that turn Procreate's settings into the studio's, where Procreate's meaning isn't known and is fitted
 * (`npm run brushes:fit`). Each is a scale or a curve on one reading, the same for every brush of every pack.
 */
export type ProcreateReading = {
  /** Procreate's full pencil taper, read as this share of the stroke's length. */
  taperShare: number;
  /** A wet or burnt edge's width, a fraction of the stamp's radius: Procreate gives an amount and no width. */
  edgeWidth: number;
  /** How steeply a rim rises at the outline (a rim StampBrushWetEdges' sharpness). */
  rimSharpness: number;
  /** How dark a full wet edge (1) makes its rim over the body; less is proportionally less. */
  wetRim: number;
  /** A grain's tile, in stamp diameters, at textureScale 1. */
  grainTile: number;
  /** A grain's brightness at textureBrightness 1: how far it raises the grain's paint. */
  grainBrightness: number;
  /** How far full textureContrast (1) stretches a grain about its mean; -1 flattens it whatever this is. */
  grainContrast: number;
  /** A grain's depth is grainDepth to this power: above 1, a shallow grain cuts in less. */
  grainDepthCurve: number;
  /** A glaze's stamp flow is dynamicsGlazedFlow to this power. */
  glazeFlowCurve: number;
  /** A blending mode's stamp flow is dynamicsGlazedFlow to this power: its stamps build, so flow tells differently. */
  blendingFlowCurve: number;
  /** A dual's stamps are this times the ratio of the dual's largest size to the main brush's. */
  dualScale: number;
  /**
   * Stamp spacing, in diameters, is plotSpacing to this power: Freya Lupen's converter reads it as its square root
   * (0.5), and Dry Brush's preview shows its stamps a sixteenth of a diameter apart at 0.004.
   */
  spacingPower: number;
  /**
   * A stamp's lateral jitter, in diameters, is lateralJitterScale times plotJitter to lateralJitterPower (Freya
   * Lupen's converter: a half times its square root).
   */
  lateralJitterScale: number;
  lateralJitterPower: number;
  /**
   * How far each glaze mode's stamps build within the stroke (a glaze StampAccumulation's build), by its transfer flags:
   * light (neither), uniform (modulated), intense (max) and heavy (both). The names are the Handbook's; which flags
   * make which mode is inferred.
   */
  glazeBuildLight: number;
  glazeBuildUniform: number;
  glazeBuildIntense: number;
  glazeBuildHeavy: number;
};

/** A Brush.archive's root object, as unarchived: its settings by Procreate's names. */
export type ProcreateBrushSettings = Readonly<Record<string, unknown>>;

/** One Procreate brush's settings and where its images landed among the pack's assets. */
export type ProcreateBrushSource = { settings: ProcreateBrushSettings; tip: StampBrushAsset; grain?: StampBrushAsset };


/** Procreate's blend modes by number, as its layers number them; 27 and 28 only appear on grains and duals. */
const PROCREATE_BLEND_NAMES: Readonly<Record<number, string>> = {
  0: 'Normal', 1: 'Multiply', 2: 'Screen', 3: 'Add', 4: 'Lighten', 5: 'Exclusion', 6: 'Difference', 7: 'Subtract',
  8: 'Linear Burn', 9: 'Color Dodge', 10: 'Color Burn', 11: 'Overlay', 12: 'Hard Light', 13: 'Color', 14: 'Luminosity',
  15: 'Hue', 16: 'Saturation', 17: 'Soft Light', 19: 'Darken', 20: 'Hard Mix', 21: 'Vivid Light', 22: 'Linear Light',
  23: 'Pin Light', 24: 'Lighter Color', 25: 'Darker Color', 26: 'Divide', 27: 'Height', 28: 'Linear Height',
};
/**
 * A dual's combine mode by number. 6 is difference: every VVDS wash with it (Main, Filler, More Wet, Shadow, Watercolor
 * Blotch) reads as a pale body inside its rim only so. 10, 19 and 28 read as their layer names; the sheet neither
 * confirms nor beats them (one or two brushes each, split).
 */
const DUAL_BLENDS: Readonly<Record<number, Extract<StampDualBlend, { family: 'layer' }>['mode']>> = {
  0: 'normal', 1: 'multiply', 2: 'screen', 4: 'lighten', 6: 'difference', 10: 'colorBurn', 11: 'overlay', 19: 'darken', 28: 'linearHeight',
};
/** A grain's blend mode by number, as layer modes number: the pack uses only these. */
const GRAIN_BLENDS: Readonly<Record<number, Extract<StampGrainBlend, { family: 'layer' }>['mode']>> = {
  1: 'multiply', 4: 'lighten', 7: 'subtract', 8: 'linearBurn', 9: 'colorDodge', 10: 'colorBurn', 19: 'darken', 20: 'hardMix', 26: 'divide', 27: 'height', 28: 'linearHeight',
};
/** The brush's own blend and its burnt edge's, by number, as layer modes number. */
const BRUSH_BLENDS: Readonly<Record<number, StampBlend>> = { 0: 'normal', 1: 'multiply', 2: 'screen', 4: 'lighten', 10: 'colorBurn', 11: 'overlay', 19: 'darken' };
const BURNT_BLENDS = BRUSH_BLENDS;
const blendName = (mode: number) => `${mode} (${PROCREATE_BLEND_NAMES[mode] ?? 'unknown'})`;

/** A stamp's lateral jitter in diameters for Procreate's plotJitter. */
const lateralJitter = (plotJitter: number, reading: ProcreateReading) => reading.lateralJitterScale * plotJitter ** reading.lateralJitterPower;
/**
 * textureContrast (-1..1) as a StampBrushGrain contrast about the grain's mean: flattening as it is, and a positive one
 * stretching by 1 + (grainContrast − 1) × textureContrast, the contrast whose slope that is.
 */
const grainContrastOf = (contrast: number, reading: ProcreateReading) => (contrast > 0 ? 1 - 1 / (1 + (reading.grainContrast - 1) * contrast) : contrast);

const IDENTITY_CURVE = ['{0.000000, 0.000000}', '{1.000000, 1.000000}'];

/**
 * Whether one of a brush's images must be negated to reach the studio's polarity, dark is paint. Procreate paints
 * with white, so an image is negated unless the brush inverts it.
 */
export const procreateTipNegated = (settings: ProcreateBrushSettings) => settings.shapeInverted !== true;
export const procreateGrainNegated = (settings: ProcreateBrushSettings) => settings.textureInverted !== true;

function readLayer(source: ProcreateBrushSource, prefix: string, notes: StampBrushSupportNote[], reading: ProcreateReading): StampBrushLayer {
  const s = source.settings;
  const num = (key: string) => Number(s[key] ?? 0);
  const on = (key: string) => s[key] === true;
  const note = (level: StampBrushSupportNote['level'], setting: string, detail: string) => notes.push({ level, setting: `${prefix}${setting}`, detail });
  const whenSet = (level: StampBrushSupportNote['level'], keys: readonly string[], detail: string) => {
    const set = keys.filter((key) => (typeof s[key] === 'boolean' ? s[key] : num(key) !== 0));
    if (set.length) note(level, set.join(', '), detail);
  };

  const spacing = num('plotSpacing') ** reading.spacingPower;
  note('approximated', 'plotSpacing', spacing < STAMP_MIN_SPACING
    ? `stamps all but continuously; placed at the studio's closest spacing, ${STAMP_MIN_SPACING}`
    : `read as stamps ${spacing.toFixed(3)} of a diameter apart`);
  if (num('plotJitter')) note('approximated', 'plotJitter', `read as each stamp moved across the stroke by up to ${lateralJitter(num('plotJitter'), reading).toFixed(2)} of a diameter`);
  const shapeScatter = num('shapeScatter');
  if (shapeScatter) note('approximated', 'shapeScatter', `${shapeScatter.toFixed(2)} read as each stamp turned at random by up to ±${Math.round(shapeScatter * 90)}°`);
  const taperStart = num('pencilTaperStartLength'), taperEnd = num('pencilTaperEndLength');
  if (taperStart || taperEnd) {
    note('approximated', 'pencilTaperStartLength, pencilTaperEndLength', `taper lengths read as shares of the stroke, the full slider as ${reading.taperShare.toFixed(2)} of it`);
    whenSet('approximated', ['pencilTaperShape'], "the taper's tip read as how long the taper holds its width before it narrows");
    whenSet('approximated', ['taperPressure'], "read as how far the taper stands in for the stroke's pressure: at 0 the previews still taper by pressure");
  }

  // Rendering modes, by the flags Procreate stores them as. A blending mode (recursive mixing) builds within the stroke
  // and its wet edge only softens; a glaze builds only as far as its mode's fitted glazeBuild, and its wet edge
  // gathers a rim.
  const blending = on('renderingRecursiveMixing');
  const modulated = on('renderingModulatedTransfer'), maxTransfer = on('renderingMaxTransfer');
  const glazeBuild = modulated && maxTransfer ? reading.glazeBuildHeavy : maxTransfer ? reading.glazeBuildIntense
    : modulated ? reading.glazeBuildUniform : reading.glazeBuildLight;
  if (blending && (modulated || maxTransfer)) {
    note('approximated', ['renderingMaxTransfer', 'renderingModulatedTransfer'].filter(on).join(', '), 'a blending mode reads as the one build, whichever it is');
  }
  // Charge and pull sit at Procreate's defaults on brushes that never mix, so wet mixing is noted only on one that does.
  if (blending || num('dynamicsMix') > 0) {
    whenSet('unsupported', ['dynamicsMix', 'dynamicsLoad', 'dynamicsWetAccumulation', 'dynamicsPressureMix'], 'wet mixing with paint already down (vid-90): the recipe mixes pigment only between deposits');
  }
  // Wet Mix's blur softens paint already on the canvas as the brush mixes into it (the Handbook; Freya Lupen's
  // converter files it with Wet Mix), not the stamp: Smooth Ink Pen sets 0.32 and previews a crisp edge.
  whenSet('unsupported', ['dynamicsBlur', 'dynamicsBlurJitter'], "Wet Mix's blur of paint already down (vid-90); the stamp stays sharp");
  // Apple Pencil pressure's Bleed, beside its flow (Freya Lupen's converter), not a Wet Mix slider.
  whenSet('unsupported', ['dynamicsPressureBleed'], "pressure's bleed: what it moves isn't known, and it isn't read");

  for (const [curve, used] of [['dynamicsPressureSizeCurve', num('dynamicsPressureSize')], ['dynamicsPressureOpacityCurve', num('dynamicsPressureOpacity')]] as const) {
    const points = (s[curve] as { points?: unknown[] } | null)?.points;
    if (used && points && JSON.stringify(points) !== JSON.stringify(IDENTITY_CURVE)) note('approximated', curve, 'a shaped pressure response, read as linear');
  }
  whenSet(
    'inapplicable',
    ['shapeAzimuth', 'dynamicsTiltOpacity', 'dynamicsTiltSize', 'dynamicsTiltBleed', 'dynamicsTiltGradation', 'dynamicsTiltShapeRoundness', 'dynamicsSpeedSize', 'dynamicsSpeedOpacity', 'textureDepthTilt'],
    'pen tilt, azimuth and speed: an authored stroke has only pressure',
  );

  let grain: StampBrushLayer['grain'];
  if (source.grain) {
    const grainBlend = GRAIN_BLENDS[num('grainBlendMode')];
    grain = {
      image: source.grain, scale: num('textureScale') * reading.grainTile, depth: num('grainDepth') ** reading.grainDepthCurve,
      blend: { family: 'layer', mode: grainBlend ?? 'multiply' }, brightness: num('textureBrightness') * reading.grainBrightness * (procreateGrainNegated(s) ? 1 : -1),
      contrast: grainContrastOf(num('textureContrast'), reading), contrastPivot: 'mean', tiling: 'mirror', offsetJitter: on('textureOffsetJitter') ? 1 : 0,
      ...(num('textureApplication') === 1 ? { kind: 'canvas' as const } : { kind: 'rolling' as const, zoom: num('textureZoom'), movement: num('textureMovement'), rotation: num('textureRotation') }),
    };
    note('approximated', 'textureScale, textureApplication', `grain read as ${grain.kind === 'canvas' ? 'texturized' : 'rolling'}, its tile ${grain.scale.toFixed(2)} stamp diameters across`);
    note(grainBlend ? 'approximated' : 'unsupported', 'grainBlendMode', grainBlend
      ? `${blendName(num('grainBlendMode'))} read as ${grainBlend}, set against the pack's previews: Procreate doesn't document how grain modes number`
      : `${blendName(num('grainBlendMode'))} has no studio reading; read as multiply`);
    // Brightness lightens the image as drawn, before Procreate inverts it: on an inverted grain it takes paint away.
    whenSet('approximated', ['textureBrightness', 'textureContrast'], "the grain's brightness and contrast, read about its own mean and fitted on the sheet");
    whenSet('unsupported', ['grainDepthJitter', 'grainDepthMinimum'], 'grain depth varying stamp to stamp');
  } else if (typeof s.bundledGrainPath === 'string') {
    note('unsupported', 'bundledGrainPath', `the grain is Procreate's own ${s.bundledGrainPath}, which the pack doesn't hold`);
  }

  const wet = num('wetEdgesAmount'), burnt = num('burntEdgesAmount');
  if (wet > 0 || burnt > 0) note('approximated', 'wetEdgesAmount, burntEdgesAmount', `edge amounts carry over; the rim's width is the studio's ${reading.edgeWidth.toFixed(3)} of the radius`);
  // Every blending-mode brush with wet edges previews a crisp, unrimmed outline, however wet.
  if (wet > 0 && blending) note('approximated', 'wetEdgesAmount', 'in a blending mode, wet edges show no rim and no softening on the preview; read as none');
  const burntBlend = BURNT_BLENDS[num('burntEdgesBlendMode')];
  if (burnt > 0 && !burntBlend) note('unsupported', 'burntEdgesBlendMode', `the burnt rim blends by ${blendName(num('burntEdgesBlendMode'))}; read as colour burn`);

  return {
    tip: { image: source.tip, roundness: Math.min(1, Math.max(0.01, Number(s.shapeRoundness ?? 1))), sampling: 'isotropic' },
    ...(grain && { grain }),
    spacing: Math.max(spacing, STAMP_MIN_SPACING),
    stepping: 'spread',
    dynamics: stampDynamics({
      pressure: { size: num('dynamicsPressureSize'), opacity: num('dynamicsPressureOpacity'), flow: num('dynamicsPressureOpacityTransfer') },
      random: { size: num('dynamicsJitterSize'), opacity: num('dynamicsJitterOpacity'), flow: num('dynamicsWetnessJitter') },
    }),
    // shapeCount stores Procreate's 1–16 stamps as sixteenths.
    scatter: { count: Math.max(1, Math.round(num('shapeCount') * 16)), countJitter: num('shapeCountJitter'), countPressure: 0, radius: 0, lateral: lateralJitter(num('plotJitter'), reading) },
    rotation: { angle: num('shapeAngle'), follow: Math.min(1, Math.max(-1, num('shapeRotation'))), jitter: (shapeScatter * Math.PI) / 2, randomStart: on('shapeRandomise') },
    flip: { x: on('shapeFlipXJitter'), y: on('shapeFlipYJitter') },
    blur: { amount: 0, jitter: 0 },
    taper: {
      start: taperStart * reading.taperShare, end: taperEnd * reading.taperShare, size: 1 - num('pencilTaperSize'), opacity: 1 - num('pencilTaperOpacity'),
      shape: num('pencilTaperShape'), pressure: num('taperPressure'),
    },
    falloff: num('dynamicsFalloff'),
    // maxOpacity only bounds the sidebar's opacity slider (the Handbook's Properties): a deposit states its own opacity.
    flow: num('dynamicsGlazedFlow') ** (blending ? reading.blendingFlowCurve : reading.glazeFlowCurve),
    accumulation: blending ? { kind: 'build' } : { kind: 'glaze', build: glazeBuild },
    ...(wet > 0 && !blending && { wetEdges: { kind: 'rim', width: reading.edgeWidth, rim: Math.min(1, wet * reading.wetRim), sharpness: reading.rimSharpness } }),
    ...(burnt > 0 && { burntEdge: { width: reading.edgeWidth, strength: burnt, sharpness: reading.rimSharpness, blend: burntBlend ?? 'colorBurn' } }),
  };
}

/** The colour dynamics a main brush sets, or none. */
function readColorDynamics(s: ProcreateBrushSettings): StampBrushColorDynamics | undefined {
  const num = (key: string) => Number(s[key] ?? 0);
  const color: StampBrushColorDynamics = {
    stamp: { hue: num('dynamicsJitterHue'), saturation: num('dynamicsJitterSaturation'), lightness: num('dynamicsJitterLightness'), darkness: num('dynamicsJitterDarkness') },
    stroke: {
      hue: num('dynamicsJitterStrokeHue'), saturation: num('dynamicsJitterStrokeSaturation'), lightness: num('dynamicsJitterStrokeLightness'), darkness: num('dynamicsJitterStrokeDarkness'),
    },
    pressure: { hue: num('dynamicsPressureHue'), saturation: num('dynamicsPressureSaturation'), lightness: num('dynamicsPressureBrightness'), secondary: num('dynamicsPressureSecondaryColor') },
  };
  return Object.values(color).some((group) => Object.values(group).some((v) => v !== 0)) ? color : undefined;
}

/** `main` read into a StampBrush named `name`, with `dual` (its Sub01) as the dual brush, and what didn't carry over. */
export function normalizeProcreateBrush(
  name: string, main: ProcreateBrushSource, dual?: ProcreateBrushSource, reading: ProcreateReading = PROCREATE_READING,
): { brush: StampBrush; support: StampBrushSupportNote[] } {
  const support: StampBrushSupportNote[] = [];
  const blend = BRUSH_BLENDS[Number(main.settings.blendMode ?? 0)];
  if (!blend) support.push({ level: 'unsupported', setting: 'blendMode', detail: `the brush paints in ${blendName(Number(main.settings.blendMode))}; read as normal` });
  const color = readColorDynamics(main.settings);
  const brush: StampBrush = { name, blend: blend ?? 'normal', ...(color && { color }), ...readLayer(main, '', support, reading) };
  if (dual) {
    const mode = Number(main.settings.dualBlendMode ?? 0);
    const dualBlend = DUAL_BLENDS[mode];
    support.push(dualBlend
      ? { level: 'approximated', setting: 'dualBlendMode', detail: `combine mode ${blendName(mode)} read as ${dualBlend}, set against the pack's previews: Procreate doesn't document how combine modes number` }
      : { level: 'unsupported', setting: 'dualBlendMode', detail: `combine mode ${blendName(mode)} has no studio equivalent; read as multiply` });
    if (readColorDynamics(dual.settings)) support.push({ level: 'inapplicable', setting: 'Sub01 colour dynamics', detail: "a dual only shapes the main brush's coverage; its colour is the main brush's" });
    const scale = (Number(dual.settings.maxSize ?? 1) / Number(main.settings.maxSize ?? 1)) * reading.dualScale;
    support.push({ level: 'approximated', setting: 'Sub01 maxSize', detail: `the dual's stamps read as ${scale.toFixed(2)}× the main brush's, the ratio of their largest sizes; on the sheet neither half nor double fits better` });
    brush.dual = { ...readLayer(dual, 'Sub01 ', support, reading), blend: { family: 'layer', mode: dualBlend ?? 'multiply' }, scale };
  }
  return { brush, support };
}
