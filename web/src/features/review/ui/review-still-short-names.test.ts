import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewStillShortNames } from './review-still-short-names.ts';

test('a folder drops the words its names share and their common extension, cutting only between words', () => {
  assert.deepEqual(
    reviewStillShortNames(['buy-box-og-every-colour-box.png', 'buy-box-og-every-colour-page.png', 'buy-box-portrait-one-box-box.png']),
    ['og-every-colour-box', 'og-every-colour-page', 'portrait-one-box-box'],
  );
  assert.deepEqual(reviewStillShortNames(['og-even.png', 'og-every.jpg']), ['even.png', 'every.jpg']);
});

test('a lone still, or one the cut would empty, keeps its whole name', () => {
  assert.deepEqual(reviewStillShortNames(['hero.png']), ['hero.png']);
  assert.deepEqual(reviewStillShortNames(['hero.png', 'hero-wide.png']), ['hero', 'hero-wide']);
  assert.deepEqual(reviewStillShortNames(['og-.png', 'og-wide.png']), ['og-.png', 'wide']);
});
