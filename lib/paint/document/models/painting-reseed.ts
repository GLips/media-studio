// painting-reseed.ts: a layer's applications reseeded for a boil epoch (ENGINE 4.6): every seed in them suffixed as
// the renderer suffixes a boiling op's (stampBoilSeed), so the epoch lays every mark anew. The compiler reseeds; a
// document declares no boil.

import { stampBoilSeed } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampCanonicalDatum } from '#lib/paint/painting/models/stamp-canonical.ts';

const isDatumList = (datum: StampCanonicalDatum): datum is readonly StampCanonicalDatum[] => Array.isArray(datum);

/** `datum` with every `seed` string in its plain objects and arrays suffixed for `epoch`; anything else kept as it is. */
function reseededDatum(datum: StampCanonicalDatum, epoch: number): StampCanonicalDatum {
  if (isDatumList(datum)) return datum.map((inner) => reseededDatum(inner, epoch));
  if (datum === null || typeof datum !== 'object' || ArrayBuffer.isView(datum) || datum instanceof Set || datum instanceof Map) return datum;
  // SAFETY: what's left of StampCanonicalDatum is its plain object, every field a datum.
  const fields = Object.entries(datum as { readonly [field: string]: StampCanonicalDatum });
  return Object.fromEntries(fields.map(([field, inner]) => [field, field === 'seed' && typeof inner === 'string' ? stampBoilSeed(inner, epoch) : reseededDatum(inner, epoch)]));
}

/**
 * `value` with every `seed` string it holds, at any depth (a tip's, a footprint's, a roughness's, a noise field's),
 * suffixed for boil epoch `epoch`. Epoch 0 is the painting as written. Functions (a hand's curve) are kept as they are.
 */
export function paintingReseeded<T extends StampCanonicalDatum>(value: T, epoch: number): T {
  // SAFETY: reseededDatum rebuilds plain objects and arrays field for field, changing only seed strings: T's shape.
  return epoch ? (reseededDatum(value, epoch) as T) : value;
}
