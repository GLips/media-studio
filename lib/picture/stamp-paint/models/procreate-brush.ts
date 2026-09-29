// procreate-brush.ts: a Procreate brush (its Brush.archive settings, and its Sub01 when it's a dual brush) read into a
// StampBrush, with a note for every setting that doesn't carry over as Procreate means it. Procreate's field names
// stop here: nothing past this file reads them.
//
// Several readings are the studio's own (taper length, rotation scatter, grain scale, rim width, combine modes, dual
// size), each noted as `approximated` where it applies. Each was set against the VVDS previews on the brush fidelity
// sheet (`studio brushes sheet`); where a reading varied brush by brush with no better rule, the simplest was kept.
//
// Negative space: live-input settings (stabilization, smoothing, prediction, pressure smoothing), the size and opacity
// sliders' positions (paintSize, paintOpacity, maxSize, minSize: a deposit states its own diameter and opacity), the
// finger taper (taperStartLength…: a stroke with pressure is a pencil stroke), smudge and erase settings and the
// preview's own settings aren't a brush's painting, and go unreported.

import type { StampBrush, StampBrushAsset, StampBrushLayer, StampDualBlend } from './stamp-brush.ts';
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
 * Procreate's wet and burnt edges have an amount and no width; the rim is this fraction of the stamp's radius. Measured
 * on the VVDS previews (the brush fidelity sheet): a glaze wash's rim falls halfway to its body 0.06 to 0.12 of the
 * radius in, 0.07 at the median.
 */
const EDGE_WIDTH = 0.07;

/** Procreate's blend modes by number, as its layers number them; 27 and 28 only appear on grains and duals. */
const PROCREATE_BLEND_NAMES: Readonly<Record<number, string>> = {
  0: 'Normal', 1: 'Multiply', 2: 'Screen', 3: 'Add', 4: 'Lighten', 5: 'Exclusion', 6: 'Difference', 7: 'Subtract',
  8: 'Linear Burn', 9: 'Color Dodge', 10: 'Color Burn', 11: 'Overlay', 12: 'Hard Light', 13: 'Color', 14: 'Luminosity',
  15: 'Hue', 16: 'Saturation', 17: 'Soft Light', 19: 'Darken', 20: 'Hard Mix', 21: 'Vivid Light', 22: 'Linear Light',
  23: 'Pin Light', 24: 'Lighter Color', 25: 'Darker Color', 26: 'Divide', 27: 'Height', 28: 'Linear Height',
};
/**
 * A dual's combine mode by number. Looks wrong: 6 is Difference among layers, but every VVDS dual with it matches its
 * preview best as overlay and near worst as difference. 10, 19 and 28 read as their layer names; the sheet neither
 * confirms nor beats them (one or two brushes each, split).
 */
const DUAL_BLENDS: Readonly<Record<number, StampDualBlend>> = {
  0: 'normal', 1: 'multiply', 2: 'screen', 4: 'lighten', 6: 'overlay', 10: 'colorBurn', 11: 'overlay', 19: 'darken', 28: 'linearHeight',
};
/**
 * A grain's tile is its textureScale times this, in stamp diameters: the size at which, on the sheet, the studio's grain
 * matches the previews' (per brush the best factor ran 0.6 to 6×; near their geometric mean).
 */
const GRAIN_TILE = 2.5;
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
  const unsupportedWhenSet = (keys: readonly string[], detail: string) => {
    const set = keys.filter((key) => (typeof s[key] === 'boolean' ? s[key] : num(key) !== 0));
    if (set.length) note('unsupported', set.join(', '), detail);
  };

  const plotSpacing = num('plotSpacing');
  if (plotSpacing < STAMP_MIN_SPACING) note('approximated', 'plotSpacing', `${plotSpacing.toFixed(3)} stamps all but continuously; placed at the studio's closest spacing, ${STAMP_MIN_SPACING}`);
  const shapeScatter = num('shapeScatter');
  if (shapeScatter) note('approximated', 'shapeScatter', `${shapeScatter.toFixed(2)} read as each stamp turned at random by up to ±${Math.round(shapeScatter * 90)}°`);
  const shapeRotation = num('shapeRotation');
  if (shapeRotation < 0) note('unsupported', 'shapeRotation', `${shapeRotation.toFixed(2)} turns stamps against the stroke; they don't follow it`);
  const taperStart = num('pencilTaperStartLength'), taperEnd = num('pencilTaperEndLength');
  if (taperStart || taperEnd) {
    note('approximated', 'pencilTaperStartLength, pencilTaperEndLength', `taper lengths read as shares of the stroke, the full slider as ${TAPER_STROKE_SHARE} of it`);
    unsupportedWhenSet(['pencilTaperShape', 'taperPressure'], "the taper's curve and its pressure link: the studio's taper eases linearly");
  }

  const accumulation = on('renderingRecursiveMixing') ? 'build' : 'glaze';
  if (on('renderingRecursiveMixing')) {
    note('approximated', 'renderingRecursiveMixing', 'a blending rendering mode mixes wet paint with the canvas; read as stamps that build within the stroke');
    unsupportedWhenSet(['dynamicsMix', 'dynamicsLoad', 'dynamicsWetAccumulation', 'dynamicsPressureBleed', 'dynamicsPressureMix'], 'wet mixing with paint already down: the recipe mixes pigment only between deposits');
  } else if (on('renderingModulatedTransfer') || on('renderingMaxTransfer')) {
    note('approximated', on('renderingMaxTransfer') ? 'renderingMaxTransfer' : 'renderingModulatedTransfer', "a heavier glaze rendering mode; read as the studio's one glaze");
  }

  for (const [curve, used] of [['dynamicsPressureSizeCurve', num('dynamicsPressureSize')], ['dynamicsPressureOpacityCurve', num('dynamicsPressureOpacity')]] as const) {
    const points = (s[curve] as { points?: unknown[] } | null)?.points;
    if (used && points && JSON.stringify(points) !== JSON.stringify(IDENTITY_CURVE)) note('approximated', curve, 'a shaped pressure response, read as linear');
  }
  unsupportedWhenSet(['dynamicsPressureOpacityTransfer'], 'pressure moving flow apart from opacity');
  unsupportedWhenSet(['shapeCountJitter'], 'the stamp count varying from step to step');
  unsupportedWhenSet(['shapeRandomise'], "each stroke's own random starting angle: the studio's rotation randomness is per stamp");
  unsupportedWhenSet(['shapeFlipXJitter', 'shapeFlipYJitter'], 'stamps flipped at random');
  unsupportedWhenSet(['dynamicsWetnessJitter'], "flow varying stamp to stamp by wetness (jitter's opacity is its own setting)");
  unsupportedWhenSet(['dynamicsBlur', 'dynamicsBlurJitter'], 'blurred stamps');
  unsupportedWhenSet(['dynamicsFalloff'], 'the stroke fading over its length');
  unsupportedWhenSet(
    ['shapeAzimuth', 'dynamicsTiltOpacity', 'dynamicsTiltSize', 'dynamicsTiltBleed', 'dynamicsTiltGradation', 'dynamicsTiltShapeRoundness', 'dynamicsSpeedSize', 'dynamicsSpeedOpacity'],
    "pen tilt, azimuth and speed: an authored stroke has only pressure",
  );
  unsupportedWhenSet(
    ['dynamicsJitterHue', 'dynamicsJitterSaturation', 'dynamicsJitterLightness', 'dynamicsJitterDarkness', 'dynamicsJitterStrokeHue', 'dynamicsJitterStrokeSaturation',
      'dynamicsJitterStrokeLightness', 'dynamicsJitterStrokeDarkness', 'dynamicsPressureHue', 'dynamicsPressureSaturation', 'dynamicsPressureBrightness', 'dynamicsPressureSecondaryColor'],
    'colour varying by stamp, stroke or pressure: a deposit is one material',
  );
  if (num('blendMode')) note('unsupported', 'blendMode', `the brush paints in ${blendName(num('blendMode'))}; a deposit states its own blend`);

  let grain: StampBrushLayer['grain'];
  if (source.grain) {
    grain = { image: source.grain, scale: num('textureScale') * GRAIN_TILE, mode: num('textureApplication') === 1 ? 'texturized' : 'rolling', depth: num('grainDepth') };
    note('approximated', 'textureScale, textureApplication', `grain read as ${grain.mode}, its tile ${grain.scale.toFixed(2)} stamp diameters across`);
    note('unsupported', 'grainBlendMode', `the grain combines by ${blendName(num('grainBlendMode'))}; the studio's grain cuts paint by its depth`);
    unsupportedWhenSet(['textureBrightness', 'textureContrast'], "the grain's brightness and contrast: the image is kept as drawn");
    unsupportedWhenSet(['textureOffsetJitter'], "the grain's offset changing with each stroke");
    unsupportedWhenSet(['textureRotation'], 'a turned grain');
    unsupportedWhenSet(['grainDepthJitter', 'grainDepthMinimum', 'textureDepthTilt'], 'grain depth varying by stamp or tilt');
    if (grain.mode === 'rolling' && (num('textureZoom') !== 1 || num('textureMovement') !== 1)) note('unsupported', 'textureZoom, textureMovement', 'a rolling grain that zooms with size or slides less than the stamp');
  } else if (typeof s.bundledGrainPath === 'string') {
    note('unsupported', 'bundledGrainPath', `the grain is Procreate's own ${s.bundledGrainPath}, which the pack doesn't hold`);
  }

  const edge = (amount: number) => (amount > 0 ? { width: EDGE_WIDTH, strength: amount } : undefined);
  if (num('wetEdgesAmount') > 0 || num('burntEdgesAmount') > 0) note('approximated', 'wetEdgesAmount, burntEdgesAmount', `edge amounts carry over; the rim's width is the studio's ${EDGE_WIDTH} of the radius`);
  if (num('burntEdgesAmount') > 0 && num('burntEdgesBlendMode')) note('unsupported', 'burntEdgesBlendMode', `the burnt rim blends by ${blendName(num('burntEdgesBlendMode'))}; the studio's darkens`);

  return {
    tip: { image: source.tip, roundness: Math.min(1, Math.max(0.01, Number(s.shapeRoundness ?? 1))) },
    ...(grain && { grain }),
    spacing: Math.max(plotSpacing, STAMP_MIN_SPACING),
    jitter: { lateral: num('plotJitter'), size: num('dynamicsJitterSize'), opacity: num('dynamicsJitterOpacity') },
    // shapeCount stores Procreate's 1–16 stamps as sixteenths.
    scatter: { count: Math.max(1, Math.round(num('shapeCount') * 16)), radius: 0 },
    rotation: { angle: num('shapeAngle'), follow: Math.min(1, Math.max(0, shapeRotation)), jitter: (shapeScatter * Math.PI) / 2 },
    taper: { start: taperStart * TAPER_STROKE_SHARE, end: taperEnd * TAPER_STROKE_SHARE, size: 1 - num('pencilTaperSize'), opacity: 1 - num('pencilTaperOpacity') },
    flow: num('dynamicsGlazedFlow') * Number(s.maxOpacity ?? 1),
    pressure: { size: num('dynamicsPressureSize'), opacity: num('dynamicsPressureOpacity') },
    accumulation,
    ...(edge(num('wetEdgesAmount')) && { wetEdge: edge(num('wetEdgesAmount')) }),
    ...(edge(num('burntEdgesAmount')) && { burntEdge: edge(num('burntEdgesAmount')) }),
  };
}

/** `main` read into a StampBrush named `name`, with `dual` (its Sub01) as the dual brush, and what didn't carry over. */
export function normalizeProcreateBrush(name: string, main: ProcreateBrushSource, dual?: ProcreateBrushSource): { brush: StampBrush; support: StampBrushSupportNote[] } {
  const support: StampBrushSupportNote[] = [];
  const brush: StampBrush = { name, ...readLayer(main, '', support) };
  if (dual) {
    const mode = Number(main.settings.dualBlendMode ?? 0);
    const blend = DUAL_BLENDS[mode];
    support.push(blend
      ? { level: 'approximated', setting: 'dualBlendMode', detail: `combine mode ${blendName(mode)} read as ${blend}, set against the pack's previews: Procreate doesn't document how combine modes number` }
      : { level: 'unsupported', setting: 'dualBlendMode', detail: `combine mode ${blendName(mode)} has no studio equivalent; read as multiply` });
    const scale = Number(dual.settings.maxSize ?? 1) / Number(main.settings.maxSize ?? 1);
    support.push({ level: 'approximated', setting: 'Sub01 maxSize', detail: `the dual's stamps read as ${scale.toFixed(2)}× the main brush's, the ratio of their largest sizes; on the sheet neither half nor double fits better` });
    brush.dual = { ...readLayer(dual, 'Sub01 ', support), blend: blend ?? 'multiply', scale };
  }
  return { brush, support };
}
