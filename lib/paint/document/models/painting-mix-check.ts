// painting-mix-check.ts: a paint charge's mix held to what a layer can paint: each mix one the engine's
// paintMixtureProblem accepts, hex parts `#rrggbb`, a field of mixes valid at both ends; and the pigments a mix spends
// of its layer's 12 slots, the medium's own white among them where it lightens with white.

import { paintColorPigmentId, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { paintMixtureProblem } from '#lib/paint/materials/models/paint-mixture.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { stampPaintFieldProblem } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { Field, Hex, Mix, MixPart } from './painting-document.ts';
import { isPaintingList, type PaintingProblemList } from './painting-problem.ts';
import { paintingField } from './painting-region-check.ts';

const HEX = /^#[0-9a-f]{6}$/i;

const isHex = (pigment: MixPart['pigment']): pigment is Hex => typeof pigment === 'string';

/** Whether `mix` is a field of mixes: a mix has parts; a field has a kind. */
export const isPaintingMixField = (mix: Mix | Field<Mix>): mix is Field<Mix> => !('parts' in mix);

/** Each end of a field of mixes, by its field within the field: a linear's `from.value` and `to.value`. */
export function paintingMixFieldEnds(field: Field<Mix>): readonly (readonly [string, Mix])[] {
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
  const bad = mix.parts.findIndex(({ pigment }) => (isHex(pigment) ? !HEX.test(pigment) : !(pigment.id && HEX.test(pigment.overWhite) && HEX.test(pigment.overBlack))));
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
  if (!isPaintingMixField(mix)) {
    checkOneMix(list, owner, field, mix, box);
    return;
  }
  const geometry = stampPaintFieldProblem(mix, () => null);
  if (geometry) {
    list.error(owner, field, `a field: ${geometry}`, box);
    return;
  }
  for (const [end, value] of paintingMixFieldEnds(mix)) checkOneMix(list, owner, paintingField(field, end), value, box);
}

/** The pigments, by id, a mix (or a field of them) lays in `medium`: its parts', and the medium's white below full strength. */
export function paintingMixPigmentIds(mix: Mix | Field<Mix>, medium: PaintMedium): Set<string> {
  const mixes = isPaintingMixField(mix) ? paintingMixFieldEnds(mix).map(([, value]) => value) : [mix];
  const ids = new Set<string>();
  for (const { parts, strength } of mixes) {
    for (const { pigment, amount } of parts) if (amount > 0) ids.add(asAppearance(pigment).id);
    if (medium.lightening.kind === 'white' && strength < 1) ids.add(medium.lightening.white.id);
  }
  return ids;
}
