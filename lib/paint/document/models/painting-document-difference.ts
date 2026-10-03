// painting-document-difference.ts: where two documents first differ, by path. A factory is pure, so two calls with
// the same values return equal documents; `studio paint check` calls it twice and names the first place they part,
// and an evaluation diff reads what changed between two evaluations by it.

/** What a document is made of, as far as comparing two of them goes. */
export type PaintingDatum =
  | string | number | boolean | null | undefined
  | ((...args: never[]) => PaintingDatum)
  | readonly PaintingDatum[]
  | { readonly [field: string]: PaintingDatum };

const isList = (datum: PaintingDatum): datum is readonly PaintingDatum[] => Array.isArray(datum);

/**
 * The first path at which `a` and `b` differ (`layers[0].washes[1].key`; `''` for the roots themselves), or null when
 * they're equal. Functions (a hand's pressure curve) compare by `functions`: their `source` text, as a purity check
 * must (a factory may make a new one per call), or their `identity`, as a cache must. NaN equals NaN.
 */
export function paintingFirstDifference(a: PaintingDatum, b: PaintingDatum, path = '', functions: 'source' | 'identity' = 'source'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a === 'function' || typeof b === 'function') {
    return functions === 'source' && typeof a === 'function' && typeof b === 'function' && String(a) === String(b) ? null : path;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return path;
  if (isList(a) || isList(b)) {
    if (!isList(a) || !isList(b) || a.length !== b.length) return path;
    for (let i = 0; i < a.length; i++) {
      const found = paintingFirstDifference(a[i], b[i], `${path}[${i}]`, functions);
      if (found !== null) return found;
    }
    return null;
  }
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const field of fields) {
    const found = paintingFirstDifference(a[field], b[field], path ? `${path}.${field}` : field, functions);
    if (found !== null) return found;
  }
  return null;
}
