import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampDrying } from './stamp-wetness.ts';

const AUTHORING = new URL('../../../../docs/painting-authoring.md', import.meta.url);

/** The drying table's rows in docs/painting-authoring.md, each split into its cells: the header first. */
function dryingTableRows(): string[][] {
  const lines = readFileSync(AUTHORING, 'utf8').split('\n'), from = lines.findIndex((line) => line.startsWith('**Drying times.**'));
  assert.ok(from >= 0, 'the authoring doc has its drying table');
  const start = lines.findIndex((line, i) => i > from && line.startsWith('|'));
  const table = lines.slice(start, lines.findIndex((line, i) => i > start && !line.startsWith('|')));
  return table.filter((line) => !line.startsWith('|---')).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

/** A time as the table writes it: model seconds to a tenth. */
const tableSeconds = (seconds: number) => String(Math.round(seconds * 10) / 10);

test("the authoring doc's drying table is the laws' own, at each medium's sheen and drying, and its default water", () => {
  const [header, ...rows] = dryingTableRows();
  const absorbencies = header.slice(1).map((cell) => Number(/^(?:absorbency )?([\d.]+)/.exec(cell)![1]));
  const media = rows.map(([label]) => {
    const [, name, water] = /^(watercolour|gouache) ([\d.]+)/.exec(label)!;
    const medium = name === 'watercolour' ? PAINT_MEDIA.watercolour : PAINT_MEDIA.gouache;
    if (label.includes('its default')) assert.equal(Number(water), medium.wetting.defaultWater, label);
    return { name, water: Number(water), wetting: medium.wetting };
  });
  assert.deepEqual(new Set(media.map(({ name }) => name)), new Set(['watercolour', 'gouache']));
  const expected = media.map(({ water, wetting }) => absorbencies.map((absorbency) => {
    const { rate, openTime, shiny, damp } = stampDrying(wetting, { color: '#ffffff', absorbency });
    const shines = water > shiny ? `shiny to ${tableSeconds((water - shiny) / rate)}` : 'never shiny';
    return `${shines}, damp from ${tableSeconds((water - damp) / rate)}, dry at ${tableSeconds(openTime + water / rate)}`;
  }));
  assert.deepEqual(rows.map((cells) => cells.slice(1)), expected);
});
