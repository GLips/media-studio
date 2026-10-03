// stamp-gate-masks.ts: brushed masking fluid and wax resist (stamp-brushed-mask.ts), held to what they must do
// against a twin, the same mark painted in black on white, whose darkness is its coverage:
//
// - fluid-footprint: fluid brushed on with a mark holds a flood off just where the mark painted covers;
// - fluid-unmasked: no paint lands under the fluid, and once it's lifted the paper under it takes paint;
// - resist-peaks: wax leaves the paper's peaks bare through an unmask and lets its valleys take paint.

import { stampLinearDynamics, type StampBrushGrain } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampGroupScope, StampPaintEnvironment, StampPaintPaper, StampPaintScope } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampMark } from '#lib/paint/painting/models/stamp-marks.ts';
import type { StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { STAMP_GATE_IMAGES, stampGateAsset, stampGateBrush, stampGateGrainHeight, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_MASK_IDS = ['mask/fluid-footprint', 'mask/fluid-unmasked', 'mask/resist-peaks'] as const;
export type StampGateMaskId = (typeof STAMP_GATE_MASK_IDS)[number];

/** Wide enough that the paper's tile spans it once, so each grain cell is 10 px. */
const SIZE = { width: 160, height: 120 };
const FLAT: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'flat' } };

/** Levels of 255 a fluid's footprint may stand from its twin's coverage: half-float masks, an 8-bit frame, its dither. */
export const STAMP_GATE_FOOTPRINT_LEVELS = 3;

/** A grain that breaks the mark into flecks, offset by its key, so a mask that missed its grain or offset shows. */
const FLECKS: StampBrushGrain = {
  kind: 'canvas', image: stampGateAsset('grain.png'), scale: 0.4, depth: 0.8, brightness: 0, contrast: 0, contrastPivot: 'midGrey', tiling: 'repeat', offsetJitter: 1,
  blend: { family: 'texture', mode: 'multiply' },
};
const FLUID_BRUSH = stampGateBrush('Fluid', { flow: 0.7, grain: FLECKS, dynamics: stampLinearDynamics({ size: { pressure: 0.5 } }) });
/** A wobbling stroke of fluid, its hand seeded by its key. */
const FLUID: StampMark = {
  key: 'fluid', brush: FLUID_BRUSH, diameter: 34,
  geometry: { kind: 'stroke', path: [{ x: 20, y: 50 }, { x: 80, y: 70 }, { x: 140, y: 55 }], hand: { profile: 'swell', wobble: { pressure: 0.2, position: 0.3 } } },
};
/** A firm, even stroke of fluid, its middle wholly covered, so paint under it is plain. */
const FIRM: StampMark = { key: 'firm', brush: stampGateBrush('Firm', { flow: 1 }), diameter: 40, geometry: { kind: 'stroke', path: [{ x: 20, y: 40 }, { x: 140, y: 80 }] } };
/** A broad, even band of wax, its middle wholly covered. */
const WAX: StampMark = { key: 'wax', brush: stampGateBrush('Wax', { flow: 1 }), diameter: 80, geometry: { kind: 'stroke', path: [{ x: 0, y: 60 }, { x: 160, y: 60 }] } };
/** Rows of the wax's middle every pixel of which it wholly covers. */
const WAX_ROWS = [48, 72] as const;
/** Paper whose tooth is grain.png, one tile across the painting, as deep as it goes. */
const TOOTHED: StampPaintPaper = { color: '#ffffff', grain: { image: stampGateAsset('grain.png'), scale: 1, depth: 1 } };
/** Valleys and peaks of the paper, as heights 0..1 (stampGateGrainHeight); its mean is about 0.5. */
const VALLEY = 0.45, PEAK = 0.62;
/** The band the grey is painted in once the fluid is lifted. */
const BAND = stampGatePolygon(0, 0, 80, 0, 80, 120, 0, 120);
const PAST = stampGatePolygon(-30, -30, 190, -30, 190, 150, -30, 150);

const ROUND = stampGateBrush('Round', { flow: 1 });
const fill = (region: StampRegion) => ({ brush: ROUND, size: 30, application: { kind: 'flood' as const }, region });
const flood = (g: StampGroupScope, id: string, colour: `#${string}`, region = PAST) =>
  g.passage(id, {}, (pass) => pass.fill(id, { ...fill(region), well: { paint: { kind: 'color', color: colour } } }));

const gatePainting = (environment: StampPaintEnvironment, body: (paint: StampPaintScope) => void): StampGatePainting => ({
  painting: compileStampPaintRecipe(stampPaintRecipe(environment, body)), ...SIZE, t: 0, images: STAMP_GATE_IMAGES,
});
const group = (environment: StampPaintEnvironment, body: (g: StampGroupScope) => void) => gatePainting(environment, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, body));
/** `mark` painted black: its twin. */
const twin = (mark = FLUID) => group(FLAT, (g) => g.passage('twin', {}, (pass) => pass.mark('twin', { mark, well: { paint: { kind: 'color', color: '#000000' } } })));

/** What case `id` is drawn from: its paintings, each drawn at its time to a frame. */
export function stampGateMaskPaintings(id: StampGateMaskId): StampGatePainting[] {
  if (id === 'mask/fluid-footprint') {
    return [twin(), group(FLAT, (g) => { g.mask('fluid', { marks: [FLUID] }); flood(g, 'flood', '#000000'); }), group(FLAT, (g) => flood(g, 'flood', '#000000'))];
  }
  if (id === 'mask/fluid-unmasked') {
    return [twin(FIRM), group(FLAT, (g) => {
      g.mask('fluid', { marks: [FIRM] });
      flood(g, 'flood', '#000000');
      g.unmask('lifted', {});
      flood(g, 'band', '#808080', BAND);
    }), group(FLAT, (g) => flood(g, 'band', '#808080', BAND))];
  }
  const toothed = { ...FLAT, paper: TOOTHED };
  return [group(toothed, (g) => {
    g.resist('wax', { marks: [WAX] });
    // Wax isn't fluid: no unmask lifts it.
    g.unmask('all', {});
    flood(g, 'flood', '#000000');
  }), group(toothed, (g) => flood(g, 'flood', '#000000'))];
}

type Rgba = ArrayLike<number>;
/** A black-on-white frame's darkness at pixel `i`, 0..1: the coverage laid there. */
const darkness = (frame: Rgba, i: number) => 1 - (frame[i * 4] + frame[i * 4 + 1] + frame[i * 4 + 2]) / (3 * 255);
const pixels = SIZE.width * SIZE.height;

/** Whether case `id`'s frames hold to its property. */
export function checkStampGateMask(id: StampGateMaskId, frames: readonly Rgba[]): StampGateWashCheck {
  if (id === 'mask/fluid-footprint') {
    const [painted, held, bare] = frames;
    let worst = 0, sum = 0, covered = 0;
    for (let i = 0; i < pixels; i++) {
      const coverage = darkness(painted, i), fluid = 1 - darkness(held, i) / Math.max(darkness(bare, i), 1e-6);
      const levels = Math.abs(fluid - coverage) * 255;
      worst = Math.max(worst, levels);
      sum += levels;
      if (coverage > 0.02) covered++;
    }
    return {
      id: `${id}: the fluid holds paint off as the mark painted covers`, passed: worst <= STAMP_GATE_FOOTPRINT_LEVELS && covered > pixels / 20,
      detail: `${covered} pixels covered; the fluid's footprint against its twin's coverage: worst ${worst.toFixed(2)} levels, mean ${(sum / pixels).toFixed(3)} (past ${STAMP_GATE_FOOTPRINT_LEVELS} fails)`,
    };
  }
  if (id === 'mask/fluid-unmasked') {
    const [painted, subject, band] = frames;
    let core = 0, paintedUnder = 0, unpainted = 0;
    for (let i = 0; i < pixels; i++) {
      if (darkness(painted, i) < 0.99) continue;
      core++;
      const inBand = darkness(band, i) > 0.25;
      // As much as the fluid's edge leaves open, and no more.
      if (!inBand && darkness(subject, i) > 1 - darkness(painted, i) + STAMP_GATE_FOOTPRINT_LEVELS / 255) paintedUnder++;
      if (inBand && Math.abs(darkness(subject, i) - darkness(band, i)) > STAMP_GATE_FOOTPRINT_LEVELS / 255) unpainted++;
    }
    return {
      id: `${id}: nothing lands under the fluid, and the paper it kept takes paint once it's lifted`, passed: core > 100 && !paintedUnder && !unpainted,
      detail: `${core} pixels wholly under the fluid; ${paintedUnder} of them painted while it stood, ${unpainted} in the band not painted as the band alone is after it's lifted (past 0 fails)`,
    };
  }
  const [waxed, bare] = frames;
  let valleys = 0, valleysHeld = 0, peaks = 0, peaksPainted = 0;
  // One pixel near each grain cell's middle, where the paper's linear read is the cell's height alone.
  for (let cy = 0; cy * 10 + 4 < SIZE.height; cy++) {
    for (let cx = 0; cx * 10 + 4 < SIZE.width; cx++) {
      const x = cx * 10 + 4, y = cy * 10 + 4;
      if (y < WAX_ROWS[0] || y > WAX_ROWS[1]) continue;
      const i = y * SIZE.width + x, h = stampGateGrainHeight(Math.floor(x / 2.5), Math.floor(y / 2.5));
      const kept = darkness(waxed, i) / Math.max(darkness(bare, i), 1e-6);
      if (h < VALLEY) { valleys++; if (kept < 0.9) valleysHeld++; }
      if (h > PEAK) { peaks++; if (kept > 0.1) peaksPainted++; }
    }
  }
  return {
    id: `${id}: wax keeps the paper's peaks bare, through an unmask, and its valleys take paint`, passed: valleys > 5 && peaks > 5 && !valleysHeld && !peaksPainted,
    detail: `${peaks} peaks under the wax, ${peaksPainted} of them keeping over 10% of the paint; ${valleys} valleys, ${valleysHeld} keeping under 90% (past 0 fails)`,
  };
}
