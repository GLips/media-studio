// meadow.painting.ts: a watercolour sky painted wet-in-wet with a treeline charged into it while it shines, then,
// once it has set, a hill laid over it in a second wash of the same layer; and a cloud in a layer of its own, free
// to drift. One paper, one brush, three mixes. The worked example of docs/painting-authoring.md, checked by its spec.

import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { BrushRef, Clip, Mix, PaintingDocument, Paper, Ring, Subpath } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';

export const properties = {
  hillTopPx: { type: 'number', unit: 'paper px', min: 150, max: 260, step: 10, default: 200 },
} as const satisfies PropertySchema;

const W = 640, H = 360;
/** Where the sky wash stops, px from the top; the hill always rises above it. */
const SKY_FOOT = 262;

const { ultramarine, cerulean, burntSienna } = WATERCOLOUR_PIGMENTS;
const SKY_BLUE: Mix = { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: cerulean, amount: 0.5 }], strength: 0.45 };
const EARTH: Mix = { parts: [{ pigment: burntSienna, amount: 1 }, { pigment: ultramarine, amount: 0.4 }], strength: 0.7 };
const CLOUD_GREY: Mix = { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: burntSienna, amount: 0.6 }], strength: 0.15 };

const COTTON: Paper = {
  color: '#f4f2ed',
  grain: { image: { style: 'watercolor', pack: 'vvds', file: 'papers/vvds-watercolor-canvas-3.grain.png' }, scale: 1, depth: 0.35 },
  absorbency: 0.5,
};
/** An even brush: a flood that later work waits on wets its whole footprint. */
const WASH: BrushRef = { style: 'watercolor', brush: 'wash' };

const SKY: Ring = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: SKY_FOOT }, { x: 0, y: SKY_FOOT }];
const IN_SKY: Clip = { region: { kind: 'polygon', rings: [SKY] } };

/** A slow, uneven line for the treeline, heavier where it dips, its whole core on the sky flood's shiny paper. */
const TREELINE: Subpath = Array.from({ length: 17 }, (_, i) => {
  const x = (i * W) / 16, dip = Math.sin(i * 1.7) * 0.5 + 0.5;
  return { x, y: SKY_FOOT - 50 + 6 * dip, pressure: 0.6 + 0.4 * dip };
});

/** The hill: a swell peaking at `topPx` a third of the way across, closed along the bottom edge. */
function hillOutline(topPx: number): Ring {
  const ridge = Array.from({ length: 33 }, (_, i) => {
    const x = (i * W) / 32, swell = 0.5 + 0.5 * Math.cos(2 * Math.PI * (x / W - 1 / 3));
    return { x, y: H - (H - topPx) * (0.7 + 0.3 * swell) };
  });
  return [...ridge, { x: W, y: H }, { x: 0, y: H }];
}

export default function meadow({ hillTopPx }: PropertyValues<typeof properties>): PaintingDocument {
  return {
    widthPx: W,
    heightPx: H,
    paper: COTTON,
    medium: 'watercolour',
    layers: [
      {
        key: 'landscape',
        washes: [
          {
            key: 'sky',
            applications: [
              {
                key: 'sky-flood', kind: 'fill', area: { region: { kind: 'polygon', rings: [SKY] } },
                brush: WASH, diameterPx: 90, seed: 'sky-flood', charge: { kind: 'paint', mix: SKY_BLUE, water: 0.85 },
              },
              {
                key: 'treeline', on: 'wet', kind: 'stroke', subpaths: [TREELINE], hand: { profile: 'swell', wobble: { position: 0.2 } },
                clips: [IN_SKY], brush: WASH, diameterPx: 26, seed: 'treeline', charge: { kind: 'paint', mix: EARTH, water: 0.6 },
              },
            ],
          },
          {
            key: 'hill',
            applications: [{
              key: 'hill-flood', kind: 'fill', area: { region: { kind: 'polygon', rings: [hillOutline(hillTopPx)] } },
              brush: WASH, diameterPx: 70, seed: 'hill-flood', charge: { kind: 'paint', mix: EARTH, water: 0.5 },
            }],
          },
        ],
      },
      {
        // On the root's paper with the sky: wherever a scene poses it, it's repainted into that paper there.
        key: 'cloud',
        washes: [{
          key: 'cloud-wash',
          applications: [{
            kind: 'fill',
            area: { region: { kind: 'ellipse', center: { x: 200, y: 80 }, radiusX: 70, radiusY: 22 }, edge: { kind: 'feather', widthPx: 14 } },
            brush: WASH, diameterPx: 40, seed: 'cloud-flood', charge: { kind: 'paint', mix: CLOUD_GREY, water: 0.7 },
          }],
        }],
      },
    ],
  };
}
