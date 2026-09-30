import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kubelkaMunkFilm, kubelkaMunkOver } from './paint-kubelka-munk.ts';
import { PAINT_MEDIA, TITANIUM_WHITE, paintPigmentFromColor } from './paint-medium.ts';
import { paintFilm, paintLayered, paintMixtureComponents, paintMixtureProblem, paintOpaque, type PaintMixture } from './paint-mixture.ts';
import { paintClumps, paintValley, paintWetSettle } from './paint-paper.ts';
import { paintPigmentFromAppearance, type PaintPigmentAppearance } from './paint-pigment.ts';
import { PAINT_BANDS, linearToSrgb, paintBandsToLinearRgb, paintDeltaE, paintHexToLinear, spectralPaintBands, type PaintBands } from './paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS as W } from './paint-watercolour-pigments.ts';

const flat = (bands: PaintBands, value: number) => new Float64Array(bands.count).fill(value);
const overWhite = (mixture: PaintMixture, medium = PAINT_MEDIA.watercolour) =>
  paintBandsToLinearRgb(PAINT_BANDS, paintLayered(flat(PAINT_BANDS, 1), [paintFilm(paintMixtureComponents(mixture, medium, PAINT_BANDS), medium)]));

const body = (hex: `#${string}`) => ({ pigment: paintPigmentFromColor(hex, PAINT_MEDIA.gouache, PAINT_BANDS), amount: 1 });

/** HSV hue in degrees of a linear sRGB colour, read in display sRGB. */
function hueDegrees(linear: readonly number[]): number {
  const [r, g, b] = linear.map((v) => linearToSrgb(Math.min(1, Math.max(0, v))));
  const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
  const sector = max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return sector * 60;
}

test('blue and yellow mix to a green, as a watercolour wash and as gouache', () => {
  // One part phthalo to two of yellow, as painters mix it: phthalo's tinting strength turns an even mix teal.
  const wash = overWhite({ parts: [{ pigment: W.phthaloBlue, amount: 1 }, { pigment: W.hansaYellow, amount: 2 }], strength: 1 });
  const gouache = paintBandsToLinearRgb(PAINT_BANDS, paintOpaque(paintFilm([body('#2040c0'), body('#ffe000')], PAINT_MEDIA.gouache)));
  for (const green of [wash, gouache]) {
    const hue = hueDegrees(green);
    assert.ok(green[1] > green[0] && green[1] > green[2] && hue > 80 && hue < 170, `${green.join(', ')} (hue ${hue}) is green`);
  }
  // Pure sRGB primaries are sharper than any paint: eight bands grey them, sixteen keep the overlap that reads green.
  const sixteen = spectralPaintBands(16);
  const primary = (hex: `#${string}`) => ({ pigment: paintPigmentFromColor(hex, PAINT_MEDIA.gouache, sixteen), amount: 1 });
  const primaries = paintBandsToLinearRgb(sixteen, paintOpaque(paintFilm([primary('#0000ff'), primary('#ffff00')], PAINT_MEDIA.gouache)));
  assert.ok(primaries[1] > 0.2 && primaries[1] > primaries[0] && primaries[1] > primaries[2], `pure primaries mix to ${primaries.join(', ')}`);
});

test('a transparent glaze over white shows its colour, and over a mid colour behaves about like multiply', () => {
  const mid = paintHexToLinear('#80a0c0');
  for (const hex of ['#c8305f', '#3f86bd', '#f3c51c'] as const) {
    const medium = PAINT_MEDIA.watercolour;
    const film = paintFilm([{ pigment: paintPigmentFromColor(hex, medium, PAINT_BANDS), amount: medium.body }], { ...medium, dryingScatter: 0 });
    const white = paintBandsToLinearRgb(PAINT_BANDS, paintLayered(flat(PAINT_BANDS, 1), [film]));
    const overMid = paintBandsToLinearRgb(PAINT_BANDS, paintLayered(PAINT_BANDS.reflectanceOf(mid), [film]));
    assert.ok(paintDeltaE(white, paintHexToLinear(hex)) < 0.5, `${hex} over white`);
    // Not exact: the glaze scatters a little, and a per-band product isn't a per-channel one.
    assert.ok(paintDeltaE(overMid, white.map((v, i) => v * mid[i])) < 8, `${hex} over mid`);
  }
});

test('a thin glaze of white over black lightens it toward a neutral grey', () => {
  const white = paintFilm([{ pigment: paintPigmentFromAppearance(TITANIUM_WHITE, PAINT_BANDS), amount: 0.2 }], PAINT_MEDIA.watercolour);
  const [r, g, b] = paintBandsToLinearRgb(PAINT_BANDS, paintLayered(flat(PAINT_BANDS, 0.01), [white]));
  assert.ok(Math.min(r, g, b) > 0.2, `lightened to ${[r, g, b].join(', ')}`);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 0.03, `stays neutral: ${[r, g, b].join(', ')}`);
});

test('a pigment fitted from its appearance reproduces it over white and over black, and a thin film its tint', () => {
  for (const appearance of [...Object.values(W), TITANIUM_WHITE] as PaintPigmentAppearance[]) {
    const pigment = paintPigmentFromAppearance(appearance, PAINT_BANDS);
    const over = (under: number, thickness = 1) => paintBandsToLinearRgb(PAINT_BANDS, paintLayered(flat(PAINT_BANDS, under), [{ absorb: pigment.K.map((k) => k * thickness), scatter: pigment.S.map((s) => s * thickness) }]));
    const { tint } = appearance;
    // A swatch and its tint rarely agree exactly under Kubelka–Munk, so the fit splits the difference; eight bands
    // can't hold every red's over-black exactly.
    assert.ok(paintDeltaE(over(1), paintHexToLinear(appearance.overWhite)) < (tint ? 3 : 0.5), `${appearance.id} over white`);
    assert.ok(paintDeltaE(over(0), paintHexToLinear(appearance.overBlack)) < (tint ? 3 : 2), `${appearance.id} over black`);
    if (tint) assert.ok(paintDeltaE(over(1, tint.strength), paintHexToLinear(tint.color)) < 3, `${appearance.id} tint`);
  }
});

test('granulation grows with load, and only in a granulating pigment', () => {
  // Paper heights with mean 0.5, so relative valley depths 0..2.
  const heights = Array.from({ length: 101 }, (_, i) => i / 100);
  const spread = (granulation: number, load: number) => {
    const shares = heights.map((h) => paintWetSettle(paintValley(h, 0.5), 0, granulation, load));
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    assert.ok(Math.abs(mean - 1) < 1e-9, `conserved over the paper: mean ${mean}`);
    return Math.max(...shares) - Math.min(...shares);
  };
  const granulating = PAINT_MEDIA.watercolour.granulation * (W.ultramarine.granulation ?? 0);
  assert.ok(spread(granulating, 0.1) < spread(granulating, 0.3) && spread(granulating, 0.3) < spread(granulating, 0.6), 'heavier washes granulate more');
  assert.equal(spread(0, 1), 0, 'a non-granulating pigment lies even');
});

test('clumps move paint about without adding any', () => {
  let sum = 0, n = 0;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++, n++) sum += paintClumps(1, x, y, 12345);
  assert.ok(Math.abs(sum / n - 1) < 0.02, `mean ${sum / n}`);
  assert.equal(paintClumps(0, 3, 4, 1), 1);
});

test('a mixture is its proportions at a strength: scaling the amounts changes nothing, and white is a component of its own', () => {
  const one = paintMixtureComponents({ parts: [{ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 3 }], strength: 0.5 }, PAINT_MEDIA.watercolour, PAINT_BANDS);
  const scaled = paintMixtureComponents({ parts: [{ pigment: W.burntSienna, amount: 30 }, { pigment: W.ultramarine, amount: 10 }], strength: 0.5 }, PAINT_MEDIA.watercolour, PAINT_BANDS);
  assert.deepEqual(one.map(({ pigment, amount }) => [pigment.id, amount]), scaled.map(({ pigment, amount }) => [pigment.id, amount]));
  assert.deepEqual(one.map(({ amount }) => amount), [0.375, 0.125]);
  const tinted = paintMixtureComponents({ parts: [{ pigment: W.ultramarine, amount: 1 }], strength: 0.25 }, PAINT_MEDIA.gouache, PAINT_BANDS);
  assert.deepEqual(tinted.map(({ pigment, amount }) => [pigment.id, amount]), [['titaniumWhite', 1.5], ['ultramarine', 0.5]]);
  assert.match(paintMixtureProblem({ parts: [{ pigment: W.ultramarine, amount: 1 }, { pigment: W.ultramarine, amount: 2 }], strength: 1 }) ?? '', /twice/);
  assert.match(paintMixtureProblem({ parts: [{ pigment: W.ultramarine, amount: 0 }], strength: 1 }) ?? '', /above 0/);
  assert.equal(paintMixtureProblem({ parts: [{ pigment: W.ultramarine, amount: 0 }, { pigment: W.cerulean, amount: 1 }], strength: 0 }), null);
});

test('a film stays physical at its limits: clear, pure scatterer, thick, and nothing at all', () => {
  for (const film of [{ absorb: 0, scatter: 0 }, { absorb: 0, scatter: 1 }, { absorb: 1e-9, scatter: 5 }, { absorb: 3, scatter: 0 }, { absorb: 40, scatter: 60 }, { absorb: 1e-6, scatter: 1e-6 }]) {
    const { R, T } = kubelkaMunkFilm(film);
    assert.ok(Number.isFinite(R) && Number.isFinite(T) && R >= 0 && T >= 0 && R + T <= 1 + 1e-12, `${JSON.stringify(film)}: R ${R}, T ${T}`);
    for (const under of [0, 0.5, 0.999]) {
      const over = kubelkaMunkOver({ R, T }, under);
      assert.ok(over >= 0 && over <= 1, `${JSON.stringify(film)} over ${under}: ${over}`);
    }
  }
  assert.deepEqual(kubelkaMunkFilm({ absorb: 0, scatter: 1 }), { R: 0.5, T: 0.5 });
  // Just past the switch to the pure scatterer's limit (b·Sx = 1e-3 at Kx ≈ 5e-7), the general formula agrees with it.
  const near = kubelkaMunkFilm({ absorb: 5.2e-7, scatter: 1 }), limit = { R: 1 / (2 + 5.2e-7), T: 1 / (2 + 5.2e-7) };
  assert.ok(Math.abs(near.R - limit.R) < 1e-6 && Math.abs(near.T - limit.T) < 1e-6);
});
