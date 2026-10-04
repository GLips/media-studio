// painting-mix-check.ts: a paint charge's mix held to what a layer can paint: each mix one the engine's
// paintMixtureProblem accepts, hex parts `#rrggbb`, a field of mixes valid at both ends. How many pigments a layer's
// mixes spend is its slots' to count (painting-pigment-slots.ts).
//
// A field of mixes is warned of where it grades through grey: the engine grades each pigment's amount, so two hues
// far apart mix on the way (blue and orange to grey, where blue and rose keep a violet). The middle is mixed by the
// pure mixer and laid over white, as the engine lays it.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { paintComponentsBetween, paintComponentsOverWhite, paintMixtureComponents, paintMixtureProblem, type PaintComponent } from '#lib/paint/materials/models/paint-mixture.ts';
import { PAINT_BANDS, paintBandsToLinearRgb, paintLinearToHex, paintLinearToLab } from '#lib/paint/materials/models/paint-spectrum.ts';
import { stampPaintFieldProblem } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { Field, Mix } from './painting-document.ts';
import { isPaintingHexPigment, paintingMixture } from './painting-mix.ts';
import { isPaintingHexColor, isPaintingList, paintingField, type PaintingProblemList } from './painting-problem.ts';

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

/** What `components` lay, a full stroke over white paper in `medium`, as linear sRGB. */
const overWhite = (components: readonly PaintComponent[], medium: PaintMedium) => paintBandsToLinearRgb(PAINT_BANDS, paintComponentsOverWhite(components, medium));

const labChroma = (linear: readonly number[]) => {
  const [, a, b] = paintLinearToLab(linear);
  return Math.hypot(a, b);
};

/** Why a field of mixes from `from` to `to` reads grey halfway in `medium`, or null. */
function mixFieldGreyProblem(from: Mix, to: Mix, medium: PaintMedium): string | null {
  const [a, b] = [from, to].map((end) => paintMixtureComponents(paintingMixture(end), medium, PAINT_BANDS));
  const ends = [overWhite(a, medium), overWhite(b, medium)], middle = overWhite(paintComponentsBetween(a, b, 0.5), medium);
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
  const bad = mix.parts.findIndex(({ pigment }) => (isPaintingHexPigment(pigment)
    ? !isPaintingHexColor(pigment)
    : !(pigment.id && isPaintingHexColor(pigment.overWhite) && isPaintingHexColor(pigment.overBlack))));
  if (bad >= 0) {
    const { pigment } = mix.parts[bad];
    const message = isPaintingHexPigment(pigment) ? `'${pigment}' isn't #rrggbb` : `${pigment.id || 'a pigment'} needs an id and #rrggbb overWhite and overBlack`;
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
