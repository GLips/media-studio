// stamp-pigment-paint.ts: a stamp painting's paint when its style paints in pigment, worked out once on the CPU for
// the GPU's pigment compositor (stamp-paint-pigment-compositor.ts), which lays and dries it per pixel.
//
// Each group is one wet wash whose palette is every pigment its deposits lay (a colour fitted as a pigment of its
// own). Its layer holds each palette pigment's amount per pixel, so a pigment stays itself to the pixel, where
// vid-81's lift needs it.

import { paintPigmentFromColor, paintPigmentInMedium, type PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import { paintMixtureComponents } from '#lib/picture/paint/models/paint-mixture.ts';
import { paintPigmentSeed } from '#lib/picture/paint/models/paint-paper.ts';
import type { PaintPigment, PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import type { PaintBands } from '#lib/picture/paint/models/paint-spectrum.ts';
import type { CompiledStampDeposit, CompiledStampPaint, StampPaintColor } from './stamp-paint-recipe.ts';

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
 * The most pigments one group can mix: its layer holds a channel each and one for coverage, and 12 fill four
 * rgba16float layers. A wash of more is two washes.
 */
export const STAMP_PIGMENT_GROUP_SLOTS = 12;

/** One pigment of a deposit's paint: its slot in its group's palette, a full stroke's amount (unit films), its habits. */
export type StampPigmentComponent = { slot: number; amount: number; granulation: number; flocculation: number; seed: number };

export type StampPigmentGroup = {
  /** Its palette, a slot each. */
  palette: readonly PaintPigment[];
  /** Layers of four channels its pixels need: coverage, then a channel per slot. */
  layers: number;
};

export type StampPigmentPaint = {
  medium: PaintMedium;
  bands: PaintBands;
  groups: readonly StampPigmentGroup[];
  deposits: ReadonlyMap<CompiledStampDeposit, readonly StampPigmentComponent[]>;
};

export const stampPigmentLayers = (slots: number) => Math.ceil((slots + 1) / 4);

/**
 * `painting`'s paint as `mixing` mixes it. Throws on a mixture naming a pigment `mixing` lacks, two different pigments
 * with one id anywhere in the painting, or a group that mixes more than STAMP_PIGMENT_GROUP_SLOTS pigments.
 */
export function compileStampPigmentPaint(painting: CompiledStampPaint, mixing: StampPigmentMixing, bands: PaintBands): StampPigmentPaint {
  const { medium } = mixing;
  const byColor = new Map<StampPaintColor, PaintPigment>();
  // Each pigment the painting lays, by id, painting-wide: the style's first, so a mixture can't name another by one of theirs.
  const known = new Map(Object.values(mixing.pigments).map((appearance) => [appearance.id, paintPigmentInMedium(appearance, medium, bands)]));
  const named = new Set(known.keys());
  const white = medium.lightening.kind === 'white' ? medium.lightening.white.id : null;
  const deposits = new Map<CompiledStampDeposit, StampPigmentComponent[]>();
  const groups = painting.groups.map((group): StampPigmentGroup => {
    const palette: PaintPigment[] = [];
    for (const deposit of group.passes.flatMap((pass) => pass.deposits)) {
      const { material } = deposit;
      const laid = material.kind === 'mixture'
        ? paintMixtureComponents(material, medium, bands)
        : [{ pigment: byColor.get(material.color) ?? byColor.set(material.color, paintPigmentFromColor(material.color, medium, bands)).get(material.color)!, amount: medium.body }];
      deposits.set(deposit, laid.map(({ pigment, amount }) => {
        if (material.kind === 'mixture' && pigment.id !== white && !named.has(pigment.id)) {
          throw new Error(`stamp paint: ${deposit.id} mixes ${pigment.id}, which isn't among its style's pigments (${[...named].join(', ')})`);
        }
        const first = known.get(pigment.id) ?? known.set(pigment.id, pigment).get(pigment.id)!;
        if (!samePigment(first, pigment)) throw new Error(`stamp paint: ${deposit.id} lays a pigment named ${pigment.id} unlike the painting's other ${pigment.id}`);
        let slot = palette.findIndex(({ id }) => id === pigment.id);
        if (slot < 0) slot = palette.push(pigment) - 1;
        return { slot, amount, granulation: pigment.granulation * medium.granulation, flocculation: pigment.flocculation, seed: paintPigmentSeed(pigment.id) };
      }));
    }
    if (palette.length > STAMP_PIGMENT_GROUP_SLOTS) {
      throw new Error(`stamp paint: ${group.id} mixes ${palette.length} pigments, over the ${STAMP_PIGMENT_GROUP_SLOTS} a wash holds; split it into two groups (${palette.map(({ id }) => id).join(', ')})`);
    }
    return { palette, layers: stampPigmentLayers(palette.length) };
  });
  return { medium, bands, groups, deposits };
}

/** Whether two pigments are one: the same absorption, scattering and habits. A name is only for people. */
const samePigment = (a: PaintPigment, b: PaintPigment) =>
  a.K.every((k, i) => k === b.K[i]) && a.S.every((s, i) => s === b.S[i])
  && a.granulation === b.granulation && a.flocculation === b.flocculation && a.staining === b.staining;
