// bloom-rims.painting.ts: the bloom chart of docs/painting-authoring.md (docs/images/bloom-rims.png), painted by
// `studio paint still`. Three rows of crisp watercolour floods at water 0.85, each row a wash of its own `rim`, 0.5, 1
// and 2 from the top; into each flood, once it's damp, a bloom drop whose water lies 0.1, 0.2 and 0.35 over damp,
// left to right.

import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { Application, BrushRef, Mix, PaintingDocument, Paper, Wash } from '#lib/paint/document/models/painting-document.ts';

const W = 640, H = 420, CELL_W = W / 3, CELL_H = H / 3;
/** Each row's wash `rim`, top to bottom. */
const RIMS = [0.5, 1, 2] as const;
/** Each column's bloom water, left to right: 0.1, 0.2 and 0.35 over watercolour's damp 0.35. */
const BLOOM_WATERS = [0.45, 0.55, 0.7] as const;

const { ultramarine, burntSienna } = WATERCOLOUR_PIGMENTS;
const SLATE: Mix = { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: burntSienna, amount: 0.35 }], strength: 0.6 };
const COTTON: Paper = {
  color: '#f4f2ed',
  grain: { image: { style: 'watercolor', pack: 'vvds', file: 'papers/vvds-watercolor-canvas-3.grain.png' }, scale: 1, depth: 0.35 },
  absorbency: 0.5,
};
/** The style's even brush: a flood's water lands whole, so a bloom meets it damp everywhere at once. */
const EVEN: BrushRef = { style: 'watercolor', brush: 'detail' };
/** The round the style drops into a wet wash. */
const CHARGE: BrushRef = { style: 'watercolor', brush: 'charge' };

/** The centre of the cell at `row`, `column`. */
const cellCentre = (row: number, column: number) => ({ x: CELL_W * (column + 0.5), y: CELL_H * (row + 0.5) });

/** Row `row`'s wash: its three floods, then a bloom into each once it's damp. */
function bloomRow(row: number): Wash {
  const floods = BLOOM_WATERS.map((_, column): Application => ({
    key: `flood-${row}-${column}`, kind: 'fill', area: { region: { kind: 'ellipse', center: cellCentre(row, column), radiusX: 84, radiusY: 52 } },
    brush: EVEN, diameterPx: 60, seed: `flood-${row}-${column}`, charge: { kind: 'paint', mix: SLATE, water: 0.85 },
  }));
  const blooms = BLOOM_WATERS.map((water, column): Application => ({
    key: `bloom-${row}-${column}`, on: 'damp', effect: 'bloom', kind: 'stamps', placements: [{ ...cellCentre(row, column), diameter: 80 }],
    brush: CHARGE, diameterPx: 80, seed: `bloom-${row}-${column}`, charge: { kind: 'water', water },
  }));
  return { key: `rim-${RIMS[row]}`, rim: RIMS[row], applications: [...floods, ...blooms] };
}

export default function bloomRims(): PaintingDocument {
  return { widthPx: W, heightPx: H, paper: COTTON, medium: 'watercolour', layers: [{ key: 'blooms', washes: RIMS.map((_, row) => bloomRow(row)) }] };
}
