// stamp-gate-textures.ts: the gate's painted textures (ENGINE 6.3): two paintings that wrap (`wrap: 'x'`) dissolved
// halfway and drawn as a shot's painted texture at half their size, so its resample averages across the seam and its
// sum weighs both, read by a three.js cylinder; judged by eye and held to a seam no rougher than the paint beside it.
// A band and a flood run across the seam and a bloom opens on it, on a grain that must meet itself there.
//
// The baseline's frame: the cylinder above, its seam turned to the camera, on grey; the texture flat below, each
// texel 2 px across, rolled half its width so its seam runs down the middle.

import meadow from '#lib/paint/document/models/meadow.painting.ts';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { PaintedTexture } from '#lib/paint/shot/models/shot-props.ts';
import { dissolve } from '#lib/paint/shot/models/shot-selection.ts';
import {
  STAMP_GATE_EARTH_MIX, STAMP_GATE_POOL_MIX, STAMP_GATE_ROUND_REF, STAMP_GATE_SHEET_IMAGES, STAMP_GATE_SHEET_PAPER, stampGateLine, stampGateRectangle, stampGateSheetBrushOf,
} from './stamp-gate-sheets.ts';

export const STAMP_GATE_TEXTURE_IDS = ['texture/wrapped-cylinder'] as const;
export type StampGateTextureId = (typeof STAMP_GATE_TEXTURE_IDS)[number];

/** The wrapped paintings' size, document px. */
export const STAMP_GATE_WRAPPED = { width: 256, height: 128 } as const;
/** The texture they're drawn into: half their size, so each texel averages 2 × 2 of their px. */
export const STAMP_GATE_WRAPPED_TEXTURE = { width: STAMP_GATE_WRAPPED.width / 2, height: STAMP_GATE_WRAPPED.height / 2 } as const;
/** How many frame px across the flat texture lays each texel. */
export const STAMP_GATE_TEXEL_PX = 2;

/** The flood's water, and where its bloom drops, straddling the seam. */
const FLOOD_WATER = 0.85;
const BLOOM_AT = { x: 252, y: 54 } as const;

/**
 * A wrapped sheet of the meadow's grain, a tile half its width and shallow enough that a bloom opens through it: a
 * flood from x 196 past the right edge to 316 (60 on the left), a bloom dropped on the seam once it turns matte, and
 * an earth band from 170 to 342 (86) run at `bandY`.
 */
const stampGateWrappedSource = (bandY: number): PaintingSourceModule => ({
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
            applications: [{ key: 'run', kind: 'stroke', subpaths: [stampGateLine(170, bandY, 256, bandY + 2, 342, bandY - 1)], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'band', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } }],
          }],
        },
      ],
    };
  },
});

/** The two paintings the texture dissolves between: the band low, and the band higher. */
const STAMP_GATE_WRAPPED_SOURCES = [stampGateWrappedSource(110), stampGateWrappedSource(100)] as const;

/** The cylinder, frame px at its plane: its radius and height, each texel near 2.4 px round its front. */
export const STAMP_GATE_CYLINDER = { radius: 48, height: 151, segments: 128 } as const;
/** The cylinder's view: the camera's stage, its field of view, and the grey behind the cylinder, linear light. */
export const STAMP_GATE_CYLINDER_VIEW = { width: 256, height: 176, fov: 30, grey: 0.2 } as const;
/** The baseline's frame: the cylinder's view above the flat texture, each texel STAMP_GATE_TEXEL_PX across. */
export const STAMP_GATE_TEXTURE_FRAME = { width: STAMP_GATE_CYLINDER_VIEW.width, height: STAMP_GATE_CYLINDER_VIEW.height + STAMP_GATE_TEXEL_PX * STAMP_GATE_WRAPPED_TEXTURE.height } as const;

/** How far the texture dissolves from the low band's painting to the high one's. */
const STAMP_GATE_TEXTURE_DISSOLVE = 0.5;

/** The shot's painted texture the cylinder reads: the two wrapped paintings whole, dissolved halfway, at half size. */
export function stampGateWrappedTexture(): PaintedTexture {
  const [low, high] = STAMP_GATE_WRAPPED_SOURCES.map((source) => {
    const evaluation = painting(source);
    return layersOf(evaluation, evaluation.document.layers.map(({ key }) => key));
  });
  return { id: 'wrapped', source: dissolve(low, high, STAMP_GATE_TEXTURE_DISSOLVE), widthPx: STAMP_GATE_WRAPPED_TEXTURE.width, heightPx: STAMP_GATE_WRAPPED_TEXTURE.height };
}

/**
 * What texture baseline `id` is drawn from, as text: each painting's sheets' programs and steps, the dissolve, the
 * texture's size, the cylinder, its view and the images.
 */
export function stampGateTextureInputs(id: StampGateTextureId) {
  const paintings = STAMP_GATE_WRAPPED_SOURCES.map((source) => {
    const compiled = compilePaintingSelection(painting(source), stampGateSheetBrushOf);
    return { programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps };
  });
  return stampCanonicalJson({
    id, paintings, dissolve: STAMP_GATE_TEXTURE_DISSOLVE, texture: STAMP_GATE_WRAPPED_TEXTURE, cylinder: STAMP_GATE_CYLINDER, view: STAMP_GATE_CYLINDER_VIEW, images: STAMP_GATE_SHEET_IMAGES,
  });
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
