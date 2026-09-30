// contrast.ts: how far apart two colours read, by WCAG 2. A still's check measures its text by it; a brand picks
// the ink that reads on a ground by it.

/** An sRGB channel, 0–255, as linear light, 0–1. */
function linearChannel(c: number) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
/** WCAG 2's relative luminance of an sRGB colour, 0–255 per channel. */
function relativeLuminance([r, g, b]: readonly number[]) {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}
/** WCAG 2's contrast ratio of two sRGB colours, 1–21: text needs 4.5:1 to read, display sizes 3:1. */
export function contrastRatio(a: readonly number[], b: readonly number[]) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
