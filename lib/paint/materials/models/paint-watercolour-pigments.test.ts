import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { paintHexToLinear, paintLinearToLab } from './paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS } from './paint-watercolour-pigments.ts';

/** The author page's Pigments table as the pigment table writes it, a row a pigment in its order. */
function pigmentReferenceTable(): string {
  const rows = Object.entries(WATERCOLOUR_PIGMENTS).map(([key, { overWhite, granulation, flocculation, staining }]) => {
    const lightness = Math.round(paintLinearToLab(paintHexToLinear(overWhite))[0]);
    return `| \`${key}\` | \`${overWhite}\` | ${lightness} | ${granulation} | ${flocculation} | ${staining} |`;
  });
  return ['| Pigment | Over white | L* | Granulation | Flocculation | Staining |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

test("the author page's Pigments table is the pigment table: each pigment's colour over white, its lightness and its habits", () => {
  const page = readFileSync(new URL('../../../../docs/painting-authoring.md', import.meta.url), 'utf8');
  const table = pigmentReferenceTable();
  assert.ok(page.includes(table), `docs/painting-authoring.md's Reference › Pigments should read, as the pigment table now does:\n${table}`);
});
