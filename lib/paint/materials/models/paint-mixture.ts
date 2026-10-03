// paint-mixture.ts: paint as a painter mixes it on the palette, and the film it lays.
//
// A mixture is pigments in proportion (`amount`, relative) at a `strength` (0..1 of a full load): proportions stay
// apart from strength, and both from water (vid-81's). Laid in a medium it becomes components, one per pigment, each
// an amount in unit films: a stroke's paint keeps its pigments apart, so each settles and clumps by its own habits
// and can later be lifted by its own staining.
//
// A film is described by its total absorption and scattering per band (paint-kubelka-munk.ts). Pigments in one film
// add theirs, so a film is the sum of its components' amounts times their K and S.

import { kubelkaMunkFilm, kubelkaMunkOpaque, kubelkaMunkOver } from './paint-kubelka-munk.ts';
import { paintPigmentInMedium, type PaintMedium } from './paint-medium.ts';
import type { PaintMixturePigment, PaintPigment } from './paint-pigment.ts';
import type { PaintBands, PaintBandValues } from './paint-spectrum.ts';

export type PaintMixturePart = { pigment: PaintMixturePigment; amount: number };
export type PaintMixture = { parts: readonly PaintMixturePart[]; strength: number };

/** One pigment of a paint as laid: how much of it a full stroke lays, in unit films. */
export type PaintComponent = { pigment: PaintPigment; amount: number };

/**
 * Why `mixture` can't be painted, or null: no part with a positive amount, an amount below 0 or not finite, a
 * pigment named twice (by id), or a strength outside 0..1.
 */
export function paintMixtureProblem({ parts, strength }: PaintMixture): string | null {
  if (!(strength >= 0 && strength <= 1)) return `its strength ${strength} isn't within 0..1`;
  const bad = parts.find(({ amount }) => !(amount >= 0 && Number.isFinite(amount)));
  if (bad) return `${bad.pigment.id}'s amount ${bad.amount} isn't a finite amount of at least 0`;
  if (!parts.some(({ amount }) => amount > 0)) return 'no pigment has an amount above 0';
  const ids = parts.map(({ pigment }) => pigment.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  return twice ? `it names ${twice} twice` : null;
}

/**
 * Each pigment's absolute amount (its share of the parts times the strength): what a gradient between two mixtures
 * interpolates, never proportions and strength apart, which disagree where the ends' strengths differ.
 */
export function paintMixtureAmounts({ parts, strength }: PaintMixture): { pigment: PaintMixturePigment; amount: number }[] {
  const total = parts.reduce((sum, { amount }) => sum + amount, 0);
  return parts.filter(({ amount }) => amount > 0).map(({ pigment, amount }) => ({ pigment, amount: (strength * amount) / total }));
}

/**
 * The components a full stroke of `mixture` lays in `medium`, by id, so a sum over them doesn't depend on how the
 * parts were written. A weaker strength lightens as the medium does: thinner in water; in a medium that lightens with
 * white, the medium's white as a component of its own at 1 − strength.
 */
export function paintMixtureComponents(mixture: PaintMixture, medium: PaintMedium, bands: PaintBands): PaintComponent[] {
  const amounts = paintMixtureAmounts(mixture).map(({ pigment, amount }) => ({ pigment: paintPigmentInMedium(pigment, medium, bands), amount: medium.body * amount }));
  const { lightening } = medium;
  if (lightening.kind === 'white' && mixture.strength < 1) {
    const white = amounts.find(({ pigment }) => pigment.id === lightening.white.id);
    const more = medium.body * (1 - mixture.strength);
    if (white) white.amount += more;
    else amounts.push({ pigment: paintPigmentInMedium(lightening.white, medium, bands), amount: more });
  }
  return amounts.toSorted((a, b) => a.pigment.id.localeCompare(b.pigment.id, 'en'));
}

/** A film as laid: its total absorption and scattering per band. */
export type PaintFilm = { absorb: PaintBandValues; scatter: PaintBandValues };

/** The film `components` lay together, dried in `medium` (its drying scatter added), each at its amount times `scale`. */
export function paintFilm(components: readonly PaintComponent[], medium: PaintMedium, scale = 1): PaintFilm {
  const count = components[0].pigment.K.length;
  const absorb = new Float64Array(count), scatter = new Float64Array(count);
  for (const { pigment, amount } of components) {
    for (let b = 0; b < count; b++) {
      absorb[b] += scale * amount * pigment.K[b];
      scatter[b] += scale * amount * pigment.S[b] * (1 + medium.dryingScatter);
    }
  }
  return { absorb, scatter };
}

/** Dried films laid over `under` (a reflectance per band) bottom to top, as glazes are: each seen through those above. */
export function paintLayered(under: PaintBandValues, films: readonly PaintFilm[]): PaintBandValues {
  const R = Float64Array.from(under);
  for (const film of films) {
    for (let b = 0; b < R.length; b++) R[b] = kubelkaMunkOver(kubelkaMunkFilm({ absorb: film.absorb[b], scatter: film.scatter[b] }), R[b]);
  }
  return R;
}

/** The reflectance of `film` built thick enough to hide anything under it. */
export function paintOpaque(film: PaintFilm): PaintBandValues {
  return film.absorb.map((k, b) => kubelkaMunkOpaque(k / Math.max(film.scatter[b], 1e-9)));
}
