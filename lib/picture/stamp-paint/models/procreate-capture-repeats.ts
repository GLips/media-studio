// procreate-capture-repeats.ts: how much Procreate's own paint varies when the same probe is painted again (vid-96).
// A repeat capture paints some probes several times, each copy in a box of its own; each copy's box is cropped out and
// the copies are compared pixel for pixel. That variation is the floor under any fit (vid-97): a renderer can't be
// held closer to Procreate than Procreate is to itself.
//
// Measured on alpha, the capture layers' coverage: the probes paint black onto transparent layers.

/** A copy of a probe's mark: its box's alpha, row by row, `width` wide. */
export type ProcreateCaptureCrop = { label: string; width: number; height: number; alpha: Uint8Array };

export type ProcreateRepeatVariation = {
  copies: number;
  /** Over every pair of copies, the largest mean absolute difference in alpha, 0..1, over pixels either paints. */
  meanAbsDiff: number;
  /** The largest 99th percentile of a pair's absolute difference, 0..1. */
  p99AbsDiff: number;
  /** The largest single pixel's difference, 0..1. */
  maxAbsDiff: number;
  /** The largest shift between two copies' alpha centroids, in pixels. */
  centroidShift: number;
  /** The largest relative difference in total paint (summed alpha) between two copies. */
  paintDiff: number;
};

const centroid = ({ width, alpha }: ProcreateCaptureCrop) => {
  let sx = 0, sy = 0, s = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (!alpha[i]) continue;
    sx += alpha[i] * (i % width);
    sy += alpha[i] * Math.floor(i / width);
    s += alpha[i];
  }
  return { x: sx / s, y: sy / s, total: s };
};

export function measureProcreateRepeatVariation(crops: readonly ProcreateCaptureCrop[]): ProcreateRepeatVariation {
  const out: ProcreateRepeatVariation = { copies: crops.length, meanAbsDiff: 0, p99AbsDiff: 0, maxAbsDiff: 0, centroidShift: 0, paintDiff: 0 };
  const centres = crops.map(centroid);
  for (let i = 0; i < crops.length; i++) {
    for (let j = i + 1; j < crops.length; j++) {
      const a = crops[i].alpha, b = crops[j].alpha;
      if (a.length !== b.length) throw new Error(`repeat variation: ${crops[i].label} and ${crops[j].label} are cropped to different sizes`);
      const histogram = new Uint32Array(256);
      let sum = 0, painted = 0, max = 0;
      for (let k = 0; k < a.length; k++) {
        if (!a[k] && !b[k]) continue;
        const d = Math.abs(a[k] - b[k]);
        histogram[d]++;
        sum += d;
        painted++;
        if (d > max) max = d;
      }
      let seen = 0, p99 = 0;
      for (let d = 0; d < 256; d++) {
        seen += histogram[d];
        if (seen >= painted * 0.99) { p99 = d; break; }
      }
      out.meanAbsDiff = Math.max(out.meanAbsDiff, painted ? sum / painted / 255 : 0);
      out.p99AbsDiff = Math.max(out.p99AbsDiff, p99 / 255);
      out.maxAbsDiff = Math.max(out.maxAbsDiff, max / 255);
      out.centroidShift = Math.max(out.centroidShift, Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y));
      out.paintDiff = Math.max(out.paintDiff, Math.abs(centres[i].total - centres[j].total) / Math.max(centres[i].total, centres[j].total));
    }
  }
  return out;
}
