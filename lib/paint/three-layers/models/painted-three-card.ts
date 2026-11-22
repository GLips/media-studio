// painted-three-card.ts: a three.js card read as cut paper, its pure side: the authored outline and its hinge, the
// distance field the material draws the cut edge and lip from, and the look's numbers (the papercraft recipe's).
//
// A card is a print (a painted texture) cut along an outline someone drew, never traced from the painting's alpha:
// painted textures are opaque. The hinge is the stretch of outline the card folds on: it gets no cut edge and is where
// contact darkens the card.

import { svgPathRegions } from '#lib/paint/animation/models/figure/svg-path-figure.ts';
import { paintWorldLightDirection } from '#lib/paint/animation/models/paint-camera-world.ts';
import type { PaintLight } from '#lib/paint/painting/models/stamp-form.ts';
import { checkedStampPolygon, stampPolygonInside, stampRingArea, stampSegmentDistanceSquared, stampSegmentsOf, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/**
 * Where a card is cut, in its print's px (y down): `shape`, its outline as points or one closed SVG path's data; and
 * `hinge`, the straight stretch it folds on, from one point on the outline to another. Every outline segment lying
 * along the hinge gets no cut edge. A card with no hinge (a base) is cut all round.
 */
export type PaintedThreeCardOutline = {
  readonly shape: readonly StampPoint[] | string;
  readonly hinge?: { readonly from: StampPoint; readonly to: StampPoint };
};

/**
 * A card: `print`, the painted texture's id it shows (`widthPx` × `heightPx`, the texture's size), cut along `outline`.
 * `thicknessPx`: its paper's thickness in print px, PAINTED_THREE_CARD_LOOK.thickness of its height when left out.
 */
export type PaintedThreeCard = {
  readonly print: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly outline: PaintedThreeCardOutline;
  readonly thicknessPx?: number;
};

/**
 * The papercraft recipe's numbers. Colours are sRGB hex. Widths in screen px. `leak` is per channel the share of the
 * key a shadow keeps (the recipe's day leak #a0602c read as shares), so a shadow warms and never goes black.
 */
export const PAINTED_THREE_CARD_LOOK = {
  /** Wrap lighting: a face lit by clamp((n·l + wrap) / (1 + wrap)). */
  wrap: 0.3,
  /** The most a face shows of its print: pigment is never relit brighter. */
  printLightMost: 1.05,
  /** Of the card's height. */
  thickness: 0.02,
  edge: { px: 2, ink: '#3a1e0a', strength: 0.6 },
  /** Its width a share of the edge's, just inside it, on edges facing the light alone. */
  lip: { share: 0.7, colour: '#fff3d8', strength: 0.5 },
  side: { shade: 0.52, cream: '#f2e9da', towardCream: 0.08 },
  kraft: '#e8d3ac',
  /** Darkening within `reach` of the card's height from its hinge, toward `tint`. */
  contact: { reach: 0.11, strength: 0.12, tint: '#5a3214' },
  leak: [0.63, 0.38, 0.17],
} as const;

/** Linear rgb shares of the key a shadow keeps, PAINTED_THREE_CARD_LOOK.leak when left out; black for a key-only view. */
export type PaintedThreeCardLeak = readonly [number, number, number];

/** A card's paper thickness, print px. */
export const paintedThreeCardThickness = ({ heightPx, thicknessPx }: PaintedThreeCard) => thicknessPx ?? PAINTED_THREE_CARD_LOOK.thickness * heightPx;

/** How near an outline point must lie to the hinge to be on it, print px. */
const HINGE_WITHIN = 0.5;

/** A card's outline as the field reads it: its polygon (print px, y down), and whether each segment (point k to k + 1) is hinge. */
export type PaintedThreeCardCut = { readonly polygon: readonly StampPoint[]; readonly hinged: readonly boolean[] };

/** How far `p` lies from the segment `a`–`b`. */
function distanceToSegment(p: StampPoint, a: StampPoint, b: StampPoint): number {
  const ex = b.x - a.x, ey = b.y - a.y, length2 = ex * ex + ey * ey || 1;
  const along = Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.y - a.y) * ey) / length2));
  return Math.hypot(p.x - a.x - ex * along, p.y - a.y - ey * along);
}

/** `card`'s outline traced and its hinge segments marked. Refuses a shape that isn't one closed area, and a hinge no segment lies along. */
export function paintedThreeCardCut({ print, outline: { shape, hinge } }: PaintedThreeCard): PaintedThreeCardCut {
  const what = `painted three card ${print}`;
  const regions = typeof shape === 'string' ? svgPathRegions(shape).regions : [{ kind: 'polygon' as const, points: shape }];
  if (regions.length !== 1) throw new Error(`${what}: its outline is one closed shape, not ${regions.length}`);
  const polygon = checkedStampPolygon(regions[0], what);
  const hinged = polygon.map((a, k) => !!hinge && [a, polygon[(k + 1) % polygon.length]].every((p) => distanceToSegment(p, hinge.from, hinge.to) <= HINGE_WITHIN));
  if (hinge && !hinged.includes(true)) throw new Error(`${what}: its hinge from (${hinge.from.x}, ${hinge.from.y}) to (${hinge.to.x}, ${hinge.to.y}) lies along none of its outline`);
  return { polygon, hinged };
}

/** Texels along a card field's longer side: a texel spans 2 screen px on a card shown 512 px across. */
export const PAINTED_THREE_CARD_FIELD_TEXELS = 256;
/** What a field holds past any hinge, print px: far enough that nothing reads as contact. */
const PAINTED_THREE_CARD_FIELD_FAR = 1e4;

/**
 * A card's distance field, `columns` × `rows` texels each `cell` print px square, row 0 the print's top. Per texel:
 * distance to the nearest cut segment (print px, positive inside), to the hinge, and that segment's outward normal
 * (y down). Bilinear filtering keeps a straight edge's distance exact; corners round within a texel.
 */
export type PaintedThreeCardField = { readonly columns: number; readonly rows: number; readonly cell: number; readonly values: Float32Array };

/** `card`'s distance field (PaintedThreeCardField). */
export function paintedThreeCardField(card: PaintedThreeCard): PaintedThreeCardField {
  const { polygon, hinged } = paintedThreeCardCut(card), segments = stampSegmentsOf(polygon), n = polygon.length;
  const cell = Math.max(card.widthPx, card.heightPx) / PAINTED_THREE_CARD_FIELD_TEXELS;
  const columns = Math.ceil(card.widthPx / cell), rows = Math.ceil(card.heightPx / cell), values = new Float32Array(columns * rows * 4);
  // Outward is to the right of each segment's run on a ring turning clockwise on screen (y down), to its left otherwise.
  const turn = Math.sign(stampRingArea(polygon));
  const normals = polygon.map((_, k) => {
    const length = Math.sqrt(segments.length2[k]);
    return { x: (turn * segments.ey[k]) / length, y: (-turn * segments.ex[k]) / length };
  });
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      let cut = Infinity, nearest = 0, hinge = Infinity;
      for (let k = 0; k < n; k++) {
        const d2 = stampSegmentDistanceSquared(segments, k, x, y);
        if (hinged[k]) hinge = Math.min(hinge, d2);
        else if (d2 < cut) [cut, nearest] = [d2, k];
      }
      const inside = stampPolygonInside(polygon, x, y) ? 1 : -1;
      values.set([inside * Math.sqrt(cut), Math.min(Math.sqrt(hinge), PAINTED_THREE_CARD_FIELD_FAR), normals[nearest].x, normals[nearest].y], (j * columns + i) * 4);
    }
  }
  return { columns, rows, cell, values };
}

/**
 * How bright a card's lights are: `fill` frontal from the camera and `sky` a hemisphere over it, as shares of the key
 * (the recipe's 1 : 0.27 : 0.14). A key-only view sets both 0.
 */
export type PaintedThreeCardLightShares = { readonly fill: number; readonly sky: number };
export const PAINTED_THREE_CARD_LIGHT_SHARES: PaintedThreeCardLightShares = { fill: 0.27, sky: 0.14 };
/** The sky's ground side, a share of its sky side: a face turned down catches less. */
export const PAINTED_THREE_CARD_SKY_GROUND = 0.6;

/** A face's light from a light along `cosine` (n·l), wrapped (PAINTED_THREE_CARD_LOOK.wrap). */
const paintedThreeCardWrapped = (cosine: number) => Math.min(1, Math.max(0, (cosine + PAINTED_THREE_CARD_LOOK.wrap) / (1 + PAINTED_THREE_CARD_LOOK.wrap)));

/**
 * The key's, fill's and sky's intensities under `light`, scaled so a card squarely facing the camera, lit by all
 * three, shows its print as painted: what makes "never relit" hold. A face turned toward the key shows more, up to
 * PAINTED_THREE_CARD_LOOK.printLightMost. Refuses lights that leave a camera-facing card dark.
 */
export function paintedThreeCardLightStrengths(light: PaintLight, { fill, sky }: PaintedThreeCardLightShares): { key: number; fill: number; sky: number } {
  // Facing the camera: the key at its angle to the view, the fill square on, the sky edge-on (half sky, half ground).
  const facing = paintedThreeCardWrapped(paintWorldLightDirection(light).z) + fill + (sky * (1 + PAINTED_THREE_CARD_SKY_GROUND)) / 2;
  if (!(facing > 0)) throw new Error(`painted three card: a light at elevation ${light.elevation} with no fill or sky leaves a card facing the camera dark`);
  return { key: 1 / facing, fill: fill / facing, sky: sky / facing };
}
