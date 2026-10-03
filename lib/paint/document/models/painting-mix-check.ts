// painting-mix-check.ts: a paint charge's mix held to what a layer can paint: each mix one the engine's
// paintMixtureProblem accepts, hex parts `#rrggbb`, a field of mixes valid at both ends. How many pigments a layer's
// mixes spend is its slots' to count (painting-pigment-slots.ts).

import { paintColorPigmentId } from '#lib/paint/materials/models/paint-medium.ts';
import { paintMixtureProblem } from '#lib/paint/materials/models/paint-mixture.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { stampPaintFieldProblem } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { Field, Hex, Mix, MixPart } from './painting-document.ts';
import { isPaintingHexColor, isPaintingList, paintingField, type PaintingProblemList } from './painting-problem.ts';

const isHex = (pigment: MixPart['pigment']): pigment is Hex => typeof pigment === 'string';

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

/** A part's pigment as the engine's mixture reads it: a hex stands for a pigment of its own, `color:#rrggbb`. */
const asAppearance = (pigment: MixPart['pigment']): PaintPigmentAppearance =>
  (isHex(pigment) ? { id: paintColorPigmentId(pigment), name: pigment, overWhite: pigment, overBlack: pigment } : pigment);

/** Problems in one mix at `field` of `owner`. */
function checkOneMix(list: PaintingProblemList, owner: string, field: string, mix: Mix, box?: StampBox): void {
  if (!isPaintingList(mix.parts)) {
    list.error(owner, paintingField(field, 'parts'), 'a mix needs its parts', box);
    return;
  }
  const bad = mix.parts.findIndex(({ pigment }) => (isHex(pigment)
    ? !isPaintingHexColor(pigment)
    : !(pigment.id && isPaintingHexColor(pigment.overWhite) && isPaintingHexColor(pigment.overBlack))));
  if (bad >= 0) {
    const { pigment } = mix.parts[bad];
    const message = isHex(pigment) ? `'${pigment}' isn't #rrggbb` : `${pigment.id || 'a pigment'} needs an id and #rrggbb overWhite and overBlack`;
    list.error(owner, paintingField(field, `parts[${bad}].pigment`), message, box);
    return;
  }
  const problem = paintMixtureProblem({ parts: mix.parts.map(({ pigment, amount }) => ({ pigment: asAppearance(pigment), amount })), strength: mix.strength });
  if (problem) list.error(owner, field, problem, box);
}

/** Problems in a charge's mix, a mix or a field of them, at `field` of `owner`. */
export function checkPaintingMix(list: PaintingProblemList, owner: string, field: string, mix: Mix | Field<Mix>, box?: StampBox): void {
  if ('parts' in mix) {
    checkOneMix(list, owner, field, mix, box);
    return;
  }
  const geometry = stampPaintFieldProblem(mix, () => null);
  if (geometry) {
    list.error(owner, field, `a field: ${geometry}`, box);
    return;
  }
  for (const [end, value] of mixFieldEnds(mix)) checkOneMix(list, owner, paintingField(field, end), value, box);
}
