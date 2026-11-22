import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_CARD_FLAT, STAMP_CARD_LOOK, stampCardReliefSteps, stampCardShadow, stampSheetStepsRimmed, type StampCardReliefStepIn } from './stamp-card-relief.ts';
import { PAPER_KEY_LIGHT } from './stamp-form.ts';
import type { StampSheetCompositeStep } from './stamp-sheet-program.ts';

const reliefOf = (step: StampSheetCompositeStep): StampCardReliefStepIn => {
  if (step.kind === 'film') return { kind: 'other' };
  return step.kind === 'card' ? { kind: 'card', sheet: step.sheet, look: STAMP_CARD_LOOK } : step;
};

test("a card's shadow falls away from the light, lift·cot(elevation) long, and none for a card lying flat", () => {
  const shadow = stampCardShadow(PAPER_KEY_LIGHT, 0.7)!;
  // The papercraft key is upper left, so the shadow falls lower right.
  assert.ok(shadow.offset.x > 0 && shadow.offset.y > 0);
  assert.ok(Math.abs(Math.hypot(shadow.offset.x, shadow.offset.y) - 0.7 / Math.tan(PAPER_KEY_LIGHT.elevation)) < 1e-9);
  assert.ok(Math.abs(Math.atan2(-shadow.offset.y, -shadow.offset.x) - PAPER_KEY_LIGHT.direction) < 1e-9);
  assert.ok(shadow.reach >= Math.hypot(shadow.offset.x, shadow.offset.y) + 3 * shadow.sigma - 1);
  assert.equal(stampCardShadow(PAPER_KEY_LIGHT, 0), null);
});

test("a parent's rim waits for its last film and never shows through a child card laid before it", () => {
  // Parent film, child card, child film, parent film: a rim at the parent's card would be painted over by its
  // second film, so it's laid after, beneath the child card it must not paint over.
  const steps: StampSheetCompositeStep[] = [
    { kind: 'card', sheet: 1 }, { kind: 'film', sheet: 1, film: 0 }, { kind: 'card', sheet: 2 }, { kind: 'film', sheet: 2, film: 0 }, { kind: 'film', sheet: 1, film: 1 },
  ];
  const rimmed = stampSheetStepsRimmed(steps, () => true);
  assert.deepEqual(rimmed.slice(3), [{ kind: 'film', sheet: 2, film: 0 }, { kind: 'rim', sheet: 2 }, { kind: 'film', sheet: 1, film: 1 }, { kind: 'rim', sheet: 1 }]);
  const light = stampCardReliefSteps(rimmed.map(reliefOf));
  assert.deepEqual(light, [
    { kind: 'cast', level: 0, look: STAMP_CARD_LOOK, occludes: [], rim: 'later' }, null,
    // The child lies over the parent's waiting rim, in a level of its own.
    { kind: 'cast', level: 1, look: STAMP_CARD_LOOK, occludes: [0], rim: 'later' }, null,
    { kind: 'rim', level: 1 }, null, { kind: 'rim', level: 0 },
  ]);
});

test('a flat card still hides the rim under it; a card laying nothing frees its rim; pieces lay their rim at once', () => {
  const light = stampCardReliefSteps([
    { kind: 'card', sheet: 1, look: STAMP_CARD_LOOK }, { kind: 'card', sheet: 2, look: STAMP_CARD_FLAT }, { kind: 'pieces', look: STAMP_CARD_LOOK }, null, { kind: 'rim', sheet: 3 }, { kind: 'rim', sheet: 1 },
  ]);
  assert.deepEqual(light, [
    { kind: 'cast', level: 0, look: STAMP_CARD_LOOK, occludes: [], rim: 'later' },
    { kind: 'cast', level: 1, look: STAMP_CARD_FLAT, occludes: [0], rim: 'none' },
    { kind: 'cast', level: 1, look: STAMP_CARD_LOOK, occludes: [0], rim: 'now' },
    null, null, { kind: 'rim', level: 0 },
  ]);
});
