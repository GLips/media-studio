// stamp-gate-paper-card.ts: the gate's three.js paper cards (shot/paper-card), four pop-up views under the paper key:
// a house-shaped test card square to the camera on a tipped base, under the key alone (no fill or sky, a black leak:
// the recipe's key-only diagnosis), then fully lit; the card half risen; a small pop-up mid-rise, a pennant folding
// out of its house. Prints are flat colours, so the checks know their values.
//
// Held to: the shadow falling away from the light, the recipe's depth and warm; a cut edge on the cut sides, none on
// the hinge; the lip toward the light only; the print as painted where the card faces the camera, never past 1.05.

import { Matrix4, Vector3 } from 'three';
import { buildPaintCamera } from '#lib/paint/animation/models/paint-camera-build.ts';
import type { PaintCamera } from '#lib/paint/animation/models/paint-camera.ts';
import { paintCameraWorld, paintWorldLightDirection, paintWorldPlane, type PaintCameraWorld } from '#lib/paint/animation/models/paint-camera-world.ts';
import { linearToSrgb, srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-canonical.ts';
import { PAPER_KEY_LIGHT } from '#lib/paint/painting/models/stamp-form.ts';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { PAINTED_THREE_CARD_LOOK, type PaintedThreeCard } from '#lib/paint/three-layers/models/painted-three-card.ts';
import { paintedThreeShotCamera } from '#lib/paint/three-layers/models/painted-three-camera.ts';
import { paintedThreePopUpRig, PAINTED_THREE_POP_UP_BASE, type PaintedThreePopUp, type PaintedThreePopUpCard } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
import { shotCameraProject } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampGateShotSpan } from './stamp-gate-shot-span.ts';

export const STAMP_GATE_PAPER_CARD_ID = 'shot/paper-card';
export const STAMP_GATE_PAPER_CARD_IDS = [STAMP_GATE_PAPER_CARD_ID] as const;
export type StampGatePaperCardId = (typeof STAMP_GATE_PAPER_CARD_IDS)[number];

/** Each view's frame, the camera's field of view, and the depth its pop-up's plane lies at. */
const STAMP_GATE_PAPER_CARD_VIEW = { frame: { width: 320, height: 240 }, fov: 30, depth: 1 } as const;
/** The grey a view's clear lies over, linear. */
const STAMP_GATE_PAPER_CARD_CLEAR = 0.18;

/** A flat print: `ground` over all of it, `patch` (box, colour) over part. Colours sRGB hex. */
export type StampGatePaperCardPrint = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly ground: string;
  readonly patch?: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly colour: string };
};

/** The prints: the test card's sage with a red patch, the base's sand, the tree's green, the pennant's red. */
export const STAMP_GATE_PAPER_CARD_PRINTS: readonly StampGatePaperCardPrint[] = [
  { id: 'house', width: 140, height: 200, ground: '#86a07c', patch: { x0: 50, y0: 100, x1: 90, y1: 140, colour: '#b5523b' } },
  { id: 'base', width: 400, height: 300, ground: '#cdb98f' },
  { id: 'tree', width: 120, height: 220, ground: '#6f8a55', patch: { x0: 45, y0: 170, x1: 75, y1: 220, colour: '#7a5232' } },
  { id: 'pennant', width: 60, height: 30, ground: '#b5523b' },
];

/** A print's colour at its px (x, y), sRGB 0..1: as the page writes its texture. */
export function stampGatePaperCardPrintAt({ ground, patch }: StampGatePaperCardPrint, x: number, y: number): readonly [number, number, number] {
  const hex = patch && x >= patch.x0 && x < patch.x1 && y >= patch.y0 && y < patch.y1 ? patch.colour : ground;
  const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

const BASE: PaintedThreeCard = {
  print: 'base', widthPx: 400, heightPx: 300, outline: { shape: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] },
};
/** The test card's outline: a house, walls 0 and 140, eaves at 30, its ridge at 0, hinged along its foot at 200. */
const HOUSE_OUTLINE: readonly StampPoint[] = [{ x: 0, y: 200 }, { x: 140, y: 200 }, { x: 140, y: 30 }, { x: 70, y: 0 }, { x: 0, y: 30 }];
const HOUSE: PaintedThreeCard = { print: 'house', widthPx: 140, heightPx: 200, outline: { shape: HOUSE_OUTLINE, hinge: { from: { x: 0, y: 200 }, to: { x: 140, y: 200 } } } };
/** A fir on a trunk, its trunk's foot the hinge, cut from SVG path data as a traced drawing would be. */
const TREE: PaintedThreeCard = {
  print: 'tree', widthPx: 120, heightPx: 220,
  outline: { shape: 'M 60 0 L 120 170 L 75 170 L 75 220 L 45 220 L 45 170 L 0 170 Z', hinge: { from: { x: 45, y: 220 }, to: { x: 75, y: 220 } } },
};
/** A pennant hinged along its left edge, folding out sideways. */
const PENNANT: PaintedThreeCard = {
  print: 'pennant', widthPx: 60, heightPx: 30, outline: { shape: [{ x: 0, y: 0 }, { x: 60, y: 15 }, { x: 0, y: 30 }], hinge: { from: { x: 0, y: 0 }, to: { x: 0, y: 30 } } },
};

/** Radians the base tips back from facing the camera: the recipe's 40–55° down. */
const PITCH = 0.9;
/** A rise over `seconds` from `from` s, linear, to `angle`. */
const rising = (from: number, seconds: number, angle: number) => ({ at }: { at: number }) => angle * Math.min(1, Math.max(0, (at - from) / seconds));

export const STAMP_GATE_PAPER_CARD_VIEW_IDS = ['key', 'lit', 'rising', 'pop-up'] as const;
export type StampGatePaperCardViewId = (typeof STAMP_GATE_PAPER_CARD_VIEW_IDS)[number];

/** A view: its pop-up, the moment it's drawn at, and whether its lights are the key alone. */
type StampGatePaperCardView = { readonly popUp: PaintedThreePopUp; readonly at: number; readonly keyOnly: boolean };

/** The test card on the base, standing up by `angle`. */
const testCard = (angle: number): PaintedThreePopUp => ({
  at: { x: 160, y: 150 }, pitch: PITCH, scale: 0.7, base: BASE, cards: [{ ...HOUSE, id: 'house', at: { x: 200, y: 200 }, angle }],
});

export const STAMP_GATE_PAPER_CARD_VIEWS: Readonly<Record<StampGatePaperCardViewId, StampGatePaperCardView>> = {
  key: { popUp: testCard(PITCH), at: 0, keyOnly: true },
  lit: { popUp: testCard(PITCH), at: 0, keyOnly: false },
  rising: { popUp: testCard(PITCH / 2), at: 0, keyOnly: false },
  'pop-up': {
    popUp: {
      at: { x: 160, y: 140 }, pitch: PITCH, scale: 0.5, base: BASE,
      cards: [
        { ...HOUSE, id: 'house', at: { x: 140, y: 220 }, angle: rising(0, 0.8, PITCH) },
        { ...TREE, id: 'tree', at: { x: 290, y: 180 }, angle: rising(0.15, 0.8, PITCH) },
        { ...PENNANT, id: 'pennant', on: 'house', at: { x: 120, y: 95 }, angle: rising(0.3, 0.8, 1.4) },
      ] satisfies PaintedThreePopUpCard[],
    },
    at: 0.6, keyOnly: false,
  },
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

/** The baseline's frame: the views side by side. */
export const stampGatePaperCardFrame = () => ({ width: STAMP_GATE_PAPER_CARD_VIEW.frame.width * STAMP_GATE_PAPER_CARD_VIEW_IDS.length, height: STAMP_GATE_PAPER_CARD_VIEW.frame.height });

/** What the baseline is drawn from, as text: the views' pop-ups are their angles at their moments. */
export const stampGatePaperCardInputs = (id: StampGatePaperCardId) => stampCanonicalJson({
  id, view: STAMP_GATE_PAPER_CARD_VIEW, clear: STAMP_GATE_PAPER_CARD_CLEAR, prints: STAMP_GATE_PAPER_CARD_PRINTS, look: PAINTED_THREE_CARD_LOOK, light: PAPER_KEY_LIGHT,
  views: STAMP_GATE_PAPER_CARD_VIEW_IDS.map((view) => {
    const { popUp, at, keyOnly } = STAMP_GATE_PAPER_CARD_VIEWS[view];
    return { view, at, keyOnly, pitch: popUp.pitch, scale: popUp.scale ?? 1, base: popUp.base, cards: popUp.cards.map(({ id: card, print, widthPx, heightPx, outline, on, at: placed, angle }) => ({ id: card, print, widthPx, heightPx, outline, on: on ?? null, at: placed, angle: typeof angle === 'number' ? angle : angle(paintMoment(at)) })) };
  }),
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

/** A view's pose, read through its camera: where a card's point (card space) lands in its picture, and its rig's matrices. */
function stampGatePaperCardSeen(view: StampGatePaperCardViewId) {
  const { popUp, at } = STAMP_GATE_PAPER_CARD_VIEWS[view], { camera, world } = stampGatePaperCardCamera();
  const plane = paintWorldPlane(world, STAMP_GATE_PAPER_CARD_VIEW.depth), centre = plane.point(popUp.at), rig = paintedThreePopUpRig(popUp), pose = rig.poseAt(paintMoment(at));
  const scale = plane.length(popUp.scale ?? 1), root = new Matrix4().makeTranslation(centre.x, centre.y, centre.z).multiply(new Matrix4().makeScale(scale, scale, scale));
  const shot = paintedThreeShotCamera(camera, world, 0, paintMoment(at), null);
  const project = (card: string, point: Vector3): StampPoint => {
    const seen = shotCameraProject(shot, point.clone().applyMatrix4(pose.get(card)!).applyMatrix4(root));
    if (!seen) throw new Error(`stamp gate: ${STAMP_GATE_PAPER_CARD_ID}'s ${card} lies behind the camera`);
    return seen;
  };
  // A print px on a card's front, in card space.
  const front = (card: string, { x, y }: StampPoint) => new Vector3(x, -y, rig.thickness.get(card)! / 2);
  return { pose, project, front };
}

/**
 * Where on the base the test card's print px `on` casts its shadow in view `view`, as base print px: along the key
 * from it onto the base's front.
 */
function stampGatePaperCardShadowOf(view: StampGatePaperCardViewId, on: StampPoint): StampPoint {
  const { pose, front } = stampGatePaperCardSeen(view), base = pose.get(PAINTED_THREE_POP_UP_BASE)!;
  const toward = paintWorldLightDirection(PAPER_KEY_LIGHT), light = new Vector3(toward.x, toward.y, toward.z);
  const caster = front('house', on).applyMatrix4(pose.get('house')!), onBase = front(PAINTED_THREE_POP_UP_BASE, { x: 0, y: 0 }).applyMatrix4(base);
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
  const { project, front } = stampGatePaperCardSeen('lit'), hingeX = STAMP_GATE_PAPER_CARD_VIEWS.lit.popUp.cards[0].at.x;
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

/** How near the print a card facing the camera shows, of it; and how far past PAINTED_THREE_CARD_LOOK.printLightMost one turned to the light may go. */
const STAMP_GATE_PAPER_CARD_PRINT = { within: 0.02, past: 0.01 } as const;

/**
 * The print, read at the patch's middle: as painted in the key and lit views, the card square to the camera; turned
 * up toward the key in the rising view, at least as bright and never past printLightMost of it.
 */
function stampGatePaperCardPrintChecks(pictureOf: StampGatePaperCardPictureOf): StampGateWashCheck[] {
  const print = STAMP_GATE_PAPER_CARD_PRINTS.find(({ id }) => id === 'house')!, { x0, y0, x1, y1 } = print.patch!, middle = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const painted = luma(stampGatePaperCardPrintAt(print, middle.x, middle.y).map(srgbToLinear));
  const shown = (view: StampGatePaperCardViewId) => {
    const { project, front } = stampGatePaperCardSeen(view);
    return luma(stampGatePaperCardRgbAt(pictureOf(view), project('house', front('house', middle)))) / painted;
  };
  const key = shown('key'), lit = shown('lit'), turned = shown('rising'), most = PAINTED_THREE_CARD_LOOK.printLightMost + STAMP_GATE_PAPER_CARD_PRINT.past;
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

/** The case's checks, given each view as rendered. The pop-up view is judged by eye. */
export function checkStampGatePaperCard(pictureOf: StampGatePaperCardPictureOf): StampGateWashCheck[] {
  return [...stampGatePaperCardShadowChecks(pictureOf('lit')), ...stampGatePaperCardEdgeChecks(pictureOf('lit')), ...stampGatePaperCardPrintChecks(pictureOf)];
}
