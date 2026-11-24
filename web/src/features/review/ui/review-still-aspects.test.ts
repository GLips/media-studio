import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSectionedGridStep, reviewStillAspectSectionsOf, reviewStillRatioName } from './review-still-aspects.ts';

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
  // Sections of 5 at 4 columns and 2 at 6 lay out rows [0-3], [4], [5-6].
  assert.equal(reviewSectionedGridStep(2, { along: 0, rows: 1 }, [{ count: 5, columns: 4 }, { count: 2, columns: 6 }]), 4);
  assert.equal(reviewSectionedGridStep(4, { along: 0, rows: 1 }, [{ count: 5, columns: 4 }, { count: 2, columns: 6 }]), 5);
  assert.equal(reviewSectionedGridStep(6, { along: 0, rows: -1 }, [{ count: 5, columns: 4 }, { count: 2, columns: 6 }]), 4);
  assert.equal(reviewSectionedGridStep(6, { along: 0, rows: 1 }, [{ count: 5, columns: 4 }, { count: 2, columns: 6 }]), 6);
  assert.equal(reviewSectionedGridStep(4, { along: 1, rows: 0 }, [{ count: 5, columns: 4 }, { count: 2, columns: 6 }]), 5);
  // A section of 6 at 3 columns over one of 3 at 5: up from the second row's end lands on the first row's end.
  assert.equal(reviewSectionedGridStep(8, { along: 0, rows: -1 }, [{ count: 6, columns: 3 }, { count: 3, columns: 5 }]), 5);
});

test('a section goes by the name its ratio is cut to, or its width to one', () => {
  assert.deepEqual([1.9, 1200 / 630, 1280 / 720, 1080 / 1350, 1080 / 1920, 1000 / 700].map(reviewStillRatioName), ['1.91:1', '1.91:1', '16:9', '4:5', '9:16', '1.43:1']);
});
