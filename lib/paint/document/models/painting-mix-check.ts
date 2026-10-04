// painting-mix-check.ts: a paint charge's mix held to what a layer can paint: each mix one the engine's
// paintMixtureProblem accepts, hex parts `#rrggbb`, a field of mixes valid at both ends. How many pigments a layer's
// mixes spend is its slots' to count (painting-pigment-slots.ts).
//
// A field of mixes is warned of where it grades through grey: the engine grades each pigment's amount, so two hues
// far apart mix on the way (blue and orange to grey, where blue and rose keep a violet). The middle is mixed by the
// pure mixer and laid over white, as the engine lays it.

import { paintColorPigmentId, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { paintFilm, paintLayered, paintMixtureComponents, paintMixtureProblem, type PaintComponent, type PaintMixture } from '#lib/paint/materials/models/paint-mixture.ts';
import type { PaintMixturePigment } from '#lib/paint/materials/models/paint-pigment.ts';
import { PAINT_BANDS, paintBandsToLinearRgb, paintLinearToHex, paintLinearToLab } from '#lib/paint/materials/models/paint-spectrum.ts';
import { stampPaintFieldProblem } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { Field, Hex, Mix, MixPart } from './painting-document.ts';
import { isPaintingHexColor, isPaintingList, paintingField, type PaintingProblemList } from './painting-problem.ts';

const isHex = (pigment: MixPart['pigment']): pigment is Hex => typeof pigment === 'string';

/** A part's pigment as the engine's mixture reads it: a hex is a colour standing for a pigment of its own, fitted as its medium fits a colour. */
export const paintingMixPigment = (pigment: MixPart['pigment']): PaintMixturePigment =>
  (isHex(pigment) ? { color: pigment, id: paintColorPigmentId(pigment), name: pigment } : pigment);

/** `mix` as the engine's mixture, the one the compile lays and the checks mix. */
export const paintingMixture = ({ parts, strength }: Mix): PaintMixture => ({ parts: parts.map(({ pigment, amount }) => ({ pigment: paintingMixPigment(pigment), amount })), strength });

/**
 * Each end of a field of mixes, by its field within the field (a linear's `from.value` and `to.value`), so a problem
 * names the end it's in.
 */
function mixFieldEnds(field: Field<Mix>): readonly (readonly [string, Mix])[] {
  if (field.kind === 'constant') return [['value', field.value]];
  if (field.kind === 'linear') return [['from.value', field.from.value], ['to.value', field.to.value]];
  if (field.kind === 'radial') return [['inner', field.inner], ['outer', field.outer]];
  return [['a', field.a], ['b', field.b]];
}

/**
 * A field's middle reads grey when it keeps less than this share of its duller end's chroma: about where blue to
 * orange, or ultramarine to burnt sienna, turns to mud, while ultramarine to rose keeps three quarters as violet.
 */
const GREY_MIDDLE_KEEPS = 0.5;

/** Ends duller than this CIELAB chroma are near greys already, with no colour for the middle to lose. */
const GREY_ENDS_BELOW = 10;

const WHITE_PAPER = new Float64Array(PAINT_BANDS.count).fill(1);

/** What `components` lay, a full stroke over white paper in `medium`, as linear sRGB. */
const overWhite = (components: readonly PaintComponent[], medium: PaintMedium) =>
  paintBandsToLinearRgb(PAINT_BANDS, paintLayered(WHITE_PAPER, [paintFilm(components, medium)]));

const labChroma = (linear: readonly number[]) => {
  const [, a, b] = paintLinearToLab(linear);
  return Math.hypot(a, b);
};

/** Halfway between two ends' components, as the engine grades them: each pigment at the mean of its ends' amounts, an end lacking it at 0. */
function componentsHalfway(a: readonly PaintComponent[], b: readonly PaintComponent[]): PaintComponent[] {
  const halfway = new Map<string, PaintComponent>();
  for (const { pigment, amount } of [...a, ...b]) {
    const kept = halfway.get(pigment.id);
    if (kept) kept.amount += amount / 2;
    else halfway.set(pigment.id, { pigment, amount: amount / 2 });
  }
  return [...halfway.values()];
}

/** Why a field of mixes from `from` to `to` reads grey halfway in `medium`, or null. */
function mixFieldGreyProblem(from: Mix, to: Mix, medium: PaintMedium): string | null {
  const [a, b] = [from, to].map((end) => paintMixtureComponents(paintingMixture(end), medium, PAINT_BANDS));
  const ends = [overWhite(a, medium), overWhite(b, medium)], middle = overWhite(componentsHalfway(a, b), medium);
  const duller = Math.min(...ends.map(labChroma)), kept = labChroma(middle) / duller;
  if (duller < GREY_ENDS_BELOW || kept >= GREY_MIDDLE_KEEPS) return null;
  const [first, second] = ends.map(paintLinearToHex);
  return `grades through grey: from ${first} to ${second} it mixes ${paintLinearToHex(middle)} halfway, ${Math.round(kept * 100)}% of the duller end's chroma: `
    + 'grade one mix\'s strength, change hue across layers, or charge the second colour into the wet flood';
}

/** Problems in one mix at `field` of `owner`; whether the engine can paint it. */
function checkOneMix(list: PaintingProblemList, owner: string, field: string, mix: Mix, box?: StampBox): boolean {
  if (!isPaintingList(mix.parts)) {
    list.error(owner, paintingField(field, 'parts'), 'a mix needs its parts', box);
    return false;
  }
  const bad = mix.parts.findIndex(({ pigment }) => (isHex(pigment)
    ? !isPaintingHexColor(pigment)
    : !(pigment.id && isPaintingHexColor(pigment.overWhite) && isPaintingHexColor(pigment.overBlack))));
  if (bad >= 0) {
    const { pigment } = mix.parts[bad];
    const message = isHex(pigment) ? `'${pigment}' isn't #rrggbb` : `${pigment.id || 'a pigment'} needs an id and #rrggbb overWhite and overBlack`;
    list.error(owner, paintingField(field, `parts[${bad}].pigment`), message, box);
    return false;
  }
  const problem = paintMixtureProblem(paintingMixture(mix));
  if (problem) list.error(owner, field, problem, box);
  return !problem;
}

/**
 * Problems in a charge's mix, a mix or a field of them, at `field` of `owner`, laid in `medium`; a field whose middle
 * greys is warned of.
 */
export function checkPaintingMix(list: PaintingProblemList, owner: string, field: string, mix: Mix | Field<Mix>, medium: PaintMedium, box?: StampBox): void {
  if ('parts' in mix) {
    checkOneMix(list, owner, field, mix, box);
    return;
  }
  const geometry = stampPaintFieldProblem(mix, () => null);
  if (geometry) {
    list.error(owner, field, `a field: ${geometry}`, box);
    return;
  }
  const ends = mixFieldEnds(mix);
  const paintable = ends.map(([end, value]) => checkOneMix(list, owner, paintingField(field, end), value, box)).every(Boolean);
  if (!paintable || ends.length !== 2) return;
  const grey = mixFieldGreyProblem(ends[0][1], ends[1][1], medium);
  if (grey) list.warn(owner, field, grey, box);
}
