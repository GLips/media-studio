import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import { stampBrushEvenEdge } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { refineStampBrushEdges, STAMP_BRUSH_PROBE_BARE_MEDIUM, StampBrushProbeRefusal, stampBrushProbe, stampBrushProbePaint, stampBrushEdgeSample, stampEdgeProbeSheet, stampProbeEdgeOffsets, stampProbeSections } from './stamp-brush-profile-probes.ts';

/** A hard round tip's support at every diameter. */
const roundSupport = { main: { width: 64, height: 64, span: 1, roundness: 1, reach: [0.5, 0.52] }, dual: null };

/** `v` at every heading. */
const eight = (v: number) => Array.from({ length: 8 }, () => v);

const round: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};

test("a probe's visible offsets are read per side at every heading, from its paint's contrast with the paper, each probe in its own cell", () => {
  const sheet = stampEdgeProbeSheet(stampBrushProbe(round, () => roundSupport), 16, STAMP_BRUSH_PROBE_BARE_MEDIUM), left = 5, right = 7.3;
  // A stroke whose paint ramps over two pixels to nothing, reaching `left` px to its left and `right` to its right.
  const coverageAt = (s: number) => Math.min(1, Math.max(0, 0.5 + (left - s) / 2)) * Math.min(1, Math.max(0, 0.5 + (s + right) / 2));
  // A bristle streak `width` px wide, 4 px past its left edge, across a bare gap.
  const streakedAt = (width: number) => (s: number) => Math.max(coverageAt(s), s >= left + 4 && s < left + 4 + width ? 1 : 0);
  // Its contrast with the paper at its centre, ΔE.
  const readAt = (centre: number, paint = coverageAt) => stampProbeSections(sheet, sheet.pieces.map((piece) => {
    const { center, left: normal } = sheet.probes[piece.probe], { x, y, w, h } = piece.crop;
    // Each pixel's paint averaged over a 4×4 grid in it, as a renderer's antialiasing covers it.
    const covered = (px: number, py: number) => {
      let sum = 0;
      for (let k = 0; k < 16; k++) sum += paint((px + ((k % 4) + 0.5) / 4 - center.x) * normal.x + (py + (Math.floor(k / 4) + 0.5) / 4 - center.y) * normal.y);
      return sum / 16;
    };
    const plane = Float32Array.from({ length: w * h }, (_, i) => centre * covered(x + (i % w), y + Math.floor(i / w)));
    return { piece, contrast: plane };
  }));
  const read = readAt(40);
  // A stroke the eye can't tell from the paper has no visible edge to measure.
  assert.throws(() => stampProbeEdgeOffsets(sheet, readAt(1.5)), StampBrushProbeRefusal);
  // No two probes on a page share a pixel a read takes: each probe's contrast is its own paint's alone.
  for (const a of sheet.pieces) {
    for (const b of sheet.pieces) {
      if (a.probe >= b.probe || sheet.probes[a.probe].page !== sheet.probes[b.probe].page) continue;
      const apart = a.crop.x + a.crop.w <= b.crop.x || b.crop.x + b.crop.w <= a.crop.x || a.crop.y + a.crop.h <= b.crop.y || b.crop.y + b.crop.h <= a.crop.y;
      assert.ok(apart, `probes ${a.probe} and ${b.probe} overlap`);
    }
  }
  const offsets = stampProbeEdgeOffsets(sheet, read);
  for (const side of [offsets.left, offsets.right]) assert.equal(side.length, 8);
  // Every window of a clean edge reads the same: no noise.
  for (const noise of [...offsets.noise.left, ...offsets.noise.right]) assert.ok(noise < 0.01, `noise ${noise}`);
  for (const [measured, truth] of [[offsets.left, left], [offsets.right, right]] as const) {
    for (const offset of measured) assert.ok(Math.abs(offset - truth) < 0.05, `${offset} for ${truth}`);
  }
  // A hairline streak past a gap reads as no edge at any heading, however the raster lands it; a broad one is the edge.
  for (const offset of stampProbeEdgeOffsets(sheet, readAt(40, streakedAt(1))).left) assert.ok(Math.abs(offset - left) <= 0.25, `${offset} with a hairline`);
  for (const offset of stampProbeEdgeOffsets(sheet, readAt(40, streakedAt(3))).left) assert.ok(Math.abs(offset - (left + 7)) <= 0.5, `${offset} with a broad streak`);
  // Sides 2.3 px apart don't collapse to one; each is rounded to a quarter pixel.
  assert.deepEqual(stampBrushEdgeSample(offsets), { left: eight(5), right: eight(7.25) });
  // Within the tolerance, or within twice the seeds' standard error, they're one offset: their median.
  assert.deepEqual(stampBrushEdgeSample({ left: eight(6.1), right: eight(6.4), noise: { left: eight(0), right: eight(0) } }), stampBrushEvenEdge(6.25));
  assert.deepEqual(stampBrushEdgeSample({ ...offsets, noise: { left: eight(0.1), right: eight(1.2) } }), stampBrushEvenEdge(6.25));
});

/** A repeatable stand-in for randomness, -1..1. */
const hashed = (x: number) => 2 * ((((Math.sin(x) * 43_758.5453) % 1) + 1) % 1) - 1;

/**
 * Offsets a third of the diameter, bending past 80 px if `bend`, with `noise` px of randomness in every reading,
 * which each reading states as `stated`.
 */
const rangedProfile = (bend: boolean, noise: number, stated = noise) => (diameter: number) => {
  const offset = diameter / 3 + (bend && diameter > 80 ? (diameter - 80) / 2 : 0);
  const sides = Array.from({ length: 8 }, (_, h) => offset + noise * hashed(diameter * 12.9898 + h * 78.233)), noises = eight(stated);
  return Promise.resolve({ diameter, left: sides, right: sides, noise: { left: noises, right: noises } });
};

test('a profile is subdivided where it bends, not where the brush is merely ragged', async () => {
  const diameters = async (bend: boolean, noise: number, stated = noise) => (await refineStampBrushEdges([2, 4, 8, 16, 32, 64, 128, 256, 512], rangedProfile(bend, noise, stated))).map((m) => m.diameter);
  assert.deepEqual(await diameters(false, 0), [2, 4, 8, 16, 32, 64, 128, 256, 512]);
  // A ragged edge's misses within three standard errors are its randomness: no more is measured than for a clean one.
  assert.deepEqual(await diameters(false, 1), [2, 4, 8, 16, 32, 64, 128, 256, 512]);
  // A bend past the noise is found on a ragged edge too.
  const bent = await diameters(true, 1);
  assert.ok(bent.some((d) => d > 64 && d < 128), `bend at 80 px refined: ${bent.join(', ')}`);
  // Randomness its readings understate doesn't shrink as the diameters close in, so the halving soon stops, far short
  // of the 256 diameters 2 px apart that reading it as bends would measure.
  const understated = await diameters(false, 20, 0.1);
  assert.ok(understated.length <= 32, understated.join(', '));
});

test("a profile is the widest run of diameters its brush paints, a refusal bounding it, a midpoint's too", async () => {
  // Refused past `most` px and short of `upTo`: a planned diameter, or only a midpoint.
  const refusingPast = (most: number, bend = false, upTo = Infinity) => (diameter: number) =>
    diameter > most && diameter < upTo ? Promise.reject(new StampBrushProbeRefusal(`its stroke lays nothing along its centre at ${diameter} px`)) : rangedProfile(bend, 0)(diameter);
  const diameters = async (most: number, bend = false, upTo = Infinity, planned = [2, 4, 8, 16, 32, 64, 128, 256, 512]) => (await refineStampBrushEdges(planned, refusingPast(most, bend, upTo))).map((m) => m.diameter);
  assert.deepEqual(await diameters(256), [2, 4, 8, 16, 32, 64, 128, 256]);
  // A brush that vanishes at 4 px alone is measured from 8 px: a lone 2 px is no range.
  assert.deepEqual(await diameters(2, false, 8), [8, 16, 32, 64, 128, 256, 512]);
  // Runs as wide either side of a refusal: the larger diameters'.
  assert.deepEqual(await diameters(4, false, 16, [2, 4, 8, 16, 32]), [16, 32]);
  // The bend past 80 px is refined toward 128, and a midpoint refused past 100 px bounds the range below it.
  const bent = await diameters(100, true, 128);
  assert.ok(bent.includes(96) && bent.every((d) => d <= 100), bent.join(', '));
  await assert.rejects(refineStampBrushEdges([2, 4, 8], refusingPast(2)), /only 2 px of 2, 4, 8/);
  // A brush refused at every diameter says why.
  await assert.rejects(refineStampBrushEdges([2, 4, 8], refusingPast(0)), /no diameter of 2, 4, 8: its stroke lays nothing along its centre at 8 px/);
});

test("a style's probes lay its darkest pigment at full load, or black where it mixes none", () => {
  assert.deepEqual(stampBrushProbePaint({ kind: 'pigment', medium: PAINT_MEDIA.gouache, pigments: WATERCOLOUR_PIGMENTS }), {
    kind: 'mixture', parts: [{ pigment: WATERCOLOUR_PIGMENTS.ultramarine, amount: 1 }], strength: 1,
  });
  assert.deepEqual(stampBrushProbePaint({ kind: 'flat' }), STAMP_BRUSH_PROBE_BARE_MEDIUM.paint);
});
