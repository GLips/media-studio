// The ink field bars 4 and 5 share: the 174 inks as a lattice of dots on black, and the count at its foot. Bar 4's
// needle ripples repaint the field and its last one lands every cell back on this rest look by bar 4's last frame; bar
// 5 picks the field up from that state on its first and filters it, the count standing where bar 4 landed it. This
// module is the one place the handover state is written down: change it here, not in a bar.

import { H, ODOMETER_DIGIT_EM, W } from '../../lib/studio/api.ts';
import { glyphFieldLayout, type GlyphCell, type GlyphFieldProps, type GlyphLayout, type GlyphRest, type GlyphShape } from '../../lib/studio/reel/glyph-field.tsx';
import { archivoAdvance } from '#models/reel/ticker-layout.ts';
import { inks, type Ink } from './look.ts';

/** A cell of the ink field: its place in the lattice and the ink it shows. */
export type InkCell = GlyphCell<Ink>;

/**
 * 18 columns on a 90 px pitch, centred: 174 cells in 10 rows, centres at x 195–1725 and y 135–945, the last row's 12
 * centred under the rows above. The pitch keeps the top and bottom rows' dots about 25 px clear of the HUD's text
 * (y 79 and 1004), so it stays legible over the field.
 */
export const INK_FIELD_LAYOUT = { columns: 18, pitch: 90, center: { x: W / 2, y: H / 2 }, lastRow: 'center' } as const satisfies GlyphLayout;

/** Cell i shows inks[i], the timeline's seeded shuffle, so every ink sits somewhere and neighbours differ. */
export const INK_FIELD_ITEMS: readonly Ink[] = inks;

/** Every cell's place, in the order of `INK_FIELD_ITEMS`: where a strike lands, or where a cell starts from. */
export const INK_FIELD_SLOTS = glyphFieldLayout(INK_FIELD_ITEMS.length, INK_FIELD_LAYOUT);

/** The centre of the cell at `column`, `row` (from 0, top left) of a full row: where to aim a strike. */
export function inkFieldSlotAt(column: number, row: number) {
  const { x, y } = INK_FIELD_SLOTS[row * INK_FIELD_LAYOUT.columns + column];
  return { x, y };
}

/**
 * Where bar 4's needle first strikes, on its first frame: bar 3's dive lands the period of the machine's .00 reading
 * here on its last, so the cut is a match on that dot.
 */
export const INK_FIRST_STRIKE = inkFieldSlotAt(7, 4);

/** The dot a cell rests as: half the pitch across, 45 px, the reference's 44.5. */
export const INK_DOT = { L: 0.5, w: 0.5, r: 0.25, theta: 0 } as const satisfies GlyphShape;

/** The field at rest: each cell a round dot in its own ink, at full size, opaque and unbrightened. */
export const inkFieldRest = (cell: InkCell): GlyphRest => ({ ...INK_DOT, fill: cell.item.color, scale: 1, opacity: 1, brighten: 0 });

/**
 * The field's items, layout and rest look, to spread into a GlyphField: `<GlyphField t={t} {...INK_FIELD} waves={…} />`.
 * At rest (no wave playing, no filter step, no punch) it draws exactly the handover frame.
 */
export const INK_FIELD = { items: INK_FIELD_ITEMS, layout: INK_FIELD_LAYOUT, rest: inkFieldRest } satisfies Pick<GlyphFieldProps<Ink>, 'items' | 'layout' | 'rest'>;

/**
 * The count at the field's foot, an Odometer in Archivo 900 at width 72: its digits 300 px tall (28% of the frame)
 * from x 96 on the baseline 952. `size` is the Odometer's size for that, `top` the digits' top, and `cell` a place's
 * width (its 1ch plus the tracking), for setting type after the digits.
 */
export const INK_COUNT = (() => {
  const left = 96, base = 952, weight = 900, wdth = 72, tracking = -0.02;
  const size = 300 / ODOMETER_DIGIT_EM.height;
  const cell = (archivoAdvance('0', { wght: weight, wdth }) + tracking) * size;
  return { left, base, weight, wdth, tracking, size, top: base - ODOMETER_DIGIT_EM.top * size, cell };
})();
