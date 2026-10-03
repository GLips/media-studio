// stamp-gate-textures.ts: the gate's painted textures (ENGINE 6.3): a painting that wraps (`wrap: 'x'`) drawn as a
// shot's painted texture and read by a three.js cylinder, judged by eye against its accepted baseline and held to a
// seam no rougher than the paint beside it. A band and a flood run across the seam, and a bloom opens on it, on a
// paper whose grain must meet itself there.
//
// The baseline's frame: the cylinder above, its seam turned to the camera, on grey; the texture flat below, rolled
// half its width so its seam runs down the middle.

import meadow from '#lib/paint/document/models/meadow.painting.ts';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { PaintedTexture } from '#lib/paint/shot/models/shot-props.ts';
import {
  STAMP_GATE_EARTH_MIX, STAMP_GATE_POOL_MIX, STAMP_GATE_ROUND_REF, STAMP_GATE_SHEET_IMAGES, STAMP_GATE_SHEET_PAPER, stampGateLine, stampGateRectangle, stampGateSheetBrushOf,
} from './stamp-gate-sheets.ts';

export const STAMP_GATE_TEXTURE_IDS = ['texture/wrapped-cylinder'] as const;
export type StampGateTextureId = (typeof STAMP_GATE_TEXTURE_IDS)[number];

/** The wrapped painting's size, document px, and the texture it's drawn into the same. */
export const STAMP_GATE_WRAPPED = { width: 256, height: 128 } as const;

/** The flood's water, and where its bloom drops, straddling the seam. */
const FLOOD_WATER = 0.85;
const BLOOM_AT = { x: 252, y: 54 } as const;

/**
 * A wrapped sheet of the meadow's grain, a tile half its width and shallow enough that a bloom opens through it: a
 * flood from x 196 past the right edge to 316 (60 on the left), a bloom dropped on the seam once it turns matte, and
 * an earth band below run from 170 to 342 (86).
 */
export const STAMP_GATE_WRAPPED_SOURCE: PaintingSourceModule = {
  default: function gateWrapped(): PaintingDocument {
    const grain = { ...meadow({ hillTopPx: 200 }).paper.grain!, scale: 0.5, depth: 0.2 };
    return {
      widthPx: STAMP_GATE_WRAPPED.width, heightPx: STAMP_GATE_WRAPPED.height, wrap: 'x', paper: { ...STAMP_GATE_SHEET_PAPER, grain }, medium: 'watercolour',
      layers: [
        {
          key: 'pond',
          washes: [{
            key: 'pool',
            applications: [
              { key: 'flood', kind: 'fill', area: { region: stampGateRectangle(196, 14, 316, 94) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: 'flood', charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: FLOOD_WATER } },
              { key: 'bloom', on: 'damp', effect: 'bloom', kind: 'stamps', placements: [BLOOM_AT], brush: STAMP_GATE_ROUND_REF, diameterPx: 22, seed: 'bloom', charge: { kind: 'water', water: 0.95 } },
            ],
          }],
        },
        {
          key: 'band',
          washes: [{
            key: 'stroke',
            applications: [{ key: 'run', kind: 'stroke', subpaths: [stampGateLine(170, 110, 256, 112, 342, 109)], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'band', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } }],
          }],
        },
      ],
    };
  },
};

/** The cylinder, frame px at its plane: its radius and height, each texel near 1.18 px round its front. */
export const STAMP_GATE_CYLINDER = { radius: 48, height: 151, segments: 128 } as const;
/** The cylinder's view: the camera's stage, its field of view, and the grey behind the cylinder, linear light. */
export const STAMP_GATE_CYLINDER_VIEW = { width: 256, height: 176, fov: 30, grey: 0.2 } as const;
/** The baseline's frame: the cylinder's view above the flat texture. */
export const STAMP_GATE_TEXTURE_FRAME = { width: STAMP_GATE_WRAPPED.width, height: STAMP_GATE_CYLINDER_VIEW.height + STAMP_GATE_WRAPPED.height } as const;

/** The shot's painted texture the cylinder reads: the whole wrapped painting, at its size. */
export function stampGateWrappedTexture(): PaintedTexture {
  const evaluation = painting(STAMP_GATE_WRAPPED_SOURCE);
  return { id: 'wrapped', source: layersOf(evaluation, evaluation.document.layers.map(({ key }) => key)), widthPx: STAMP_GATE_WRAPPED.width, heightPx: STAMP_GATE_WRAPPED.height };
}

/** What texture baseline `id` is drawn from, as text: its sheets' programs and steps, the cylinder, its view and the images. */
export function stampGateTextureInputs(id: StampGateTextureId) {
  const compiled = compilePaintingSelection(painting(STAMP_GATE_WRAPPED_SOURCE), stampGateSheetBrushOf);
  return stampCanonicalJson({ id, programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps, cylinder: STAMP_GATE_CYLINDER, view: STAMP_GATE_CYLINDER_VIEW, images: STAMP_GATE_SHEET_IMAGES });
}

/**
 * How rough the flat texture is across each column boundary of `rgb` (its rows, `width` × `height`, RGB bytes,
 * rolled so the seam lies between columns width / 2 − 1 and width / 2): the mean over rows of the largest channel's
 * step, levels, one a boundary.
 */
export function stampGateColumnSteps(rgb: ArrayLike<number>, width: number, height: number): number[] {
  return Array.from({ length: width - 1 }, (_, x) => {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const at = (y * width + x) * 3;
      sum += Math.max(...[0, 1, 2].map((c) => Math.abs(rgb[at + 3 + c] - rgb[at + c])));
    }
    return sum / height;
  });
}
