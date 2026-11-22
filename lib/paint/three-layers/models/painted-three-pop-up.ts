// painted-three-pop-up.ts: a pop-up's rig, its pure side: cards hinged on a pitched base, each standing up from its
// parent by an angle in time, nested cards riding their parents. The studio side (painted-three-pop-up.ts there)
// builds its meshes and sets each card's matrix from here; checks read where a card's point lands the same way.
//
// Card space is a card's print px with y turned up (x, −y) and z out of its front, its back at −thickness/2. The
// pop-up's space is print px too, its origin the base's centre, before it's placed and scaled on its plane.

import { Matrix4, Vector3 } from 'three';
import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINTED_THREE_CARD_LOOK, paintedThreeCardCut, type PaintedThreeCard } from './painted-three-card.ts';

/**
 * A card standing on its parent (`on`, a card's id; the base when left out). Flat, its hinge's middle sits at `at` on
 * its parent's front (parent print px), upright as drawn. It stands toward the viewer by `angle`, radians from flat:
 * on the base it faces the camera at the pitch. A keyed angle on a latch curve overshoots.
 */
export type PaintedThreePopUpCard = PaintedThreeCard & {
  readonly id: string;
  readonly on?: string;
  readonly at: StampPoint;
  readonly angle: PresentationValue<number>;
};

/**
 * A pop-up: `base`, a card cut all round, centred at `at` (frame px on its plane), tipped back from facing the camera
 * by `pitch` radians (the recipe looks 40–55° down); `cards`, any order; `scale`, frame px per print px (default 1).
 * `thicknessPx`: every card's paper unless one names its own; 2% of the tallest card's height by default.
 */
export type PaintedThreePopUp = {
  readonly at: StampPoint;
  readonly pitch: number;
  readonly scale?: number;
  readonly thicknessPx?: number;
  readonly base: PaintedThreeCard;
  readonly cards: readonly PaintedThreePopUpCard[];
};

/** A pop-up's id for its base, which no card may take. */
export const PAINTED_THREE_POP_UP_BASE = 'base';

/** A card's hinge in card space: the pivot on its back face, and the axis it stands up about (unit length). */
type PaintedThreeHinge = { readonly pivot: Vector3; readonly axis: Vector3 };

/** A card's hinge in card space (PaintedThreeHinge): its axis turns the card's body, beyond the hinge, toward +z. */
function paintedThreePopUpHinge(card: PaintedThreePopUpCard, thickness: number): PaintedThreeHinge {
  const { polygon } = paintedThreeCardCut(card), { from, to } = card.outline.hinge!;
  // The body's side of the hinge: toward the outline's mean point, in card space (y up).
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, mean = polygon.reduce((sum, p) => ({ x: sum.x + p.x / polygon.length, y: sum.y + p.y / polygon.length }), { x: 0, y: 0 });
  const along = new Vector3(to.x - from.x, -(to.y - from.y), 0).normalize(), body = new Vector3(mean.x - middle.x, -(mean.y - middle.y), 0);
  body.addScaledVector(along, -body.dot(along)).normalize();
  // Turning by +θ about body × z carries the body toward z.
  return { pivot: new Vector3(middle.x, -middle.y, -thickness / 2), axis: body.clone().cross(new Vector3(0, 0, 1)) };
}

/** A pop-up's rig, checked: each card's id in parents-first order, and the matrix of each (and the base) at a moment. */
export type PaintedThreePopUpRig = {
  /** The base's id, then each card's, every parent before its children. */
  readonly order: readonly string[];
  /** Card space into the pop-up's space at `moment`, by id. */
  readonly poseAt: (moment: PaintMoment) => ReadonlyMap<string, Matrix4>;
  /** Each card's paper thickness, print px, by id. */
  readonly thickness: ReadonlyMap<string, number>;
  /** A sphere about the base's centre holding the pop-up at any pose, print px: what a shadow camera is fitted to. */
  readonly reach: number;
};

/**
 * `popUp`'s rig. Refuses a card with no hinge, an id taken twice or the base's, a parent that isn't a card, and cards
 * that stand on each other round a loop.
 */
export function paintedThreePopUpRig(popUp: PaintedThreePopUp): PaintedThreePopUpRig {
  const { base, cards, pitch } = popUp;
  paintedThreeCardCut(base);
  const byId = new Map<string, PaintedThreePopUpCard>();
  for (const card of cards) {
    if (card.id === PAINTED_THREE_POP_UP_BASE || byId.has(card.id)) throw new Error(`painted three pop-up: card id ${card.id} is taken`);
    if (!card.outline.hinge) throw new Error(`painted three pop-up: card ${card.id}'s outline has no hinge to stand on`);
    byId.set(card.id, card);
  }
  const order: string[] = [], placed = new Set([PAINTED_THREE_POP_UP_BASE]);
  while (order.length < cards.length) {
    const ready = cards.filter((card) => !placed.has(card.id) && placed.has(card.on ?? PAINTED_THREE_POP_UP_BASE));
    if (!ready.length) {
      const stuck = cards.filter((card) => !placed.has(card.id));
      const missing = stuck.find((card) => card.on !== undefined && !byId.has(card.on));
      throw new Error(missing ? `painted three pop-up: card ${missing.id} stands on ${missing.on}, which is no card` : `painted three pop-up: cards ${stuck.map(({ id }) => id).join(', ')} stand on each other round a loop`);
    }
    for (const card of ready) {
      order.push(card.id);
      placed.add(card.id);
    }
  }
  const paper = popUp.thicknessPx ?? PAINTED_THREE_CARD_LOOK.thickness * Math.max(...cards.map(({ heightPx }) => heightPx), cards.length ? 0 : base.heightPx);
  const thickness = new Map([[PAINTED_THREE_POP_UP_BASE, base.thicknessPx ?? paper], ...cards.map((card) => [card.id, card.thicknessPx ?? paper] as const)]);
  const hinges = new Map(cards.map((card) => [card.id, paintedThreePopUpHinge(card, thickness.get(card.id)!)]));
  // The base's centre to the origin, tipped back about x: its top edge goes away from the camera.
  const baseMatrix = new Matrix4().makeRotationX(-pitch).multiply(new Matrix4().makeTranslation(-base.widthPx / 2, base.heightPx / 2, 0));
  // Each card's own reach from its hinge, the base's half diagonal, all stacked: no pose reaches past their sum.
  const reach = Math.hypot(base.widthPx, base.heightPx) / 2 + cards.reduce((sum, card) => sum + Math.hypot(card.widthPx, card.heightPx), 0);
  return {
    order: [PAINTED_THREE_POP_UP_BASE, ...order],
    thickness,
    reach,
    poseAt: (moment) => {
      const matrices = new Map([[PAINTED_THREE_POP_UP_BASE, baseMatrix]]);
      for (const id of order) {
        const card = byId.get(id)!, { pivot, axis } = hinges.get(id)!, parent = card.on ?? PAINTED_THREE_POP_UP_BASE;
        // On the parent's front at `at`, the card's back face down on it, turned up about its hinge.
        const onParent = new Matrix4().makeTranslation(card.at.x, -card.at.y, thickness.get(parent)! / 2);
        const turned = new Matrix4().makeRotationAxis(axis, presentationValueAt(card.angle, moment));
        matrices.set(id, matrices.get(parent)!.clone().multiply(onParent).multiply(turned).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)));
      }
      return matrices;
    },
  };
}
