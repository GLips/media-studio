import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RenderedStill } from './render-stills.ts';
import { layoutStillSheets } from './still-sheet.ts';

const still = (preset: 'og' | 'youtube', headline: string, crop: string, refused = false): RenderedStill => ({
  still: { design: 'card', preset, variant: `${headline}-${crop}`, axes: { headline, crop } }, fits: [],
  problems: refused ? [{ kind: 'ui-zone', problem: 'under the badge' }] : [],
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
