// stamp-gate-textures.ts: the gate's painted textures (ENGINE 6.3), each drawn as a shot's painted texture at half
// its paintings' size, so its resample averages across a seam, read by a three.js object through the loader and
// laid flat beside it; judged by eye and held to seams no rougher than the paint beside them. A case is a row of
// STAMP_GATE_TEXTURE_CASES; the page adds its three.js object.
//
// texture/wrapped-cylinder: two paintings wrapping x dissolved halfway, round a cylinder, its seam to the camera, the
// texture flat below, rolled half its width. texture/wrapped-tile: a tile wrapping both ways, a flood and a bloom on
// its corner, flat 2 × 2 beside a plane whose uv runs to 2 each way, so its handle repeats.

import meadow from '#lib/paint/document/models/meadow.painting.ts';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf, type LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampCanonicalJson, type StampCanonicalDatum } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { StampAxis, StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintedTexture } from '#lib/paint/shot/models/shot-props.ts';
import { dissolve } from '#lib/paint/shot/models/shot-selection.ts';
import {
  STAMP_GATE_EARTH_MIX, STAMP_GATE_POOL_MIX, STAMP_GATE_ROUND_REF, STAMP_GATE_SHEET_IMAGES, STAMP_GATE_SHEET_PAPER, stampGateLine, stampGateRectangle, stampGateSheetBrushOf,
} from './stamp-gate-sheets.ts';

export const STAMP_GATE_TEXTURE_IDS = ['texture/wrapped-cylinder', 'texture/wrapped-tile'] as const;
export type StampGateTextureId = (typeof STAMP_GATE_TEXTURE_IDS)[number];

/** How many frame px across the flat texture lays each texel. */
export const STAMP_GATE_TEXEL_PX = 2;

/** The flood's water. */
const FLOOD_WATER = 0.85;

/** A wrapped gate painting: its source's name, its size and wrap, its flood's rectangle, where its bloom drops, its bands. */
type StampGateWrappedPainting = {
  /** Its factory's name, which names its sheets, and so its programs. */
  readonly name: string;
  readonly size: { readonly width: number; readonly height: number };
  readonly wrap: StampWrap;
  /** x0, y0, x1, y1, run past a seam. */
  readonly flood: readonly [number, number, number, number];
  readonly bloomAt: StampPoint;
  /** Each a stroke's points, x then y (stampGateLine). */
  readonly bands: readonly (readonly number[])[];
};

/**
 * A sheet of the meadow's grain, a tile half its width and shallow enough that a bloom opens through it, wrapping as
 * `wrap`: a flood over `flood`, a bloom dropped at `bloomAt` once it turns matte, and an earth stroke along each band.
 */
function stampGateWrappedSource({ name, size, wrap, flood, bloomAt, bands }: StampGateWrappedPainting): PaintingSourceModule {
  const factory = (): PaintingDocument => {
    const grain = { ...meadow({ hillTopPx: 200 }).paper.grain!, scale: 0.5, depth: 0.2 };
    return {
      widthPx: size.width, heightPx: size.height, wrap, paper: { ...STAMP_GATE_SHEET_PAPER, grain }, medium: 'watercolour',
      layers: [
        {
          key: 'pond',
          washes: [{
            key: 'pool',
            applications: [
              { key: 'flood', kind: 'fill', area: { region: stampGateRectangle(...flood) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: 'flood', charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: FLOOD_WATER } },
              { key: 'bloom', on: 'damp', effect: 'bloom', kind: 'stamps', placements: [bloomAt], brush: STAMP_GATE_ROUND_REF, diameterPx: 22, seed: 'bloom', charge: { kind: 'water', water: 0.95 } },
            ],
          }],
        },
        {
          key: 'band',
          washes: [{
            key: 'stroke',
            applications: [{
              key: 'run', kind: 'stroke', subpaths: bands.map((band) => stampGateLine(...band)), brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'band',
              charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 },
            }],
          }],
        },
      ],
    };
  };
  return { default: Object.defineProperty(factory, 'name', { value: name }) };
}

/** Every layer of `source`, as a texture reads it. */
function stampGateWholePainting(source: PaintingSourceModule): LayerSelection {
  const evaluation = painting(source);
  return layersOf(evaluation, evaluation.document.layers.map(({ key }) => key));
}

/** `source`'s sheets' programs and steps, compiled with the gate's brushes. */
function stampGateTexturePainting(source: PaintingSourceModule) {
  const compiled = compilePaintingSelection(painting(source), stampGateSheetBrushOf);
  return { programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps };
}

/** The cylinder's paintings' size, document px. */
const STAMP_GATE_WRAPPED = { width: 256, height: 128 } as const;
/** The texture they're drawn into: half their size, so each texel averages 2 × 2 of their px. */
const STAMP_GATE_WRAPPED_TEXTURE = { width: STAMP_GATE_WRAPPED.width / 2, height: STAMP_GATE_WRAPPED.height / 2 } as const;

/**
 * The two paintings the cylinder's texture dissolves between, wrapping x: a flood from x 196 past the right edge to
 * 316 (60 on the left), a bloom dropped on the seam, and an earth band from 170 to 342 (86), low in one, higher in the other.
 */
const STAMP_GATE_WRAPPED_SOURCES = [110, 100].map((bandY) => stampGateWrappedSource({
  name: 'gateWrapped', size: STAMP_GATE_WRAPPED, wrap: 'x', flood: [196, 14, 316, 94], bloomAt: { x: 252, y: 54 }, bands: [[170, bandY, 256, bandY + 2, 342, bandY - 1]],
}));

/** The cylinder, frame px at its plane: its radius and height, each texel near 2.4 px round its front. */
export const STAMP_GATE_CYLINDER = { radius: 48, height: 151, segments: 128 } as const;
/** The cylinder's view: the camera's stage, its field of view, and the grey behind the cylinder, linear light. */
const STAMP_GATE_CYLINDER_VIEW = { width: 256, height: 176, fov: 30, grey: 0.2 } as const;
/** How far the texture dissolves from the low band's painting to the high one's. */
const STAMP_GATE_TEXTURE_DISSOLVE = 0.5;

/** The tile's size, document px: square, as the gate's square grain at half its width fits it whole both ways. */
const STAMP_GATE_TILE = { width: 160, height: 160 } as const;
/** The texture it's drawn into: half its size, so each texel averages 2 × 2 of its px, across a seam too. */
const STAMP_GATE_TILE_TEXTURE = { width: STAMP_GATE_TILE.width / 2, height: STAMP_GATE_TILE.height / 2 } as const;

/**
 * A tile wrapping both ways: a flood from (110, 110) past its right and bottom edges and its corner to (210, 210), a
 * bloom dropped on the corner, and an earth stroke across each seam alone, at y 80 and at x 80, clear of the flood.
 */
const STAMP_GATE_TILE_SOURCE = stampGateWrappedSource({
  name: 'gateTile', size: STAMP_GATE_TILE, wrap: 'xy', flood: [110, 110, 210, 210], bloomAt: { x: 157, y: 157 }, bands: [[105, 80, 160, 82, 215, 79], [80, 105, 82, 160, 79, 215]],
});

/** The plane the tile's texture is read on through three.js: frame px at its plane, its uv running to 2 each way. */
export const STAMP_GATE_PLANE = { size: 288, repeats: 2 } as const;
/** The plane's view: the camera's stage, its field of view, and the grey round the plane, linear light. */
const STAMP_GATE_PLANE_VIEW = { width: 320, height: 320, fov: 30, grey: 0.2 } as const;

/**
 * A texture case but its three.js object (the page's): its texture; the object's `view` (camera stage, field of view,
 * grey behind, linear light) at `viewAt` in the frame; the texture flat at `flat.at`, `texels` across and down,
 * STAMP_GATE_TEXEL_PX px each, rolled `roll` texels so a seam lands inside; the axes its seam check holds; its inputs.
 */
export type StampGateTextureCase = {
  readonly texture: () => PaintedTexture;
  readonly view: { readonly width: number; readonly height: number; readonly fov: number; readonly grey: number };
  readonly viewAt: StampPoint;
  readonly flat: { readonly at: StampPoint; readonly texels: { readonly width: number; readonly height: number }; readonly roll: StampPoint };
  readonly seams: readonly StampAxis[];
  readonly inputs: () => Readonly<Record<string, StampCanonicalDatum>>;
};

export const STAMP_GATE_TEXTURE_CASES: Readonly<Record<StampGateTextureId, StampGateTextureCase>> = {
  // The cylinder above, its seam (u 0 and 1) turned to the camera; the texture below, rolled half its width so its
  // seam runs down the middle.
  'texture/wrapped-cylinder': {
    texture: () => {
      const [low, high] = STAMP_GATE_WRAPPED_SOURCES.map(stampGateWholePainting);
      return { id: 'wrapped', source: dissolve(low, high, STAMP_GATE_TEXTURE_DISSOLVE), widthPx: STAMP_GATE_WRAPPED_TEXTURE.width, heightPx: STAMP_GATE_WRAPPED_TEXTURE.height };
    },
    view: STAMP_GATE_CYLINDER_VIEW,
    viewAt: { x: 0, y: 0 },
    flat: { at: { x: 0, y: STAMP_GATE_CYLINDER_VIEW.height }, texels: STAMP_GATE_WRAPPED_TEXTURE, roll: { x: STAMP_GATE_WRAPPED_TEXTURE.width / 2, y: 0 } },
    seams: ['x'],
    inputs: () => ({
      paintings: STAMP_GATE_WRAPPED_SOURCES.map(stampGateTexturePainting), dissolve: STAMP_GATE_TEXTURE_DISSOLVE, texture: STAMP_GATE_WRAPPED_TEXTURE, cylinder: STAMP_GATE_CYLINDER,
      view: STAMP_GATE_CYLINDER_VIEW,
    }),
  },
  // The tile flat 2 × 2 on the left, its seams and corner at the middle; the plane beside it, its uv to 2 each way.
  'texture/wrapped-tile': {
    texture: () => ({ id: 'tile', source: stampGateWholePainting(STAMP_GATE_TILE_SOURCE), widthPx: STAMP_GATE_TILE_TEXTURE.width, heightPx: STAMP_GATE_TILE_TEXTURE.height }),
    view: STAMP_GATE_PLANE_VIEW,
    viewAt: { x: 2 * STAMP_GATE_TEXEL_PX * STAMP_GATE_TILE_TEXTURE.width, y: 0 },
    flat: { at: { x: 0, y: 0 }, texels: { width: 2 * STAMP_GATE_TILE_TEXTURE.width, height: 2 * STAMP_GATE_TILE_TEXTURE.height }, roll: { x: 0, y: 0 } },
    seams: ['x', 'y'],
    inputs: () => ({ paintings: [stampGateTexturePainting(STAMP_GATE_TILE_SOURCE)], texture: STAMP_GATE_TILE_TEXTURE, plane: STAMP_GATE_PLANE, view: STAMP_GATE_PLANE_VIEW }),
  },
};

/** Texture baseline `id`'s frame size: the least holding its view and its flat texture. */
export function stampGateTextureFrame(id: StampGateTextureId): { width: number; height: number } {
  const { view, viewAt, flat } = STAMP_GATE_TEXTURE_CASES[id];
  return {
    width: Math.max(viewAt.x + view.width, flat.at.x + STAMP_GATE_TEXEL_PX * flat.texels.width),
    height: Math.max(viewAt.y + view.height, flat.at.y + STAMP_GATE_TEXEL_PX * flat.texels.height),
  };
}

/**
 * Where texture case `id`'s seams cross its flat texture: on each axis it holds, the boundary between flat texels on
 * which its texture's last texel meets its first, given its roll.
 */
export function stampGateTextureSeams(id: StampGateTextureId): { axis: StampAxis; at: number }[] {
  const { texture, flat: { roll }, seams } = STAMP_GATE_TEXTURE_CASES[id], { widthPx, heightPx } = texture();
  return seams.map((axis) => {
    const [side, rolled] = axis === 'x' ? [widthPx, roll.x] : [heightPx, roll.y];
    return { axis, at: side - (rolled % side) - 1 };
  });
}

/**
 * What texture baseline `id` is drawn from, as text: each painting's sheets' programs and steps, the dissolve, the
 * texture's size, the object it's read on, its view and the images.
 */
export const stampGateTextureInputs = (id: StampGateTextureId) => stampCanonicalJson({ id, ...STAMP_GATE_TEXTURE_CASES[id].inputs(), images: STAMP_GATE_SHEET_IMAGES });

/**
 * How rough a flat texture is across each boundary between its texels along `axis` (`rgb` its rows, `width` × `height`,
 * RGB bytes): across each column boundary for x, each row boundary for y, the mean over the other axis of the largest
 * channel's step, levels, one a boundary.
 */
export function stampGateSeamSteps(rgb: ArrayLike<number>, width: number, height: number, axis: StampAxis): number[] {
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
