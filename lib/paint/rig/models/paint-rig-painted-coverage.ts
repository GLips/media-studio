// paint-rig-painted-coverage.ts: where a sheet is painted, purely. Every sheet of a rig is painted on the same blank
// paper and an unpainted texel matches it byte for byte, so coverage is read off a texel's largest 8-bit channel
// difference from the paper: none at 0, whole from `full`. Paint edges are crisp, so a boundary texel much paler than
// the paint beside it (paper through a ragged dry edge) is partly covered: a soft 1 px edge that neither grows nor
// shrinks the paint.

/**
 * `full`: below the faintest glaze measured on studio-p6 (17, a head's cel; 32 in its layers). `edgeShare`: a boundary
 * texel is whole from this share of its painted neighbours' mean difference.
 */
export const PAINT_RIG_PAINTED = { full: 16, edgeShare: 0.5 } as const;

/** Each texel's painted coverage (0..1) of a `w` × `h` sheet, both it and `paper` 8-bit RGBA (alpha unread). */
export function paintRigPaintedCoverage(sheet: Uint8Array, paper: Uint8Array, w: number, h: number): Float32Array {
  const { full, edgeShare } = PAINT_RIG_PAINTED, difference = new Uint8Array(w * h), coverage = new Float32Array(w * h);
  for (let t = 0; t < w * h; t++) {
    const at = 4 * t;
    difference[t] = Math.max(Math.abs(sheet[at] - paper[at]), Math.abs(sheet[at + 1] - paper[at + 1]), Math.abs(sheet[at + 2] - paper[at + 2]));
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const t = j * w + i, own = difference[t];
    if (!own) continue;
    let boundary = false, sum = 0, painted = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj;
      if ((!di && !dj) || x < 0 || y < 0 || x >= w || y >= h) continue;
      const near = difference[y * w + x];
      if (!near) boundary = true;
      else { sum += near; painted++; }
    }
    // A lone fleck is read against itself.
    const reference = boundary ? Math.max(full, edgeShare * (painted ? sum / painted : own)) : full;
    coverage[t] = Math.min(1, own / reference);
  }
  return coverage;
}
