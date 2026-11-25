import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioSpatialStepOf, type StudioItemBox } from './studio-spatial-step.ts';

const box = (left: number, top: number, width: number, height: number): StudioItemBox => ({ left, top, right: left + width, bottom: top + height });

// A full-width row, then a grid of three tiles over two tiles, as a project page lays them out.
const page = [box(0, 0, 900, 44), box(0, 60, 280, 300), box(300, 60, 280, 300), box(600, 60, 280, 300), box(0, 380, 280, 300), box(300, 380, 280, 300)];

test('up and down keep the column through a grid, and reach rows above and below it', () => {
  assert.equal(studioSpatialStepOf(page, 2, 'down'), 5);
  assert.equal(studioSpatialStepOf(page, 3, 'down'), 5, 'a short last line takes the nearest tile');
  assert.equal(studioSpatialStepOf(page, 5, 'up'), 2);
  assert.equal(studioSpatialStepOf(page, 3, 'up'), 0);
  assert.equal(studioSpatialStepOf(page, 0, 'down'), 1);
  assert.equal(studioSpatialStepOf(page, 5, 'down'), null);
});

test('left and right step along a line and hold at its ends', () => {
  assert.equal(studioSpatialStepOf(page, 1, 'right'), 2);
  assert.equal(studioSpatialStepOf(page, 3, 'right'), null);
  assert.equal(studioSpatialStepOf(page, 4, 'left'), null);
  assert.equal(studioSpatialStepOf(page, 0, 'right'), null);
  assert.equal(studioSpatialStepOf(page, null, 'down'), 0);
});
