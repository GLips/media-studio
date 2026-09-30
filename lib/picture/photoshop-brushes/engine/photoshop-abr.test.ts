import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoshopAbrFixture } from './photoshop-abr-fixture.ts';
import { readPhotoshopAbr, writePhotoshopAbr } from './photoshop-abr.ts';

test('an .abr written as Photoshop lays one out reads back as it was: presets, groups, tips and patterns', () => {
  const written = photoshopAbrFixture(), bytes = writePhotoshopAbr(written), read = readPhotoshopAbr(bytes);
  assert.deepEqual(read.presets, written.presets);
  assert.deepEqual(read.tips, written.tips);
  assert.deepEqual(read.patterns, written.patterns);
  // `flow` is a stringID four letters long: written as a charID, Photoshop would read it as another key.
  assert.ok(Buffer.from(bytes).includes(Buffer.from('\0\0\0\x04flowlong', 'latin1')));
});
