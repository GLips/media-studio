// stamp-pigment-reference.ts: a painting in pigment worked out on the CPU, the reference the GPU's pigment compositor
// (stamp-paint-pigment-compositor.ts) is held to by `stamp:reference pigment`. Each deposit's coverage is the coverage
// reference's (stamp-reference-deposit.ts); laying it into its wash and drying the wash are stamp-pigment-paint.ts's
// CPU twins. And a small fixture painting that exercises them: mixtures, a colour, wet mixing, glazes, an opaque group,
// a graded fill, masking fluid, a pass within a region and a granulating paper, its tip and grain drawn here so it needs
// no pack.
//
// Negative space: the coverage reference has no wet or burnt rims, clips or tints, so a painting with any is refused
// rather than drawn wrong.

import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import { linearToSrgb, paintBandsToLinearRgb, PAINT_BANDS, type PaintBands } from '#lib/picture/paint/models/paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/picture/paint/models/paint-watercolour-pigments.ts';
import { bindStampBrushImages, stampLinearDynamics, type StampBrush, type StampBrushImageSource } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint, type PaintMaterial, type StampPaintColor, type StampPaintPaper } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { stampDepositKeepAt } from '#lib/picture/stamp-paint/models/stamp-deposit-keep.ts';
import { compileStampPigmentPaint, stampPigmentDryGroup, stampPigmentLayDeposit, stampPigmentPaper, type StampPigmentMixing } from '#lib/picture/stamp-paint/models/stamp-pigment-paint.ts';
import { renderStampReferenceDeposit } from './stamp-reference-deposit.ts';
import { sampleStampReference, stampReferenceMips, type StampReferenceMips } from './stamp-reference-image.ts';

/** A grey image as a pack holds one: `size` texels square, a byte each, dark is paint. */
export type StampPigmentFixtureImage = { size: number; pixels: Uint8Array };

export type StampPigmentReferenceInput = {
  painting: CompiledStampPaint;
  mixing: StampPigmentMixing;
  paper: StampPaintPaper;
  width: number;
  height: number;
  /** Each image the painting and its paper name, as mips. */
  mips: (source: StampBrushImageSource) => StampReferenceMips;
  bands?: PaintBands;
};

/** Why the CPU can't paint `painting` in pigment, or null. */
function unpaintable(painting: CompiledStampPaint, paper: StampPaintPaper): string | null {
  if (paper.image) return 'its paper is a photograph';
  for (const group of painting.groups) {
    for (const pass of group.passes) {
      if (pass.clipTo) return `${pass.id} is clipped`;
      for (const deposit of pass.deposits) {
        const { brush } = deposit;
        if (brush.color) return `${deposit.id}'s brush tints its stamps`;
        if (brush.wetEdges || brush.burntEdge || brush.dual?.wetEdges || brush.dual?.burntEdge) return `${deposit.id}'s brush has blurred rims`;
      }
    }
  }
  return null;
}

/** The output pass's ordered dither at a pixel, in levels of a byte (stamp-paint-renderer.ts's). */
const dither = (x: number, y: number) => {
  const d = x * 0.7548776662 + y * 0.569840291;
  return d - Math.floor(d) - 0.5;
};

/** `input.painting` in pigment, as the GPU would show it: gamma-encoded RGB bytes, row by row. Throws on what the CPU can't paint. */
export function renderStampPigmentReference(input: StampPigmentReferenceInput): Uint8ClampedArray {
  const { painting, mixing, paper, width, height, mips } = input;
  const { medium } = mixing;
  const bands = input.bands ?? PAINT_BANDS;
  const problem = unpaintable(painting, paper);
  if (problem) throw new Error(`stamp pigment reference: can't paint this painting: ${problem}`);
  const paint = compileStampPigmentPaint(painting, mixing, bands);
  const paperColor = [1, 3, 5].map((i) => parseInt(paper.color.slice(i, i + 2), 16) / 255);
  const bare = stampPigmentPaper(bands, paper.color, paperColor);

  // The paper's tooth at each pixel, as the deposit pass reads it: its paint (mips hold paint) and its mean paint.
  const grain = paper.grain;
  const toothMips = grain && mips(grain.image);
  const tileW = grain ? grain.scale * width : 1, tileH = toothMips ? tileW * (toothMips[0].height / toothMips[0].width) : 1;
  const lod = toothMips ? Math.max(0, Math.log2(toothMips[0].width / tileW)) : 0;
  const meanTooth = toothMips ? sampleStampReference(toothMips, 0.5, 0.5, 16, 'tile') : 0.5;
  const toothAt = (x: number, y: number) => (toothMips ? sampleStampReference(toothMips, (x + 0.5) / tileW, (y + 0.5) / tileH, lod, 'mirror') : 0.5);

  const reflectance = new Float64Array(width * height * bands.count);
  for (let i = 0; i < width * height; i++) reflectance.set(bare, i * bands.count);
  const box = { x: 0, y: 0, width, height };
  painting.groups.forEach((group, g) => {
    const channels = paint.groups[g].palette.length + 1;
    const layer = new Float64Array(width * height * channels);
    for (const [pass, deposit] of group.passes.flatMap((p) => p.deposits.map((d) => [p, d] as const))) {
      // The finished painting, every fill's front across it, as the GPU page draws it.
      const { coverage } = renderStampReferenceDeposit({
        brush: bindStampBrushImages(deposit.brush, deposit.diameter, mips), stamps: deposit.stamps, dualStamps: deposit.dualStamps,
        diameter: deposit.diameter, opacity: deposit.opacity, grainOffset: deposit.grainOffset, box,
        ...(deposit.kind === 'wash' && { wash: deposit.wash }),
        keep: (x, y) => stampDepositKeepAt(deposit, pass.within, Number.MAX_VALUE, x, y),
      });
      const components = paint.deposits.get(deposit)!;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (coverage[i] <= 0) continue;
          const pixel = layer.subarray(i * channels, (i + 1) * channels);
          stampPigmentLayDeposit(pixel, components, medium, coverage[i], { tooth: toothAt(x, y), mean: meanTooth, depth: grain?.depth ?? 0 }, x + 0.5, y + 0.5);
        }
      }
    }
    for (let i = 0; i < width * height; i++) {
      stampPigmentDryGroup(reflectance.subarray(i * bands.count, (i + 1) * bands.count), layer.subarray(i * channels, (i + 1) * channels), paint.groups[g], medium, group.composite, group.opacity, bare);
    }
  });

  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const linear = paintBandsToLinearRgb(bands, reflectance.subarray(i * bands.count, (i + 1) * bands.count));
    const d = dither(i % width, Math.floor(i / width)) / 255;
    linear.forEach((v, c) => {
      rgb[i * 3 + c] = Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v))) + d)) * 255);
    });
  }
  return rgb;
}

/** A texel hash to 0..1, for drawing the fixture's paper. */
const hashed = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

const fixtureAsset = (file: string) => ({ style: 'fixture', pack: 'fixture', file });
const colorMaterial = (color: StampPaintColor) => ({ kind: 'color', color } as const);

/** The media the fixture paints in: a wet glaze, a body colour lightened with white, and a dry one. */
export const STAMP_PIGMENT_FIXTURE_MEDIA = ['watercolour', 'gouache', 'crayon'] as const satisfies readonly (keyof typeof PAINT_MEDIA)[];

/**
 * The fixture: a painting in `medium` at 320 × 260 on a toothed paper, its tip and grain as images. Its last group
 * mixes twelve pigments, a full wash, so every layer of a group's state is laid and read.
 */
export function stampPigmentFixture(mediumName: (typeof STAMP_PIGMENT_FIXTURE_MEDIA)[number]) {
  const width = 320, height = 260, tipSize = 64, grainSize = 64;
  const tip: StampPigmentFixtureImage = {
    size: tipSize,
    pixels: Uint8Array.from({ length: tipSize * tipSize }, (_, i) => {
      const r = Math.hypot((i % tipSize) + 0.5 - tipSize / 2, Math.floor(i / tipSize) + 0.5 - tipSize / 2) / (tipSize / 2);
      const t = Math.min(1, Math.max(0, (1 - r) / 0.35));
      return Math.round(255 * (1 - t * t * (3 - 2 * t)));
    }),
  };
  // Blocky value noise, a few texels a cell, so a mip or two still holds tooth.
  const grain: StampPigmentFixtureImage = {
    size: grainSize,
    pixels: Uint8Array.from({ length: grainSize * grainSize }, (_, i) => Math.round(255 * (0.25 + 0.5 * hashed((i % grainSize) >> 2, Math.floor(i / grainSize) >> 2)))),
  };
  const brush: StampBrush = {
    name: 'Fixture Round', blend: 'normal', accumulation: { kind: 'buildToOpacity' },
    tip: { image: fixtureAsset('tip.png'), roundness: 1, sampling: 'isotropic' },
    spacing: 0.1, stepping: 'eachStamp', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
    rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
    taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 0.5,
  };
  const paper: StampPaintPaper = { color: '#f6f1e6', grain: { image: fixtureAsset('grain.png'), scale: 0.15, depth: 0.5 } };
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    // A granulating sky, graded down to the horizon, round a sun reserved with masking fluid.
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => {
      g.mask('sun', { region: { kind: 'ellipse', x: 250, y: 45, radiusX: 22, radiusY: 22 }, edge: { soft: 3 } });
      g.pass('wash', {}, (pass) => pass.fill('granulating', {
        brush, diameter: 40, application: { kind: 'wash' }, region: { kind: 'polygon', points: [{ x: 10, y: 10 }, { x: 310, y: 10 }, { x: 310, y: 95 }, { x: 10, y: 95 }] },
        material: { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 0.3 }], strength: 0.9 },
        load: { kind: 'linear', from: { x: 0, y: 10, value: 1 }, to: { x: 0, y: 95, value: 0.3 } },
      }));
    });
    p.group('field', { composite: 'glaze', opacity: 0.9 }, (g) => g.pass('wet', {}, (pass) => {
      pass.stroke('green', { brush, diameter: 60, material: { kind: 'mixture', parts: [{ pigment: W.phthaloBlue, amount: 1 }, { pigment: W.hansaYellow, amount: 2 }], strength: 1 }, path: [{ x: 20, y: 140 }, { x: 300, y: 120 }] });
      pass.stroke('rose', { brush, diameter: 40, material: colorMaterial('#c8305f'), path: [{ x: 60, y: 190 }, { x: 250, y: 30 }] });
    }));
    p.group('patch', { composite: 'opaque' }, (g) => g.pass('cover', { within: { kind: 'ellipse', x: 260, y: 162, radiusX: 34, radiusY: 16 } }, (pass) => {
      pass.stroke('cerulean', { brush, diameter: 50, material: { kind: 'mixture', parts: [{ pigment: W.cerulean, amount: 1 }], strength: 0.7 }, path: [{ x: 230, y: 150 }, { x: 290, y: 175 }] });
    }));
    // Each pigment at full strength, so no white joins them, and two colours: overlapping swatches, mixing wet.
    const swatches = [...Object.values(W).map((pigment): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment, amount: 1 }], strength: 1 })), colorMaterial('#3a7d44'), colorMaterial('#d98c2b')];
    p.group('palette', { composite: 'glaze', opacity: 0.8 }, (g) => g.pass('swatches', {}, (pass) => swatches.forEach((material, k) => {
      pass.stroke(`swatch-${k}`, { brush, diameter: 30, material, path: [{ x: 20 + k * 25, y: 212 }, { x: 34 + k * 25, y: 250 }] });
    })));
  }));
  const mixing: StampPigmentMixing = { kind: 'pigment', medium: PAINT_MEDIA[mediumName], pigments: W };
  return { painting, paper, mixing, width, height, tip, grain };
}

const fixtureImageMips = (image: StampPigmentFixtureImage) => stampReferenceMips({ width: image.size, height: image.size, paint: Float32Array.from(image.pixels, (v) => 1 - v / 255) });

/** The fixture's images as the CPU reference reads them, by file. */
export function stampPigmentFixtureMips(fixture: ReturnType<typeof stampPigmentFixture>): (source: StampBrushImageSource) => StampReferenceMips {
  const tip = fixtureImageMips(fixture.tip), grain = fixtureImageMips(fixture.grain);
  return (source) => ('file' in source && source.file === 'grain.png' ? grain : tip);
}
