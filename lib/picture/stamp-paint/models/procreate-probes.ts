// procreate-probes.ts: the probe brushes, a Procreate brush set built to read Procreate's renderer out by experiment
// (vid-89). Nothing published documents how Procreate paints (its grain and combine blends, rendering modes, wet and
// burnt edges, flow and pressure), so each probe starts from one plain brush and changes one setting, and Procreate's
// own preview of it is the readout. Round-tripped through Procreate (docs/procreate-probes.md), the set imports as a
// pack like any other, and the brush fidelity sheet and `studio brushes fit` compare the studio's painting of each
// probe with Procreate's.
//
// Most readouts are one stamp (`stamp: true` previews a brush as a single stamp): a tip that ramps from no paint at its
// left to full paint at its right, over a grain that saws from none to full down its height, draws a grain blend's
// whole transfer, a(x) against g(y), in one image. Strokes read what only a stroke shows: overlap within a stroke, rims,
// taper, pressure.
//
// Images are drawn as Procreate reads them, white is paint, and neither is inverted.

/** A probe's image, `size` pixels square, one byte per pixel, row by row. */
export type ProcreateProbeImage = 'disk' | 'flat' | 'rampX' | 'rampY' | 'sawY' | 'sawX' | 'strip';

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
        // A bar a sixth as wide as it's tall: which way a stamp is turned shows at a glance.
        case 'strip': value = Math.abs(u - 0.5) < 1 / 12 && Math.abs(v - 0.5) < 0.45 ? 1 : 0; break;
      }
      pixels[y * size + x] = Math.round(value * 255);
    }
  }
  return pixels;
}

/** Brush.archive settings by Procreate's names. */
export type ProcreateProbeSettings = Readonly<Record<string, number | boolean>>;

export type ProcreateProbe = {
  /** Its name in the set, numbered so the library lists them in order. */
  name: string;
  /** What its preview reads out. */
  reads: string;
  settings: ProcreateProbeSettings;
  tip: ProcreateProbeImage;
  grain: ProcreateProbeImage;
  /** A dual brush: its own settings over the plain base, and its tip. */
  dual?: { settings: ProcreateProbeSettings; tip: ProcreateProbeImage };
};

/**
 * The plain brush every probe starts from: a hard round tip, no grain, full flow, no dynamics, no taper, pressure
 * moving nothing, Light Glaze, no edges. Every setting the importer reads is here, so no probe inherits one from the
 * template brush it's written over.
 */
export const PROCREATE_PROBE_BASE: ProcreateProbeSettings = {
  stamp: false, blendMode: 0, extendedBlend: 0, shapeInverted: false, textureInverted: false, shapeRoundness: 1,
  plotSpacing: 0.05, plotJitter: 0, shapeScatter: 0, shapeRotation: 0, shapeAngle: 0, shapeRandomise: false, shapeCount: 1 / 16, shapeCountJitter: 0,
  shapeFlipXJitter: false, shapeFlipYJitter: false, shapeAzimuth: false,
  pencilTaperStartLength: 0, pencilTaperEndLength: 0, pencilTaperSize: 0, pencilTaperOpacity: 0, pencilTaperShape: 0, taperPressure: 0,
  dynamicsFalloff: 0, dynamicsGlazedFlow: 1, maxOpacity: 1, dynamicsBlur: 0, dynamicsBlurJitter: 0,
  dynamicsJitterSize: 0, dynamicsJitterOpacity: 0, dynamicsWetnessJitter: 0,
  dynamicsPressureSize: 0, dynamicsPressureOpacity: 0, dynamicsPressureOpacityTransfer: 0, dynamicsPressureBleed: 0,
  dynamicsSpeedSize: 0, dynamicsSpeedOpacity: 0, dynamicsTiltOpacity: 0, dynamicsTiltSize: 0, dynamicsTiltBleed: 0, dynamicsTiltGradation: 0, dynamicsTiltShapeRoundness: 0,
  renderingRecursiveMixing: false, renderingModulatedTransfer: false, renderingMaxTransfer: false,
  dynamicsMix: 0, dynamicsPressureMix: 0, dynamicsWetAccumulation: 0, dynamicsLoad: 1,
  wetEdgesAmount: 0, burntEdgesAmount: 0, burntEdgesBlendMode: 10, dualBlendMode: 1,
  grainBlendMode: 1, grainDepth: 0, grainDepthJitter: 0, grainDepthMinimum: 0, textureApplication: 1, textureScale: 0.5,
  textureBrightness: 0, textureContrast: 0, textureOffsetJitter: false, textureZoom: 0, textureMovement: 1, textureRotation: 0, textureDepthTilt: 0,
  dynamicsJitterHue: 0, dynamicsJitterSaturation: 0, dynamicsJitterLightness: 0, dynamicsJitterDarkness: 0,
  dynamicsJitterStrokeHue: 0, dynamicsJitterStrokeSaturation: 0, dynamicsJitterStrokeLightness: 0, dynamicsJitterStrokeDarkness: 0,
  dynamicsPressureHue: 0, dynamicsPressureSaturation: 0, dynamicsPressureBrightness: 0, dynamicsPressureSecondaryColor: 0,
};

/** Grain blends by the number Procreate stores (grainBlendMode), each one the importer reads. */
const GRAIN_BLEND_PROBES = [[1, 'multiply'], [4, 'lighten'], [7, 'subtract'], [8, 'linear burn'], [9, 'colour dodge'], [10, 'colour burn'], [19, 'darken'], [20, 'hard mix'], [26, 'divide'], [27, 'height'], [28, 'linear height']] as const;
/** Dual combine modes by the number Procreate stores (dualBlendMode). */
const DUAL_BLEND_PROBES = [[0, 'normal'], [1, 'multiply'], [2, 'screen'], [4, 'lighten'], [6, 'difference?'], [10, 'colour burn'], [11, 'overlay'], [19, 'darken'], [28, 'linear height']] as const;
/** Rendering modes as the three flags Procreate stores them: recursive mixing, modulated transfer, max transfer. */
const RENDERING_PROBES = [[false, false, false], [false, false, true], [false, true, false], [false, true, true], [true, false, false], [true, true, false]] as const;

/** A single-stamp readout: the tip ramps a(x), the grain saws g(y), at full depth. */
const stampReadout = (settings: ProcreateProbeSettings): Pick<ProcreateProbe, 'settings' | 'tip' | 'grain'> => ({
  settings: { stamp: true, grainDepth: 1, textureApplication: 0, textureZoom: 0, textureMovement: 1, textureScale: 1, ...settings }, tip: 'rampX', grain: 'sawY',
});
/** A stroke of the hard round tip, at half flow so overlap within the stroke shows. */
const strokeReadout = (settings: ProcreateProbeSettings, tip: ProcreateProbeImage = 'disk'): Pick<ProcreateProbe, 'settings' | 'tip' | 'grain'> => ({
  settings: { dynamicsGlazedFlow: 0.5, ...settings }, tip, grain: 'flat',
});

/** Every probe, in order. */
export function procreateProbes(): ProcreateProbe[] {
  const list: Omit<ProcreateProbe, 'name'>[] = [
    { reads: "the tip's own transfer: its ramp as painted, no grain", settings: { stamp: true }, tip: 'rampX', grain: 'flat' },
    { reads: 'a hard round stamp at full flow: the reference every stamp probe is sized by', settings: { stamp: true }, tip: 'disk', grain: 'flat' },
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
    ...RENDERING_PROBES.map(([recursive, modulated, max]) => ({
      reads: `rendering flags recursive ${recursive}, modulated ${modulated}, max ${max}: overlap within a half-flow stroke`,
      ...strokeReadout({ renderingRecursiveMixing: recursive, renderingModulatedTransfer: modulated, renderingMaxTransfer: max }),
    })),
    ...[0.25, 0.5, 1].map((w) => ({ reads: `wet edges ${w} in Light Glaze`, ...strokeReadout({ wetEdgesAmount: w, dynamicsGlazedFlow: 1 }) })),
    { reads: 'wet edges 1 in a blending mode', ...strokeReadout({ wetEdgesAmount: 1, dynamicsGlazedFlow: 1, renderingRecursiveMixing: true }) },
    ...[0.5, 1].map((b) => ({ reads: `burnt edges ${b}, colour burn`, ...strokeReadout({ burntEdgesAmount: b, dynamicsGlazedFlow: 1 }) })),
    ...[0.25, 0.5, 0.75].map((f) => ({ reads: `flow ${f} in Light Glaze: a stroke's density against its flow`, ...strokeReadout({ dynamicsGlazedFlow: f }) })),
    { reads: 'max opacity 0.5: whether it scales paint or only the slider', ...strokeReadout({ dynamicsGlazedFlow: 1, maxOpacity: 0.5 }) },
    { reads: 'pressure to size 1: the preview stroke\'s pressure along it', ...strokeReadout({ dynamicsGlazedFlow: 1, dynamicsPressureSize: 1 }) },
    { reads: 'pressure to opacity 1', ...strokeReadout({ dynamicsGlazedFlow: 1, dynamicsPressureOpacity: 1 }) },
    { reads: 'pressure to flow 1', ...strokeReadout({ dynamicsGlazedFlow: 1, dynamicsPressureOpacityTransfer: 1 }) },
    ...[0.5, 1].map((b) => ({ reads: `wet mix blur ${b}: whether it blurs a stamp that mixes nothing`, ...strokeReadout({ dynamicsGlazedFlow: 1, dynamicsBlur: b }) })),
    ...[0.25, 1].map((t) => ({ reads: `taper ${t} at both ends, size and opacity to nothing`, ...strokeReadout({ dynamicsGlazedFlow: 1, pencilTaperStartLength: t, pencilTaperEndLength: t, pencilTaperSize: 1, pencilTaperOpacity: 1 }) })),
    { reads: 'randomised start on a strip: whether the preview turns it', ...strokeReadout({ dynamicsGlazedFlow: 1, shapeRandomise: true, plotSpacing: 0.3 }, 'strip') },
    { reads: 'shape scatter 0.5 on a strip: how far each stamp turns', ...strokeReadout({ dynamicsGlazedFlow: 1, shapeScatter: 0.5, plotSpacing: 0.3 }, 'strip') },
    { reads: 'shape rotation 1 (follow stroke) on a strip', ...strokeReadout({ dynamicsGlazedFlow: 1, shapeRotation: 1, plotSpacing: 0.3 }, 'strip') },
  ];
  return list.map((probe, i) => ({ name: `Probe ${String(i + 1).padStart(2, '0')}`, ...probe }));
}
