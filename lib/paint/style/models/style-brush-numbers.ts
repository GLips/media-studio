// style-brush-numbers.ts: a style's brushes as numbers to plan by (`studio brushes describe`): what pressure keeps of
// each one's size, opacity and flow, how wide it reads against its diameter, the smallest diameter its profile holds,
// and how it meets the paper. Packs are private, so these come from the packs on this machine, never from the
// studio's docs; each is read through the engine's own rule for it.

import type { StampBrushMedia, StampScaleTarget } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampPressureShare } from '#lib/paint/brush/models/stamp-dynamics.ts';
import { stampBrushEdgeOffsetMean, stampBrushProfileRange } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { STAMP_BRUSH_PROBE_LEAST_DIAMETER } from '#lib/paint/brush-packs/models/stamp-brush-profile-probes.ts';
import { STAMP_PRESSURE_GRAIN_OWNER, stampBrushPaperContact, type StampPaperContact } from '#lib/paint/painting/models/stamp-paper-contact.ts';
import type { ResolvedStampPaintStyle, StampStyleBrush } from './style.ts';

/** The pressures each brush's shares are read at. */
export const STAMP_STYLE_BRUSH_PRESSURES = [0.3, 0.6, 1] as const;
/** The diameters, px, each brush's visible width is read at, where its profile reaches. */
export const STAMP_STYLE_BRUSH_DIAMETERS = [4, 8, 16, 32, 64, 128, 256] as const;

/** Read for every brush, bound to pressure or not: what a painter plans a stroke's weight by. */
const ALWAYS_READ: readonly StampScaleTarget[] = ['size', 'opacity', 'flow'];
/** Read only where pressure moves them. */
const READ_WHEN_BOUND: readonly StampScaleTarget[] = ['roundness', 'count', 'scatter', 'grainDepth'];

/**
 * A brush's footprint as its profile reads: visible width (both sides' mean offsets) over diameter at each of
 * STAMP_STYLE_BRUSH_DIAMETERS it reaches, and the range its profile holds; or why it has none.
 */
export type StampStyleBrushFootprint =
  | { kind: 'measured'; smallest: number; largest: number; widths: readonly { diameter: number; ratio: number }[] }
  | { kind: 'unmeasured'; why: string };

/**
 * One role of a style. `pressure`: each target's share at STAMP_STYLE_BRUSH_PRESSURES, outside a taper, grain depth
 * left out where the paper's tooth answers pressure instead (STAMP_PRESSURE_GRAIN_OWNER). `flow`: the brush's own,
 * before pressure. `pressedTip`: a bristle or erodible tip, whose texels touch only as pressure passes their contact,
 * so falling pressure parts it as well as anything its shares say.
 */
export type StampStyleBrushNumbers = {
  role: string; pack: string; brush: string; media: StampBrushMedia;
  pressure: readonly { target: StampScaleTarget; shares: readonly number[] }[];
  flow: number; pressedTip: boolean; footprint: StampStyleBrushFootprint; paper: StampPaperContact;
};

const pressureShares = (brush: StampStyleBrush, target: StampScaleTarget) => STAMP_STYLE_BRUSH_PRESSURES.map((pressure) => stampPressureShare(brush.dynamics, target, {
  pressure, pressureThrough: 1, heading: 0, initialHeading: 0, step: 0, distance: 0, countDraw: 0,
}));

function footprintOf(brush: StampStyleBrush): StampStyleBrushFootprint {
  const { profile } = brush;
  if (profile.kind === 'refused') return { kind: 'unmeasured', why: profile.why };
  if (profile.kind === 'unmeasured') return { kind: 'unmeasured', why: 'its pack measured no profile for it' };
  const { min, max } = stampBrushProfileRange(profile);
  const widths = STAMP_STYLE_BRUSH_DIAMETERS.filter((diameter) => diameter >= min && diameter <= max)
    .map((diameter) => ({ diameter, ratio: (2 * stampBrushEdgeOffsetMean(profile, diameter, brush.name)) / diameter }));
  return { kind: 'measured', smallest: min, largest: max, widths };
}

/** Each role of `resolved`, in `roles`' order (its style.ts's brushes, naming each role's pack). */
export function stampStyleBrushNumbers(resolved: ResolvedStampPaintStyle, roles: Readonly<Record<string, { pack: string }>>): StampStyleBrushNumbers[] {
  const medium = resolved.mixing.kind === 'pigment' ? resolved.mixing.medium : null;
  return Object.entries(roles).map(([role, { pack }]) => {
    const brush = resolved.brushes[role], paper = stampBrushPaperContact(medium, brush.media);
    const toothOwnsGrain = STAMP_PRESSURE_GRAIN_OWNER[paper.kind] === 'tooth';
    const bound = READ_WHEN_BOUND.filter((target) => brush.dynamics[target]?.pressure && !(target === 'grainDepth' && toothOwnsGrain));
    const pressure = [...ALWAYS_READ, ...bound].map((target) => ({ target, shares: pressureShares(brush, target) }));
    const pressedTip = 'bristles' in brush.tip || !!brush.tip.pressed;
    return { role, pack, brush: brush.name, media: brush.media, pressure, flow: brush.flow, pressedTip, footprint: footprintOf(brush), paper };
  });
}

const fixed = (n: number, digits = 2) => String(Number(n.toFixed(digits)));

function paperContactText(paper: StampPaperContact): string {
  if (paper.kind === 'flat') return "flat colour, which the paper's grain cuts alike everywhere";
  if (paper.kind === 'valleys') return 'settles into the valleys; catches no peaks';
  const skips = paper.dryBrush ? ", and skips the valleys, leaving what's there: a dry brush" : '';
  return `catches the peaks above ${fixed(paper.tooth)} of the paper's mean height, deeper as it presses (the tooth, not its grain, answers pressure)${skips}`;
}

const smallestText = (smallest: number) => (smallest <= STAMP_BRUSH_PROBE_LEAST_DIAMETER
  ? `measured down to the probes' ${STAMP_BRUSH_PROBE_LEAST_DIAMETER} px floor`
  : `its profile starts at ${fixed(smallest, 1)} px: plan nothing finer`);

/** `numbers` as lines a terminal prints: a heading per role and an indented line per measure. */
export function stampStyleBrushNumbersText(numbers: readonly StampStyleBrushNumbers[]): string[] {
  const at = STAMP_STYLE_BRUSH_PRESSURES.join(' / ');
  return numbers.flatMap(({ role, pack, brush, media, pressure, flow, pressedTip, footprint, paper }) => {
    const shares = pressure.map(({ target, shares: each }) => `${target} ${each.map((share) => fixed(share)).join(' ')}`).join('; ');
    const tip = pressedTip ? '; a pressed tip, its bristles touching as it presses, so falling pressure parts them' : '';
    const widths = footprint.kind === 'measured'
      ? [
        `visible width / diameter: ${footprint.widths.map(({ diameter, ratio }) => `${diameter} px ${fixed(ratio)}`).join(', ')}`,
        `${smallestText(footprint.smallest)}; largest ${fixed(footprint.largest, 0)} px`,
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
