import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSectionedGridStep, reviewStillAspectSectionsOf } from './review-still-aspects.ts';

const sizes: Record<string, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 }, og: { w: 1200, h: 630 }, square: { w: 1080, h: 1080 }, og2x: { w: 2400, h: 1260 }, portrait: { w: 1080, h: 1350 },
};

test('stills group by aspect, widest first, with the shared size named only when every one has it', () => {
  const { groups, unread } = reviewStillAspectSectionsOf(['story', 'og', 'square', 'og2x', 'portrait', 'pending'], (name) => sizes[name]);
  assert.deepEqual(groups.map((g) => [g.word, g.items]), [
    ['wide', ['og', 'og2x']], ['square', ['square']], ['tall', ['portrait']], ['tall', ['story']],
  ]);
  assert.equal(groups[0].size, null);
  assert.deepEqual(groups[1].size, { w: 1080, h: 1080 });
  assert.deepEqual(unread, ['pending']);
});

test('a row up or down crosses into the next section, keeping the column where that row reaches it', () => {
  // Sections of 5 and 2 at 4 columns lay out rows [0-3], [4], [5-6].
  assert.equal(reviewSectionedGridStep(2, { along: 0, rows: 1 }, [5, 2], 4), 4);
  assert.equal(reviewSectionedGridStep(4, { along: 0, rows: 1 }, [5, 2], 4), 5);
  assert.equal(reviewSectionedGridStep(6, { along: 0, rows: -1 }, [5, 2], 4), 4);
  assert.equal(reviewSectionedGridStep(6, { along: 0, rows: 1 }, [5, 2], 4), 6);
  assert.equal(reviewSectionedGridStep(4, { along: 1, rows: 0 }, [5, 2], 4), 5);
});
