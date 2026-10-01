// wet-animations.ts: the passage sheet's animation checks (vid-117), each a short strip of frames in every medium: a
// sunset, where only the paint's colour changes and nothing changes shape, and a cloud drifting over a still sky, its
// texture first held on the cloud as it moves, then repainted every second frame as hand-drawn animation boils.
//
// Negative space: no strip is a video. A few frames side by side show what the eye would judge in motion.

import type { StampGroupBoil } from '#lib/picture/stamp-paint/models/stamp-group-motion.ts';
import { stampPaintRecipe, type StampPaintRecipe } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import type { StampRegion } from '#lib/picture/stamp-paint/models/stamp-region.ts';
import { WET_PASSAGE_CELL, wetPassageMixture, type WetPassageKit } from './wet-passages.ts';

/** The scene's frame rate the strips are drawn at. */
export const WET_ANIMATION_FPS = 30;

/** A painting of a strip, and the frames of it shown, each with its caption. */
export type WetAnimationTake = { recipe: StampPaintRecipe; frames: readonly { frame: number; caption: string }[] };

/** An animation check: its ID, how it's described to the person judging it, and its takes in a kit, shown in order. */
export type WetAnimation = { id: string; title: string; shows: string; lookFor: string; takes: (kit: WetPassageKit) => WetAnimationTake[] };

/** An animation painted in one medium: its frames as PNG data URLs with their captions, or why it couldn't be. */
export type WetAnimationPainted = { animation: string } & ({ frames: { caption: string; png: string }[] } | { refused: string });

const { width: W, height: H } = WET_PASSAGE_CELL;
const polygon = (...xy: number[]): StampRegion => ({ kind: 'polygon', points: xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1] }])) });
const SKY = polygon(12, 12, W - 12, 12, W - 12, 180, 12, 180);
const HILL = polygon(12, H - 12, 12, 190, 110, 150, 220, 175, W - 12, 160, W - 12, H - 12);
const flood = { application: { kind: 'flood' } } as const;

/** The sunset's four hours, day to dusk: the sky's paint, the sun's and the hill's, by pigment. */
const HOURS: readonly { caption: string; sky: Record<string, number>; sun: Record<string, number>; hill: Record<string, number> }[] = [
  { caption: 'afternoon', sky: { cerulean: 0.3 }, sun: { hansaYellow: 0.15 }, hill: { ultramarine: 0.15, hansaYellow: 0.25 } },
  { caption: 'evening', sky: { cerulean: 0.18, hansaYellow: 0.1 }, sun: { hansaYellow: 0.3, quinacridoneRose: 0.05 }, hill: { ultramarine: 0.25, burntSienna: 0.15 } },
  { caption: 'sunset', sky: { quinacridoneRose: 0.14, hansaYellow: 0.14 }, sun: { quinacridoneRose: 0.25, hansaYellow: 0.25 }, hill: { ultramarine: 0.3, burntSienna: 0.25 } },
  { caption: 'dusk', sky: { ultramarine: 0.18, quinacridoneRose: 0.12 }, sun: { quinacridoneRose: 0.35, burntSienna: 0.1 }, hill: { ultramarine: 0.45, burntSienna: 0.3 } },
];

/** A sky wetted and washed in, a sun dropped into it, and a hill on dry paper; its paint at `hour`. */
function sunsetAt(kit: WetPassageKit, hour: (typeof HOURS)[number]): StampPaintRecipe {
  const { fill, drop } = kit.brushes;
  return stampPaintRecipe((paint) => {
    paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.wash('sky', { preparation: { region: SKY } }, (wash) => {
      wash.fill('sky', { brush: fill, diameter: 90, ...flood, region: SKY, material: wetPassageMixture(kit, hour.sky) });
      wash.stamps('sun', { brush: drop, diameter: 70, material: wetPassageMixture(kit, hour.sun), at: [{ x: 250, y: 130 }] });
    }));
    paint.group('hill', { composite: 'glaze', opacity: 1 }, (group) => group.wash('hill', {}, (wash) => {
      wash.fill('hill', { brush: fill, diameter: 60, ...flood, region: HILL, material: wetPassageMixture(kit, hour.hill) });
    }));
  });
}

/** How far the cloud drifts each frame, in pixels: far enough to see between neighbouring frames. */
const DRIFT = 24;
const STRIP = [0, 1, 2, 3];

/** A pale sky laid dry, and a grey cloud painted wet into paper wetted about it, drifting right; boiling when `boil`. */
function driftingCloud(kit: WetPassageKit, boil?: StampGroupBoil): StampPaintRecipe {
  const { fill, drop } = kit.brushes;
  const puff: StampRegion = { kind: 'ellipse', x: 110, y: 100, radiusX: 70, radiusY: 34 };
  return stampPaintRecipe((paint) => {
    paint.group('sky', { composite: 'glaze', opacity: 1 }, (group) => group.wash('sky', {}, (wash) => {
      wash.fill('sky', { brush: fill, diameter: 90, ...flood, region: polygon(12, 12, W - 12, 12, W - 12, H - 12, 12, H - 12), material: wetPassageMixture(kit, { cerulean: 0.2 }) });
    }));
    const motion = { keys: [{ at: 0, x: 0, y: 0 }, { at: 1, x: DRIFT * WET_ANIMATION_FPS, y: 0 }] };
    paint.group('cloud', { composite: 'glaze', opacity: 1, motion, ...(boil && { boil }) }, (group) => group.wash('cloud', { preparation: { region: { ...puff, radiusX: 80, radiusY: 42 } } }, (wash) => {
      wash.fill('cloud', { brush: fill, diameter: 40, region: puff, material: wetPassageMixture(kit, { ultramarine: 0.15, burntSienna: 0.08, quinacridoneRose: 0.03 }) });
      wash.stamps('shadow', { brush: drop, diameter: 36, material: wetPassageMixture(kit, { ultramarine: 0.25, burntSienna: 0.12 }), at: [{ x: 85, y: 112 }, { x: 135, y: 116 }] });
    }));
  });
}

const stripFrames = STRIP.map((frame) => ({ frame, caption: `frame ${frame + 1}` }));

export const WET_ANIMATIONS: readonly WetAnimation[] = [
  {
    id: 'sunset', title: 'A sunset: only the colour changes',
    takes: (kit) => HOURS.map((hour) => ({ recipe: sunsetAt(kit, hour), frames: [{ frame: 0, caption: hour.caption }] })),
    shows: 'The same sky, sun and hill painted four times, from afternoon to dusk. Every stroke is the same each time; only the paint in the brush changes.',
    lookFor: 'Nothing should change shape from one picture to the next: the same edges, the same texture, the same marks, only their colour moving toward dusk. Anything that shifts or flickers is wrong.',
  },
  {
    id: 'drift-stuck', title: 'A drifting cloud, its texture held',
    takes: (kit) => [{ recipe: driftingCloud(kit), frames: stripFrames }],
    shows: `Four frames in a row of a cloud drifting right over a still sky, ${DRIFT} pixels a frame. The cloud is painted once and moved.`,
    lookFor: 'The cloud’s texture, grain and edges should travel with it, exactly the same in every frame. The sky behind should not change at all.',
  },
  {
    id: 'drift-boiling', title: 'A drifting cloud, boiling on twos',
    takes: (kit) => [{ recipe: driftingCloud(kit, { every: 2 }), frames: stripFrames }],
    shows: 'The same drifting cloud, but repainted every second frame, the way hand-drawn animation “boils”: frames 1 and 2 are one painting, frames 3 and 4 another.',
    lookFor: 'Frames 1 and 2 should be the same cloud moved; frame 3 should be a fresh painting of the same cloud, the same shape and colour, only its marks and texture new. The sky should never change.',
  },
];
