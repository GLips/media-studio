// stamp-gate-regions.ts: the areas the GPU gate paints and the properties their frames are held to, black floods on
// white, by each pixel's signed distance from the area's outline:
//
// - ragged-within: a ragged `within` breaks its edge, but paints nothing past its ragged reach and all short of it;
// - inset-reserve: masking fluid inset by its distance holds paint off only from that far inside;
// - stands-before: the far range stops `overlap` inside the near hill's shape, and with the hill painted no paper
//   shows anywhere between them.

import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampGroupScope, StampPaintScope, StampPassOptions } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import { stampPolygonDistance, stampRegionPolygon, type StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_REGION_IDS = ['region/ragged-within', 'region/inset-reserve', 'region/stands-before'] as const;
export type StampGateRegionId = (typeof STAMP_GATE_REGION_IDS)[number];

const SIZE = { width: 200, height: 140 };
const FLAT = { kind: 'flat' } as const;
const ROUND = stampGateBrush('Round', { flow: 1 });
/** How far from an edge's line a pixel must sit to be held to wholly painted or bare: its antialiasing and a pixel's centre. */
const MARGIN = 1.5;
/** The least share of either side of a ragged edge's band that must cross it, so a straight edge fails. */
export const STAMP_GATE_RAGGED_LEAST = 0.05;

const RAGGED = { amount: 6, scale: 10 };
const WITHIN = stampGatePolygon(40, 20, 160, 20, 160, 120, 40, 120);
const RESERVE = { region: stampGatePolygon(60, 30, 140, 30, 140, 110, 60, 110), inset: 8 };
const HILL: StampRegion = { kind: 'ellipse', x: 110, y: 120, radiusX: 70, radiusY: 60 };
const OVERLAP = 3;

/** A black flood past the whole painting, so only areas bound it. */
const PAST = stampGatePolygon(-30, -30, 230, -30, 230, 170, -30, 170);
const flood = (group: StampGroupScope, id: string, options: StampPassOptions = {}) =>
  group.pass(id, options, (pass) => pass.fill(id, { brush: ROUND, diameter: 30, application: { kind: 'flood' }, material: { kind: 'color', color: '#000000' }, region: PAST }));

const gatePainting = (body: (paint: StampPaintScope) => void): StampGatePainting => ({
  painting: compileStampPaintRecipe(stampPaintRecipe(body)), paper: { color: '#ffffff' }, mixing: FLAT, ...SIZE, t: 0, images: STAMP_GATE_IMAGES,
});

/**
 * The paintings case `id` is drawn from: the ragged within's flood; the inset reserve's; the far range alone under
 * the hill standing before it, then with the hill painted over it.
 */
export function stampGateRegionPaintings(id: StampGateRegionId): StampGatePainting[] {
  if (id === 'region/ragged-within') {
    return [gatePainting((p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => flood(g, 'flood', { within: { region: WITHIN, edge: { ragged: RAGGED } } })))];
  }
  if (id === 'region/inset-reserve') {
    return [gatePainting((p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => {
      g.mask('reserve', RESERVE);
      flood(g, 'flood');
    }))];
  }
  const range = (hill: boolean) => gatePainting((p) => {
    p.group('far', { composite: 'opaque', depth: 1 }, (g) => {
      // An unmask of the far range's own can't lift what the hill reserves.
      g.unmask('open', {});
      flood(g, 'flood');
    });
    p.group('near', { composite: 'opaque', standsBefore: { groups: ['far'], shape: HILL, overlap: OVERLAP } }, (g) => {
      if (hill) g.pass('hill', { within: { region: HILL } }, (pass) => pass.fill('hill', { brush: ROUND, diameter: 30, application: { kind: 'flood' }, material: { kind: 'color', color: '#808080' }, region: HILL }));
    });
  });
  return [range(false), range(true)];
}

type Rgba = ArrayLike<number>;
const lightness = (frame: Rgba, i: number) => (frame[i * 4] + frame[i * 4 + 1] + frame[i * 4 + 2]) / 3;
const painted = (frame: Rgba, i: number) => lightness(frame, i) < 64;
const bare = (frame: Rgba, i: number) => lightness(frame, i) > 240;

/** Each pixel's signed distance from `region`'s outline at its centre, positive inside. */
function distances(region: StampRegion): Float64Array {
  const polygon = stampRegionPolygon(region);
  return Float64Array.from({ length: SIZE.width * SIZE.height }, (_, i) => stampPolygonDistance(polygon, (i % SIZE.width) + 0.5, Math.floor(i / SIZE.width) + 0.5));
}

/** Pixels painted that must be bare (past `bareFrom` inside, or before `bareTo`) and bare that must be painted (between `paintedFrom` and `paintedTo`). */
function heldTo(frame: Rgba, sd: Float64Array, { paintedFrom, paintedTo, bareFrom, bareTo }: { paintedFrom: number; paintedTo: number; bareFrom: number; bareTo: number }) {
  let paintedWrong = 0, bareWrong = 0;
  sd.forEach((d, i) => {
    if (d > paintedFrom && d < paintedTo && !painted(frame, i)) bareWrong++;
    if ((d > bareFrom || d < bareTo) && !bare(frame, i)) paintedWrong++;
  });
  return { paintedWrong, bareWrong };
}

/** Whether case `id`'s frames, each drawn from its painting of stampGateRegionPaintings, hold to its property. */
export function checkStampGateRegion(id: StampGateRegionId, frames: readonly Rgba[]): StampGateWashCheck {
  if (id === 'region/ragged-within') {
    const [frame] = frames, sd = distances({ kind: 'polygon', points: stampRegionPolygon(WITHIN) });
    const reach = RAGGED.amount + MARGIN;
    const { paintedWrong, bareWrong } = heldTo(frame, sd, { paintedFrom: reach, paintedTo: Infinity, bareFrom: Infinity, bareTo: -reach });
    // A straight edge paints all of the band inside it and none outside; a ragged one crosses the half of its reach
    // nearest its line often.
    let outside = 0, outsidePainted = 0, inside = 0, insideBare = 0;
    sd.forEach((d, i) => {
      if (d < -MARGIN && d > -RAGGED.amount / 2) { outside++; if (!bare(frame, i)) outsidePainted++; }
      if (d > MARGIN && d < RAGGED.amount / 2) { inside++; if (!painted(frame, i)) insideBare++; }
    });
    const crossed = Math.min(outsidePainted / outside, insideBare / inside);
    return {
      id: `${id}: its edge is broken within its reach`, passed: !paintedWrong && !bareWrong && crossed >= STAMP_GATE_RAGGED_LEAST,
      detail: `${paintedWrong} pixels painted past its reach, ${bareWrong} bare short of it (past 0 fails); its edge crosses ${(outsidePainted / outside * 100).toFixed(1)}% of the band outside and ${(insideBare / inside * 100).toFixed(1)}% inside (under ${STAMP_GATE_RAGGED_LEAST * 100}% fails)`,
    };
  }
  if (id === 'region/inset-reserve') {
    const [frame] = frames;
    const { paintedWrong, bareWrong } = heldTo(frame, distances(RESERVE.region), { paintedFrom: -Infinity, paintedTo: RESERVE.inset - MARGIN, bareFrom: RESERVE.inset + MARGIN, bareTo: -Infinity });
    return {
      id: `${id}: paint stops ${RESERVE.inset} px inside the reserve`, passed: !paintedWrong && !bareWrong,
      detail: `${bareWrong} pixels bare short of the inset, ${paintedWrong} painted past it (past 0 fails)`,
    };
  }
  const [alone, together] = frames, sd = distances(HILL);
  const { paintedWrong, bareWrong } = heldTo(alone, sd, { paintedFrom: -Infinity, paintedTo: OVERLAP - MARGIN, bareFrom: OVERLAP + MARGIN, bareTo: -Infinity });
  let open = 0;
  for (let i = 0; i < SIZE.width * SIZE.height; i++) if (!painted(together, i) && lightness(together, i) > 160) open++;
  return {
    id: `${id}: the far range stops ${OVERLAP} px inside the hill, and no paper shows between them`, passed: !paintedWrong && !bareWrong && !open,
    detail: `alone, ${bareWrong} pixels of the range bare short of the overlap, ${paintedWrong} painted past it; with the hill, ${open} pixels of paper (past 0 fails)`,
  };
}
