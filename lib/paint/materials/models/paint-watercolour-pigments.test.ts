import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PAINT_MEDIA } from './paint-medium.ts';
import { paintComponentsOverWhite, paintMixtureComponents } from './paint-mixture.ts';
import type { PaintPigmentAppearance } from './paint-pigment.ts';
import { PAINT_BANDS, paintBandsToLinearRgb, paintHexToLinear, paintLinearToHex, paintLinearToLab } from './paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS } from './paint-watercolour-pigments.ts';

/** A full gouache load of `pigment` dried on white paper, as linear sRGB. */
function driedGouache(pigment: PaintPigmentAppearance): [number, number, number] {
  const gouache = PAINT_MEDIA.gouache;
  return paintBandsToLinearRgb(PAINT_BANDS, paintComponentsOverWhite(paintMixtureComponents({ parts: [{ pigment, amount: 1 }], strength: 1 }, gouache, PAINT_BANDS), gouache));
}

const lightness = (linear: readonly number[]) => Math.round(paintLinearToLab(linear)[0]);

/** The author page's Pigments table as the pigment table and the pure mixer write it, a row a pigment in its order. */
function pigmentReferenceTable(): string {
  const rows = Object.entries(WATERCOLOUR_PIGMENTS).map(([key, pigment]) => {
    const { overWhite, granulation, flocculation, staining } = pigment, gouache = driedGouache(pigment);
    return `| \`${key}\` | \`${overWhite}\` | ${lightness(paintHexToLinear(overWhite))} | \`${paintLinearToHex(gouache)}\` | ${lightness(gouache)} | ${granulation} | ${flocculation} | ${staining} |`;
  });
  return ['| Pigment | Over white | L* | Gouache | L* | Granulation | Flocculation | Staining |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n');
}

test("the author page's Pigments table is the pigment table: each pigment over white and dried in gouache, their lightness, and its habits", () => {
  const page = readFileSync(new URL('../../../../docs/painting-authoring.md', import.meta.url), 'utf8');
  const table = pigmentReferenceTable();
  assert.ok(page.includes(table), `docs/painting-authoring.md's Reference › Pigments should read, as the pigment table now does:\n${table}`);
});
