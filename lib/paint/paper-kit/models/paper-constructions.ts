// paper-constructions.ts: cut-paper constructions as pop-up sheets: a card standing on a fold-back tab, an X of two
// slotted cards, a tent, a box house with a tent roof. Each takes its print's geometry and a `rise` from 0 (lying
// flat) to 1 (standing), and folds every hinge from it, so a construction folds up from flat as `rise` plays; a latch
// curve on `rise` overshoots and settles with no more keys.
//
// Every construction stands square on what it stands on (π/2), as folded paper does in a diorama, not turned to face
// the camera as a flat pop-up card is.

import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { PaintedThreePopUpSheet } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import {
  PAINTED_THREE_SHEET_ROOT, PAINTED_THREE_SHEET_THICKNESS, paintedThreeSheetRingPoints, type PaintedThreeSheetEdge, type PaintedThreeSheetRing,
} from '#lib/paint/three-layers/models/painted-three-sheet.ts';
import { stampPolygonInside, stampRingsCross, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * Where a construction goes in a pop-up: `id`, its sheets' id or their prefix; `print`, the painted texture its sheets
 * show (one id, or one per part); `at`, `on`, `yaw`, `scale` and `tint` as PaintedThreePopUpSheet's, for its standing sheet.
 */
export type PaperConstructionPlace<Print = string> = Pick<PaintedThreePopUpSheet, 'id' | 'at' | 'on' | 'yaw' | 'scale' | 'tint'> & { readonly print: Print };

/** A construction placed: its sheets, ready for a pop-up's `sheets`. */
export type PaperConstruction<Print = string> = (place: PaperConstructionPlace<Print>) => PaintedThreePopUpSheet[];

/** A construction's rise: 0 lies flat, 1 stands; past 1 (a latch's overshoot) it folds a little further. */
export type PaperRise = PresentationValue<number>;

/** `rise` read through `angle`, in time as `rise` is. */
const angleOfRise = (rise: PaperRise, angle: (rise: number) => number): PresentationValue<number> =>
  (typeof rise === 'number' ? angle(rise) : (moment) => angle(presentationValueAt(rise, moment)));

const QUARTER = Math.PI / 2;

/** A place's own fields, but its print, for a sheet. */
const placed = ({ id, at, on, yaw, scale, tint }: PaperConstructionPlace<unknown>) => ({ id, at, ...(on && { on }), ...(yaw !== undefined && { yaw }), ...(scale !== undefined && { scale }), ...(tint && { tint }) });

/**
 * A card standing on `foot`, an edge of its `outline`, in a print `widthPx` × `heightPx` (print px, y down), `holes`
 * cut through it. `tab`, sharing the foot below it, folds back under: flat, the card lies over it; risen, the tab
 * lies face down behind the foot.
 */
export type PaperStandUpOptions = {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly outline: PaperOutline;
  readonly holes?: readonly PaperOutline[];
  readonly foot: PaintedThreeSheetEdge;
  readonly tab?: PaperOutline;
  readonly rise: PaperRise;
};

/** An outline in print px (y down): its points, or one closed SVG path's data. */
export type PaperOutline = PaintedThreeSheetRing;

/** Radians short of turned over a stand-up's tab lies while its card is flat, so the two never share a slab. */
const PAPER_STAND_UP_TUCK = 0.08;

/** The fold-back tab's face id on a stand-up's sheet. */
export const PAPER_STAND_UP_TAB = 'tab';

/** A card standing on its foot, a fold-back tab under it (PaperStandUpOptions). One sheet, `id`. */
export function paperStandUp({ widthPx, heightPx, outline, holes, foot, tab, rise }: PaperStandUpOptions): PaperConstruction {
  return (place) => [{
    ...placed(place), print: place.print, widthPx, heightPx,
    root: { outline, ...(holes && { holes }), hinge: foot },
    // The tab's angle less the card's is −π once it stands: turned over, flat on the ground. Turned exactly over while
    // the card lies flat, the tab fills the card's own slab and its kraft fights the print; a sliver short of over
    // tucks it into the ground below instead, closing as the card rises.
    folds: tab ? [{ id: PAPER_STAND_UP_TAB, outline: tab, hinge: foot, angle: angleOfRise(rise, (r) => r * QUARTER - Math.PI + PAPER_STAND_UP_TUCK * Math.max(0, 1 - r)) }] : [],
    angle: angleOfRise(rise, (r) => r * QUARTER),
  }];
}

/** The X's slots, print px: each card's, a hole along its centre line, one from its top half down, one from its foot half up. */
export type PaperXTreeSlots = { readonly top: readonly StampPoint[]; readonly foot: readonly StampPoint[] };

/**
 * Two copies of one card slotted into an X, as PaperStandUpOptions without a tab. `slotPx`, the slots' width: three
 * times the default paper's thickness when left out, so the crossing card clears it.
 */
export type PaperXTreeOptions = Omit<PaperStandUpOptions, 'tab'> & { readonly slotPx?: number };

/** How far a slot moves toward the centre at a time when it doesn't fit inside the card, of its width. */
const SLOT_STEP = 0.25;

/**
 * Where an X's slots lie on its card (PaperXTreeSlots): along the line square to `foot` through its middle, meeting at
 * half the card's height there. A hole must lie inside its card, so each stops short of the outline by what keeps
 * its corners in: a sliver of paper bridges each slot's open end, hidden by the card crossing it.
 */
export function paperXTreeSlots({ outline, foot, heightPx, slotPx }: Pick<PaperXTreeOptions, 'outline' | 'foot' | 'heightPx' | 'slotPx'>): PaperXTreeSlots {
  const ring = paintedThreeSheetRingPoints(outline, 'paper X tree'), width = slotPx ?? 3 * PAINTED_THREE_SHEET_THICKNESS * heightPx;
  const middle = { x: (foot.from.x + foot.to.x) / 2, y: (foot.from.y + foot.to.y) / 2 }, length = Math.hypot(foot.to.x - foot.from.x, foot.to.y - foot.from.y);
  const along = { x: (foot.to.x - foot.from.x) / length, y: (foot.to.y - foot.from.y) / length };
  // Square to the foot, toward the card's body.
  const mean = ring.reduce((sum, p) => ({ x: sum.x + p.x / ring.length, y: sum.y + p.y / ring.length }), { x: 0, y: 0 });
  const side = Math.sign((mean.x - middle.x) * -along.y + (mean.y - middle.y) * along.x) || 1, up = { x: -along.y * side, y: along.x * side };
  const at = (s: number, w: number) => ({ x: middle.x + up.x * s + along.x * w, y: middle.y + up.y * s + along.y * w });
  // The centre line's first crossing of the outline past the foot: the card's height there.
  const crossings = ring.flatMap((a, k) => {
    const b = ring[(k + 1) % ring.length], ex = b.x - a.x, ey = b.y - a.y, d = up.x * ey - up.y * ex;
    if (Math.abs(d) < 1e-12) return [];
    const s = ((a.x - middle.x) * ey - (a.y - middle.y) * ex) / d, t = ((a.x - middle.x) * up.y - (a.y - middle.y) * up.x) / d;
    return t >= 0 && t <= 1 && s > 1e-6 ? [s] : [];
  });
  if (!crossings.length) throw new Error('paper X tree: the line up from its foot\'s middle never leaves its outline');
  const height = Math.min(...crossings), half = height / 2;
  const slot = (from: number, to: number) => [at(from, -width / 2), at(to, -width / 2), at(to, width / 2), at(from, width / 2)];
  const fits = (points: readonly StampPoint[]) => points.every(({ x, y }) => stampPolygonInside(ring, x, y)) && !stampRingsCross(ring, points);
  const fitted = (end: number, toward: 1 | -1) => {
    for (let gap = width / 2; gap < half; gap += width * SLOT_STEP) {
      const points = toward < 0 ? slot(half, end - gap) : slot(end + gap, half);
      if (fits(points)) return points;
    }
    throw new Error(`paper X tree: a slot ${width} px wide fits nowhere along its centre line`);
  };
  return { top: fitted(height, -1), foot: fitted(0, 1) };
}

/**
 * Two cards slotted into an X (PaperXTreeOptions), rising together: `<id>/a` slotted from its top, and `<id>/b`
 * slotted from its foot, turned a quarter further about the parent's normal. Both print the same print.
 */
export function paperXTree({ widthPx, heightPx, outline, holes = [], foot, slotPx, rise }: PaperXTreeOptions): PaperConstruction {
  const slots = paperXTreeSlots({ outline, foot, heightPx, slotPx }), stand = angleOfRise(rise, (r) => r * QUARTER);
  return (place) => {
    const yaw = place.yaw ?? 0, crossed = typeof yaw === 'number' ? yaw + QUARTER : (moment: PaintMoment) => presentationValueAt(yaw, moment) + QUARTER;
    const card = (id: string, slot: readonly StampPoint[], turned: PresentationValue<number>): PaintedThreePopUpSheet => ({
      ...placed(place), id, yaw: turned, print: place.print, widthPx, heightPx, root: { outline, holes: [...holes, slot], hinge: foot }, angle: stand,
    });
    return [card(`${place.id}/a`, slots.top, yaw), card(`${place.id}/b`, slots.foot, crossed)];
  };
}

/**
 * A tent: one print `widthPx` × `heightPx` creased across at `ridgeY`, its lower panel standing on its bottom edge and
 * its upper folding back down over the ridge, each `pitch` radians from flat (the ground) at rise 1.
 */
export type PaperTentOptions = { readonly widthPx: number; readonly heightPx: number; readonly ridgeY: number; readonly pitch: number; readonly rise: PaperRise };

/** The tent's upper panel's face id. */
export const PAPER_TENT_BACK = 'back';

/** A tent's sheet, its lower panel standing by `stand` and its ridge folding by `ridge`, as PaperTentOptions lays it. */
function paperTentSheet({ widthPx, heightPx, ridgeY }: Pick<PaperTentOptions, 'widthPx' | 'heightPx' | 'ridgeY'>, stand: PresentationValue<number>, ridge: PresentationValue<number>) {
  const across = (y: number): PaintedThreeSheetEdge => ({ from: { x: 0, y }, to: { x: widthPx, y } });
  const panel = (y0: number, y1: number) => [{ x: 0, y: y0 }, { x: widthPx, y: y0 }, { x: widthPx, y: y1 }, { x: 0, y: y1 }];
  return {
    widthPx, heightPx, angle: stand,
    root: { outline: panel(ridgeY, heightPx), hinge: across(heightPx) },
    folds: [{ id: PAPER_TENT_BACK, outline: panel(0, ridgeY), hinge: across(ridgeY), angle: ridge }],
  };
}

/** A tent standing on its lower panel's edge (PaperTentOptions). One sheet, `id`. */
export function paperTent({ pitch, rise, ...sheet }: PaperTentOptions): PaperConstruction {
  const built = paperTentSheet(sheet, angleOfRise(rise, (r) => r * pitch), angleOfRise(rise, (r) => -2 * r * pitch));
  return (place) => [{ ...placed(place), print: place.print, ...built }];
}

/**
 * A box house: `widthPx` its front and back walls, `depthPx` its gable ends, `wallPx` its walls' height to the eaves,
 * `tabPx` its foot tabs, `pitch` its roof's radians from flat, `overhangPx` its roof past each gable (0 by default).
 */
export type PaperBoxHouseOptions = {
  readonly widthPx: number;
  readonly depthPx: number;
  readonly wallPx: number;
  readonly tabPx: number;
  readonly pitch: number;
  readonly overhangPx?: number;
};

/** The four walls, each named as it faces at rise 1. */
export const PAPER_BOX_HOUSE_WALLS = ['left', 'front', 'right', 'back'] as const;
export type PaperBoxHouseWall = (typeof PAPER_BOX_HOUSE_WALLS)[number];

/**
 * A box house's two prints to paint, print px (y down). `walls`: a strip, left to right the left gable, front, right
 * gable and back, feet on `footY`, eaves on `eavesY`, gable peaks at 0; under each foot a tab cut in at 45° so tabs
 * meet at the corners. `roof`: its front slope below `ridgeY`, its back above.
 */
export type PaperBoxHouseNet = {
  readonly walls: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly eavesY: number;
    readonly footY: number;
    readonly outlines: Readonly<Record<PaperBoxHouseWall, readonly StampPoint[]>>;
    readonly tabs: Readonly<Record<PaperBoxHouseWall, readonly StampPoint[]>>;
  };
  readonly roof: { readonly widthPx: number; readonly heightPx: number; readonly ridgeY: number };
};

/** `of` each wall, by name. */
const eachPaperWall = <T,>(of: (name: PaperBoxHouseWall) => T): Record<PaperBoxHouseWall, T> => ({ left: of('left'), front: of('front'), right: of('right'), back: of('back') });

/** Each wall's left edge in the strip, print px. */
const wallX = ({ widthPx: w, depthPx: d }: PaperBoxHouseOptions): Readonly<Record<PaperBoxHouseWall, number>> => ({ left: 0, front: d, right: d + w, back: 2 * d + w });

/** A box house's prints (PaperBoxHouseNet), sized up to whole px. */
export function paperBoxHouseNet(options: PaperBoxHouseOptions): PaperBoxHouseNet {
  const { widthPx: w, depthPx: d, wallPx, tabPx, pitch, overhangPx = 0 } = options;
  // The gables rise to the ridge, which lies over the box's middle; each slope spans half the depth.
  const eavesY = (d / 2) * Math.tan(pitch), footY = eavesY + wallPx, slope = d / 2 / Math.cos(pitch), x = wallX(options);
  const wall = (name: PaperBoxHouseWall): StampPoint[] => {
    const x0 = x[name], x1 = x0 + (name === 'left' || name === 'right' ? d : w);
    const top = name === 'left' || name === 'right' ? [{ x: x0, y: eavesY }, { x: (x0 + x1) / 2, y: 0 }, { x: x1, y: eavesY }] : [{ x: x0, y: eavesY }, { x: x1, y: eavesY }];
    return [...top, { x: x1, y: footY }, { x: x0, y: footY }];
  };
  const tab = (name: PaperBoxHouseWall): StampPoint[] => {
    const x0 = x[name], x1 = x0 + (name === 'left' || name === 'right' ? d : w);
    return [{ x: x0, y: footY }, { x: x1, y: footY }, { x: x1 - tabPx, y: footY + tabPx }, { x: x0 + tabPx, y: footY + tabPx }];
  };
  return {
    walls: { widthPx: Math.ceil(2 * (w + d)), heightPx: Math.ceil(footY + tabPx), eavesY, footY, outlines: eachPaperWall(wall), tabs: eachPaperWall(tab) },
    roof: { widthPx: Math.ceil(w + 2 * overhangPx), heightPx: Math.ceil(2 * slope), ridgeY: slope },
  };
}

/** The roof's sheet id within a box house: `<id>/roof`. */
export const paperBoxHouseRoofId = (id: string) => `${id}/roof`;
/** A tab's face id on a box house's walls: `<wall>-tab`. */
export const paperBoxHouseTabFace = (wall: PaperBoxHouseWall) => `${wall}-tab`;

/**
 * A box house rising from its net (PaperBoxHouseNet): over its rise's first half the strip stands on the front's
 * foot, tabs flat out in front; over the second the walls fold round and the roof leans back over them. Sheets: `id`,
 * the walls (prints `walls`); `<id>/roof` (`roof`), on the front's eaves, riding the box.
 */
export function paperBoxHouse({ rise, ...options }: PaperBoxHouseOptions & { readonly rise: PaperRise }): PaperConstruction<{ readonly walls: string; readonly roof: string }> {
  const net = paperBoxHouseNet(options), { walls, roof } = net, x = wallX(options), { footY, eavesY } = walls;
  // In sequence: folding the walls while the strip lay flat would swing them through the ground.
  const standing = angleOfRise(rise, (r) => QUARTER * Math.min(1, 2 * r)), folding = (angle: number) => angleOfRise(rise, (r) => angle * Math.max(0, 2 * r - 1));
  const upright = (wall: PaperBoxHouseWall): PaintedThreeSheetEdge => ({ from: { x: x[wall], y: eavesY }, to: { x: x[wall], y: footY } });
  const foot = (wall: PaperBoxHouseWall): PaintedThreeSheetEdge => ({ from: { x: x[wall], y: footY }, to: { x: x[wall] + (wall === 'left' || wall === 'right' ? options.depthPx : options.widthPx), y: footY } });
  // Each fold turns away from the front's face, so the printed side stays out; each tab turns back as far as its wall stands, lying flat.
  const sides = [
    { id: 'left', on: PAINTED_THREE_SHEET_ROOT, hinge: upright('front') },
    { id: 'right', on: PAINTED_THREE_SHEET_ROOT, hinge: upright('right') },
    { id: 'back', on: 'right', hinge: upright('back') },
  ] as const;
  const tabs = PAPER_BOX_HOUSE_WALLS.map((wall) => ({
    id: paperBoxHouseTabFace(wall), on: wall === 'front' ? PAINTED_THREE_SHEET_ROOT : wall, outline: walls.tabs[wall], hinge: foot(wall), angle: standing,
  }));
  const roofSheet = paperTentSheet(roof, folding(options.pitch - QUARTER), folding(-2 * options.pitch));
  return (place) => [
    {
      ...placed(place), print: place.print.walls, widthPx: walls.widthPx, heightPx: walls.heightPx, angle: standing,
      root: { outline: walls.outlines.front, hinge: foot('front') },
      folds: [...sides.map(({ id, on, hinge }) => ({ id, on, hinge, outline: walls.outlines[id], angle: folding(-QUARTER) })), ...tabs],
    },
    { id: paperBoxHouseRoofId(place.id), print: place.print.roof, on: { sheet: place.id }, at: { x: x.front + options.widthPx / 2, y: eavesY }, ...(place.tint && { tint: place.tint }), ...roofSheet },
  ];
}
