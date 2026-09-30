// stamp-pigment-paint.ts: a stamp painting's paint when its style paints in pigment, worked out once on the CPU for
// the GPU's pigment compositor and the CPU reference alike.
//
// Each group is one wet wash whose palette is every pigment its deposits lay (a colour fitted as a pigment of its
// own). Its layer holds each palette pigment's amount per pixel, so a pigment stays itself to the pixel, where
// vid-81's lift needs it. The per-pixel rules here are the CPU twins of stamp-paint-pigment-compositor.ts's WGSL.

import { kubelkaMunkFilm, kubelkaMunkOver } from '#lib/picture/paint/models/paint-kubelka-munk.ts';
import { paintPigmentFromColor, paintPigmentInMedium, type PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import { paintMixtureComponents } from '#lib/picture/paint/models/paint-mixture.ts';
import { paintClumps, paintDryContact, paintPigmentSeed, paintValley, paintWetSettle } from '#lib/picture/paint/models/paint-paper.ts';
import type { PaintPigment, PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import { paintHexToLinear, srgbToLinear, type PaintBands } from '#lib/picture/paint/models/paint-spectrum.ts';
import { STAMP_OPAQUE_COVER, type CompiledStampDeposit, type CompiledStampPaint, type StampPaintColor } from './stamp-paint-recipe.ts';

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

/**
 * A deposit laid into a group's pixel (coverage, then each slot's amount), twin of `layDeposit`. `tooth` is the
 * paper's paint here, `mean` its mean. The wash takes the incoming paint by volume, less as pickup carries the wet
 * paint under it along: a stand-in for levelling that doesn't conserve paint (vid-81's).
 */
export function stampPigmentLayDeposit(
  pixel: Float64Array, components: readonly StampPigmentComponent[], medium: PaintMedium, cover: number,
  paper: { tooth: number; mean: number; depth: number }, x: number, y: number,
) {
  const c = Math.min(1, Math.max(0, cover));
  if (c <= 0) return;
  const h = 1 - paper.tooth, meanHeight = 1 - paper.mean;
  const valley = paintValley(h, meanHeight);
  const incoming = new Float64Array(pixel.length);
  for (const component of components) {
    const contact = medium.paperContact.kind === 'peaks'
      ? paintDryContact(h, meanHeight, medium.paperContact.tooth, paper.depth)
      : paintWetSettle(valley, paper.depth, component.granulation, component.amount);
    incoming[component.slot + 1] += component.amount * Math.max(0, contact * paintClumps(component.flocculation, x, y, component.seed));
  }
  const under = pixel[0];
  const rate = c * (1 - medium.pickup * under);
  for (let i = 1; i < pixel.length; i++) pixel[i] += rate * (incoming[i] - pixel[i]);
  pixel[0] = c + under * (1 - c);
}

/**
 * A group's pixel dried onto `painting` (reflectance per band, in place), twin of `layGroup`. A glaze is its film at
 * `opacity` of its thickness over what's there. An opaque group is painted on paper kept for it: its film at full
 * body over bare `paper`, covering as far as its coverage, raised as the flat compositor raises it.
 */
export function stampPigmentDryGroup(
  painting: Float64Array, pixel: Float64Array, group: StampPigmentGroup, medium: PaintMedium, composite: 'glaze' | 'opaque', opacity: number, paper: Float64Array,
) {
  const coverage = pixel[0];
  if (coverage <= 0) return;
  const bands = painting.length;
  const thickness = composite === 'glaze' ? opacity : 1 / Math.max(coverage, 0.001);
  const cover = Math.min(1, coverage * STAMP_OPAQUE_COVER) * opacity;
  for (let b = 0; b < bands; b++) {
    let absorb = 0, scatter = 0;
    group.palette.forEach((pigment, slot) => {
      absorb += pixel[slot + 1] * pigment.K[b];
      scatter += pixel[slot + 1] * pigment.S[b];
    });
    const film = kubelkaMunkFilm({ absorb: absorb * thickness, scatter: scatter * (1 + medium.dryingScatter) * thickness });
    const laid = composite === 'glaze' ? kubelkaMunkOver(film, painting[b]) : painting[b] + (kubelkaMunkOver(film, paper[b]) - painting[b]) * cover;
    painting[b] = Math.min(1, Math.max(0, laid));
  }
}


/** The paper's reflectance per band at a pixel whose photograph reads `color` (gamma sRGB, 0..1): its written colour's, moved as far as the pixel differs. */
export function stampPigmentPaper(bands: PaintBands, paperColor: StampPaintColor, color: readonly number[]): Float64Array {
  const base = bands.reflectanceOf(paintHexToLinear(paperColor)), written = paintHexToLinear(paperColor);
  const moved = color.map((v, i) => srgbToLinear(v) - written[i]);
  return base.map((R, b) => Math.min(0.999, Math.max(0.001, R + bands.correctionBasis.reduce((sum, column, c) => sum + column[b] * moved[c], 0))));
}
