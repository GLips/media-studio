// stamp-gate-rainy-street.ts: the gate's rainy street (ENGINE 9, test 5), everything a shot presents at once: a sky
// dissolving to night at the back; a street painted in on sixes, its lamp lit by a property step, its puddle clocked
// with drops landing in it at their times, and a walker on that wet paper placed by a play, re-solving the sheet at
// each pose; the lamp's reflection cut to the puddle and fading in; the rain; and the camera pushing in. The walk,
// lamp and ramps are tables by scene second, so a baseline's inputs name them.

import { paintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { PaintPlacementMove } from '#lib/paint/animation/models/paint-pins.ts';
import { paintingSelectedLayers } from '#lib/paint/document/models/painting-document-compile.ts';
import type { Application, Layer, LayerNode, Mix, PaintingDocument, Region } from '#lib/paint/document/models/painting-document.ts';
import { paintingEvaluationDiff } from '#lib/paint/document/models/painting-evaluation-diff.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingEvaluation, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { dissolve } from '#lib/paint/shot/models/shot-selection.ts';
import { motionCurves, seg } from '#lib/picture/motion/models/motion.ts';
import { stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_RAIN, STAMP_GATE_RAIN_DEPTHS, STAMP_GATE_RAIN_PAINTING, stampGateRainAt } from './stamp-gate-rain.ts';
import { STAMP_GATE_EARTH_MIX, STAMP_GATE_POOL_MIX, STAMP_GATE_ROUND_REF, STAMP_GATE_SHEET_PAPER, stampGateLine, stampGateRectangle, stampGateSheetBrushOf } from './stamp-gate-sheets.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const { yellowOchre, quinacridoneRose, ultramarine, burntUmber, hansaYellow } = WATERCOLOUR_PIGMENTS;
const brush = STAMP_GATE_ROUND_REF;

/** The street's frame, px, and its stage's margin: room for the rain's defocus and the push. */
const STREET = { width: 160, height: 120 } as const;
const STREET_MARGIN = 16;

/**
 * The street sheet's drying scale: its puddle, flooded at 0 s, shines through the walker's landing at 0.2 s and every
 * drop's, the last at 1.75 s.
 */
const STREET_SCALE = 0.015;

/** The planes' depths: the sky at the back, the street and its reflection on it, the rain about the street. */
const DEPTHS = { sky: 4, street: 2 } as const;

/** A flood over `region` in `mix` at `water`. */
const flood = (key: string, region: Region, mix: Mix, water: number) =>
  ({ key, kind: 'fill', area: { region }, brush, diameterPx: 24, seed: key, charge: { kind: 'paint', mix, water } } as const);

/** A layer of one unclocked wash of `applications`. */
const unclocked = (key: string, ...applications: Application[]): Layer => ({ key, washes: [{ key: `${key}-wash`, applications }] });

/** The puddle on the road, document px: the walker's feet land on its far edge. */
const PUDDLE = stampGateHeronPolygon(30, 100, 52, 92, 96, 90, 138, 94, 150, 104, 118, 114, 62, 115, 34, 110);

/** The drops landing in the puddle: where, document px, and when, scene seconds. */
const DROPS = [{ x: 104, y: 102, at: 0.5 }, { x: 70, y: 106, at: 1 }, { x: 128, y: 104, at: 1.75 }] as const;

/** When the walker lands on the sheet, scene seconds: while the puddle shines. */
const WALKER_AT = 0.2;

/** Where the lamp stands, document px: its post's foot on the road, its head above it. */
const LAMP = { x: 132, head: 34, foot: 88 } as const;

const streetProperties = {
  night: { type: 'boolean', default: false },
  lamp: { type: 'boolean', default: false },
} as const satisfies PropertySchema;

/**
 * The rainy street: a `sky`, dusk or `night`; a `road`; a `lamp`, its post, then its head lit by `lamp` in a wash of
 * its own, so the step changes a wash's first application; the `puddle` clocked from 0 s, its drops landing at their
 * times; a `walker` group, clocked from WALKER_AT, feet in the puddle; and the lamp's `reflection`.
 */
export const STAMP_GATE_PUDDLED_STREET: PaintingSourceModule<typeof streetProperties> = {
  properties: streetProperties,
  default: function gatePuddledStreet({ night, lamp }: PropertyValues<typeof streetProperties>): PaintingDocument {
    const { width, height } = STREET;
    const skyMix = night
      ? { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: burntUmber, amount: 0.4 }], strength: 0.7 }
      : { parts: [{ pigment: yellowOchre, amount: 1 }, { pigment: quinacridoneRose, amount: 0.35 }], strength: 0.35 };
    // Both pigments either way, in one order: a pigment new to the layer would change its films' layout from its first wash.
    const lampMix = { parts: [{ pigment: hansaYellow, amount: lamp ? 1 : 0.1 }, { pigment: burntUmber, amount: lamp ? 0.05 : 1 }], strength: lamp ? 0.8 : 0.25 };
    const post = { key: 'lamp-post', kind: 'stroke', subpaths: [stampGateLine(LAMP.x, LAMP.foot, LAMP.x, LAMP.head)], brush, diameterPx: 3, seed: 'lamp-post', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.3 } } as const;
    const head = { key: 'lamp-head', kind: 'stamps', placements: [{ x: LAMP.x, y: LAMP.head }], brush, diameterPx: 12, seed: 'lamp-head', charge: { kind: 'paint', mix: lampMix, water: 0.5 } } as const;
    const drops = DROPS.map(({ x, y, at }, i) => ({ key: `drop-${i + 1}`, at, kind: 'stamps', placements: [{ x, y }], brush, diameterPx: 8, seed: `drop-${i + 1}`, charge: { kind: 'water', water: 0.95 } } as const));
    const walker: LayerNode = {
      key: 'walker',
      children: [{
        key: 'figure',
        washes: [{
          key: 'figure-wash', clock: { origin: WALKER_AT },
          applications: [
            { key: 'figure-body', kind: 'stroke', subpaths: [stampGateLine(42, 66, 43, 80)], brush, diameterPx: 7, seed: 'figure-body', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } },
            { key: 'figure-legs', kind: 'stroke', subpaths: [stampGateLine(38, 96, 42, 80, 47, 96)], brush, diameterPx: 4, seed: 'figure-legs', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.8 } },
            { key: 'figure-head', kind: 'stamps', placements: [{ x: 42, y: 60 }], brush, diameterPx: 7, seed: 'figure-head', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.4 } },
          ],
        }],
      }],
    };
    return {
      widthPx: width, heightPx: height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', dryingScale: STREET_SCALE,
      layers: [
        unclocked('sky', flood('sky-flood', stampGateRectangle(0, 0, width, height), skyMix, 0.8)),
        unclocked('road', flood('road-flood', stampGateRectangle(0, 82, width, height), { parts: [{ pigment: burntUmber, amount: 1 }], strength: 0.35 }, 0.6)),
        { key: 'lamp', washes: [{ key: 'lamp-post-wash', applications: [post] }, { key: 'lamp-head-wash', applications: [head] }] },
        { key: 'puddle', washes: [{ key: 'puddle-wash', clock: { origin: 0 }, applications: [flood('puddle-flood', PUDDLE, STAMP_GATE_POOL_MIX, 0.85), ...drops] }] },
        walker,
        unclocked('reflection', { key: 'reflection-streak', kind: 'stroke', subpaths: [stampGateLine(LAMP.x - 2, 92, LAMP.x + 2, 104, LAMP.x - 1, 114)], brush, diameterPx: 6, seed: 'reflection', charge: { kind: 'paint', mix: lampMix, water: 0.5 } }),
      ],
    };
  },
};

/** The street plane's layers. */
const STREET_LAYERS = ['road', 'lamp', 'puddle', 'walker'] as const;

/**
 * The first entry on the street's sheet that lighting the lamp changes, as the evaluation diff reads it: the first
 * application whose content differs among the street plane's washes, a solve's `from` naming it.
 */
export function stampGateRainyStreetLampStep(): string {
  const lit = streetAt(true), { washes } = paintingEvaluationDiff(streetAt(false), lit, stampGateSheetBrushOf);
  const street = new Set([...paintingSelectedLayers(lit.tree, STREET_LAYERS)].map((layer) => lit.tree.layers[layer].node.key));
  const changed = washes.find(({ layer, change }) => street.has(layer) && change.kind === 'content');
  if (changed?.change.kind !== 'content') throw new Error('the rainy street: lighting the lamp changes none of the street\'s washes');
  return changed.change.path.split('.')[0];
}

/** A 24 fps frame's middle, scene seconds: clear of the hold grid's edges. */
const midFrame = (frame: number) => (frame + 0.5) / PAINT_ANIMATION_FPS;

/**
 * The frames each check draws, at their middles. `walking`: thirteen frames the walker moves through, the street's
 * prefix stepping on sixes. `repeated`: the walker forward a step and back, one hold. `lamp`: the frame before the
 * lamp lights and the one it lights at. `warmed`: frames inside the warm span, the walker still.
 */
export const STAMP_GATE_RAINY_STREET_AT = {
  walking: Array.from({ length: 13 }, (_, i) => midFrame(6 + i)),
  repeated: [midFrame(24), midFrame(25), midFrame(26)],
  lamp: [midFrame(29), midFrame(30)],
  warmed: [midFrame(36), midFrame(37), midFrame(38), midFrame(39), midFrame(40)],
  baseline: 1.9,
} as const;

/** When the lamp lights, scene seconds: the street's source step at frame 30. */
const LAMP_ON = 30 / PAINT_ANIMATION_FPS;

/** The span warmed before the `warmed` frames, scene seconds: one hold of the street's source, the walker still. */
export const STAMP_GATE_RAINY_STREET_WARM = { from: 1.5, to: 1.7 } as const;

/**
 * The walker's place keys, scene seconds: a px a frame to 1 s; still; a step forward and back on frames 24 to 26; still
 * through the warm span; then on across the puddle.
 */
const WALK: readonly ({ readonly at: number } & PaintPlacementMove)[] = [
  { at: 0, x: 0, y: 0 }, { at: 1, x: 24, y: 0 }, { at: midFrame(24), x: 24, y: 0 }, { at: midFrame(25), x: 27, y: 0 }, { at: midFrame(26), x: 24, y: 0 },
  { at: 1.75, x: 24, y: 0 }, { at: 4, x: 60, y: 0 },
];

/** The presentation's ramps: the sky's dissolve to night, the reflection's fade, and the camera's push, depth units. */
const RAMPS = { night: { from: 0.5, to: 2.5 }, reflection: { from: 1.25, to: 2.25 }, push: { to: 3, dolly: 0.3 } } as const;

/**
 * The sky laid a tenth larger about the frame's centre: it shares the street's frame-sized document, and the focus on
 * the street blurs it, so its painting must reach past the frame by that blur.
 */
const SKY_LAY = { placement: { x: 0, y: 0, rotation: 0, scale: 1.1 }, pivot: { x: STREET.width / 2, y: STREET.height / 2 } } as const;

/** The street at `lamp`. */
const streetAt = (lamp: boolean) => painting(STAMP_GATE_PUDDLED_STREET, { lamp });

/** Every evaluation the shot reads: the street at dusk and unlit (the sky's first end), at night, and lit; and the rain's drop. */
export const stampGateRainyStreetEvaluations = (): PaintingEvaluation[] => [
  painting(STAMP_GATE_PUDDLED_STREET), painting(STAMP_GATE_PUDDLED_STREET, { night: true }), streetAt(true), painting(STAMP_GATE_RAIN_PAINTING),
];

/** What the shot reads beside its evaluations, as its baseline's inputs name it. */
export const STAMP_GATE_RAINY_STREET_PRESENTATION = { walk: WALK, lampOn: LAMP_ON, ramps: RAMPS, rain: STAMP_GATE_RAIN, depths: DEPTHS, skyLay: SKY_LAY } as const;

/**
 * The rainy street: the sky dissolving to night at the back; the street, its source on sixes and its clock unheld,
 * lit at LAMP_ON; the reflection cut to the puddle, fading in; the rain; the walker placed by WALK; the camera pushing
 * in, focused on the street, its shutter open as the rain's.
 */
export function stampGateRainyStreetShot(): StampGateShot {
  const dusk = painting(STAMP_GATE_PUDDLED_STREET), night = painting(STAMP_GATE_PUDDLED_STREET, { night: true });
  return {
    camera: {
      stage: stampStage(STREET, STREET_MARGIN), fov: 35, lens: { bloom: 0, shutter: STAMP_GATE_RAIN.shutter },
      plays: [
        paintCameraPlay({ kind: 'move', value: paintKeyed([{ at: 0, value: { dolly: 0 } }, { at: RAMPS.push.to, value: { dolly: RAMPS.push.dolly } }]) }, { clock: { at: 0 }, origin: 'the camera pushes in' }),
        paintCameraPlay({ kind: 'focus', value: { focus: DEPTHS.street, aperture: 1.5 } }, { clock: { at: 0 }, origin: 'the camera focuses on the street' }),
      ],
    },
    planes: [
      {
        id: 'sky', depth: DEPTHS.sky, lay: SKY_LAY,
        source: ({ at }: PaintMoment) => dissolve(layersOf(dusk, ['sky']), layersOf(night, ['sky']), seg(at, RAMPS.night.from, RAMPS.night.to, motionCurves.linear)),
      },
      {
        id: 'street', depth: DEPTHS.street, sourceClock: { hold: 6 }, source: ({ at }: PaintMoment) => layersOf(streetAt(at >= LAMP_ON), STREET_LAYERS, { at }),
        occurrences: {
          walker: { plays: [{ clip: { kind: 'place', value: paintKeyed(WALK.map(({ at, ...value }) => ({ at, value }))) }, clock: { at: 0 }, origin: 'the walker crosses the puddle' }] },
        },
      },
      {
        id: 'reflection', depth: DEPTHS.street, source: layersOf(streetAt(true), ['reflection']), masks: [{ kind: 'alphaOf', drawable: 'street/puddle' }],
        visibility: ({ at }) => seg(at, RAMPS.reflection.from, RAMPS.reflection.to, motionCurves.linear),
      },
      { kind: 'instanced', id: 'rain', depths: STAMP_GATE_RAIN_DEPTHS.rain, variants: { drop: layersOf(painting(STAMP_GATE_RAIN_PAINTING), ['drop']) }, instances: ({ at }) => stampGateRainAt(at) },
    ],
  };
}
