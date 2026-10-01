// stamp-pigment-paint.ts: a stamp painting's paint when its style paints in pigment, worked out once on the CPU for
// the GPU's pigment compositor (stamp-paint-pigment-compositor.ts), which lays and dries it per pixel.
//
// Each group's palette is every pigment its deposits lay (a colour fitted as a pigment of its own). Its layer holds
// each palette pigment's amount per pixel, so a pigment stays itself to the pixel, where a lift needs it. A graded
// material (a graded wash) lays each pigment of either end at an amount the GPU grades between the two, so a wash
// passes from one colour to another by pigment amounts, never by rendered colour; a keyed one over the scene too.

import { paintPigmentFromColor, paintPigmentInMedium, type PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import { paintMixtureComponents } from '#lib/picture/paint/models/paint-mixture.ts';
import { paintPigmentSeed } from '#lib/picture/paint/models/paint-paper.ts';
import type { PaintPigment, PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import type { PaintBands } from '#lib/picture/paint/models/paint-spectrum.ts';
import type { PlacedStamp } from './stamp-placement.ts';
import { stampPaintFieldEnds } from './stamp-paint-field.ts';
import { stampKeySpanAt } from './stamp-material-keys.ts';
import { stampPassDeposits, type CompiledStampDeposit, type CompiledStampPaint, type PaintMaterial, type StampKeyedMaterial, type StampPaintColor } from './stamp-paint-recipe.ts';

/**
 * Paint as pigment in a `medium`, mixed and dried with Kubelka–Munk. `pigments`, keyed by id, are the ones a mixture
 * may name; a colour is fitted as a pigment of its own, and a medium lightened with white brings its white.
 */
export type StampPigmentMixing<P extends Readonly<Record<string, PaintPigmentAppearance>> = Readonly<Record<string, PaintPigmentAppearance>>> = {
  kind: 'pigment';
  medium: PaintMedium;
  pigments: P;
};

/** How a painting's paint mixes: `flat` colour, laid by each deposit's blend in gamma-encoded sRGB as Photoshop lays it; or pigment. */
export type StampPaintMixing = { kind: 'flat' } | StampPigmentMixing;

/**
 * The most pigments one group can mix: its layer holds a channel each, one for coverage and, in a group with a wash,
 * one for its open share, so 12 fit four rgba16float layers either way. A wash of more is two washes.
 */
export const STAMP_PIGMENT_GROUP_SLOTS = 12;

/**
 * A pigment's amount at one end of a material over scene time: a full stroke's (unit films) at each key, eased
 * between them and held beyond (stamp-material-keys.ts); a single key for paint that doesn't change.
 */
export type StampPigmentAmountKeys = readonly { at: number; amount: number }[];

/**
 * One pigment of a deposit's paint: its slot in its group's palette, its amounts at its material's first end and at
 * its second (the same for an ungraded one; 0 at an end or a key without it), its habits.
 */
export type StampPigmentComponent = {
  slot: number; ends: readonly [first: StampPigmentAmountKeys, second: StampPigmentAmountKeys]; granulation: number; flocculation: number; seed: number;
};

/** `component`'s amounts at its material's two ends `t` seconds into the scene. */
export function stampPigmentAmountsAt({ ends }: StampPigmentComponent, t: number): [first: number, second: number] {
  const at = (keys: StampPigmentAmountKeys) => {
    const { from, to, share } = stampKeySpanAt(keys, t);
    return keys[from].amount + (keys[to].amount - keys[from].amount) * share;
  };
  return [at(ends[0]), at(ends[1])];
}

/** Where a deposit's material grades between its ends, as paintFieldShare reads it (STAMP_PAINT_FIELD_SHARE): kind 0 for none. */
export type StampPigmentGrade = { kind: 0 | 1 | 2; geometry: readonly [number, number, number, number] };

export type StampPigmentGroup = {
  /** Its palette, a slot each. */
  palette: readonly PaintPigment[];
  /**
   * Layers of four channels its paint needs, all a wet stage moves: coverage, then a channel per slot, and in a group
   * with a wash its open share.
   */
  paintLayers: number;
  /**
   * In a group with a wash, the channel holding each pixel's open share, its paint's last: how much of its paint
   * hasn't set (stamp-paint-pigment-compositor.ts). Null in a group without, which pays nothing for it.
   */
  open: number | null;
  /**
   * In a group on its own paper (StampGroupPaper), the layer after its paint whose first channel holds how much of its
   * paper shows over what's under it, which no wet stage moves. Null in a group on the ground's.
   */
  sheetLayer: number | null;
};

/** Layers of four channels a group's pixels need: its paint's, and its sheet's if it has one. */
export const stampPigmentGroupLayers = ({ paintLayers, sheetLayer }: StampPigmentGroup) => paintLayers + (sheetLayer === null ? 0 : 1);

export type StampPigmentPaint = {
  medium: PaintMedium;
  bands: PaintBands;
  groups: readonly StampPigmentGroup[];
  /** Each deposit's group, by index, its components (none for water or a lift) and where its material grades. */
  deposits: ReadonlyMap<CompiledStampDeposit, StampPigmentDeposit>;
};

export type StampPigmentDeposit = { group: number; components: readonly StampPigmentComponent[]; grade: StampPigmentGrade };

const UNGRADED: StampPigmentGrade = { kind: 0, geometry: [0, 0, 0, 0] };

/** How much of pigment `id` an end of a material lays: none if it lacks it. */
const amountAtEnd = (laid: readonly { pigment: PaintPigment; amount: number }[], id: string) => laid.find(({ pigment }) => pigment.id === id)?.amount ?? 0;

/** Layers of four channels a group of `slots` pigments needs for its paint: coverage, a channel each, and an open share if it `washes`. */
export const stampPigmentLayers = (slots: number, washes: boolean) => Math.ceil((slots + 1 + (washes ? 1 : 0)) / 4);

/**
 * `painting`'s paint as `mixing` mixes it, a graded material's pigments from both its ends. Throws on a mixture
 * naming a pigment `mixing` lacks, two different pigments with one id anywhere in the painting, or a group that mixes
 * more than STAMP_PIGMENT_GROUP_SLOTS pigments.
 */
export function compileStampPigmentPaint(painting: CompiledStampPaint, mixing: StampPigmentMixing, bands: PaintBands): StampPigmentPaint {
  const { medium } = mixing;
  const byColor = new Map<StampPaintColor, PaintPigment>();
  // Each pigment the painting lays, by id, painting-wide: the style's first, so a mixture can't name another by one of theirs.
  const known = new Map(Object.values(mixing.pigments).map((appearance) => [appearance.id, paintPigmentInMedium(appearance, medium, bands)]));
  const named = new Set(known.keys());
  const white = medium.lightening.kind === 'white' ? medium.lightening.white.id : null;
  const deposits = new Map<CompiledStampDeposit, StampPigmentDeposit>();
  const groups = painting.groups.map((group, g): StampPigmentGroup => {
    const palette: PaintPigment[] = [];
    for (const deposit of group.passes.flatMap((pass) => stampPassDeposits(pass))) {
      const { action } = deposit;
      // Water and a lift lay no pigment of their own.
      if (action.kind !== 'paint') {
        deposits.set(deposit, { group: g, components: [], grade: UNGRADED });
        continue;
      }
      if (action.burnish && medium.paperContact.kind !== 'peaks') throw new Error(`stamp paint: ${deposit.id} burnishes, and ${medium.name} isn't a dry medium`);
      const { first, second, kind, geometry } = stampPaintFieldEnds(action.material);
      /** What a full stroke of `material` lays, each pigment the painting's one of its id. */
      const laidOf = (material: PaintMaterial) => {
        const laid = material.kind === 'mixture'
          ? paintMixtureComponents(material, medium, bands)
          : [{ pigment: byColor.get(material.color) ?? byColor.set(material.color, paintPigmentFromColor(material.color, medium, bands)).get(material.color)!, amount: medium.body }];
        return laid.map(({ pigment, amount }) => {
          if (material.kind === 'mixture' && pigment.id !== white && !named.has(pigment.id)) {
            throw new Error(`stamp paint: ${deposit.id} mixes ${pigment.id}, which isn't among its style's pigments (${[...named].join(', ')})`);
          }
          const kept = known.get(pigment.id) ?? known.set(pigment.id, pigment).get(pigment.id)!;
          if (!samePigment(kept, pigment)) throw new Error(`stamp paint: ${deposit.id} lays a pigment named ${pigment.id} unlike the painting's other ${pigment.id}`);
          return { pigment: kept, amount };
        });
      };
      /** Each key of a material's end with what it lays: a material that doesn't change is one key. */
      const keysOf = (end: StampKeyedMaterial) => (end.kind === 'keys' ? end.keys : [{ at: 0, material: end }]).map(({ at, material }) => ({ at, laid: laidOf(material) }));
      const atFirst = keysOf(first), atSecond = kind === 0 ? atFirst : keysOf(second);
      const pigments = [...atFirst, ...atSecond].flatMap(({ laid }) => laid.map(({ pigment }) => pigment)).filter((pigment, i, all) => all.findIndex(({ id }) => id === pigment.id) === i);
      deposits.set(deposit, {
        group: g,
        grade: kind === 0 ? UNGRADED : { kind, geometry },
        components: pigments.map((pigment) => {
          let slot = palette.findIndex(({ id }) => id === pigment.id);
          if (slot < 0) slot = palette.push(pigment) - 1;
          const amounts = (keys: typeof atFirst) => keys.map(({ at, laid }) => ({ at, amount: amountAtEnd(laid, pigment.id) }));
          return {
            slot, ends: [amounts(atFirst), amounts(atSecond)],
            granulation: pigment.granulation * medium.granulation, flocculation: pigment.flocculation, seed: paintPigmentSeed(pigment.id),
          };
        }),
      });
    }
    if (palette.length > STAMP_PIGMENT_GROUP_SLOTS) {
      throw new Error(`stamp paint: ${group.id} mixes ${palette.length} pigments, over the ${STAMP_PIGMENT_GROUP_SLOTS} a wash holds; split it into two groups (${palette.map(({ id }) => id).join(', ')})`);
    }
    const washes = group.passes.some((pass) => pass.kind === 'wash'), paintLayers = stampPigmentLayers(palette.length, washes);
    return { palette, paintLayers, open: washes ? 4 * paintLayers - 1 : null, sheetLayer: group.paper === 'own' ? paintLayers : null };
  });
  return { medium, bands, groups, deposits };
}

/**
 * `stamp`'s share of its grain's depth in `medium` (null: flat paint). A medium that catches the paper's peaks reads
 * pressure against the tooth itself (paintDryContact), so the brush's grain depth by pressure, Photoshop's model of
 * the same, is set aside: kept, Kyle's Nupastel laid nothing at half pressure in crayon. A lift's stamps go alike.
 */
export const stampGrainDepthIn = (stamp: PlacedStamp, medium: PaintMedium | null): number =>
  stamp.grainDepth * (medium?.paperContact.kind === 'peaks' ? 1 : stamp.grainDepthByPressure);

/** Whether two pigments are one: the same absorption, scattering and habits. A name is only for people. */
const samePigment = (a: PaintPigment, b: PaintPigment) =>
  a.K.every((k, i) => k === b.K[i]) && a.S.every((s, i) => s === b.S[i])
  && a.granulation === b.granulation && a.flocculation === b.flocculation && a.staining === b.staining;
