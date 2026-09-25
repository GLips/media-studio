import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RenderedStill } from './render-stills.ts';
import { layoutStillSheets, stillAxesThatLookAlike } from './still-sheet.ts';

const still = (preset: 'og' | 'youtube', headline: string, crop: string, refused = false, look = new Uint8Array(16)): RenderedStill => ({
  still: { design: 'card', preset, variant: `${headline}-${crop}`, axes: { headline, crop } }, fits: [],
  problems: refused ? [{ kind: 'ui-zone', problem: 'under the badge' }] : [], look,
});

test('a sheet per design and preset lays the first axis across and the rest down, keeping refused variants and gaps', () => {
  const sheets = layoutStillSheets([
    still('og', 'short', 'whole'), still('og', 'short', 'card'), still('og', 'long', 'whole', true),
    still('youtube', 'short', 'whole'),
  ]);
  assert.deepEqual(sheets.map((s) => `${s.design}-${s.preset}`), ['card-og', 'card-youtube']);
  const [og] = sheets;
  assert.equal(og.columnAxis, 'headline');
  assert.deepEqual(og.columns, ['short', 'long']);
  assert.deepEqual(og.rows.map((r) => [r.values, r.cells.map((c) => c && `${c.still.variant}${c.problems.length ? ' refused' : ''}`)]), [
    [{ crop: 'whole' }, ['short-whole', 'long-whole refused']],
    [{ crop: 'card' }, ['short-card', null]],
  ]);
});

test('an axis whose values look alike at a preset is reported there, and not where they differ', () => {
  // A look is grey levels: a headline changes it a lot; at og the crop moves it by 2, at youtube by 40.
  const look = (headline: number, crop: number) => new Uint8Array(16).fill(headline + crop);
  const alike = stillAxesThatLookAlike([
    still('og', 'short', 'whole', false, look(0, 0)), still('og', 'short', 'card', false, look(0, 2)),
    still('og', 'long', 'whole', false, look(100, 0)), still('og', 'long', 'card', false, look(100, 2)),
    still('youtube', 'short', 'whole', false, look(0, 0)), still('youtube', 'short', 'card', false, look(0, 40)),
  ]);
  assert.deepEqual(alike, [{ design: 'card', preset: 'og', axis: 'crop', values: ['whole', 'card'] }]);
});
