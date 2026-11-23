import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryItemsImportedBy } from './library-uses.ts';

test("a module's library items are the ids its #library imports name, and nothing else it imports", () => {
  const source = [
    "import item from '#library/2026-11-22-214148/item.json' with { type: 'json' };",
    "import transcript from '#library/2026-11-22-214148/transcript.json' with { type: 'json' };",
    'const cap = await import("#library/2026-11-22-cap-trial/item.json", { with: { type: "json" } });',
    "import { libraryFootage } from '#studio';",
    "import data from '#lib/footage/library/models/library-item.ts';",
  ].join('\n');
  assert.deepEqual([...libraryItemsImportedBy(source)].toSorted(), ['2026-11-22-214148', '2026-11-22-cap-trial']);
  assert.equal(libraryItemsImportedBy("export const x = '#library';").size, 0);
});
