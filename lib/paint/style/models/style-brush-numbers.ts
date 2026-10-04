// style-brush-numbers.ts: a style's brushes as numbers to plan by (`studio brushes describe`): what pressure keeps of
// each one's size, opacity and flow, how wide it reads against its diameter, the smallest diameter its profile was
// measured at, and how it meets the paper. Packs are private, so these come from the packs on this machine, never
// from the studio's docs.

import type { StampBrush, StampBrushMedia, StampScaleTarget } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPressureShare } from '#lib/paint/brush/models/stamp-dynamics.ts';
import { stampBrushEdgeOffsetMean, stampBrushProfileRange } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import type { ResolvedStampPaintStyle, StampPaintStyle } from './style.ts';

/** The pressures each brush's shares are read at. */
export const STAMP_STYLE_BRUSH_PRESSURES = [0.3, 0.6, 1] as const;
/** The diameters, px, each brush's visible width is read at, where its profile reaches. */
export const STAMP_STYLE_BRUSH_DIAMETERS = [4, 8, 16, 32, 64, 128, 256] as const;

/** Read for every brush, bound to pressure or not: what a painter plans a stroke's weight by. */
const ALWAYS_READ: readonly StampScaleTarget[] = ['size', 'opacity', 'flow'];
/** Read only where pressure moves them. */
const READ_WHEN_BOUND: readonly StampScaleTarget[] = ['roundness', 'count', 'scatter', 'grainDepth'];

/**
 * How a brush meets the paper. `peaks`: it catches the peaks above `tooth` of the paper's mean height, deeper as it
 * presses (a dry medium, or a dry brush in a wet one, which skips the valleys). `valleys`: its paint settles into
 * them, catching no peaks. `flat`: flat colour, which the paper's grain cuts alike everywhere.
 */
export type StampStyleBrushPaperContact = { kind: 'peaks'; tooth: number; dryBrush: boolean } | { kind: 'valleys' } | { kind: 'flat' };

/**
 * A brush's footprint as its profile reads: visible width (both sides' mean offsets) over diameter at each of
 * STAMP_STYLE_BRUSH_DIAMETERS it reaches, and the range measured; or why it has none.
 */
export type StampStyleBrushFootprint =
  | { kind: 'measured'; smallest: number; largest: number; widths: readonly { diameter: number; ratio: number }[] }
  | { kind: 'unmeasured'; why: string };

/**
 * One role of a style. `pressure`: each target's share at STAMP_STYLE_BRUSH_PRESSURES, outside a taper. `flow`: the
 * brush's own, before pressure. `pressedTip`: a bristle or erodible tip, whose texels touch only as pressure passes
 * their contact, so falling pressure parts it as well as anything its shares say.
 */
export type StampStyleBrushNumbers = {
  role: string; pack: string; brush: string; media: StampBrushMedia;
  pressure: readonly { target: StampScaleTarget; shares: readonly number[] }[];
  flow: number; pressedTip: boolean; footprint: StampStyleBrushFootprint; paper: StampStyleBrushPaperContact;
};

const pressureShares = (brush: StampBrush, target: StampScaleTarget) => STAMP_STYLE_BRUSH_PRESSURES.map((pressure) => stampPressureShare(brush.dynamics, target, {
  pressure, pressureThrough: 1, heading: 0, initialHeading: 0, step: 0, distance: 0, countDraw: 0,
}));

function footprintOf(brush: StampBrush): StampStyleBrushFootprint {
  const { profile } = brush;
  if (profile.kind === 'refused') return { kind: 'unmeasured', why: profile.why };
  if (profile.kind === 'unmeasured') return { kind: 'unmeasured', why: 'its pack measured no profile for it' };
  const { min, max } = stampBrushProfileRange(profile);
  const widths = STAMP_STYLE_BRUSH_DIAMETERS.filter((diameter) => diameter >= min && diameter <= max)
    .map((diameter) => ({ diameter, ratio: (2 * stampBrushEdgeOffsetMean(profile, diameter, brush.name)) / diameter }));
  return { kind: 'measured', smallest: min, largest: max, widths };
}

function paperContactOf(style: ResolvedStampPaintStyle, media: StampBrushMedia): StampStyleBrushPaperContact {
  if (style.mixing.kind === 'flat') return { kind: 'flat' };
  const { paperContact } = style.mixing.medium;
  if (paperContact.kind === 'peaks') return { kind: 'peaks', tooth: paperContact.tooth, dryBrush: false };
  return media === 'dry' ? { kind: 'peaks', tooth: paperContact.dryBrush.tooth, dryBrush: true } : { kind: 'valleys' };
}

/** Each of `style`'s roles, in its style.ts's order, as `resolved` (the same style, read from its packs) paints it. */
export function stampStyleBrushNumbers(style: StampPaintStyle, resolved: ResolvedStampPaintStyle): StampStyleBrushNumbers[] {
  return Object.entries(style.brushes).map(([role, { pack }]) => {
    const brush = resolved.brushes[role], media = brush.media ?? style.packs[pack].media;
    const pressure = [...ALWAYS_READ, ...READ_WHEN_BOUND.filter((target) => brush.dynamics[target]?.pressure)].map((target) => ({ target, shares: pressureShares(brush, target) }));
    const pressedTip = 'bristles' in brush.tip || !!brush.tip.pressed;
    return { role, pack, brush: brush.name, media, pressure, flow: brush.flow, pressedTip, footprint: footprintOf(brush), paper: paperContactOf(resolved, media) };
  });
}

const fixed = (n: number, digits = 2) => String(Number(n.toFixed(digits)));

function paperContactText(paper: StampStyleBrushPaperContact): string {
  if (paper.kind === 'flat') return "flat colour, which the paper's grain cuts alike everywhere";
  if (paper.kind === 'valleys') return 'settles into the valleys; catches no peaks';
  return `catches the peaks above ${fixed(paper.tooth)} of the paper's mean height, deeper as it presses${paper.dryBrush ? ", and skips the valleys, leaving what's there: a dry brush" : ''}`;
}

/** `numbers` as lines a terminal prints: a heading per role and an indented line per measure. */
export function stampStyleBrushNumbersText(numbers: readonly StampStyleBrushNumbers[]): string[] {
  const at = STAMP_STYLE_BRUSH_PRESSURES.join(' / ');
  return numbers.flatMap(({ role, pack, brush, media, pressure, flow, pressedTip, footprint, paper }) => {
    const shares = pressure.map(({ target, shares: each }) => `${target} ${each.map((share) => fixed(share)).join(' ')}`).join('; ');
    const tip = pressedTip ? '; a pressed tip, its bristles touching as it presses, so falling pressure parts them' : '';
    const widths = footprint.kind === 'measured'
      ? [
        `visible width / diameter: ${footprint.widths.map(({ diameter, ratio }) => `${diameter} px ${fixed(ratio)}`).join(', ')}`,
        `smallest measured diameter ${fixed(footprint.smallest, 1)} px (no smaller probe drew a line; plan nothing finer), largest ${fixed(footprint.largest, 0)} px`,
      ]
      : [`no profile: ${footprint.why}`];
    return [
      `${role}: ${brush} (${pack}, ${media})`,
      `  kept at pressure ${at}: ${shares}; its own flow ${fixed(flow)}${tip}`,
      ...widths.map((line) => `  ${line}`),
      `  paper: ${paperContactText(paper)}`,
    ];
  });
}
