// stamp-gate-paper-card.ts: the gate's three.js paper cards (shot/paper-card), five pop-up views under the paper key:
// a house-shaped test card square to the camera under the key alone (the recipe's key-only diagnosis), then fully lit;
// the card half risen; a small pop-up mid-rise; a box folded from one sheet with a tent roof, a window and a tab.
// Prints are flat colours, so the checks know their values. A sixth view, a diorama, goes through a shot's lens.
//
// Held to: the shadow falling away from the light, the recipe's depth and warm; a cut edge on the cut sides, none on
// the hinge; the lip toward the light only; the print as painted where the card faces the camera, never past 1.05.

import { Matrix4, Vector3 } from 'three';
import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import { presentationValueAt } from '#lib/paint/animation/models/paint-value.ts';
import type { Hex, Layer, Mix, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import type { PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { TITANIUM_WHITE } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintCameraWorld, paintWorldLightDirection, paintWorldPlane, type PaintCameraWorld } from '#lib/paint/animation/models/paint-camera-world.ts';
import { linearToSrgb, srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-canonical.ts';
import { PAPER_KEY_LIGHT } from '#lib/paint/painting/models/stamp-form.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampPolygonInside, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintedThreeShotCamera } from '#lib/paint/three-layers/models/painted-three-camera.ts';
import { PAINTED_THREE_PAPER_LOOK } from '#lib/paint/three-layers/models/painted-three-paper.ts';
import { paintedThreePopUpRig, PAINTED_THREE_POP_UP_BASE, type PaintedThreePopUp, type PaintedThreePopUpSheet } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import { PAINTED_THREE_SHEET_ROOT, type PaintedThreeSheet, type PaintedThreeSheetFold } from '#lib/paint/three-layers/models/painted-three-sheet.ts';
import { shotCameraProject } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_ROUND_REF } from './stamp-gate-sheets.ts';
import { stampGateShotSpan } from './stamp-gate-shot-span.ts';

export const STAMP_GATE_PAPER_CARD_ID = 'shot/paper-card';
export const STAMP_GATE_PAPER_CARD_IDS = [STAMP_GATE_PAPER_CARD_ID] as const;
export type StampGatePaperCardId = (typeof STAMP_GATE_PAPER_CARD_IDS)[number];

/** Each view's frame, the camera's field of view, and the depth its pop-up's plane lies at. */
const STAMP_GATE_PAPER_CARD_VIEW = { frame: { width: 320, height: 240 }, fov: 30, depth: 1 } as const;
/** The grey a view's clear lies over, linear. */
const STAMP_GATE_PAPER_CARD_CLEAR = 0.18;

/** A flat print: `ground` over all of it, each of `patches` (a polygon, its colour) over part, the last on top. Colours sRGB hex. */
export type StampGatePaperCardPrint = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly ground: string;
  readonly patches?: readonly { readonly points: readonly StampPoint[]; readonly colour: string }[];
};

const rectangle = (x0: number, y0: number, x1: number, y1: number): StampPoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/**
 * The box's net, its own px before it's turned onto its print (y down): the front wall standing on its foot at y 0,
 * the side walls and back folding off it round the box, the roof's two slopes above the front, a tab below the right
 * wall. A window is cut through the front.
 */
const BOX = { wide: 100, deep: 70, tall: 70, rise: 30, tab: 18, inset: 10 } as const;
const BOX_SLOPE = Math.atan2(BOX.rise, BOX.deep / 2), BOX_ROOF = Math.hypot(BOX.rise, BOX.deep / 2);
/** Radians the box's net is turned on its print, so it stands turned on the base and shows its right side. */
const BOX_TURN = -0.45;
/** How far the turned net lies in from its print's edges, px. */
const BOX_MARGIN = 4;
const boxNet = (() => {
  const { wide, deep, tall, tab, inset } = BOX;
  const faces = {
    front: rectangle(0, -tall, wide, 0), left: rectangle(-deep, -tall, 0, 0), right: rectangle(wide, -tall, wide + deep, 0), back: rectangle(wide + deep, -tall, 2 * wide + deep, 0),
    roofFront: rectangle(0, -tall - BOX_ROOF, wide, -tall), roofBack: rectangle(0, -tall - 2 * BOX_ROOF, wide, -tall - BOX_ROOF), tab: rectangle(wide + inset, 0, wide + deep - inset, tab),
    window: rectangle(14, -tall + 14, 40, -tall + 36), door: rectangle(58, -36, 82, 0), sideWindow: rectangle(wide + 22, -tall + 18, wide + 48, -tall + 40),
  };
  const turn = (p: StampPoint) => ({ x: p.x * Math.cos(BOX_TURN) - p.y * Math.sin(BOX_TURN), y: p.x * Math.sin(BOX_TURN) + p.y * Math.cos(BOX_TURN) });
  const all = Object.values(faces).flat().map(turn), x0 = Math.min(...all.map(({ x }) => x)), y0 = Math.min(...all.map(({ y }) => y));
  const place = (p: StampPoint) => {
    const { x, y } = turn(p);
    return { x: x - x0 + BOX_MARGIN, y: y - y0 + BOX_MARGIN };
  };
  return {
    place, face: (id: keyof typeof faces) => faces[id].map(place),
    width: Math.ceil(Math.max(...all.map(({ x }) => x)) - x0 + 2 * BOX_MARGIN), height: Math.ceil(Math.max(...all.map(({ y }) => y)) - y0 + 2 * BOX_MARGIN),
  };
})();

/** The test card's patch, where its print is read. */
const HOUSE_PATCH = { x0: 50, y0: 100, x1: 90, y1: 140 } as const;

/** The prints: the test card's sage with a red patch, the base's sand, the tree's green, the pennant's red; the box's cream walls, red roof, dark door and yellow window. */
export const STAMP_GATE_PAPER_CARD_PRINTS: readonly StampGatePaperCardPrint[] = [
  { id: 'house', width: 140, height: 200, ground: '#86a07c', patches: [{ points: rectangle(HOUSE_PATCH.x0, HOUSE_PATCH.y0, HOUSE_PATCH.x1, HOUSE_PATCH.y1), colour: '#b5523b' }] },
  { id: 'base', width: 400, height: 300, ground: '#cdb98f' },
  { id: 'tree', width: 120, height: 220, ground: '#6f8a55', patches: [{ points: rectangle(45, 170, 75, 220), colour: '#7a5232' }] },
  { id: 'pennant', width: 60, height: 30, ground: '#b5523b' },
  {
    id: 'box', width: boxNet.width, height: boxNet.height, ground: '#e3cfa8',
    patches: [
      { points: boxNet.face('roofFront'), colour: '#a4503a' }, { points: boxNet.face('roofBack'), colour: '#8e4632' },
      { points: boxNet.face('door'), colour: '#6b4a2e' }, { points: boxNet.face('sideWindow'), colour: '#e8c25a' },
    ],
  },
];

/** A print's colour at its px (x, y), sRGB 0..1: as the page writes its texture. */
export function stampGatePaperCardPrintAt({ ground, patches = [] }: StampGatePaperCardPrint, x: number, y: number): readonly [number, number, number] {
  const hex = patches.findLast(({ points }) => stampPolygonInside(points, x, y))?.colour ?? ground;
  const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

const BASE: PaintedThreeSheet = { print: 'base', widthPx: 400, heightPx: 300, root: { outline: rectangle(0, 0, 400, 300) } };
/** The test card's outline: a house, walls 0 and 140, eaves at 30, its ridge at 0, standing on its foot at 200. */
const HOUSE_OUTLINE: readonly StampPoint[] = [{ x: 0, y: 200 }, { x: 140, y: 200 }, { x: 140, y: 30 }, { x: 70, y: 0 }, { x: 0, y: 30 }];
const HOUSE: PaintedThreeSheet = { print: 'house', widthPx: 140, heightPx: 200, root: { outline: HOUSE_OUTLINE, hinge: { from: { x: 0, y: 200 }, to: { x: 140, y: 200 } } } };
/** A fir on a trunk, standing on its trunk's foot, cut from SVG path data as a traced drawing would be. */
const TREE: PaintedThreeSheet = {
  print: 'tree', widthPx: 120, heightPx: 220,
  root: { outline: 'M 60 0 L 120 170 L 75 170 L 75 220 L 45 220 L 45 170 L 0 170 Z', hinge: { from: { x: 45, y: 220 }, to: { x: 75, y: 220 } } },
};
/** A pennant hinged along its left edge, folding out sideways. */
const PENNANT: PaintedThreeSheet = {
  print: 'pennant', widthPx: 60, heightPx: 30, root: { outline: [{ x: 0, y: 0 }, { x: 60, y: 15 }, { x: 0, y: 30 }], hinge: { from: { x: 0, y: 0 }, to: { x: 0, y: 30 } } },
};

/**
 * The box as one sheet: its front wall the root, standing on its foot; the walls folded back square round it, the
 * roof's slopes folded off the front's top into a tent, and the tab folded out flat from the right wall's foot.
 */
const BOX_SHEET: PaintedThreeSheet = (() => {
  const { wide, deep, tall, inset } = BOX, { place, face } = boxNet;
  const edge = (from: StampPoint, to: StampPoint) => ({ from: place(from), to: place(to) });
  const fold = (id: Parameters<typeof face>[0], on: string, hinge: { from: StampPoint; to: StampPoint }, angle: number): PaintedThreeSheetFold => ({ id, on, outline: face(id), hinge, angle });
  return {
    print: 'box', widthPx: boxNet.width, heightPx: boxNet.height,
    root: { outline: face('front'), holes: [face('window')], hinge: edge({ x: 0, y: 0 }, { x: wide, y: 0 }) },
    folds: [
      fold('left', PAINTED_THREE_SHEET_ROOT, edge({ x: 0, y: -tall }, { x: 0, y: 0 }), -Math.PI / 2),
      fold('right', PAINTED_THREE_SHEET_ROOT, edge({ x: wide, y: -tall }, { x: wide, y: 0 }), -Math.PI / 2),
      fold('back', 'right', edge({ x: wide + deep, y: -tall }, { x: wide + deep, y: 0 }), -Math.PI / 2),
      fold('roofFront', PAINTED_THREE_SHEET_ROOT, edge({ x: 0, y: -tall }, { x: wide, y: -tall }), BOX_SLOPE - Math.PI / 2),
      fold('roofBack', 'roofFront', edge({ x: 0, y: -tall - BOX_ROOF }, { x: wide, y: -tall - BOX_ROOF }), -2 * BOX_SLOPE),
      fold('tab', 'right', edge({ x: wide + inset, y: 0 }, { x: wide + deep - inset, y: 0 }), Math.PI / 2),
    ],
  };
})();

/** Radians the base tips back from facing the camera: the recipe's 40–55° down. */
const PITCH = 0.9;
/** A rise over `seconds` from `from` s, linear, to `angle`. */
const rising = (from: number, seconds: number, angle: number) => ({ at }: { at: number }) => angle * Math.min(1, Math.max(0, (at - from) / seconds));

export const STAMP_GATE_PAPER_CARD_VIEW_IDS = ['key', 'lit', 'rising', 'pop-up', 'box'] as const;
export type StampGatePaperCardViewId = (typeof STAMP_GATE_PAPER_CARD_VIEW_IDS)[number];

/** A view: its pop-up, the moment it's drawn at, and whether its lights are the key alone. */
type StampGatePaperCardView = { readonly popUp: PaintedThreePopUp; readonly at: number; readonly keyOnly: boolean };

/** The test card on the base, standing up by `angle`. */
const testCard = (angle: number): PaintedThreePopUp => ({
  at: { x: 160, y: 150 }, pitch: PITCH, scale: 0.7, base: BASE, sheets: [{ ...HOUSE, id: 'house', at: { x: 200, y: 200 }, angle }],
});

export const STAMP_GATE_PAPER_CARD_VIEWS: Readonly<Record<StampGatePaperCardViewId, StampGatePaperCardView>> = {
  key: { popUp: testCard(PITCH), at: 0, keyOnly: true },
  lit: { popUp: testCard(PITCH), at: 0, keyOnly: false },
  rising: { popUp: testCard(PITCH / 2), at: 0, keyOnly: false },
  'pop-up': {
    popUp: {
      at: { x: 160, y: 140 }, pitch: PITCH, scale: 0.5, base: BASE,
      sheets: [
        { ...HOUSE, id: 'house', at: { x: 140, y: 220 }, angle: rising(0, 0.8, PITCH) },
        { ...TREE, id: 'tree', at: { x: 290, y: 180 }, angle: rising(0.15, 0.8, PITCH) },
        { ...PENNANT, id: 'pennant', on: { sheet: 'house' }, at: { x: 120, y: 95 }, angle: rising(0.3, 0.8, 1.4) },
      ] satisfies PaintedThreePopUpSheet[],
    },
    at: 0.6, keyOnly: false,
  },
  box: { popUp: { at: { x: 160, y: 130 }, pitch: PITCH, scale: 0.6, base: BASE, sheets: [{ ...BOX_SHEET, id: 'box', at: { x: 190, y: 210 }, angle: Math.PI / 2 }] }, at: 0, keyOnly: false },
};

/** The camera seeing every view: a still lens, a three plane per view at the pop-ups' depth. */
export function stampGatePaperCardCamera(): { readonly camera: PaintCamera; readonly world: PaintCameraWorld } {
  const { frame, fov, depth } = STAMP_GATE_PAPER_CARD_VIEW, stage = stampStage(frame);
  const built = buildPaintCamera({
    stage, fov, lens: { bloom: 0, shutter: 'shut' }, span: stampGateShotSpan(STAMP_GATE_PAPER_CARD_VIEW_IDS.map((id) => STAMP_GATE_PAPER_CARD_VIEWS[id].at)),
    planes: STAMP_GATE_PAPER_CARD_VIEW_IDS.map((id) => ({ id, depth, kind: 'three' as const })),
  });
  if (!built.ok) throw new Error(`stamp gate: ${STAMP_GATE_PAPER_CARD_ID}'s camera: ${built.problems.join('; ')}`);
  return { camera: built.camera, world: paintCameraWorld(stage, { fov }) };
}

/** The baseline's frame: the views side by side, then the diorama. */
export const stampGatePaperCardFrame = () => ({ width: STAMP_GATE_PAPER_CARD_VIEW.frame.width * (STAMP_GATE_PAPER_CARD_VIEW_IDS.length + 1), height: STAMP_GATE_PAPER_CARD_VIEW.frame.height });

/** What the baseline is drawn from, as text: the views' pop-ups are their angles at their moments. */
export const stampGatePaperCardInputs = (id: StampGatePaperCardId) => stampCanonicalJson({
  id, view: STAMP_GATE_PAPER_CARD_VIEW, clear: STAMP_GATE_PAPER_CARD_CLEAR, prints: STAMP_GATE_PAPER_CARD_PRINTS, look: PAINTED_THREE_PAPER_LOOK, light: PAPER_KEY_LIGHT,
  views: STAMP_GATE_PAPER_CARD_VIEW_IDS.map((view) => {
    const { popUp, at, keyOnly } = STAMP_GATE_PAPER_CARD_VIEWS[view], moment = paintMoment(at);
    const sheet = ({ print, widthPx, heightPx, root, folds = [] }: PaintedThreeSheet) => ({
      print, widthPx, heightPx, root,
      folds: folds.map(({ id: face, on, outline, holes, hinge, angle }) => ({ id: face, on: on ?? null, outline, holes: holes ?? null, hinge, angle: presentationValueAt(angle, moment) })),
    });
    return {
      view, at, keyOnly, pitch: popUp.pitch, scale: popUp.scale ?? 1, base: sheet(popUp.base),
      sheets: popUp.sheets.map((each) => ({ id: each.id, sheet: sheet(each), on: each.on ?? null, at: each.at, angle: presentationValueAt(each.angle, moment) })),
    };
  }),
  diorama: stampGatePaperCardDioramaInputs(),
});

/** A view as rendered: premultiplied linear rgba floats over the frame, row by row. */
export type StampGatePaperCardPicture = { readonly width: number; readonly height: number; readonly values: Float32Array };
/** Each view as rendered, by its id. */
export type StampGatePaperCardPictureOf = (view: StampGatePaperCardViewId) => StampGatePaperCardPicture;

/** A view's picture over the clear grey, encoded: RGBA bytes. */
export function stampGatePaperCardBytes({ width, height, values }: StampGatePaperCardPicture): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const cover = values[i * 4 + 3];
    for (let c = 0; c < 3; c++) bytes[i * 4 + c] = Math.round(255 * linearToSrgb(Math.min(1, values[i * 4 + c] + (1 - cover) * STAMP_GATE_PAPER_CARD_CLEAR)));
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

/** A picture's linear colour at `at` (px), bilinear between pixel centres. Refuses a point off it: the case misplaced it. */
function stampGatePaperCardRgbAt({ width, height, values }: StampGatePaperCardPicture, { x, y }: StampPoint): [number, number, number] {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  if (!(x0 >= 0 && y0 >= 0 && x0 + 1 < width && y0 + 1 < height)) throw new Error(`stamp gate: ${STAMP_GATE_PAPER_CARD_ID} reads (${x.toFixed(1)}, ${y.toFixed(1)}), off its ${width} × ${height} view`);
  const at = (i: number, j: number, c: number) => values[(j * width + i) * 4 + c];
  const channel = (c: number) => (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy;
  return [channel(0), channel(1), channel(2)];
}

const luma = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Red over blue: how warm a colour is. */
const warmth = ([r, , b]: readonly number[]) => r / b;
const text = (v: number) => v.toFixed(3);

/** A sheet's root face's matrix in a pose. */
const rootOf = (pose: ReadonlyMap<string, ReadonlyMap<string, Matrix4>>, sheet: string) => pose.get(sheet)!.get(PAINTED_THREE_SHEET_ROOT)!;

/** A view's pose, read through its camera: where a card's point (sheet space) lands in its picture, and its rig's matrices. */
function stampGatePaperCardSeen(view: StampGatePaperCardViewId) {
  const { popUp, at } = STAMP_GATE_PAPER_CARD_VIEWS[view], { camera, world } = stampGatePaperCardCamera();
  const plane = paintWorldPlane(world, STAMP_GATE_PAPER_CARD_VIEW.depth), centre = plane.point(popUp.at), rig = paintedThreePopUpRig(popUp), pose = rig.poseAt(paintMoment(at));
  const scale = plane.length(popUp.scale ?? 1), root = new Matrix4().makeTranslation(centre.x, centre.y, centre.z).multiply(new Matrix4().makeScale(scale, scale, scale));
  const shot = paintedThreeShotCamera(camera, world, 0, paintMoment(at), null);
  const project = (card: string, point: Vector3): StampPoint => {
    const seen = shotCameraProject(shot, point.clone().applyMatrix4(rootOf(pose, card)).applyMatrix4(root));
    if (!seen) throw new Error(`stamp gate: ${STAMP_GATE_PAPER_CARD_ID}'s ${card} lies behind the camera`);
    return seen;
  };
  // A print px on a sheet's front, in sheet space.
  const front = (card: string, { x, y }: StampPoint) => new Vector3(x, -y, rig.folding.get(card)!.thickness / 2);
  return { pose, project, front };
}

/**
 * Where on the base the test card's print px `on` casts its shadow in view `view`, as base print px: along the key
 * from it onto the base's front.
 */
function stampGatePaperCardShadowOf(view: StampGatePaperCardViewId, on: StampPoint): StampPoint {
  const { pose, front } = stampGatePaperCardSeen(view), base = rootOf(pose, PAINTED_THREE_POP_UP_BASE);
  const toward = paintWorldLightDirection(PAPER_KEY_LIGHT), light = new Vector3(toward.x, toward.y, toward.z);
  const caster = front('house', on).applyMatrix4(rootOf(pose, 'house')), onBase = front(PAINTED_THREE_POP_UP_BASE, { x: 0, y: 0 }).applyMatrix4(base);
  const normal = new Vector3(0, 0, 1).transformDirection(base), cast = caster.addScaledVector(light, -caster.clone().sub(onBase).dot(normal) / light.dot(normal));
  const local = cast.applyMatrix4(base.clone().invert());
  return { x: local.x, y: -local.y };
}

/** How deep the test card's shadow on the base may be, 1 − shadow/lit luma: the recipe's broad cast shadow, its penumbra and tone allowed for. */
const STAMP_GATE_PAPER_CARD_SHADOW = { least: 0.13, most: 0.45 } as const;
/**
 * The card's print px whose shadows are searched for the deepest the camera sees: its right wall's half, every 5 px.
 * The key comes from high in front, so the shadow falls mostly behind the card and shows only right of it.
 */
const STAMP_GATE_PAPER_CARD_CASTERS: readonly StampPoint[] = Array.from({ length: 9 * 35 }, (_, i) => ({ x: 100 + 5 * (i % 9), y: 30 + 5 * Math.floor(i / 9) }));
/** How far right of the card's silhouette a shadow is read, screen px: clear of its antialiased edge. */
const STAMP_GATE_PAPER_CARD_CLEAR_OF_CARD = 3;

/**
 * The shadow, read in the lit view: the darkest of the base the card's right half casts on, where the camera sees it
 * past the card, beside the base mirrored across the card's hinge, where the key falls unblocked. Darker by the
 * recipe's depth, and warmer: the leak keeps red over blue.
 */
function stampGatePaperCardShadowChecks(picture: StampGatePaperCardPicture): StampGateWashCheck[] {
  const { project, front } = stampGatePaperCardSeen('lit'), hingeX = STAMP_GATE_PAPER_CARD_VIEWS.lit.popUp.sheets[0].at.x;
  const right = Math.max(...HOUSE_OUTLINE.map((p) => project('house', front('house', p)).x));
  const onBase = (at: StampPoint) => stampGatePaperCardRgbAt(picture, project(PAINTED_THREE_POP_UP_BASE, front(PAINTED_THREE_POP_UP_BASE, at)));
  const seen = STAMP_GATE_PAPER_CARD_CASTERS.map((caster) => stampGatePaperCardShadowOf('lit', caster))
    .filter((cast) => project(PAINTED_THREE_POP_UP_BASE, front(PAINTED_THREE_POP_UP_BASE, cast)).x >= right + STAMP_GATE_PAPER_CARD_CLEAR_OF_CARD);
  if (!seen.length) throw new Error(`stamp gate: ${STAMP_GATE_PAPER_CARD_ID}'s card casts no shadow the camera sees past it`);
  const cast = seen.reduce((darkest, each) => (luma(onBase(each)) < luma(onBase(darkest)) ? each : darkest)), clear = { x: 2 * hingeX - cast.x, y: cast.y };
  const shadow = onBase(cast), lit = onBase(clear);
  const depth = 1 - luma(shadow) / luma(lit);
  const where = `the base at (${cast.x.toFixed(0)}, ${cast.y.toFixed(0)}) beside (${clear.x.toFixed(0)}, ${clear.y.toFixed(0)}), base px`;
  return [
    {
      id: `${STAMP_GATE_PAPER_CARD_ID}: shadow away from the light`, passed: depth >= STAMP_GATE_PAPER_CARD_SHADOW.least,
      detail: `${where}: luma ${text(luma(shadow))} in the card's shadow, ${text(luma(lit))} clear of it, ${text(depth)} deep (${STAMP_GATE_PAPER_CARD_SHADOW.least} at least wanted)`,
    },
    {
      id: `${STAMP_GATE_PAPER_CARD_ID}: shadow warm, never black`, passed: depth <= STAMP_GATE_PAPER_CARD_SHADOW.most && warmth(shadow) > warmth(lit),
      detail: `${where}: ${text(depth)} deep (${STAMP_GATE_PAPER_CARD_SHADOW.most} at most wanted), red over blue ${text(warmth(shadow))} in shadow and ${text(warmth(lit))} lit (warmer in shadow wanted)`,
    },
  ];
}

/** Where the cut edge, lip and face are read, screen px in from an edge. */
const STAMP_GATE_PAPER_CARD_READ = { edge: 1.2, hinge: 1.5, lip: 2.7, face: 6 } as const;
/** The cut edge's most luma of the face's; the hinge's least; how far the lit lip stands above the unlit one, of the face. */
const STAMP_GATE_PAPER_CARD_EDGE = { cut: 0.8, hinge: 0.85, lip: 0.1 } as const;

/**
 * Luma in the lit view at each of `read` screen px in from the test card's print px `edge`, stepping `inward` (a unit
 * in print px) across the face.
 */
function stampGatePaperCardInward(picture: StampGatePaperCardPicture, edge: StampPoint, inward: StampPoint, read: readonly number[]): number[] {
  const { project, front } = stampGatePaperCardSeen('lit'), from = project('house', front('house', edge));
  const seenAt = (o: number) => project('house', front('house', { x: edge.x + inward.x * o, y: edge.y + inward.y * o }));
  return read.map((px) => {
    // Print px step by step until the screen has gone `px` in: the card is near square to the camera, so it's near the scale's.
    let o = 0;
    while (Math.hypot(seenAt(o).x - from.x, seenAt(o).y - from.y) < px) o += 0.05;
    return luma(stampGatePaperCardRgbAt(picture, seenAt(o)));
  });
}

/** The cut edge and lip, read in the lit view: dark along both walls and not along the hinge; the lip on the wall facing the light. */
function stampGatePaperCardEdgeChecks(picture: StampGatePaperCardPicture): StampGateWashCheck[] {
  const { edge, hinge, lip, face } = STAMP_GATE_PAPER_CARD_READ;
  const [leftEdge, leftLip, leftFace] = stampGatePaperCardInward(picture, { x: 0, y: 140 }, { x: 1, y: 0 }, [edge, lip, face]);
  const [rightEdge, rightLip, rightFace] = stampGatePaperCardInward(picture, { x: 140, y: 140 }, { x: -1, y: 0 }, [edge, lip, face]);
  const [hingeEdge, hingeFace] = stampGatePaperCardInward(picture, { x: 70, y: 200 }, { x: 0, y: -1 }, [hinge, face]);
  return [
    {
      id: `${STAMP_GATE_PAPER_CARD_ID}: cut edge`,
      passed: leftEdge / leftFace <= STAMP_GATE_PAPER_CARD_EDGE.cut && rightEdge / rightFace <= STAMP_GATE_PAPER_CARD_EDGE.cut && hingeEdge / hingeFace >= STAMP_GATE_PAPER_CARD_EDGE.hinge,
      detail: `${edge} px in from the left wall ${text(leftEdge / leftFace)} of the face ${face} px in, from the right ${text(rightEdge / rightFace)} (${STAMP_GATE_PAPER_CARD_EDGE.cut} at most wanted); ${hinge} px up from the hinge ${text(hingeEdge / hingeFace)} (${STAMP_GATE_PAPER_CARD_EDGE.hinge} at least wanted: no edge on a fold)`,
    },
    {
      id: `${STAMP_GATE_PAPER_CARD_ID}: lip toward the light`, passed: leftLip / leftFace >= rightLip / rightFace + STAMP_GATE_PAPER_CARD_EDGE.lip,
      detail: `${lip} px in, the left wall (toward the key) ${text(leftLip / leftFace)} of its face, the right ${text(rightLip / rightFace)} (${STAMP_GATE_PAPER_CARD_EDGE.lip} more on the left wanted)`,
    },
  ];
}

/** How near the print a card facing the camera shows, of it; and how far past PAINTED_THREE_PAPER_LOOK.printLightMost one turned to the light may go. */
const STAMP_GATE_PAPER_CARD_PRINT = { within: 0.02, past: 0.01 } as const;

/**
 * The print, read at the patch's middle: as painted in the key and lit views, the card square to the camera; turned
 * up toward the key in the rising view, at least as bright and never past printLightMost of it.
 */
function stampGatePaperCardPrintChecks(pictureOf: StampGatePaperCardPictureOf): StampGateWashCheck[] {
  const print = STAMP_GATE_PAPER_CARD_PRINTS.find(({ id }) => id === 'house')!, { x0, y0, x1, y1 } = HOUSE_PATCH, middle = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const painted = luma(stampGatePaperCardPrintAt(print, middle.x, middle.y).map(srgbToLinear));
  const shown = (view: StampGatePaperCardViewId) => {
    const { project, front } = stampGatePaperCardSeen(view);
    return luma(stampGatePaperCardRgbAt(pictureOf(view), project('house', front('house', middle)))) / painted;
  };
  const key = shown('key'), lit = shown('lit'), turned = shown('rising'), most = PAINTED_THREE_PAPER_LOOK.printLightMost + STAMP_GATE_PAPER_CARD_PRINT.past;
  return [
    {
      id: `${STAMP_GATE_PAPER_CARD_ID}: print as painted`, passed: Math.abs(key - 1) <= STAMP_GATE_PAPER_CARD_PRINT.within && Math.abs(lit - 1) <= STAMP_GATE_PAPER_CARD_PRINT.within,
      detail: `facing the camera the patch shows ${text(key)} of its print under the key alone, ${text(lit)} fully lit (within ${STAMP_GATE_PAPER_CARD_PRINT.within} of 1 wanted)`,
    },
    {
      id: `${STAMP_GATE_PAPER_CARD_ID}: never relit`, passed: turned >= lit - STAMP_GATE_PAPER_CARD_PRINT.within && turned <= most,
      detail: `half risen, turned toward the key, the patch shows ${text(turned)} of its print (from ${text(lit)} to ${text(most)} wanted)`,
    },
  ];
}

/** The case's checks, given each view as rendered. The pop-up and box views are judged by eye. */
export function checkStampGatePaperCard(pictureOf: StampGatePaperCardPictureOf): StampGateWashCheck[] {
  return [...stampGatePaperCardShadowChecks(pictureOf('lit')), ...stampGatePaperCardEdgeChecks(pictureOf('lit')), ...stampGatePaperCardPrintChecks(pictureOf)];
}

/** The diorama's moment, its lens's bloom (frame px) and its dusk back's depth: drawn through the shot's renderer so the lens blooms its glow. */
export const STAMP_GATE_PAPER_CARD_DIORAMA = { at: 0, bloom: 4, backDepth: 3 } as const;

const { ultramarine, yellowOchre, phthaloGreen, burntUmber, hansaYellow, cadmiumRed } = WATERCOLOUR_PIGMENTS;
const CREAM: Mix = { parts: [{ pigment: hansaYellow, amount: 1 }, { pigment: cadmiumRed, amount: 0.15 }, { pigment: TITANIUM_WHITE, amount: 1 }], strength: 0.95 };

/** A gouache layer filling `region` with `mix`, whole. */
const dioramaFill = (key: string, region: Region, mix: Mix): Layer => ({
  key, medium: 'gouache',
  washes: [{
    key: `${key}-wash`,
    applications: [{ key: `${key}-fill`, on: 'dry', kind: 'fill', area: { region }, brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: key, charge: { kind: 'paint', mix, opacityCap: 1 } }],
  }],
});
/** A diorama painting: its source, the layers it shows, its size. */
export type StampGateDioramaPrint = { readonly module: PaintingSourceModule; readonly layers: readonly string[]; readonly widthPx: number; readonly heightPx: number };

/** A painting of `layers` on `paper`, its factory's `name` naming its sheets. */
function dioramaPrint(name: string, widthPx: number, heightPx: number, paper: Hex, layers: readonly Layer[]): StampGateDioramaPrint {
  const factory = (): PaintingDocument => ({ widthPx, heightPx, paper: stampGateHeronPaper(paper, 1), medium: 'gouache', layers: [...layers] });
  return { module: { default: Object.defineProperty(factory, 'name', { value: name }) }, layers: layers.map(({ key }) => key), widthPx, heightPx };
}
const dioramaWhole = (width: number, height: number) => stampGateHeronPolygon(-10, -10, width + 10, -10, width + 10, height + 10, -10, height + 10);
const dioramaBox = ({ x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) => stampGateHeronPolygon(x0, y0, x1, y0, x1, y1, x0, y1);
const { width: FRAME_WIDTH, height: FRAME_HEIGHT } = STAMP_GATE_PAPER_CARD_VIEW.frame;

/**
 * The diorama's paintings, by key: a dusk back the frame's size; and its prints: the ground, a fir every tree shares,
 * the house with its window unlit, and the window's glow map, black but for the window.
 */
export const STAMP_GATE_PAPER_CARD_DIORAMA_PRINTS = {
  dusk: dioramaPrint('gatePaperDusk', FRAME_WIDTH, FRAME_HEIGHT, '#f3eee2', [
    stampGateHeronLayer('dusk', dioramaWhole(FRAME_WIDTH, FRAME_HEIGHT), { parts: [{ pigment: ultramarine, amount: 1 }], strength: 0.8 }, 0.8),
  ]),
  ground: dioramaPrint('gatePaperGround', 400, 300, '#e8dcc0', [dioramaFill('ground', dioramaWhole(400, 300), { parts: [{ pigment: yellowOchre, amount: 1 }, { pigment: phthaloGreen, amount: 0.25 }], strength: 0.6 })]),
  tree: dioramaPrint('gatePaperTree', 120, 220, '#f3eee2', [
    dioramaFill('crown', dioramaWhole(120, 220), { parts: [{ pigment: phthaloGreen, amount: 1 }, { pigment: yellowOchre, amount: 1.2 }], strength: 0.8 }),
    dioramaFill('trunk', dioramaBox({ x0: 40, y0: 165, x1: 80, y1: 230 }), { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.8 }),
  ]),
  house: dioramaPrint('gatePaperHouse', 140, 200, '#f3eee2', [
    dioramaFill('walls', dioramaWhole(140, 200), { parts: [{ pigment: ultramarine, amount: 0.4 }, { pigment: burntUmber, amount: 1 }, { pigment: TITANIUM_WHITE, amount: 1 }], strength: 0.8 }),
    dioramaFill('window', dioramaBox(HOUSE_PATCH), { parts: [{ pigment: burntUmber, amount: 1 }, { pigment: yellowOchre, amount: 1 }], strength: 0.8 }),
  ]),
  window: dioramaPrint('gatePaperWindow', 140, 200, '#000000', [dioramaFill('lit', dioramaBox(HOUSE_PATCH), CREAM)]),
} as const satisfies Readonly<Record<string, StampGateDioramaPrint>>;

/** A sheet as the diorama writes it: its print by key, its size the print's. */
export type StampGateDioramaSheet = Omit<PaintedThreePopUpSheet, 'widthPx' | 'heightPx'>;
const DIORAMA_FIR = { print: 'tree', root: TREE.root } as const;

/**
 * The diorama's pop-up but its prints: a base turned half a radian on its turntable; three firs from the one print,
 * each yawed and tinted its own way, behind the house, its window glowing twice its map; each square to the base.
 */
export const STAMP_GATE_PAPER_CARD_DIORAMA_POP_UP: Omit<PaintedThreePopUp, 'base' | 'sheets'> & { readonly base: Omit<PaintedThreeSheet, 'widthPx' | 'heightPx'>; readonly sheets: readonly StampGateDioramaSheet[] } = {
  at: { x: 160, y: 140 }, pitch: PITCH, scale: 0.5, turn: 0.5,
  base: { print: 'ground', root: BASE.root },
  sheets: [
    { ...DIORAMA_FIR, id: 'fir-left', at: { x: 80, y: 110 }, yaw: -0.6, angle: Math.PI / 2 },
    { ...DIORAMA_FIR, id: 'fir-middle', at: { x: 190, y: 80 }, yaw: 0, angle: Math.PI / 2, tint: { hue: 0.4, value: -0.2 } },
    { ...DIORAMA_FIR, id: 'fir-right', at: { x: 310, y: 120 }, yaw: 0.25, angle: Math.PI / 2, tint: { hue: -0.35, value: 0.15 } },
    { print: 'house', root: HOUSE.root, id: 'house', at: { x: 230, y: 260 }, yaw: -0.5, angle: Math.PI / 2, glow: 'window', glowStrength: 2 },
  ],
};

/** The diorama's part of the baseline's inputs: its numbers, pop-up and each painting's document. */
export const stampGatePaperCardDioramaInputs = () => ({
  ...STAMP_GATE_PAPER_CARD_DIORAMA, popUp: STAMP_GATE_PAPER_CARD_DIORAMA_POP_UP,
  prints: Object.fromEntries(Object.entries(STAMP_GATE_PAPER_CARD_DIORAMA_PRINTS).map(([key, { module, layers }]) => [key, { document: module.default({}), layers }])),
});
