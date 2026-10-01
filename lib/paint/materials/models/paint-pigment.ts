// paint-pigment.ts: a pigment, what's in the tube: absorption and scattering per band (K, S per unit amount), whence
// its colour, tinting strength and transparency, plus how it behaves on paper: granulation, flocculation, staining.
//
// A pigment is written as a painter would describe it (PaintPigmentAppearance: a swatch over white and over black,
// maybe a thin tint) and fitted into K and S once (Curtis §4.1, paint-pigment-tint.ts). The fit is from stated looks,
// never from measured or licensed data. What a medium does with a pigment is paint-medium.ts's.

import { kubelkaMunkFromAppearance } from './paint-kubelka-munk.ts';
import { paintPigmentTintedFit } from './paint-pigment-tint.ts';
import { paintHexToLinear, type PaintBands, type PaintBandValues } from './paint-spectrum.ts';

export type PaintHex = `#${string}`;

/** How a pigment behaves on paper, beside its colour. Each 0..1. */
export type PaintPigmentHabits = {
  /** How strongly it settles into the paper's valleys (ultramarine, umber, cerulean high; quinacridones 0). */
  granulation: number;
  /** How strongly it clumps into speckles, whatever the paper. */
  flocculation: number;
  /** How much of it resists lifting back off (phthalos, quinacridones high). Carried for vid-81's lift; nothing reads it yet. */
  staining: number;
};

/**
 * A pigment ready to mix. `id` is what it's known by: two pigments with one id are one pigment, so a mixture can't
 * name it twice, and its clumping is seeded by it. `name` is only for people.
 */
export type PaintPigment = PaintPigmentHabits & {
  id: string;
  name: string;
  /** Absorption per unit amount, per band. */
  K: PaintBandValues;
  /** Scattering per unit amount, per band. */
  S: PaintBandValues;
};

/**
 * A pigment as a painter would describe a glaze of it: the colour a unit-thick swatch shows over white and over
 * black. From those two follow its absorption and scattering: a swatch nearly as light over black as over white
 * scatters, so covers; one nearly black over black is a transparent glaze.
 */
export type PaintPigmentAppearance = Partial<PaintPigmentHabits> & {
  /** Its id (PaintPigment's): a palette's key for it, so it holds whatever the name says. */
  id: string;
  name: string;
  overWhite: PaintHex;
  overBlack: PaintHex;
  /**
   * The colour a thin wash shows over white paper, at `strength` of a unit swatch's pigment, undried: how the paint
   * thins, which its swatch alone can't say. Where a swatch and its tint disagree, the fit splits the difference.
   */
  tint?: { color: PaintHex; strength: number };
};

/** A reflectance held inside (0, 1), where the inversions are defined. */
export const paintHeldReflectance = (v: number, low = 1e-4, high = 1 - 1e-4) => Math.min(high, Math.max(low, v));

export const paintPigmentHabits = (from: Partial<PaintPigmentHabits>): PaintPigmentHabits => ({
  granulation: from.granulation ?? 0, flocculation: from.flocculation ?? 0, staining: from.staining ?? 0,
});

// A tint's fit takes milliseconds, so each appearance is fitted once per bands.
const FITTED = new WeakMap<PaintBands, Map<string, { K: PaintBandValues; S: PaintBandValues }>>();
const appearanceKey = ({ overWhite, overBlack, tint }: PaintPigmentAppearance) => `${overWhite} ${overBlack} ${tint ? `${tint.color} ${tint.strength}` : ''}`;

/**
 * `appearance` as K and S in `bands`: each band's colour over white and over black inverted per band, then, if it
 * has a tint, corrected to reproduce that too.
 */
export function paintPigmentFromAppearance(appearance: PaintPigmentAppearance, bands: PaintBands): PaintPigment {
  const key = appearanceKey(appearance);
  const byBands = FITTED.get(bands) ?? new Map<string, { K: PaintBandValues; S: PaintBandValues }>();
  FITTED.set(bands, byBands);
  let fitted = byBands.get(key);
  if (!fitted) {
    const white = bands.reflectanceOf(paintHexToLinear(appearance.overWhite));
    const black = bands.reflectanceOf(paintHexToLinear(appearance.overBlack));
    const K = new Float64Array(bands.count), S = new Float64Array(bands.count);
    for (let b = 0; b < bands.count; b++) {
      const w = paintHeldReflectance(white[b], 2e-3);
      // Over black a swatch can't read lighter than over white, and a little scattering keeps the inversion defined.
      ({ K: K[b], S: S[b] } = kubelkaMunkFromAppearance(w, paintHeldReflectance(Math.min(black[b], w * 0.999))));
    }
    fitted = appearance.tint ? paintPigmentTintedFit({ overWhite: appearance.overWhite, overBlack: appearance.overBlack, tint: appearance.tint }, { K, S }, bands) : { K, S };
    byBands.set(key, fitted);
  }
  return { id: appearance.id, name: appearance.name, K: fitted.K.slice(), S: fitted.S.slice(), ...paintPigmentHabits(appearance) };
}
