// stamp-gate-folds.ts: the gate's folding cards (shot/folds), on one plane at one frame, each its own sheet: a pop-up
// card latching upright from lying flat (caught past upright, in its quiver), a card squashed about its foot landing,
// a card flipped over its upright crease showing its blank back, and a rigged base whose hinged flap folds back. The
// frame is accepted by eye: the flipped card shows its paper alone, its cut mirrored; the flap narrows over its crease.

import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { Mix, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { RigPart } from '#lib/paint/shot/models/shot-props.ts';
import { stampGateHeronLayer, stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const FOLDS = { width: 200, height: 140 } as const;
const { cerulean, yellowOchre, quinacridoneRose, phthaloGreen, burntSienna, ultramarine } = WATERCOLOUR_PIGMENTS;
const mixOf = (pigment: Mix['parts'][number]['pigment'], strength: number): Mix => ({ parts: [{ pigment, amount: 1 }], strength });
const CARD_PAPER = stampGateHeronPaper('#f0dcb4', 1.43);

/** Where the cards stand, document px: each one's outline (x, y pairs) and the foot or crease it turns about. */
const POPUP = { outline: [14, 60, 54, 60, 54, 104, 14, 104], pivot: { x: 34, y: 104 } } as const;
const LANDING = { outline: [66, 64, 96, 64, 96, 104, 66, 104], pivot: { x: 81, y: 104 } } as const;
/** The flip's paint lies off its crease's middle, so its front would show which way round it is. */
const FLIP = { outline: [110, 60, 150, 60, 150, 104, 110, 104], stripe: [110, 60, 124, 60, 124, 104, 110, 104], pivot: { x: 130, y: 82 } } as const;
const BASE = [160, 80, 196, 80, 196, 104, 160, 104] as const;
const FLAP = [162, 48, 194, 48, 194, 80, 162, 80] as const;
const HINGE = { x: 178, y: 80 } as const;

/** A card's layer over `outline`, dry over what's before it. */
const cardLayer = (key: string, outline: readonly number[], mix: Mix) => stampGateHeronLayer(key, stampGateHeronPolygon(...outline), mix, 0.7);

/** A sky and a ground line; the four cards, each an own sheet of warm paper; the hinged one, a base and a flap. */
export const STAMP_GATE_FOLDS: PaintingSourceModule = {
  default: function gateFolds(): PaintingDocument {
    const card = (key: string, ...layers: ReturnType<typeof cardLayer>[]) => ({ key, sheet: { kind: 'own', paper: CARD_PAPER } as const, children: layers });
    return {
      widthPx: FOLDS.width, heightPx: FOLDS.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [
        stampGateHeronLayer('sky', stampGateHeronPolygon(0, 0, 200, 0, 200, 104, 0, 104), mixOf(cerulean, 0.3), 0.8),
        card('popup', cardLayer('popup-face', POPUP.outline, mixOf(quinacridoneRose, 0.55))),
        card('landing', cardLayer('landing-face', LANDING.outline, mixOf(yellowOchre, 0.65))),
        card('flip', cardLayer('flip-face', FLIP.outline, mixOf(phthaloGreen, 0.4)), cardLayer('flip-stripe', FLIP.stripe, mixOf(ultramarine, 0.6))),
        card('hinged', cardLayer('base', BASE, mixOf(burntSienna, 0.55)), cardLayer('flap', FLAP, mixOf(ultramarine, 0.45))),
      ],
    };
  },
};

/** The hinged card's rig: a base, and a flap hinged on its top edge, folding about a level crease. */
export const STAMP_GATE_FOLDS_PARTS: readonly RigPart[] = [
  { id: 'base', z: 0, parent: null, cels: ['base'] },
  { id: 'flap', z: 1, parent: 'base', joint: 'hinge', pivot: HINGE, crease: 0, cels: ['flap'] },
];

/**
 * The folds shot's keys, scene seconds and radians, its baseline's frame `at`: the pop-up latches upright at
 * `latched`; the landing card squashes to `squash` after `landed` (its fall left out: a shut shutter strobes it); the
 * flip turns from `flipFrom` to `flipTo`, through edge-on within a frame; the flap folds back to `flap`.
 */
export const STAMP_GATE_FOLDS_KEYS = {
  at: 0.66, latched: 0.6, landed: 0.55, squash: 0.35, flipFrom: 0.4, flipTo: 0.6, flap: 1.1,
} as const;

/** The cards on one plane, moved by STAMP_GATE_FOLDS_KEYS. */
export function stampGateFoldsShot(): StampGateShot {
  const k = STAMP_GATE_FOLDS_KEYS, clock = { at: 0 };
  // Lying flat behind its foot is a fold of −π/2: its top away from the viewer.
  const rise = paintKeyed([{ at: 0, value: -Math.PI / 2 }, { at: k.latched, value: 0, curve: { latch: {} } }]);
  const squash = paintKeyed([
    { at: 0, value: { x: 0, y: 0 } }, { at: k.landed, hold: true },
    { at: k.landed + 0.08, value: { x: k.squash, y: 0 }, curve: 'out' }, { at: k.landed + 0.5, value: { x: 0, y: 0 }, curve: { spring: { duration: 0.3, bounce: 0.3 } } },
  ]);
  const flip = paintKeyed([{ at: 0, value: 0 }, { at: k.flipFrom, hold: true }, { at: k.flipTo, value: Math.PI, curve: 'inOut' }]);
  const flap = paintKeyed([{ at: 0, value: { fold: 0 } }, { at: k.at, value: { fold: k.flap }, curve: 'inOut' }]);
  return {
    camera: { stage: stampStage(FOLDS, 2), fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [{
      id: 'folds', depth: 1, source: layersOf(painting(STAMP_GATE_FOLDS), ['sky', 'popup', 'landing', 'flip', 'hinged']),
      occurrences: {
        popup: { pivot: POPUP.pivot, plays: [{ clip: { kind: 'fold', angle: rise }, clock, origin: 'pop up' }] },
        landing: { pivot: LANDING.pivot, plays: [{ clip: { kind: 'strain', value: squash }, clock, origin: 'land' }] },
        flip: { pivot: FLIP.pivot, plays: [{ clip: { kind: 'fold', angle: flip, crease: Math.PI / 2 }, clock, origin: 'flip' }] },
        hinged: { rig: { parts: STAMP_GATE_FOLDS_PARTS, pose: { flap } } },
      },
    }],
  };
}
