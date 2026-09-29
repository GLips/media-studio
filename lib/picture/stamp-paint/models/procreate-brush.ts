// procreate-brush.ts: a Procreate brush (its Brush.archive settings, and its Sub01 when it's a dual brush) read into a
// StampBrush, with a note for every setting that doesn't carry over as Procreate means it. Procreate's field names
// stop here: nothing past this file reads them.
//
// Several readings are the studio's own (taper length, rotation scatter, grain scale and polarity, rim width, combine
// modes, dual size, falloff span), each noted as `approximated` where it applies. Each was set against the VVDS
// previews on the brush fidelity sheet (`studio brushes sheet`); where a reading varied brush by brush with no better
// rule, the simplest was kept.
//
// Negative space: live-input settings (stabilization, smoothing, prediction, pressure smoothing), the size and opacity
// sliders' positions (paintSize, paintOpacity, maxSize, minSize: a deposit states its own diameter and opacity), the
// finger taper (taperStartLength…: a stroke with pressure is a pencil stroke), smudge and erase settings and the
// preview's own settings aren't a brush's painting, and go unreported. Tilt, azimuth and speed are noted `inapplicable`
// (a path has none); wet mixing is noted `unsupported`, left to the wet-paint model.

import type { StampBlend, StampBrush, StampBrushAsset, StampBrushColorDynamics, StampBrushLayer, StampDualBlend, StampGrainBlend } from './stamp-brush.ts';
import { STAMP_MIN_SPACING } from './stamp-placement.ts';
import type { StampBrushSupportNote } from './style.ts';

/** A Brush.archive's root object, as unarchived: its settings by Procreate's names. */
export type ProcreateBrushSettings = Readonly<Record<string, unknown>>;

/** One Procreate brush's settings and where its images landed among the pack's assets. */
export type ProcreateBrushSource = { settings: ProcreateBrushSettings; tip: StampBrushAsset; grain?: StampBrushAsset };

/**
 * Procreate's full pencil taper, read as this share of the stroke's length. On the sheet no share from 0.1 to 0.7 fits
 * the previews better overall; brushes split between shorter and longer.
 */
const TAPER_STROKE_SHARE = 0.5;
/**
 * Procreate's wet and burnt edges have an amount and no width; the rim is this fraction of the stamp's radius. Fit with
 * the renderer's rim gain to Main Watercolor's preview, whose rim peaks a pixel in and is halfway to its body by four.
 */
const EDGE_WIDTH = 0.035;

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
const DUAL_BLENDS: Readonly<Record<number, StampDualBlend>> = {
  0: 'normal', 1: 'multiply', 2: 'screen', 4: 'lighten', 6: 'difference', 10: 'colorBurn', 11: 'overlay', 19: 'darken', 28: 'linearHeight',
};
/** A grain's blend mode by number, as layer modes number: the pack uses only these. */
const GRAIN_BLENDS: Readonly<Record<number, StampGrainBlend>> = {
  1: 'multiply', 4: 'lighten', 7: 'subtract', 8: 'linearBurn', 9: 'colorDodge', 10: 'colorBurn', 19: 'darken', 20: 'hardMix', 26: 'divide', 27: 'height', 28: 'linearHeight',
};
/** The brush's own blend and its burnt edge's, by number, as layer modes number. */
const BRUSH_BLENDS: Readonly<Record<number, StampBlend>> = { 0: 'normal', 1: 'multiply', 2: 'screen', 4: 'lighten', 10: 'colorBurn', 11: 'overlay', 19: 'darken' };
const BURNT_BLENDS = BRUSH_BLENDS;
/**
 * A grain's tile is its textureScale times this, in stamp diameters: the size at which, on the sheet, the studio's grain
 * matches the previews' (per brush the best factor ran 0.6 to 6×; near their geometric mean).
 */
const GRAIN_TILE = 2.5;
/**
 * A grain's brightness is its textureBrightness times this, raising its paint. On the sheet, half fits the 26 VVDS
 * brushes that set one best overall (as read, the brighter grains leave their strokes too dark; negated, most go pale).
 */
const GRAIN_BRIGHTNESS = 0.5;
const blendName = (mode: number) => `${mode} (${PROCREATE_BLEND_NAMES[mode] ?? 'unknown'})`;

const IDENTITY_CURVE = ['{0.000000, 0.000000}', '{1.000000, 1.000000}'];

/**
 * Whether one of a brush's images must be negated to reach the studio's polarity, dark is paint. Procreate paints
 * with white, so an image is negated unless the brush inverts it.
 */
export const procreateTipNegated = (settings: ProcreateBrushSettings) => settings.shapeInverted !== true;
export const procreateGrainNegated = (settings: ProcreateBrushSettings) => settings.textureInverted !== true;

function readLayer(source: ProcreateBrushSource, prefix: string, notes: StampBrushSupportNote[]): StampBrushLayer {
  const s = source.settings;
  const num = (key: string) => Number(s[key] ?? 0);
  const on = (key: string) => s[key] === true;
  const note = (level: StampBrushSupportNote['level'], setting: string, detail: string) => notes.push({ level, setting: `${prefix}${setting}`, detail });
  const whenSet = (level: StampBrushSupportNote['level'], keys: readonly string[], detail: string) => {
    const set = keys.filter((key) => (typeof s[key] === 'boolean' ? s[key] : num(key) !== 0));
    if (set.length) note(level, set.join(', '), detail);
  };

  const plotSpacing = num('plotSpacing');
  if (plotSpacing < STAMP_MIN_SPACING) note('approximated', 'plotSpacing', `${plotSpacing.toFixed(3)} stamps all but continuously; placed at the studio's closest spacing, ${STAMP_MIN_SPACING}`);
  const shapeScatter = num('shapeScatter');
  if (shapeScatter) note('approximated', 'shapeScatter', `${shapeScatter.toFixed(2)} read as each stamp turned at random by up to ±${Math.round(shapeScatter * 90)}°`);
  const taperStart = num('pencilTaperStartLength'), taperEnd = num('pencilTaperEndLength');
  if (taperStart || taperEnd) {
    note('approximated', 'pencilTaperStartLength, pencilTaperEndLength', `taper lengths read as shares of the stroke, the full slider as ${TAPER_STROKE_SHARE} of it`);
    whenSet('approximated', ['pencilTaperShape'], "the taper's tip read as how long the taper holds its width before it narrows");
    whenSet('approximated', ['taperPressure'], "read as how far the taper stands in for the stroke's pressure: at 0 the previews still taper by pressure");
  }

  // Rendering modes, by the flags Procreate stores them as. A blending mode (recursive mixing) builds within the stroke
  // and its wet edge only softens; a glaze reaches at most its flow, and its wet edge gathers a rim.
  const blending = on('renderingRecursiveMixing');
  if (!blending && (on('renderingModulatedTransfer') || on('renderingMaxTransfer'))) {
    note('approximated', ['renderingMaxTransfer', 'renderingModulatedTransfer'].filter(on).join(', '), "a heavier glaze; on the sheet its body reads as the studio's one glaze does");
  }
  // Charge and pull sit at Procreate's defaults on brushes that never mix, so wet mixing is noted only on one that does.
  if (blending || num('dynamicsMix') > 0) {
    whenSet('unsupported', ['dynamicsMix', 'dynamicsLoad', 'dynamicsWetAccumulation', 'dynamicsPressureBleed', 'dynamicsPressureMix'], 'wet mixing with paint already down (vid-81, vid-83): the recipe mixes pigment only between deposits');
  }

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
      image: source.grain, scale: num('textureScale') * GRAIN_TILE, mode: num('textureApplication') === 1 ? 'texturized' : 'rolling', depth: num('grainDepth'),
      blend: grainBlend ?? 'multiply', brightness: num('textureBrightness') * GRAIN_BRIGHTNESS * (procreateGrainNegated(s) ? 1 : -1), contrast: num('textureContrast'), offsetJitter: on('textureOffsetJitter') ? 1 : 0,
      zoom: num('textureZoom'), movement: num('textureMovement'), rotation: num('textureRotation'),
    };
    note('approximated', 'textureScale, textureApplication', `grain read as ${grain.mode}, its tile ${grain.scale.toFixed(2)} stamp diameters across`);
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
  if (wet > 0 || burnt > 0) note('approximated', 'wetEdgesAmount, burntEdgesAmount', `edge amounts carry over; the rim's width is the studio's ${EDGE_WIDTH} of the radius`);
  // Every blending-mode brush with wet edges previews a crisp, unrimmed outline, however wet.
  if (wet > 0 && blending) note('approximated', 'wetEdgesAmount', 'in a blending mode, wet edges show no rim and no softening on the preview; read as none');
  const burntBlend = BURNT_BLENDS[num('burntEdgesBlendMode')];
  if (burnt > 0 && !burntBlend) note('unsupported', 'burntEdgesBlendMode', `the burnt rim blends by ${blendName(num('burntEdgesBlendMode'))}; read as colour burn`);

  return {
    tip: { image: source.tip, roundness: Math.min(1, Math.max(0.01, Number(s.shapeRoundness ?? 1))) },
    ...(grain && { grain }),
    spacing: Math.max(plotSpacing, STAMP_MIN_SPACING),
    jitter: { lateral: num('plotJitter'), size: num('dynamicsJitterSize'), opacity: num('dynamicsJitterOpacity'), flow: num('dynamicsWetnessJitter') },
    // shapeCount stores Procreate's 1–16 stamps as sixteenths.
    scatter: { count: Math.max(1, Math.round(num('shapeCount') * 16)), countJitter: num('shapeCountJitter'), radius: 0 },
    rotation: { angle: num('shapeAngle'), follow: Math.min(1, Math.max(-1, num('shapeRotation'))), jitter: (shapeScatter * Math.PI) / 2, randomStart: on('shapeRandomise') },
    flip: { x: on('shapeFlipXJitter'), y: on('shapeFlipYJitter') },
    blur: { amount: num('dynamicsBlur'), jitter: num('dynamicsBlurJitter') },
    taper: {
      start: taperStart * TAPER_STROKE_SHARE, end: taperEnd * TAPER_STROKE_SHARE, size: 1 - num('pencilTaperSize'), opacity: 1 - num('pencilTaperOpacity'),
      shape: num('pencilTaperShape'), pressure: num('taperPressure'),
    },
    falloff: num('dynamicsFalloff'),
    flow: num('dynamicsGlazedFlow') * Number(s.maxOpacity ?? 1),
    pressure: { size: num('dynamicsPressureSize'), opacity: num('dynamicsPressureOpacity'), flow: num('dynamicsPressureOpacityTransfer') },
    accumulation: blending ? 'build' : 'glaze',
    ...(wet > 0 && !blending && { wetEdge: { width: EDGE_WIDTH, rim: wet } }),
    ...(burnt > 0 && { burntEdge: { width: EDGE_WIDTH, strength: burnt, blend: burntBlend ?? 'colorBurn' } }),
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
export function normalizeProcreateBrush(name: string, main: ProcreateBrushSource, dual?: ProcreateBrushSource): { brush: StampBrush; support: StampBrushSupportNote[] } {
  const support: StampBrushSupportNote[] = [];
  const blend = BRUSH_BLENDS[Number(main.settings.blendMode ?? 0)];
  if (!blend) support.push({ level: 'unsupported', setting: 'blendMode', detail: `the brush paints in ${blendName(Number(main.settings.blendMode))}; read as normal` });
  const color = readColorDynamics(main.settings);
  const brush: StampBrush = { name, blend: blend ?? 'normal', ...(color && { color }), ...readLayer(main, '', support) };
  if (dual) {
    const mode = Number(main.settings.dualBlendMode ?? 0);
    const dualBlend = DUAL_BLENDS[mode];
    support.push(dualBlend
      ? { level: 'approximated', setting: 'dualBlendMode', detail: `combine mode ${blendName(mode)} read as ${dualBlend}, set against the pack's previews: Procreate doesn't document how combine modes number` }
      : { level: 'unsupported', setting: 'dualBlendMode', detail: `combine mode ${blendName(mode)} has no studio equivalent; read as multiply` });
    if (readColorDynamics(dual.settings)) support.push({ level: 'inapplicable', setting: 'Sub01 colour dynamics', detail: "a dual only shapes the main brush's coverage; its colour is the main brush's" });
    const scale = Number(dual.settings.maxSize ?? 1) / Number(main.settings.maxSize ?? 1);
    support.push({ level: 'approximated', setting: 'Sub01 maxSize', detail: `the dual's stamps read as ${scale.toFixed(2)}× the main brush's, the ratio of their largest sizes; on the sheet neither half nor double fits better` });
    brush.dual = { ...readLayer(dual, 'Sub01 ', support), blend: dualBlend ?? 'multiply', scale };
  }
  return { brush, support };
}
