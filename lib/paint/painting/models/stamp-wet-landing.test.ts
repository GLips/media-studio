import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampDepositionLaw } from './stamp-wet-landing.ts';

/** A deposit doing `kind` with a brush of `media`. */
const laid = (kind: 'paint' | 'water' | 'lift', media?: 'wet' | 'dry') => ({ action: { kind }, brush: { media } });

test("a deposit's law follows its brush and medium: a dry brush and crayon press into the tooth even in a wash, and an eraser lifts from the history", () => {
  const { watercolour, gouache, crayon } = PAINT_MEDIA;
  assert.equal(stampDepositionLaw(laid('paint'), watercolour, true), 'wash');
  assert.equal(stampDepositionLaw(laid('paint', 'wet'), gouache, true), 'wash');
  assert.equal(stampDepositionLaw(laid('paint', 'dry'), watercolour, true), 'dry');
  assert.equal(stampDepositionLaw(laid('paint'), crayon, true), 'dry');
  assert.equal(stampDepositionLaw(laid('lift', 'dry'), crayon, true), 'wash');
  // Out of a wash there's no history to land in, whatever the medium.
  assert.equal(stampDepositionLaw(laid('paint'), watercolour, false), 'dry');
  // Crayon given watercolour's water still lays by its own law: wet history is declared, never read off the numbers.
  assert.equal(stampDepositionLaw(laid('paint'), { ...crayon, wetting: watercolour.wetting }, true), 'dry');
});
