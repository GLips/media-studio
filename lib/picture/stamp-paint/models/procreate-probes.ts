// procreate-probes.ts: the probe brushes, a Procreate brush set built to read Procreate's renderer out by experiment
// (vid-89, vid-96). Nothing published documents how Procreate paints (its grain and combine blends, rendering modes,
// wet and burnt edges, flow, colour space), so each probe starts from one plain brush and changes one setting. Procreate
// paints each probe's marks on a capture canvas (models/procreate-capture-plan.ts), and its exported layers are the
// readout (docs/procreate-probes.md).
//
// Most readouts are one stamp, a tap: a tip that ramps from no paint at its left to full paint at its right, over a
// grain that saws from none to full down its height, draws a grain blend's whole transfer, a(x) against g(y), in one
// image. Strokes read what only a stroke shows: build-up within a stroke and between strokes, rims, taper, rotation,
// paint over a ground.
//
// Images are drawn as Procreate reads them, white is paint, and neither is inverted.

/** A probe's image, `size` pixels square, one byte per pixel, row by row. */
export type ProcreateProbeImage = 'disk' | 'flat' | 'rampX' | 'rampY' | 'sawY' | 'sawX' | 'strip' | 'flag' | 'barV' | 'barH';

/** How many times a saw grain climbs from no paint to full across its tile: enough to read its period off a readout. */
const SAW_PERIODS = 4;

export function drawProcreateProbeImage(image: ProcreateProbeImage, size: number): Uint8Array {
  const pixels = new Uint8Array(size * size), r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      let value = 0;
      switch (image) {
        case 'disk': value = Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r * 0.96 ? 1 : 0; break;
        case 'flat': value = 1; break;
        case 'rampX': value = u; break;
        case 'rampY': value = v; break;
        case 'sawY': value = (v * SAW_PERIODS) % 1; break;
        case 'sawX': value = (u * SAW_PERIODS) % 1; break;
        // A bar a sixth as wide as it's tall: which way a stamp is turned shows at a glance, up to a half turn.
        case 'strip': value = Math.abs(u - 0.5) < 1 / 12 && Math.abs(v - 0.5) < 0.45 ? 1 : 0; break;
        // The strip with a pennant at its top right: no turn or flip of it looks like another, so rotation reads whole.
        case 'flag': value = (Math.abs(u - 0.5) < 1 / 12 && Math.abs(v - 0.5) < 0.45) || (u >= 0.5 && u < 0.85 && v >= 0.05 && v < 0.3) ? 1 : 0; break;
        // Two bars that cross in the middle, for a dual's two tips: each alone at its arms, both where they cross.
        case 'barV': value = Math.abs(u - 0.5) < 0.15 && Math.abs(v - 0.5) < 0.45 ? 1 : 0; break;
        case 'barH': value = Math.abs(v - 0.5) < 0.15 && Math.abs(u - 0.5) < 0.45 ? 1 : 0; break;
      }
      pixels[y * size + x] = Math.round(value * 255);
    }
  }
  return pixels;
}

/** Brush.archive settings by Procreate's names. */
export type ProcreateProbeSettings = Readonly<Record<string, number | boolean>>;

/**
 * What a probe paints, each laid out in its own box on the capture canvas: `tap` one stamp; `line` a straight stroke;
 * `selfCross` one stroke that loops across itself; `twoCross` two strokes that cross (build-up within a stroke against
 * between strokes); `sCurve` Procreate's own preview stroke; `longLine` a stroke across the whole canvas, over the
 * stripe ground, for wet mix.
 */
export type ProcreateProbeMark = 'tap' | 'line' | 'selfCross' | 'twoCross' | 'sCurve' | 'longLine';
/**
 * What a mark is painted over. `clear` is the capture's own transparent layer; the rest are patches on the ground
 * layer, painted onto directly, so the export shows paint as Procreate composites it over that colour.
 */
export type ProcreateProbeGround = 'clear' | 'black' | 'grey' | 'white' | 'stripe';
export type ProcreateProbeMarking = { mark: ProcreateProbeMark; ground: ProcreateProbeGround; color: string };

export type ProcreateProbe = {
  /** Its name in the set, numbered so the library lists them in order and the capture finds each by it. */
  name: string;
  /** What its capture reads out. */
  reads: string;
  settings: ProcreateProbeSettings;
  tip: ProcreateProbeImage;
  grain: ProcreateProbeImage;
  /** A dual brush: its own settings over the plain base, and its tip. */
  dual?: { settings: ProcreateProbeSettings; tip: ProcreateProbeImage };
  /**
   * A real brush from a pack instead, by its name there, painted with its own settings (the bridge to its preview
   * thumbnail, or a held-out brush). Its settings, tip and grain above are unused.
   */
  bridge?: { brush: string };
  /** The stamp's diameter asked for, in canvas pixels on the capture canvas (PROCREATE_CAPTURE_CANVAS). */
  diameter: number;
  marks: readonly ProcreateProbeMarking[];
  /** The stamp the capture's calibration taps are painted with: one, the plain disk. */
  calibration?: true;
};

/** The paint colour a mark takes unless it says: black, so a clear-layer capture's alpha is its coverage. */
export const PROCREATE_PROBE_INK = '#000000';

/**
 * Procreate's brush size, as a diameter in canvas pixels, at size 1 (paintSize 1 with maxSize 1). Measured off the
 * size ladder's captures on the 4096 canvas: the diameter is linear in paintSize × maxSize up to it.
 */
export const PROCREATE_FULL_SIZE_DIAMETER = 1000;

/**
 * The plain brush every probe starts from: a hard round tip, no grain, full flow, no dynamics, no taper (touch or
 * pencil), no streamline or stabilisation, pressure moving nothing, Light Glaze, no edges. Every setting the importer
 * reads is here, so no probe inherits one from the template brush it's written over. The scripted strokes are a
 * finger's, so the touch taper (taper*) is the one that applies; the pencil's is zeroed too.
 */
export const PROCREATE_PROBE_BASE: ProcreateProbeSettings = {
  stamp: false, blendMode: 0, extendedBlend: 0, shapeInverted: false, textureInverted: false, shapeRoundness: 1,
  plotSpacing: 0.05, plotJitter: 0, shapeScatter: 0, shapeRotation: 0, shapeAngle: 0, shapeRandomise: false, shapeCount: 1 / 16, shapeCountJitter: 0,
  shapeFlipXJitter: false, shapeFlipYJitter: false, shapeAzimuth: false,
  plotSmoothing: 0, plotMovingAverageStabilization: 0, plotFFTSmoothingAmount: 0,
  pencilTaperStartLength: 0, pencilTaperEndLength: 0, pencilTaperSize: 0, pencilTaperOpacity: 0, pencilTaperShape: 0, taperPressure: 0,
  taperStartLength: 0, taperEndLength: 0, taperSize: 0, taperOpacity: 0,
  minSize: 0, maxSize: 1, paintSize: 0.1, minOpacity: 0, paintOpacity: 1,
  dynamicsFalloff: 0, dynamicsGlazedFlow: 1, maxOpacity: 1, dynamicsBlur: 0, dynamicsBlurJitter: 0,
  dynamicsJitterSize: 0, dynamicsJitterOpacity: 0, dynamicsWetnessJitter: 0,
  dynamicsPressureSize: 0, dynamicsPressureOpacity: 0, dynamicsPressureOpacityTransfer: 0, dynamicsPressureBleed: 0,
  dynamicsSpeedSize: 0, dynamicsSpeedOpacity: 0, dynamicsTiltOpacity: 0, dynamicsTiltSize: 0, dynamicsTiltBleed: 0, dynamicsTiltGradation: 0, dynamicsTiltShapeRoundness: 0,
  renderingRecursiveMixing: false, renderingModulatedTransfer: false, renderingMaxTransfer: false,
  dynamicsMix: 0, dynamicsPressureMix: 0, dynamicsWetAccumulation: 0, dynamicsLoad: 1,
  wetEdgesAmount: 0, burntEdgesAmount: 0, burntEdgesBlendMode: 10, dualBlendMode: 1,
  grainBlendMode: 1, grainDepth: 0, grainDepthJitter: 0, grainDepthMinimum: 0, textureApplication: 1, textureScale: 0.5,
  textureBrightness: 0, textureContrast: 0, textureOffsetJitter: false, textureZoom: 0, textureMovement: 1, textureRotation: 0, textureDepthTilt: false,
  dynamicsJitterHue: 0, dynamicsJitterSaturation: 0, dynamicsJitterLightness: 0, dynamicsJitterDarkness: 0,
  dynamicsJitterStrokeHue: 0, dynamicsJitterStrokeSaturation: 0, dynamicsJitterStrokeLightness: 0, dynamicsJitterStrokeDarkness: 0,
  dynamicsPressureHue: 0, dynamicsPressureSaturation: 0, dynamicsPressureBrightness: 0, dynamicsPressureSecondaryColor: 0,
};

/** The size settings that paint `diameter` canvas pixels, by PROCREATE_FULL_SIZE_DIAMETER. */
export const procreateProbeSize = (diameter: number): ProcreateProbeSettings => ({ maxSize: 1, minSize: 0, paintSize: Math.min(1, diameter / PROCREATE_FULL_SIZE_DIAMETER) });

/** Grain blends by the number Procreate stores (grainBlendMode), each one the importer reads. */
const GRAIN_BLEND_PROBES = [[1, 'multiply'], [4, 'lighten'], [7, 'subtract'], [8, 'linear burn'], [9, 'colour dodge'], [10, 'colour burn'], [19, 'darken'], [20, 'hard mix'], [26, 'divide'], [27, 'height'], [28, 'linear height']] as const;
/** Dual combine modes by the number Procreate stores (dualBlendMode). */
const DUAL_BLEND_PROBES = [[0, 'normal'], [1, 'multiply'], [2, 'screen'], [4, 'lighten'], [6, 'difference?'], [10, 'colour burn'], [11, 'overlay'], [19, 'darken'], [28, 'linear height']] as const;
/** The dual modes the crossed-bar probes read at stroke level too. */
const DUAL_SHAPE_PROBES = [[0, 'normal'], [1, 'multiply'], [6, 'difference?'], [19, 'darken']] as const;
/** Rendering modes as the three flags Procreate stores them: recursive mixing, modulated transfer, max transfer. */
const RENDERING_PROBES = [[false, false, false], [false, false, true], [false, true, false], [false, true, true], [true, false, false], [true, true, false]] as const;
/** Colours painted over each ground, to read the compositing space: neutrals and two saturated hues. */
const GROUND_COLORS = ['#000000', '#808080', '#ffffff', '#d23c1e', '#1e50c8'] as const;
const GROUNDS = ['clear', 'black', 'grey', 'white'] as const;

/** A stamp readout's diameter: big enough to read a gradient in, a box's worth. */
const STAMP_DIAMETER = 384;
/** A stroke readout's diameter: a line many stamps long. */
const STROKE_DIAMETER = 96;

const marks = (...list: (ProcreateProbeMark | Partial<ProcreateProbeMarking> & { mark: ProcreateProbeMark })[]): ProcreateProbeMarking[] =>
  list.map((m) => ({ ground: 'clear', color: PROCREATE_PROBE_INK, ...(typeof m === 'string' ? { mark: m } : m) }));

type Draft = Omit<ProcreateProbe, 'name' | 'diameter' | 'marks'> & { diameter?: number; marks?: ProcreateProbeMarking[] };
/** A single-stamp readout: the tip ramps a(x), the grain saws g(y), at full depth. */
const stampReadout = (settings: ProcreateProbeSettings): Pick<Draft, 'settings' | 'tip' | 'grain'> => ({
  settings: { stamp: true, grainDepth: 1, textureApplication: 0, textureZoom: 0, textureMovement: 1, textureScale: 1, ...settings }, tip: 'rampX', grain: 'sawY',
});
/** A stroke of the hard round tip, at half flow so overlap within the stroke shows. */
const strokeReadout = (settings: ProcreateProbeSettings, tip: ProcreateProbeImage = 'disk'): Pick<Draft, 'settings' | 'tip' | 'grain' | 'diameter' | 'marks'> => ({
  settings: { dynamicsGlazedFlow: 0.5, ...settings }, tip, grain: 'flat', diameter: STROKE_DIAMETER, marks: marks('line'),
});

/**
 * Every probe, in order. `bridges` are real brushes from the template's pack, each painted along the preview's stroke
 * so its capture sits beside its thumbnail.
 */
export function procreateProbes({ bridges = [] }: { bridges?: readonly string[] } = {}): ProcreateProbe[] {
  const list: Draft[] = [
    ...[0.1, 0.2, 0.4].map((s) => ({ reads: `size ladder: paintSize ${s} at maxSize 1, a disk's diameter against size`, settings: { stamp: true, paintSize: s, maxSize: 1, minSize: 0 }, tip: 'disk' as const, grain: 'flat' as const })),
    { reads: "the tip's own transfer: its ramp as painted, no grain", settings: { stamp: true }, tip: 'rampX', grain: 'flat' },
    { reads: 'a hard round stamp at full flow: the reference every stamp probe is sized by, and the calibration taps', settings: { stamp: true }, tip: 'disk', grain: 'flat', calibration: true },
    ...GRAIN_BLEND_PROBES.map(([mode, label]) => ({ reads: `grain blend ${mode} (${label}): paint against a(x) and g(y)`, ...stampReadout({ grainBlendMode: mode }) })),
    ...[-1, -0.5, 0.5, 1].map((b) => ({ reads: `grain brightness ${b} under multiply`, ...stampReadout({ textureBrightness: b }) })),
    ...[-1, -0.5, 0.5, 1].map((c) => ({ reads: `grain contrast ${c} under multiply`, ...stampReadout({ textureContrast: c }) })),
    ...[0.25, 0.5, 0.75].map((d) => ({ reads: `grain depth ${d} under multiply`, ...stampReadout({ grainDepth: d }) })),
    ...[0.5].map((d) => ({ reads: `grain depth ${d} under height`, ...stampReadout({ grainDepth: d, grainBlendMode: 27 }) })),
    { reads: 'grain inverted under multiply: which way round a grain reads', ...stampReadout({ textureInverted: true }) },
    ...[0.25, 1].map((s) => ({ reads: `moving grain at scale ${s}: its period against the stamp`, ...stampReadout({ textureScale: s }) })),
    ...[0.25, 1].map((s) => ({ reads: `texturized grain at scale ${s}: its period along a stroke`, ...strokeReadout({ grainDepth: 1, textureApplication: 1, textureScale: s, dynamicsGlazedFlow: 1 }), grain: 'sawX' as const })),
    ...DUAL_BLEND_PROBES.map(([mode, label]) => ({
      reads: `dual combine ${mode} (${label}): paint against the main tip's a(x) and the dual's d(y)`,
      settings: { stamp: true, dualBlendMode: mode }, tip: 'rampX' as const, grain: 'flat' as const, dual: { settings: { stamp: true }, tip: 'rampY' as const },
    })),
    ...DUAL_SHAPE_PROBES.map(([mode, label]) => ({
      reads: `dual combine ${mode} (${label}) on crossed bars: each tip alone on its arms, both where they cross, as a stamp and along a stroke`,
      settings: { dualBlendMode: mode, dynamicsGlazedFlow: 0.5 }, tip: 'barV' as const, grain: 'flat' as const, dual: { settings: { dynamicsGlazedFlow: 0.5 }, tip: 'barH' as const },
      diameter: 256, marks: marks('tap', 'line'),
    })),
    ...RENDERING_PROBES.map(([recursive, modulated, max]) => ({
      reads: `rendering flags recursive ${recursive}, modulated ${modulated}, max ${max}: build-up within a half-flow stroke (line, self-crossing) and between two strokes`,
      ...strokeReadout({ renderingRecursiveMixing: recursive, renderingModulatedTransfer: modulated, renderingMaxTransfer: max }),
      marks: marks('line', 'selfCross', 'twoCross'),
    })),
    ...[0.02, 0.1, 0.3].flatMap((spacing) => [0.25, 0.5, 1].map((flow) => ({
      reads: `spacing ${spacing} × flow ${flow} in Light Glaze: how stamps build along a stroke`,
      ...strokeReadout({ plotSpacing: spacing, dynamicsGlazedFlow: flow }), marks: marks('line', 'twoCross'),
    }))),
    {
      reads: 'half-flow strokes of neutrals and two hues over clear, black, grey and white: the compositing space and precision',
      ...strokeReadout({}), marks: GROUND_COLORS.flatMap((color) => GROUNDS.map((ground) => ({ mark: 'twoCross' as const, ground, color }))),
    },
    ...[0.25, 0.5, 0.75, 1].map((w) => ({ reads: `wet edges ${w} in Light Glaze: the rim on a stamp and along a stroke`, ...strokeReadout({ wetEdgesAmount: w, dynamicsGlazedFlow: 1 }), marks: marks('tap', 'line') })),
    { reads: 'wet edges 1 in a blending mode', ...strokeReadout({ wetEdgesAmount: 1, dynamicsGlazedFlow: 1, renderingRecursiveMixing: true }), marks: marks('tap', 'line') },
    ...[0.25, 0.5, 0.75, 1].map((b) => ({ reads: `burnt edges ${b}, colour burn: on a stamp and along a stroke, over clear and grey`, ...strokeReadout({ burntEdgesAmount: b, dynamicsGlazedFlow: 1 }), marks: marks('tap', 'line', { mark: 'line', ground: 'grey' }) })),
    { reads: 'max opacity 0.5: whether it scales paint or only the slider', ...strokeReadout({ dynamicsGlazedFlow: 1, maxOpacity: 0.5 }), marks: marks('line', 'twoCross') },
    { reads: "pressure to size 1: a finger's constant pressure, read as a size", ...strokeReadout({ dynamicsGlazedFlow: 1, dynamicsPressureSize: 1 }) },
    { reads: "pressure to opacity 1: a finger's pressure, read as opacity", ...strokeReadout({ dynamicsGlazedFlow: 1, dynamicsPressureOpacity: 1 }) },
    ...[0.5, 1].map((b) => ({ reads: `wet mix blur ${b}: whether it blurs a stamp that mixes nothing`, ...strokeReadout({ dynamicsGlazedFlow: 1, dynamicsBlur: b }) })),
    ...[0.25, 1].map((t) => ({ reads: `touch taper ${t} at both ends, size and opacity to nothing`, ...strokeReadout({ dynamicsGlazedFlow: 1, taperStartLength: t, taperEndLength: t, taperSize: 1, taperOpacity: 1 }) })),
    { reads: 'the flag tip as one stamp, unturned: the reference the rotation probes are read against', settings: { stamp: true }, tip: 'flag', grain: 'flat', diameter: 256 },
    { reads: 'randomised start on a flag: whether a stroke turns it', ...strokeReadout({ dynamicsGlazedFlow: 1, shapeRandomise: true, plotSpacing: 0.4 }, 'flag'), diameter: 160, marks: marks('line', 'selfCross') },
    { reads: 'shape scatter 0.5 on a flag: how far each stamp turns', ...strokeReadout({ dynamicsGlazedFlow: 1, shapeScatter: 0.5, plotSpacing: 0.4 }, 'flag'), diameter: 160, marks: marks('line', 'selfCross') },
    { reads: 'shape rotation 1 (follow stroke) on a flag', ...strokeReadout({ dynamicsGlazedFlow: 1, shapeRotation: 1, plotSpacing: 0.4 }, 'flag'), diameter: 160, marks: marks('line', 'selfCross') },
    { reads: 'shape rotation 0 on a flag along a self-crossing stroke: whether a finger turns it at all', ...strokeReadout({ dynamicsGlazedFlow: 1, plotSpacing: 0.4 }, 'flag'), diameter: 160, marks: marks('line', 'selfCross') },
    ...[[0.5, 1, 0], [1, 1, 0], [0.5, 0.5, 0.5]].map(([dilution, charge, pull]) => ({
      reads: `wet mix, dilution ${dilution}, charge ${charge}, pull ${pull} (dynamicsMix, dynamicsLoad, dynamicsBlur) in a blending mode: blue pulled across a red stripe (vid-90)`,
      ...strokeReadout({ dynamicsGlazedFlow: 1, renderingRecursiveMixing: true, dynamicsMix: dilution, dynamicsLoad: charge, dynamicsBlur: pull }),
      diameter: 128, marks: marks({ mark: 'longLine', ground: 'stripe', color: '#1e50c8' }),
    })),
    ...bridges.map((brush) => ({ reads: `${brush}, the pack's own brush, along the preview's stroke: the bridge to its thumbnail`, settings: {}, tip: 'flat' as const, grain: 'flat' as const, bridge: { brush }, marks: marks('sCurve') })),
  ];
  return list.map(({ diameter = STAMP_DIAMETER, marks: probeMarks = marks('tap'), ...probe }, i) => ({ name: `Probe ${String(i + 1).padStart(2, '0')}`, ...probe, diameter, marks: probeMarks }));
}
