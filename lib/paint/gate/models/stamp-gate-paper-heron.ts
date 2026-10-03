// stamp-gate-paper-heron.ts: the gate's paper heron (ENGINE 9, test 6, its sheets: no rig yet), a heron whose body lies
// on the scene's paper, whose wing is a cut-out of a warm paper, and whose wing tip is a cut-out of a cool one inside
// it, a feather left on it. Posed before painting, the body's paint is repainted on still paper; the wing's sheets
// move whole, paper and all. What the case measures of its frames is here, pure: where each part's paper went.

import { paintSimilarityOf, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import meadow from '#lib/paint/document/models/meadow.painting.ts';
import type { BrushRef, Hex, Mix, Paper, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';

const PAPER_HERON = { width: 200, height: 140 } as const;
const GRAIN = meadow({ hillTopPx: 200 }).paper.grain!.image;
const ROUND: BrushRef = { style: 'gate', brush: 'round' };
const { ultramarine, burntUmber, cerulean, quinacridoneRose } = WATERCOLOUR_PIGMENTS;

/**
 * Three papers, each its grain at its own scale, so one's tooth doesn't line up with another's: the root's a grain
 * texel a pixel, the wing's and tip's coarser.
 */
const paperOf = (color: Hex, texelsPx: number): Paper => ({ color, grain: { image: GRAIN, scale: (64 * texelsPx) / PAPER_HERON.width, depth: 0.9 }, absorbency: 0.37 });
const ROOT_PAPER = paperOf('#f3eee2', 1);
const WING_PAPER = paperOf('#ecd4ad', 1.43);
const TIP_PAPER = paperOf('#cad8e4', 1.9);

const polygon = (...xy: number[]): Region => ({ kind: 'polygon', rings: [xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1] }]))] });
const fill = (key: string, region: Region, mix: Mix, water: number) =>
  ({ key: `${key}-flood`, kind: 'fill', area: { region }, brush: ROUND, diameterPx: 18, seed: key, charge: { kind: 'paint', mix, water } } as const);

const layer = (key: string, application: ReturnType<typeof fill>) => ({ key, washes: [{ key: `${key}-wash`, applications: [application] }] });

/**
 * Water across the foot of the sheet; and a `heron` group: its `body` on the root's paper, its `wing` an own sheet of
 * warm paper holding a `vane` and a `tip`, the tip an own sheet of cool paper inside the wing's, its `feather` on it.
 */
export const STAMP_GATE_PAPER_HERON: PaintingSourceModule = {
  default: function gatePaperHeron(): PaintingDocument {
    return {
      widthPx: PAPER_HERON.width, heightPx: PAPER_HERON.height, paper: ROOT_PAPER, medium: 'watercolour',
      layers: [
        layer('water', fill('water', polygon(0, 116, 200, 116, 200, 140, 0, 140), { parts: [{ pigment: cerulean, amount: 1 }], strength: 0.45 }, 0.8)),
        {
          key: 'heron',
          children: [
            layer('body', fill('body', { kind: 'ellipse', center: { x: 66, y: 60 }, radiusX: 36, radiusY: 22 }, { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.7 }, 0.7)),
            {
              key: 'wing', sheet: { kind: 'own', paper: WING_PAPER },
              children: [
                layer('vane', fill('vane', polygon(98, 40, 146, 26, 160, 48, 114, 70), { parts: [{ pigment: ultramarine, amount: 1 }], strength: 0.6 }, 0.7)),
                {
                  key: 'tip', sheet: { kind: 'own', paper: TIP_PAPER },
                  children: [layer('feather', fill('feather', polygon(148, 30, 170, 20, 176, 34, 156, 42), { parts: [{ pigment: quinacridoneRose, amount: 1 }], strength: 0.6 }, 0.6))],
                },
              ],
            },
          ],
        },
      ],
    };
  },
};

/** The heron moved between the case's two frames, document px (ENGINE test 6). */
export const STAMP_GATE_HERON_MOVE = { x: 17, y: 9 } as const;

/** The heron turned and grown about its middle: what its similarity check and its solved still pose it by. */
export const STAMP_GATE_HERON_TURNED = paintSimilarityOf({ x: 0, y: 0, rotation: 0.25, scale: 1.15 }, { x: 104, y: 56 });

/** The paper heron's poses with its `heron` group posed by `pose`: its body's marks and its wing's sheets all follow. */
export const stampGatePaperHeronPoses = (pose: PaintSimilarity): PaintingPoses => new Map([['heron', pose]]);

/** The heron moved by STAMP_GATE_HERON_MOVE. */
export const stampGatePaperHeronMoved = () => stampGatePaperHeronPoses({ ma: 1, mb: 0, kx: STAMP_GATE_HERON_MOVE.x, ky: STAMP_GATE_HERON_MOVE.y });

/** A picture's texels as one plane each: `width` × `height`, row by row. */
type StampGatePlane = { readonly width: number; readonly height: number; readonly values: Float32Array };

/** Linear premultiplied RGBA's luminance less its 5 × 5 mean: the grain and the paint's own texture, not its tone. */
export function stampGateHighPass(rgba: Float32Array, width: number, height: number): StampGatePlane {
  const luminance = Float32Array.from({ length: width * height }, (_, i) => 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]);
  const values = luminance.map((v, i) => {
    const x = i % width, y = Math.floor(i / width);
    let sum = 0, count = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const u = x + dx, w = y + dy;
        if (u >= 0 && w >= 0 && u < width && w < height) {
          sum += luminance[w * width + u];
          count++;
        }
      }
    }
    return v - sum / count;
  });
  return { width, height, values };
}

/** Where `coverage` reaches `least` with every texel within `reach` (a square) doing so too: inside paint, clear of its edge. */
export function stampGateCoveredWithin(coverage: StampGatePlane, least: number, reach: number): Uint8Array {
  const { width, height, values } = coverage;
  return Uint8Array.from({ length: width * height }, (_, i) => {
    const x = i % width, y = Math.floor(i / width);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const u = x + dx, w = y + dy;
        if (u < 0 || w < 0 || u >= width || w >= height || values[w * width + u] < least) return 0;
      }
    }
    return 1;
  });
}

/** Search window of shifts the case looks over, document px: wide enough to hold both rest and the move. */
export const STAMP_GATE_SHIFTS = { x0: -6, x1: 24, y0: -6, y1: 16 } as const;

/**
 * The shift d within STAMP_GATE_SHIFTS at which `b` best matches `a` over the texels `within` marks: the peak of the
 * normalised cross-correlation of a(x) with b(x + d), and that peak's value.
 */
export function stampGatePeakShift(a: StampGatePlane, b: StampGatePlane, within: Uint8Array): { x: number; y: number; r: number } {
  const { width, height } = a;
  let best = { x: 0, y: 0, r: -Infinity };
  for (let dy = STAMP_GATE_SHIFTS.y0; dy <= STAMP_GATE_SHIFTS.y1; dy++) {
    for (let dx = STAMP_GATE_SHIFTS.x0; dx <= STAMP_GATE_SHIFTS.x1; dx++) {
      let ab = 0, aa = 0, bb = 0;
      for (let i = 0; i < width * height; i++) {
        const x = i % width, y = Math.floor(i / width), u = x + dx, w = y + dy;
        if (within[i] && u >= 0 && w >= 0 && u < width && w < height) {
          const p = a.values[i], q = b.values[w * width + u];
          ab += p * q;
          aa += p * p;
          bb += q * q;
        }
      }
      const r = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
      if (r > best.r) best = { x: dx, y: dy, r };
    }
  }
  return best;
}

/** A coverage plane's total and its centre, document px; null centre for none. */
export function stampGateCoverageMass({ width, values }: StampGatePlane): { total: number; centre: { x: number; y: number } | null } {
  let total = 0, x = 0, y = 0;
  values.forEach((v, i) => {
    total += v;
    x += v * ((i % width) + 0.5);
    y += v * (Math.floor(i / width) + 0.5);
  });
  return { total, centre: total > 0 ? { x: x / total, y: y / total } : null };
}
