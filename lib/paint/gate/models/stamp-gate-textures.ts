// stamp-gate-textures.ts: the gate's painted textures (ENGINE 6.3), each drawn as a shot's painted texture at half
// its paintings' size, so its resample averages across a seam, read by a three.js object through the loader and
// laid flat beside it; judged by eye and held to seams no rougher than the paint beside them.
//
// texture/wrapped-cylinder: two paintings wrapping x dissolved halfway, round a cylinder, its seam to the camera, the
// texture flat below, rolled half its width. texture/wrapped-tile: a tile wrapping both ways, a flood and a bloom on
// its corner, flat 2 × 2 beside a plane whose uv runs to 2 each way, so its handle repeats.

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

export const STAMP_GATE_TEXTURE_IDS = ['texture/wrapped-cylinder', 'texture/wrapped-tile'] as const;
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

/** The tile's size, document px: square, as the gate's square grain at half its width fits it whole both ways. */
export const STAMP_GATE_TILE = { width: 160, height: 160 } as const;
/** The texture it's drawn into: half its size, so each texel averages 2 × 2 of its px, across a seam too. */
export const STAMP_GATE_TILE_TEXTURE = { width: STAMP_GATE_TILE.width / 2, height: STAMP_GATE_TILE.height / 2 } as const;

/**
 * A tile wrapping both ways, of the meadow's grain at half its width: a flood from (110, 110) past its right and
 * bottom edges and its corner to (210, 210), a bloom dropped on the corner once it turns matte, and an earth stroke
 * across each seam alone, at y 80 and at x 80, clear of the flood.
 */
const STAMP_GATE_TILE_SOURCE: PaintingSourceModule = {
  default: function gateTile(): PaintingDocument {
    const grain = { ...meadow({ hillTopPx: 200 }).paper.grain!, scale: 0.5, depth: 0.2 };
    return {
      widthPx: STAMP_GATE_TILE.width, heightPx: STAMP_GATE_TILE.height, wrap: 'xy', paper: { ...STAMP_GATE_SHEET_PAPER, grain }, medium: 'watercolour',
      layers: [
        {
          key: 'pond',
          washes: [{
            key: 'pool',
            applications: [
              { key: 'flood', kind: 'fill', area: { region: stampGateRectangle(110, 110, 210, 210) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: 'flood', charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: FLOOD_WATER } },
              { key: 'bloom', on: 'damp', effect: 'bloom', kind: 'stamps', placements: [{ x: 157, y: 157 }], brush: STAMP_GATE_ROUND_REF, diameterPx: 22, seed: 'bloom', charge: { kind: 'water', water: 0.95 } },
            ],
          }],
        },
        {
          key: 'band',
          washes: [{
            key: 'stroke',
            applications: [{
              key: 'run', kind: 'stroke', subpaths: [stampGateLine(105, 80, 160, 82, 215, 79), stampGateLine(80, 105, 82, 160, 79, 215)], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'band',
              charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 },
            }],
          }],
        },
      ],
    };
  },
};

/** The plane the tile's texture is read on through three.js: frame px at its plane, its uv running to 2 each way. */
export const STAMP_GATE_PLANE = { size: 288, repeats: 2 } as const;
/** The plane's view: the camera's stage, its field of view, and the grey round the plane, linear light. */
export const STAMP_GATE_PLANE_VIEW = { width: 320, height: 320, fov: 30, grey: 0.2 } as const;
/** The tile's baseline frame: the tile flat 2 × 2, each texel STAMP_GATE_TEXEL_PX across, then the plane's view beside it. */
export const STAMP_GATE_TILE_FRAME = { width: 2 * STAMP_GATE_TEXEL_PX * STAMP_GATE_TILE_TEXTURE.width + STAMP_GATE_PLANE_VIEW.width, height: STAMP_GATE_PLANE_VIEW.height } as const;

/** The shot's painted texture the plane reads: the tile whole, at half size. */
export function stampGateTileTexture(): PaintedTexture {
  const evaluation = painting(STAMP_GATE_TILE_SOURCE);
  return { id: 'tile', source: layersOf(evaluation, evaluation.document.layers.map(({ key }) => key)), widthPx: STAMP_GATE_TILE_TEXTURE.width, heightPx: STAMP_GATE_TILE_TEXTURE.height };
}

/** Texture baseline `id`'s frame size. */
export const stampGateTextureFrame = (id: StampGateTextureId) => (id === 'texture/wrapped-tile' ? STAMP_GATE_TILE_FRAME : STAMP_GATE_TEXTURE_FRAME);

/** `source`'s sheets' programs and steps, compiled with the gate's brushes. */
function stampGateTexturePainting(source: PaintingSourceModule) {
  const compiled = compilePaintingSelection(painting(source), stampGateSheetBrushOf);
  return { programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps };
}

/**
 * What texture baseline `id` is drawn from, as text: each painting's sheets' programs and steps, the dissolve, the
 * texture's size, the object it's read on, its view and the images.
 */
export function stampGateTextureInputs(id: StampGateTextureId) {
  if (id === 'texture/wrapped-tile') {
    return stampCanonicalJson({
      id, paintings: [stampGateTexturePainting(STAMP_GATE_TILE_SOURCE)], texture: STAMP_GATE_TILE_TEXTURE, plane: STAMP_GATE_PLANE, view: STAMP_GATE_PLANE_VIEW, images: STAMP_GATE_SHEET_IMAGES,
    });
  }
  return stampCanonicalJson({
    id, paintings: STAMP_GATE_WRAPPED_SOURCES.map(stampGateTexturePainting), dissolve: STAMP_GATE_TEXTURE_DISSOLVE, texture: STAMP_GATE_WRAPPED_TEXTURE, cylinder: STAMP_GATE_CYLINDER,
    view: STAMP_GATE_CYLINDER_VIEW, images: STAMP_GATE_SHEET_IMAGES,
  });
}

/**
 * How rough a flat texture is across each boundary between its texels along `axis` (`rgb` its rows, `width` × `height`,
 * RGB bytes): across each column boundary for x, each row boundary for y, the mean over the other axis of the largest
 * channel's step, levels, one a boundary.
 */
export function stampGateSeamSteps(rgb: ArrayLike<number>, width: number, height: number, axis: 'x' | 'y'): number[] {
  const [along, across] = axis === 'x' ? [width, height] : [height, width];
  const at = (i: number, j: number) => (axis === 'x' ? j * width + i : i * width + j) * 3;
  return Array.from({ length: along - 1 }, (_, i) => {
    let sum = 0;
    for (let j = 0; j < across; j++) {
      const from = at(i, j), to = at(i + 1, j);
      sum += Math.max(...[0, 1, 2].map((c) => Math.abs(rgb[to + c] - rgb[from + c])));
    }
    return sum / across;
  });
}
