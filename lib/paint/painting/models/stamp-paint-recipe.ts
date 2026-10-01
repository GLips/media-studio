// stamp-paint-recipe.ts: writing a stamp painting. `stampPaintRecipe` runs a body that declares groups, their
// passages and the passages' applications in painting order (stamp-paint-passage.ts), against its environment, and
// returns the recipe as written (stamp-paint-recipe-types.ts), which compileStampPaintRecipe
// (stamp-paint-recipe-compile.ts) checks and places.
//
// Randomness comes from IDs, never order: each deposit is seeded by its ID, so adding a stroke changes no other.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { checkedStampIdSegment } from './stamp-deposit-identity.ts';
import { writeStampPassage, type StampPassageHost } from './stamp-paint-passage.ts';
import type {
  StampMasking, StampPaintEnvironment, StampPaintRecipe, StampPaintRecipeGroup, StampPaintRecipeMask, StampPaintRecipePass, StampPaintRecipeResist, StampPaintScope,
} from './stamp-paint-recipe-types.ts';

/**
 * Writes a recipe against `environment` (a resolved style is one) by calling `body`, which declares groups, their
 * passages and the passages' paint in painting order. Each group paints in its own mixing's medium or the painting's,
 * which every operation is checked against as it's written.
 */
export function stampPaintRecipe(environment: StampPaintEnvironment, body: (paint: StampPaintScope) => void): StampPaintRecipe {
  const groups: StampPaintRecipeGroup[] = [], masks: NonNullable<StampPaintRecipeMask>[] = [], resists: NonNullable<StampPaintRecipeResist>[] = [];
  let fluid: StampPaintRecipeMask = null;
  const masking = (path: (id: string) => readonly string[]): StampMasking => {
    const push = (op: NonNullable<StampPaintRecipeMask>['op'], id: string) => {
      fluid = { path: path(id), op, under: fluid };
      masks.push(fluid);
    };
    return { mask: (id, settings) => push({ kind: 'mask', ...settings }, id), unmask: (id, settings) => push({ kind: 'unmask', ...settings }, id) };
  };
  /** Runs `inner`, then puts the fluid back as it was. */
  const scoped = <T,>(inner: () => T): T => {
    const outer = fluid;
    try {
      return inner();
    } finally {
      fluid = outer;
    }
  };
  const painted: PaintMedium | null = environment.mixing.kind === 'pigment' ? environment.mixing.medium : null;
  body({
    ...masking((id) => [id]),
    group(id, options, groupBody) {
      const passes: StampPaintRecipePass[] = [];
      groups.push({ id: checkedStampIdSegment(id), options, passes });
      // The group's wax outlasts every scope inside it, and no unmask reaches it: it's kept apart from the fluid.
      let wax: StampPaintRecipeResist = null;
      const host: StampPassageHost = { environment, medium: options.mixing?.medium ?? painted, group: id, fluid: () => fluid, resist: () => wax, masking };
      scoped(() => groupBody({
        ...masking((maskId) => [id, maskId]),
        resist: (resistId, settings) => {
          wax = { path: [id, resistId], settings, under: wax };
          resists.push(wax);
        },
        passage: (passageId, passageOptions, passageBody) => {
          passes.push(scoped(() => writeStampPassage(host, passageId, passageOptions, false, passageBody)));
        },
        knockout: (passageId, knockoutOptions, knockoutBody) => {
          if (passes.length) throw new Error(`stamp paint: ${id}/${passageId} is a knockout after ${id}'s ${passes.map((pass) => pass.id).join(', ')}; a group knocks out once, before it paints`);
          // Its fluid is its own: put back as it ends, so the group's paint isn't held off by it.
          passes.push(scoped(() => writeStampPassage(host, passageId, knockoutOptions, true, (p) => knockoutBody({ mask: p.mask, unmask: p.unmask, water: p.water, lift: p.lift, wait: p.wait }))));
        },
      }));
    },
  });
  return { environment, groups, masks, resists };
}
