// stamp-gate-paper-diorama.ts: the gate's paper diorama (shot/paper-diorama, through a PaintedShot): the paper kit's
// constructions risen on a painted ground, seen through its presets: a box house with a tent roof, two X trees and a
// stand-up bush on a fold-back tab, under the diorama's low warm light and tilt-shift focus. Judged by eye: the walls
// close, the tabs lie flat, the band of focus crosses the ground's middle.

import type { Hex, MixPart, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { paintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-canonical.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { paperBoxHouse, paperBoxHouseNet, paperStandUp, paperXTree } from '#lib/paint/paper-kit/models/paper-constructions.ts';
import { PAPER_DIORAMA_PITCH, paperDioramaFocus, paperDioramaLight } from '#lib/paint/paper-kit/models/paper-diorama.ts';
import type { PaintedTexture, ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import type { PaintedThreePopUp } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import { stampGateHeronLayer, stampGateHeronPaper } from './stamp-gate-paper-heron.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';
import { stampGateSheetBrushOf } from './stamp-gate-sheets.ts';

export const STAMP_GATE_PAPER_DIORAMA_ID = 'shot/paper-diorama';
export const STAMP_GATE_PAPER_DIORAMA_IDS = [STAMP_GATE_PAPER_DIORAMA_ID] as const;
export type StampGatePaperDioramaId = (typeof STAMP_GATE_PAPER_DIORAMA_IDS)[number];

/** The frame, its margin for blur, the field of view, the diorama's plane's depth (where the focus lies) and the aperture, frame px. */
const VIEW = { frame: { width: 320, height: 240 }, margin: 24, fov: 30, depth: 1, aperture: 3 } as const;
const stage = () => stampStage(VIEW.frame, VIEW.margin);

const { burntSienna, burntUmber, phthaloGreen, yellowOchre } = WATERCOLOUR_PIGMENTS;
const box = (x0: number, y0: number, x1: number, y1: number): Region => ({ kind: 'polygon', rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]] });
const rectangle = (x0: number, y0: number, x1: number, y1: number): StampPoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const HOUSE = { widthPx: 110, depthPx: 70, wallPx: 60, tabPx: 10, pitch: 0.6, overhangPx: 6 } as const;
const HOUSE_NET = paperBoxHouseNet(HOUSE);
/** A fir on a trunk, its foot the trunk's. */
const FIR = { widthPx: 80, heightPx: 150, outline: 'M 40 0 L 80 115 L 50 115 L 50 150 L 30 150 L 30 115 L 0 115 Z', foot: { from: { x: 30, y: 150 }, to: { x: 50, y: 150 } } } as const;
/** A bush standing on its foot at 60, a tab under it to 72. */
const BUSH = {
  widthPx: 90, heightPx: 72, outline: 'M 0 60 C 0 30 15 8 40 10 C 60 0 90 15 90 60 Z', foot: { from: { x: 0, y: 60 }, to: { x: 90, y: 60 } }, tab: rectangle(12, 60, 78, 72),
} as const;

/** The prints, each a painted texture of its id. */
const PRINT_IDS = ['ground', 'walls', 'roof', 'fir', 'bush'] as const;
type StampGatePaperDioramaPrint = (typeof PRINT_IDS)[number];
type StampGatePaperDioramaPatch = { readonly key: string; readonly region: Region; readonly mix: MixPart['pigment']; readonly strength: number };

const { eavesY, footY } = HOUSE_NET.walls, FRONT_X = HOUSE.depthPx;
/** A lit window's patch, its top left corner at (x, y). */
const litWindow = (key: string, x: number, y: number): StampGatePaperDioramaPatch => ({ key, region: box(x, y, x + 20, y + 18), mix: yellowOchre, strength: 0.8 });

/**
 * Each print: its size, its paper's colour, and patches of paint over it. The ground's path; the walls' door and lit
 * windows on the front, one on each gable; the roof's darker back slope; the fir's trunk; the bush's shade.
 */
const PRINTS: Readonly<Record<StampGatePaperDioramaPrint, { readonly width: number; readonly height: number; readonly paper: Hex; readonly patches: readonly StampGatePaperDioramaPatch[] }>> = {
  ground: { width: 400, height: 300, paper: '#a9bd83', patches: [{ key: 'path', region: box(150, 210, 210, 300), mix: yellowOchre, strength: 0.5 }] },
  walls: {
    width: HOUSE_NET.walls.widthPx, height: HOUSE_NET.walls.heightPx, paper: '#eadcbc',
    patches: [
      { key: 'door', region: box(FRONT_X + 45, footY - 32, FRONT_X + 65, footY), mix: burntUmber, strength: 0.8 },
      litWindow('front-left', FRONT_X + 14, eavesY + 12), litWindow('front-right', FRONT_X + 78, eavesY + 12), litWindow('left', 25, eavesY + 14),
      litWindow('right', FRONT_X + HOUSE.widthPx + 25, eavesY + 14),
    ],
  },
  roof: { width: HOUSE_NET.roof.widthPx, height: HOUSE_NET.roof.heightPx, paper: '#c0614a', patches: [{ key: 'back', region: box(0, 0, HOUSE_NET.roof.widthPx, HOUSE_NET.roof.ridgeY), mix: burntSienna, strength: 0.5 }] },
  fir: { width: FIR.widthPx, height: FIR.heightPx, paper: '#5f8a4f', patches: [{ key: 'trunk', region: box(28, 112, 52, 150), mix: burntUmber, strength: 0.8 }] },
  bush: { width: BUSH.widthPx, height: BUSH.heightPx, paper: '#88a64a', patches: [{ key: 'shade', region: box(0, 36, 90, 60), mix: phthaloGreen, strength: 0.4 }] },
};

/** A print as a painting: its paper, then each patch a wash of one pigment. */
function printPainting(print: StampGatePaperDioramaPrint): PaintingSourceModule {
  const { width, height, paper, patches } = PRINTS[print];
  const factory = (): PaintingDocument => ({
    widthPx: width, heightPx: height, paper: stampGateHeronPaper(paper, 1), medium: 'watercolour',
    layers: [{ key: 'bare', washes: [] }, ...patches.map(({ key, region, mix, strength }) => stampGateHeronLayer(key, region, { parts: [{ pigment: mix, amount: 1 }], strength }, 0.5))],
  });
  return { default: Object.defineProperty(factory, 'name', { value: `gatePaperDiorama_${print}` }) };
}

/** Every print's painted texture, its id the print's. */
function stampGatePaperDioramaTextures(): PaintedTexture[] {
  return PRINT_IDS.map((print) => {
    const { width, height, patches } = PRINTS[print];
    return { id: print, source: layersOf(painting(printPainting(print)), ['bare', ...patches.map(({ key }) => key)]), widthPx: width, heightPx: height };
  });
}

/** The diorama at full rise, centred in the frame. */
export const STAMP_GATE_PAPER_DIORAMA_POP_UP: PaintedThreePopUp = {
  at: { x: VIEW.frame.width / 2, y: VIEW.frame.height / 2 }, pitch: PAPER_DIORAMA_PITCH, scale: 0.7,
  base: { print: 'ground', widthPx: 400, heightPx: 300, root: { outline: rectangle(0, 0, 400, 300) } },
  sheets: [
    ...paperBoxHouse({ ...HOUSE, rise: 1 })({ id: 'house', print: { walls: 'walls', roof: 'roof' }, at: { x: 150, y: 175 }, yaw: 0.35 }),
    ...paperXTree({ ...FIR, rise: 1 })({ id: 'fir', print: 'fir', at: { x: 300, y: 150 }, yaw: 0.3 }),
    ...paperXTree({ ...FIR, rise: 1 })({ id: 'far-fir', print: 'fir', at: { x: 70, y: 90 }, yaw: -0.2 }),
    ...paperStandUp({ ...BUSH, rise: 1 })({ id: 'bush', print: 'bush', at: { x: 285, y: 245 } }),
  ],
};

/** The diorama's light: the shot's key, and the pop-up's leak and lights. */
export const STAMP_GATE_PAPER_DIORAMA_LIGHT = paperDioramaLight(PAPER_DIORAMA_PITCH);

/** The sky behind the ground: a flat pale blue over the stage. */
function stampGatePaperDioramaSky(): StampPictureRgba {
  const { width: w, height: h } = stage(), rgba = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([0.55, 0.62, 0.72, 1], i * 4);
  return { box: { x: 0, y: 0, w, h }, rgba };
}

/** The shot, its diorama built by `build` (the page's paintedThreePopUp of STAMP_GATE_PAPER_DIORAMA_POP_UP). */
export function stampGatePaperDioramaShot(build: ThreeSource['build']): StampGateShot {
  const focus = paperDioramaFocus({ focus: VIEW.depth, aperture: VIEW.aperture, pitch: PAPER_DIORAMA_PITCH });
  return {
    camera: { stage: stage(), fov: VIEW.fov, lens: { bloom: 0, shutter: 'shut' }, plays: [paintCameraPlay({ kind: 'focus', value: focus }, { clock: { at: 0 }, origin: 'the diorama focus' })] },
    light: STAMP_GATE_PAPER_DIORAMA_LIGHT.light,
    planes: [
      { id: 'sky', depth: 3, source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: () => Promise.resolve(stampGatePaperDioramaSky()) } },
      { id: 'diorama', depth: VIEW.depth, source: { kind: 'three', build } },
    ],
    paintedTextures: stampGatePaperDioramaTextures(),
  };
}

export const stampGatePaperDioramaFrame = () => VIEW.frame;

/** What the baseline is drawn from, as text: the prints' programs and steps, the pop-up, its light, the view. */
export const stampGatePaperDioramaInputs = (id: StampGatePaperDioramaId) => stampCanonicalJson({
  id, view: VIEW, popUp: STAMP_GATE_PAPER_DIORAMA_POP_UP, light: STAMP_GATE_PAPER_DIORAMA_LIGHT,
  prints: PRINT_IDS.map((print) => {
    const compiled = compilePaintingSelection(painting(printPainting(print)), stampGateSheetBrushOf);
    return { print, programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps };
  }),
});
