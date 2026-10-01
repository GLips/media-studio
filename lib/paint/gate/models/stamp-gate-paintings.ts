// stamp-gate-paintings.ts: the paintings the GPU gate paints and holds to their accepted frames. Each is small and
// synthetic: its brushes are written here and its images drawn here, so it needs no pack and can be public. Between
// them they walk every path the renderer takes: each accumulation and grain and how it's laid, both dual plans,
// pooling, rims, tints, blends, groups, clips, paper, masks, `within`, floods, strokes fills, and the pigment
// compositor in three media.
//
// Negative space: no pack's brush is painted here. A pack's brushes are private; the gate's private run
// (stamp-gate-private.ts) paints them into ignored baselines under work/.

import { PAINT_MEDIA, paintMediumCan } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { PHOTOSHOP_POOLING } from '#lib/paint/brush/models/coverage-formulas.ts';
import { stampLinearDynamics, type StampBrush, type StampBrushAsset, type StampBrushGrain, type StampBrushLayer, type StampGrainLook } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintEnvironment, StampPaintPaper, StampPassageOptions } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { PaintMaterial, StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampRegion } from '#lib/paint/painting/models/stamp-region.ts';

/** A grey image as a pack holds one: `size` texels square, a byte each, dark is paint. */
export type StampGateImage = { size: number; pixels: Uint8Array };

/** A painting the gate paints, its paper and mixing its own: drawn at `t` seconds, its images by file, each frame in the state `frameAt` gives it. */
export type StampGatePainting = {
  painting: CompiledStampPaint;
  width: number;
  height: number;
  t: number;
  images: Readonly<Record<string, StampGateImage>>;
  frameAt?: (t: number) => StampPaintFrameState;
};

export const stampGateAsset = (file: string): StampBrushAsset => ({ style: 'gate', pack: 'gate', file });
const color = (value: StampPaintColor): PaintMaterial => ({ kind: 'color', color: value });
export const stampGatePolygon = (...xy: number[]): StampRegion => ({ kind: 'polygon', points: xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1] }])) });

/** A texel hash to 0..1. */
const hashed = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** The height of grain.png's paper at texel (x, y), 0..1, as a paper reads it: its brightness, so the ink drawn is its depth. */
export const stampGateGrainHeight = (x: number, y: number) => 0.25 + 0.5 * hashed(x >> 2, y >> 2);

const drawn = (size: number, paint: (u: number, v: number, x: number, y: number) => number): StampGateImage => ({
  size, pixels: Uint8Array.from({ length: size * size }, (_, i) => {
    const x = i % size, y = Math.floor(i / size);
    return Math.round(255 * (1 - Math.min(1, Math.max(0, paint((x + 0.5) / size, (y + 0.5) / size, x, y)))));
  }),
});
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Every image the paintings name. */
export const STAMP_GATE_IMAGES = {
  // A soft round, and a hard, lopsided one whose turns and flips show.
  'round.png': drawn(64, (u, v) => smoothstep(Math.min(1, Math.max(0, (1 - Math.hypot(u - 0.5, v - 0.5) * 2) / 0.35)))),
  'chisel.png': drawn(64, (u, v) => (Math.abs(u - 0.5) < 0.42 && Math.abs(v - 0.5) < 0.2 + 0.2 * u ? 0.6 + 0.4 * u : 0)),
  // Blocky value noise, a few texels a cell, so a mip or two still holds tooth; and a smooth ridged relief.
  'grain.png': drawn(64, (_u, _v, x, y) => 1 - stampGateGrainHeight(x, y)),
  'relief.png': drawn(64, (u, v) => 0.5 + 0.5 * Math.sin(u * Math.PI * 6) * Math.cos(v * Math.PI * 4)),
  // A tip's contacts: its middle touches first, its edge last.
  'contact.png': drawn(64, (u, v) => 1 - Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2)),
  // A paper photograph: warm light falling across a mottled sheet.
  'photograph.png': drawn(128, (u, v, x, y) => 0.15 + 0.2 * u + 0.1 * v + 0.15 * hashed(x >> 3, y >> 3)),
} satisfies Record<string, StampGateImage>;

const ROUND: StampBrushLayer = {
  accumulation: { kind: 'buildToOpacity' },
  tip: { image: stampGateAsset('round.png'), roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'eachStamp', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 0.5,
};
export const stampGateBrush = (name: string, layer: Partial<StampBrush> = {}): StampBrush => ({ ...ROUND, name, blend: 'normal', ...layer });

/** A canvas grain of `image`; spread with a rolling grain's settings, a rolling one. */
const grain = (image: string, look: Partial<StampGrainLook> & Pick<StampGrainLook, 'blend'>): StampBrushGrain => ({
  kind: 'canvas', image: stampGateAsset(image), scale: 1.5, depth: 0.8, brightness: 0, contrast: 0, contrastPivot: 'midGrey', tiling: 'repeat', offsetJitter: 0, ...look,
});

/** A wavering line across the painting from `x0, y` to `x1, y`, its pressure rising then falling. */
const line = (x0: number, x1: number, y: number, wave = 8) => Array.from({ length: 9 }, (_, i) => ({
  x: x0 + ((x1 - x0) * i) / 8, y: y + wave * Math.sin(i * 0.9), pressure: 0.3 + 0.7 * Math.sin((i / 8) * Math.PI),
}));

export const STAMP_GATE_WHITE: StampPaintPaper = { color: '#ffffff' };
const WHITE_FLAT: StampPaintEnvironment = { paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' } };

/** Grains: a rolling texture grain, a canvas height relief under a noisy squashed tip, a Procreate relief, a pressed tip, bristles. */
function strokesGrains(): StampGatePainting {
  const rolling = stampGateBrush('Rolling', {
    grain: { ...grain('grain.png', { blend: { family: 'texture', mode: 'multiply' } }), kind: 'rolling', zoom: 1, movement: 0.5, rotation: 1 },
    dynamics: stampLinearDynamics({ size: { pressure: 0.6 }, grainDepth: { pressure: 0.5 } }),
  });
  const relief = stampGateBrush('Relief', {
    tip: { image: stampGateAsset('chisel.png'), roundness: 0.5, sampling: 'anisotropic', noise: 0.4 },
    grain: grain('relief.png', { blend: { family: 'texture', mode: 'height' }, depth: 0.4 }),
    dynamics: stampLinearDynamics({ rotation: { direction: 1 } }), flip: { x: true, y: false }, spacing: 0.15,
  });
  const procreate = stampGateBrush('Procreate relief', {
    accumulation: { kind: 'glaze', build: 0.5 },
    grain: grain('grain.png', { blend: { family: 'layer', mode: 'linearHeight' }, contrastPivot: 'mean', contrast: 0.4, brightness: -0.1, tiling: 'mirror', scale: 0.8 }),
  });
  const pressed = stampGateBrush('Pressed', {
    tip: { image: stampGateAsset('round.png'), roundness: 1, sampling: 'isotropic', pressed: { contact: stampGateAsset('contact.png'), range: [0, 1], softness: 0.16 } },
    flow: 0.8,
  });
  const bristles = stampGateBrush('Bristles', {
    tip: { roundness: 1, sampling: 'isotropic', bristles: {
      along: 0.3, across: 1, radius: { pixels: 1, diameters: 0.03 }, rise: 0.4, softness: 0.2,
      bristles: Array.from({ length: 9 }, (_, k) => [hashed(k, 1) * 2 - 1, (k / 4 - 1) * 0.9, 0.2 + 0.8 * hashed(k, 2)] as const),
    } },
    dynamics: stampLinearDynamics({ rotation: { direction: 1 } }), flow: 0.7,
  });
  const painting = compileStampPaintRecipe(stampPaintRecipe(WHITE_FLAT, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => {
    pass.stroke('rolling', { brush: rolling, size: 36, well: { paint: color('#2a4d8f') }, path: line(20, 300, 30) });
    pass.stroke('relief', { brush: relief, size: 40, well: { paint: color('#8f2a4d') }, path: line(20, 300, 75) });
    pass.stroke('procreate', { brush: procreate, size: 36, well: { paint: color('#2a8f4d') }, path: line(20, 300, 120) });
    pass.stroke('pressed', { brush: pressed, size: 34, well: { paint: color('#6a3a1a') }, path: line(20, 300, 165) });
    pass.stroke('bristles', { brush: bristles, size: 40, well: { paint: color('#1a1a1a') }, path: line(20, 300, 210, 20) });
  }))));
  return { painting, width: 320, height: 240, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** A texture dual, its own grain rolling, both layers pooling: resolved grain, dual, pooling. */
const DUAL_TEXTURE = stampGateBrush('Dual texture', {
  wetEdges: PHOTOSHOP_POOLING,
  dual: {
    ...ROUND, tip: { image: stampGateAsset('chisel.png'), roundness: 1, sampling: 'isotropic' }, spacing: 0.3,
    scatter: { count: 2, radius: 0.4, lateral: 0 }, grain: { ...grain('grain.png', { blend: { family: 'texture', mode: 'multiply' } }), kind: 'rolling', zoom: 0, movement: 1, rotation: 0 },
    wetEdges: { kind: 'pooling', peak: 1, body: 0.5 }, blend: { family: 'texture', mode: 'colorBurn' }, scale: 0.5,
  },
});
/** A Procreate relief dual, which shapes the stamps' paint before the grain: resolved dual, grain, pooling. */
const DUAL_RELIEF = stampGateBrush('Dual relief', {
  grain: grain('grain.png', { blend: { family: 'texture', mode: 'multiply' }, depth: 0.5 }),
  dual: { ...ROUND, accumulation: { kind: 'build' }, spacing: 0.25, blend: { family: 'layer', mode: 'linearHeight' }, scale: 0.7, grain: grain('relief.png', { blend: { family: 'layer', mode: 'multiply' } }) },
});

/** Duals in both plans, pooling, a rim and a burnt edge, under each other so the edges burn into paint. */
function strokesDualsEdges(): StampGatePainting {
  const rimmed = stampGateBrush('Rimmed', { accumulation: { kind: 'glaze', build: 0.3 }, wetEdges: { kind: 'rim', width: 0.3, rim: 0.6, sharpness: 0.5 } });
  const burnt = stampGateBrush('Burnt', { burntEdge: { width: 0.25, strength: 0.8, sharpness: 0.6, blend: 'multiply' }, flow: 0.7 });
  const painting = compileStampPaintRecipe(stampPaintRecipe(WHITE_FLAT, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => {
    pass.stroke('dual-texture', { brush: DUAL_TEXTURE, size: 50, well: { paint: color('#244a7a') }, path: line(20, 300, 40) });
    pass.stroke('dual-relief', { brush: DUAL_RELIEF, size: 50, well: { paint: color('#7a244a') }, path: line(20, 300, 105) });
    pass.stroke('rimmed', { brush: rimmed, size: 56, well: { paint: color('#3d7a24') }, path: line(20, 300, 170) });
    pass.stroke('burnt', { brush: burnt, size: 40, well: { paint: color('#c07020') }, path: [{ x: 60, y: 20 }, { x: 160, y: 220 }, { x: 260, y: 20 }] });
  }))));
  return { painting, width: 320, height: 240, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/**
 * Accumulations: a falling opacity laid in order, and tinted; glaze stamps blurred; build scattered; placed stamps; and
 * a stroke half drawn at `t`.
 */
function strokesAccumulations(): StampGatePainting {
  const falling = stampGateBrush('Falling', {
    dynamics: stampLinearDynamics({ opacity: { pressure: 0.8 } }), flow: 0.6,
    color: { stamp: { hue: 0.1, saturation: 0.3, lightness: 0.2, darkness: 0.2 }, stroke: { hue: 0.05, saturation: 0, lightness: 0, darkness: 0 }, pressure: { hue: 0, saturation: 0, lightness: 0, secondary: 0.8 } },
  });
  const blurred = stampGateBrush('Blurred', { accumulation: { kind: 'glaze', build: 0.7 }, blur: { amount: 0.8, jitter: 0.5 }, tip: { image: stampGateAsset('chisel.png'), roundness: 0.7, sampling: 'anisotropic' } });
  const scattered = stampGateBrush('Scattered', {
    accumulation: { kind: 'build' }, spacing: 0.4, flow: 0.3,
    scatter: { count: 3, radius: 0.6, lateral: 0.3 }, dynamics: stampLinearDynamics({ size: { random: 0.5 }, count: { random: 0.5 } }),
  });
  const painting = compileStampPaintRecipe(stampPaintRecipe(WHITE_FLAT, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => {
    pass.stroke('falling', { brush: falling, size: 40, well: { paint: color('#b03030') }, secondaryColor: '#3030b0', path: line(20, 300, 35, 20) });
    pass.stroke('blurred', { brush: blurred, size: 40, well: { paint: color('#305030') }, path: line(20, 300, 90) });
    pass.stroke('scattered', { brush: scattered, size: 30, well: { paint: color('#303080') }, path: line(20, 300, 140) });
    pass.stamps('placed', { brush: falling, size: 30, well: { paint: color('#806030') }, at: [{ x: 40, y: 200 }, { x: 70, y: 205, diameter: 40, rotation: 1 }, { x: 100, y: 195, pressure: 0.3 }] });
    pass.stroke('half-drawn', { brush: scattered, size: 30, well: { paint: color('#208080') }, path: line(140, 300, 200), reveal: { at: 0, over: 2 } });
  }))));
  return { painting, width: 320, height: 240, t: 1, images: STAMP_GATE_IMAGES };
}

/** Blends over paint, an opaque group over a glaze, a clipped pass, on toothed paper. */
function colourGroups(): StampGatePainting {
  const plain = stampGateBrush('Plain', { flow: 0.8 });
  const blends = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorBurn'] as const;
  const paper: StampPaintPaper = { color: '#f4efe4', grain: { image: stampGateAsset('grain.png'), scale: 0.2, depth: 0.6 } };
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper, mixing: { kind: 'flat' } }, (p) => {
    p.group('under', { composite: 'glaze', opacity: 0.8 }, (g) => g.passage('bands', {}, (pass) => {
      pass.stroke('warm', { brush: plain, size: 70, well: { paint: color('#e0a040') }, path: [{ x: 0, y: 60 }, { x: 320, y: 60 }] });
      pass.stroke('cool', { brush: plain, size: 70, well: { paint: color('#4080c0') }, path: [{ x: 0, y: 140 }, { x: 320, y: 140 }] });
    }));
    p.group('blends', { composite: 'glaze', opacity: 0.9 }, (g) => g.passage('marks', {}, (pass) => blends.forEach((blend, k) => {
      pass.stroke(blend, { brush: plain, blend, size: 24, well: { paint: color('#a03070') }, path: [{ x: 25 + k * 42, y: 20 }, { x: 35 + k * 42, y: 180 }] });
    })));
    p.group('cover', { composite: 'opaque', order: 1 }, (g) => {
      g.passage('shape', {}, (pass) => pass.stroke('shape', { brush: plain, size: 50, well: { paint: color('#306030') }, opacity: 0.9, path: [{ x: 40, y: 210 }, { x: 280, y: 200 }] }));
      g.passage('texture', { clipTo: 'shape' }, (pass) => pass.stroke('stripes', { brush: stampGateBrush('Clipped', { grain: grain('grain.png', { blend: { family: 'texture', mode: 'multiply' } }) }), size: 30, well: { paint: color('#f0e0a0') }, path: [{ x: 60, y: 180 }, { x: 260, y: 235 }] }));
    });
  }));
  return { painting, width: 320, height: 240, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/**
 * Regions on a photographed paper: masking fluid ragged and soft, lifted partly, a pass within an ellipse, a flood
 * graded by its load and another half across its front, a neck thinner than the brush, a hatch and a cross-hatch.
 */
function regions(): StampGatePainting {
  const wet = stampGateBrush('Wet', { media: 'wet', flow: 0.6, wetEdges: PHOTOSHOP_POOLING });
  const dry = stampGateBrush('Dry', { media: 'dry', flow: 0.9, grain: grain('grain.png', { blend: { family: 'texture', mode: 'subtract' } }) });
  const paper: StampPaintPaper = { color: '#faf6ee', image: stampGateAsset('photograph.png') };
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper, mixing: { kind: 'flat' } }, (p) => {
    p.group('reserve', { composite: 'glaze', opacity: 1 }, (g) => {
      g.mask('ragged', { region: { kind: 'ellipse', x: 70, y: 60, radiusX: 40, radiusY: 30 }, edge: { ragged: { amount: 4, scale: 6 } } });
      g.mask('soft', { region: stampGatePolygon(120, 20, 170, 20, 170, 100, 120, 100), edge: { soft: 6 } });
      g.unmask('half', { amount: 0.5, region: stampGatePolygon(130, 20, 170, 20, 170, 60, 130, 60) });
      g.passage('sky', {}, (pass) => pass.fill('sky', {
        brush: wet, size: 40, application: { kind: 'flood' }, well: { paint: color('#3060a0') }, region: stampGatePolygon(10, 10, 200, 10, 200, 110, 10, 110),
        load: { kind: 'radial', center: { x: 100, y: 60 }, radius: 110, inner: 1, outer: 0.3 },
      }));
    });
    p.group('fronts', { composite: 'glaze', opacity: 1 }, (g) => {
      g.passage('front', {}, (pass) => pass.fill('front', {
        brush: wet, size: 30, application: { kind: 'flood' }, well: { paint: color('#a04030') }, region: { kind: 'ellipse', x: 260, y: 60, radiusX: 50, radiusY: 45 },
        direction: 0.5, load: { kind: 'linear', from: { x: 210, y: 0, value: 1 }, to: { x: 310, y: 0, value: 0.4 } }, reveal: { at: 0, over: 2 },
      }));
      g.passage('neck', {}, (pass) => pass.fill('neck', { brush: wet, size: 40, application: { kind: 'flood' }, well: { paint: color('#305030') }, region: stampGatePolygon(10, 230, 50, 230, 55, 130, 60, 230, 110, 230, 110, 238, 10, 238) }));
      g.passage('within', { within: { region: { kind: 'ellipse', x: 160, y: 185, radiusX: 40, radiusY: 25 } } }, (pass) => {
        pass.stroke('across', { brush: wet, size: 30, well: { paint: color('#806020') }, path: [{ x: 110, y: 170 }, { x: 210, y: 200 }] });
      });
      g.passage('hatch', {}, (pass) => {
        pass.fill('hatch', { brush: dry, size: 8, application: { kind: 'strokes', pattern: { kind: 'hatch' }, spacing: 1.8 }, well: { paint: color('#202020') }, region: stampGatePolygon(220, 130, 310, 130, 310, 180, 220, 180) });
        pass.fill('cross', { brush: dry, size: 8, well: { paint: color('#402060') }, application: { kind: 'strokes', pattern: { kind: 'crossHatch' }, spacing: 2 }, direction: 0.3, region: { kind: 'ellipse', x: 265, y: 210, radiusX: 45, radiusY: 22 } });
      });
    });
  }));
  return { painting, width: 320, height: 240, t: 1, images: STAMP_GATE_IMAGES };
}

/**
 * The painting a trace is held to its frame by: black on white, each stroke apart from the others and fully drawn,
 * so a pixel's darkness is the one deposit's coverage there. Its brushes resolve in both plans, each stage doing
 * something.
 */
export function stampGateTracePainting(): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe(WHITE_FLAT, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => {
    pass.stroke('dual-texture', { brush: DUAL_TEXTURE, size: 50, well: { paint: color('#000000') }, path: line(30, 290, 50) });
    pass.stroke('dual-relief', { brush: DUAL_RELIEF, size: 50, well: { paint: color('#000000') }, opacity: 0.7, path: line(30, 290, 150) });
  }))));
  return { painting, width: 320, height: 200, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** The stage order each of the trace painting's deposits resolves in: between them, both of the renderer's plans. */
export const STAMP_GATE_TRACE_ORDERS = ['grain,dual,pooling', 'dual,grain,pooling'];

/** The media the pigment painting is mixed in: a wet glaze, a body colour lightened with white, and a dry one. */
export const STAMP_GATE_PIGMENT_MEDIA = ['watercolour', 'gouache', 'crayon'] as const satisfies readonly (keyof typeof PAINT_MEDIA)[];

/**
 * A painting in pigment in `mediumName` on a toothed paper: mixtures, a colour, wet mixing, glazes, an opaque group, a
 * graded flood round masking fluid, a pass within a region; its last group mixes twelve pigments, a full group, so every
 * layer of a group's state is laid and read.
 */
function pigment(mediumName: (typeof STAMP_GATE_PIGMENT_MEDIA)[number]): StampGatePainting {
  const round = stampGateBrush('Round', { flow: 0.5 }), medium = PAINT_MEDIA[mediumName];
  const paper: StampPaintPaper = { color: '#f6f1e6', grain: { image: stampGateAsset('grain.png'), scale: 0.15, depth: 0.5 } };
  // Laid by the direct law in every medium, as a crayon lays it: a wet medium's history given up.
  const direct: Pick<StampPassageOptions, 'wetHistory'> = paintMediumCan(medium, 'wet-history') ? { wetHistory: false } : {};
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper, mixing: { kind: 'pigment', medium, pigments: W } }, (p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => {
      g.mask('sun', { region: { kind: 'ellipse', x: 250, y: 45, radiusX: 22, radiusY: 22 }, edge: { soft: 3 } });
      g.passage('wash', direct, (pass) => pass.fill('granulating', {
        brush: round, size: 40, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 310, 10, 310, 95, 10, 95),
        well: { paint: { kind: 'mixture', parts: [{ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 0.3 }], strength: 0.9 } },
        load: { kind: 'linear', from: { x: 0, y: 10, value: 1 }, to: { x: 0, y: 95, value: 0.3 } },
      }));
    });
    p.group('field', { composite: 'glaze', opacity: 0.9 }, (g) => g.passage('wet', direct, (pass) => {
      pass.stroke('green', { brush: round, size: 60, well: { paint: { kind: 'mixture', parts: [{ pigment: W.phthaloBlue, amount: 1 }, { pigment: W.hansaYellow, amount: 2 }], strength: 1 } }, path: [{ x: 20, y: 140 }, { x: 300, y: 120 }] });
      pass.stroke('rose', { brush: round, size: 40, well: { paint: color('#c8305f') }, path: [{ x: 60, y: 190 }, { x: 250, y: 30 }] });
    }));
    p.group('patch', { composite: 'opaque' }, (g) => g.passage('cover', { within: { region: { kind: 'ellipse', x: 260, y: 162, radiusX: 34, radiusY: 16 } }, ...direct }, (pass) => {
      pass.stroke('cerulean', { brush: round, size: 50, well: { paint: { kind: 'mixture', parts: [{ pigment: W.cerulean, amount: 1 }], strength: 0.7 } }, path: [{ x: 230, y: 150 }, { x: 290, y: 175 }] });
    }));
    // Each pigment at full strength, so no white joins them, and two colours: overlapping swatches, mixing wet.
    const swatches = [...Object.values(W).map((each): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment: each, amount: 1 }], strength: 1 })), color('#3a7d44'), color('#d98c2b')];
    p.group('palette', { composite: 'glaze', opacity: 0.8 }, (g) => g.passage('swatches', direct, (pass) => swatches.forEach((material, k) => {
      pass.stroke(`swatch-${k}`, { brush: round, size: 30, well: { paint: material }, path: [{ x: 20 + k * 25, y: 212 }, { x: 34 + k * 25, y: 250 }] });
    })));
  }));
  return { painting, width: 320, height: 260, t: Number.MAX_VALUE, images: STAMP_GATE_IMAGES };
}

/** Every painting the gate holds, by ID; an ID names its baseline. */
const STAMP_GATE_PAINTINGS = new Map<string, () => StampGatePainting>([
  ['strokes-grains', strokesGrains],
  ['strokes-duals-edges', strokesDualsEdges],
  ['strokes-accumulations', strokesAccumulations],
  ['colour-groups', colourGroups],
  ['regions', regions],
  ...STAMP_GATE_PIGMENT_MEDIA.map((medium) => [`pigment-${medium}`, () => pigment(medium)] as const),
]);

export const STAMP_GATE_PAINTING_IDS = [...STAMP_GATE_PAINTINGS.keys()];

/** The gate's painting `id`, built afresh; throws on an ID it doesn't hold. */
export function stampGatePainting(id: string): StampGatePainting {
  const painting = STAMP_GATE_PAINTINGS.get(id);
  if (!painting) throw new Error(`stamp gate: no painting ${JSON.stringify(id)}; the gate paints ${STAMP_GATE_PAINTING_IDS.join(', ')}`);
  return painting();
}

/**
 * What a painting is made of, as one string: its compiled deposits with its paper and mixing, time and any images drawn here (a
 * pack's are hashed by the caller). A baseline records its hash, so a changed painting asks for an update. JSON writes
 * typed arrays out whole, as objects of their elements.
 */
export function stampGatePaintingInputs(gate: Omit<StampGatePainting, 'images'> & Partial<Pick<StampGatePainting, 'images'>>): string {
  return JSON.stringify(gate);
}
