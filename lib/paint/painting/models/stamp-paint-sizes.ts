// stamp-paint-sizes.ts: how big a brush is, as written: px in the painting, or a size a style names (a round 6), as
// wide on the sheet as that brush lays, set once for the painting by its sheet's scale. Output resolution never
// enters: a painting's px are its own, whatever it's rendered at.
//
// Negative space: no size relative to a shape or the canvas. A size worked out from geometry (a pine's width) is a
// number, which is what numbers are for.

/** A brush size a style names: the width `name` lays on the sheet, mm. Made by stampSizeToken; a style exports its own. */
export type StampSizeToken = { readonly kind: 'size'; readonly name: string; readonly mm: number };

/** A size as written: px in the painting, or a style's named size. */
export type StampSize = number | StampSizeToken;

/** A size, or a range [least, most] a generator draws each mark's from. */
export type StampSizeRange = StampSize | readonly [StampSize, StampSize];

/** The sheet a painting is laid on, in its own coordinates: how many painting px a millimetre of paper is. */
export type StampSheet = { pxPerMm: number };

/** A style's size `name`, `mm` wide on the sheet. Throws on a width that isn't positive. */
export function stampSizeToken(name: string, mm: number): StampSizeToken {
  if (!(mm > 0 && Number.isFinite(mm))) throw new Error(`stamp paint: the size ${name} is ${mm} mm, and a size is a positive width`);
  return { kind: 'size', name, mm };
}

/**
 * `size` in painting px for `what`, a named size by `sheet`. Throws on a named size in a painting with no sheet, or a
 * size that isn't positive.
 */
export function stampSizePx(size: StampSize, sheet: StampSheet | undefined, what: string): number {
  if (typeof size === 'number') return size;
  if (!sheet) throw new Error(`stamp paint: ${what} is sized ${size.name}, and a named size needs the painting's sheet (StampPaintEnvironment's sheet)`);
  if (!(sheet.pxPerMm > 0 && Number.isFinite(sheet.pxPerMm))) throw new Error(`stamp paint: the sheet is ${sheet.pxPerMm} px a mm, and a sheet's scale is positive`);
  return size.mm * sheet.pxPerMm;
}

/** `range` in painting px for `what`: a single size is a range of one. */
export function stampSizeRangePx(range: StampSizeRange, sheet: StampSheet | undefined, what: string): readonly [number, number] {
  if (!isStampSizePair(range)) {
    const px = stampSizePx(range, sheet, what);
    return [px, px];
  }
  const [least, most] = range;
  return [stampSizePx(least, sheet, what), stampSizePx(most, sheet, what)];
}

// Array.isArray narrows a readonly tuple to any[], so a range's pair is told apart here.
const isStampSizePair = (range: StampSizeRange): range is readonly [StampSize, StampSize] => Array.isArray(range);
