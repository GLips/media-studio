import { redrawSeed, type RedrawToken } from '#lib/timing/drawings/models/drawing-schedule.ts';
import type { StampCanonicalDatum } from '#lib/paint/painting/models/stamp-canonical.ts';

const isDatumList = (datum: StampCanonicalDatum): datum is readonly StampCanonicalDatum[] => Array.isArray(datum);

/** `datum` with every `seed` string in its plain objects and arrays keyed by `token`; anything else kept as it is. */
function reseededDatum(datum: StampCanonicalDatum, token: RedrawToken): StampCanonicalDatum {
  if (isDatumList(datum)) return datum.map((inner) => reseededDatum(inner, token));
  if (datum === null || typeof datum !== 'object' || ArrayBuffer.isView(datum) || datum instanceof Set || datum instanceof Map) return datum;
  // SAFETY: what's left of StampCanonicalDatum is its plain object, every field a datum.
  const fields = Object.entries(datum as { readonly [field: string]: StampCanonicalDatum });
  return Object.fromEntries(fields.map(([field, inner]) => [field, field === 'seed' && typeof inner === 'string' ? redrawSeed(inner, token) : reseededDatum(inner, token)]));
}

/**
 * `value` with every `seed` string it holds, at any depth (a tip's, a footprint's, a roughness's, a noise field's),
 * keyed by the layer's token. Functions (a hand's curve) are kept as they are.
 */
export function paintingReseeded<T extends StampCanonicalDatum>(value: T, token: RedrawToken | undefined): T {
  // SAFETY: reseededDatum rebuilds plain objects and arrays field for field, changing only seed strings: T's shape.
  return token !== undefined ? (reseededDatum(value, token) as T) : value;
}
