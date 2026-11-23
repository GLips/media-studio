// painted-three-pop-up.ts: a pop-up's rig, its pure side: folded sheets standing on a pitched base, each up from a
// face of its parent by an angle in time, nested sheets riding their parents' faces. The studio side
// (painted-three-pop-up.ts there) builds each sheet's meshes and sets each face's matrix from here; checks read where a
// face's point lands the same way.
//
// Each sheet's own space is its sheet space (painted-three-sheet.ts). The pop-up's space is print px too, its origin
// the base's centre, before it's placed and scaled on its plane.

import { Matrix4, Vector3 } from 'three';
import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINTED_THREE_SHEET_ROOT, PAINTED_THREE_SHEET_THICKNESS, paintedThreeSheetFolding, paintedThreeSheetHingeAxis, type PaintedThreeSheet, type PaintedThreeSheetFolding } from './painted-three-sheet.ts';

/**
 * A sheet standing on a face of another: `on`, that sheet and face (the base's root by default, a sheet's root when
 * no face is named). Flat, its root's hinge's middle sits at `at` on that face's front (print px). It stands toward
 * the viewer by `angle`, radians from flat: on the base it faces the camera at the pitch.
 */
export type PaintedThreePopUpSheet = PaintedThreeSheet & {
  readonly id: string;
  readonly on?: { readonly sheet: string; readonly face?: string };
  readonly at: StampPoint;
  readonly angle: PresentationValue<number>;
};

/**
 * A pop-up: `base`, a sheet centred at `at` (frame px on its plane), its root tipped back from facing the camera by
 * `pitch` radians (the recipe looks 40–55° down); `sheets`, any order; `scale`, frame px per print px (default 1).
 * `thicknessPx`: every sheet's paper unless one names its own; PAINTED_THREE_SHEET_THICKNESS of the tallest sheet's
 * height by default.
 */
export type PaintedThreePopUp = {
  readonly at: StampPoint;
  readonly pitch: number;
  readonly scale?: number;
  readonly thicknessPx?: number;
  readonly base: PaintedThreeSheet;
  readonly sheets: readonly PaintedThreePopUpSheet[];
};

/** A pop-up's id for its base, which no sheet may take. */
export const PAINTED_THREE_POP_UP_BASE = 'base';

/** A pop-up's rig, checked: each sheet's id in parents-first order, its folding, and each face's matrix at a moment. */
export type PaintedThreePopUpRig = {
  /** The base's id, then each sheet's, every parent before its children. */
  readonly order: readonly string[];
  /** Each sheet folded, its paper the pop-up's unless it names its own, by id. */
  readonly folding: ReadonlyMap<string, PaintedThreeSheetFolding>;
  /** Sheet space into the pop-up's space at `moment`, by sheet id, then face id. */
  readonly poseAt: (moment: PaintMoment) => ReadonlyMap<string, ReadonlyMap<string, Matrix4>>;
  /** A sphere about the base's centre holding the pop-up at any pose, print px: what a shadow camera is fitted to. */
  readonly reach: number;
};

/** Every face's box diagonal: no point of a folded sheet lies further from any other along its faces. */
const sheetSpan = (folding: PaintedThreeSheetFolding) => [...folding.faces.values()].reduce((sum, { box }) => sum + Math.hypot(box.x1 - box.x0, box.y1 - box.y0), 0);

/**
 * `popUp`'s rig. Refuses a sheet whose root has no hinge to stand on, an id taken twice or the base's, a parent that
 * isn't a sheet or a face it hasn't, sheets that stand on each other round a loop, and whatever a sheet's folding
 * refuses (paintedThreeSheetFolding).
 */
export function paintedThreePopUpRig(popUp: PaintedThreePopUp): PaintedThreePopUpRig {
  const { base, sheets, pitch } = popUp, byId = new Map<string, PaintedThreePopUpSheet>();
  for (const sheet of sheets) {
    if (sheet.id === PAINTED_THREE_POP_UP_BASE || byId.has(sheet.id)) throw new Error(`painted three pop-up: sheet id ${sheet.id} is taken`);
    if (!sheet.root.hinge) throw new Error(`painted three pop-up: sheet ${sheet.id}'s root has no hinge to stand on`);
    byId.set(sheet.id, sheet);
  }
  const parentOf = (sheet: PaintedThreePopUpSheet) => sheet.on?.sheet ?? PAINTED_THREE_POP_UP_BASE;
  const order: string[] = [], placed = new Set([PAINTED_THREE_POP_UP_BASE]);
  while (order.length < sheets.length) {
    const ready = sheets.filter((sheet) => !placed.has(sheet.id) && placed.has(parentOf(sheet)));
    if (!ready.length) {
      const stuck = sheets.filter((sheet) => !placed.has(sheet.id)), missing = stuck.find((sheet) => !byId.has(parentOf(sheet)));
      throw new Error(missing ? `painted three pop-up: sheet ${missing.id} stands on ${parentOf(missing)}, which is no sheet` : `painted three pop-up: sheets ${stuck.map(({ id }) => id).join(', ')} stand on each other round a loop`);
    }
    for (const sheet of ready) {
      order.push(sheet.id);
      placed.add(sheet.id);
    }
  }
  const paper = popUp.thicknessPx ?? PAINTED_THREE_SHEET_THICKNESS * Math.max(...sheets.map(({ heightPx }) => heightPx), sheets.length ? 0 : base.heightPx);
  const folding = new Map([
    [PAINTED_THREE_POP_UP_BASE, paintedThreeSheetFolding({ ...base, thicknessPx: base.thicknessPx ?? paper })],
    ...sheets.map((sheet) => [sheet.id, paintedThreeSheetFolding({ ...sheet, thicknessPx: sheet.thicknessPx ?? paper })] as const),
  ]);
  for (const sheet of sheets) {
    const face = sheet.on?.face ?? PAINTED_THREE_SHEET_ROOT;
    if (!folding.get(parentOf(sheet))!.faces.has(face)) throw new Error(`painted three pop-up: sheet ${sheet.id} stands on ${parentOf(sheet)}'s face ${face}, which it hasn't`);
  }
  // Each sheet stands about its root's hinge, pivoting on its back face, which lies on its parent face's front.
  const stands = new Map(sheets.map((sheet) => {
    const { from, to } = sheet.root.hinge!, thickness = folding.get(sheet.id)!.thickness;
    const pivot = new Vector3((from.x + to.x) / 2, -(from.y + to.y) / 2, -thickness / 2);
    return [sheet.id, { pivot, axis: paintedThreeSheetHingeAxis(sheet.root.hinge!, folding.get(sheet.id)!.faces.get(PAINTED_THREE_SHEET_ROOT)!.rings[0]) }] as const;
  }));
  // The base's centre to the origin, tipped back about x: its top edge goes away from the camera.
  const baseMatrix = new Matrix4().makeRotationX(-pitch).multiply(new Matrix4().makeTranslation(-base.widthPx / 2, base.heightPx / 2, 0));
  const baseFolding = folding.get(PAINTED_THREE_POP_UP_BASE)!, { x0, y0, x1, y1 } = baseFolding.faces.get(PAINTED_THREE_SHEET_ROOT)!.box, cx = base.widthPx / 2, cy = base.heightPx / 2;
  // The base's root's farthest corner from its centre, its other faces, then every face of every sheet stacked: no pose reaches past their sum.
  const rootReach = Math.hypot(Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy)));
  const reach = rootReach + sheetSpan(baseFolding) - Math.hypot(x1 - x0, y1 - y0) + sheets.reduce((sum, sheet) => sum + sheetSpan(folding.get(sheet.id)!), 0);
  return {
    order: [PAINTED_THREE_POP_UP_BASE, ...order],
    folding,
    reach,
    poseAt: (moment) => {
      const placedAt = (id: string, sheet: Matrix4) => new Map([...folding.get(id)!.poseAt(moment)].map(([face, matrix]) => [face, sheet.clone().multiply(matrix)]));
      const poses = new Map([[PAINTED_THREE_POP_UP_BASE, placedAt(PAINTED_THREE_POP_UP_BASE, baseMatrix)]]);
      for (const id of order) {
        const sheet = byId.get(id)!, { pivot, axis } = stands.get(id)!, parent = parentOf(sheet), face = poses.get(parent)!.get(sheet.on?.face ?? PAINTED_THREE_SHEET_ROOT)!;
        // On the parent face's front at `at`, the sheet's back face down on it, turned up about its hinge.
        const onParent = new Matrix4().makeTranslation(sheet.at.x, -sheet.at.y, folding.get(parent)!.thickness / 2);
        const turned = new Matrix4().makeRotationAxis(axis, presentationValueAt(sheet.angle, moment));
        poses.set(id, placedAt(id, face.clone().multiply(onParent).multiply(turned).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))));
      }
      return poses;
    },
  };
}
