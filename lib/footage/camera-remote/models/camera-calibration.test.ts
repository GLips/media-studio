import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CALIBRATION_TARGETS, nextCalibrationStep, readSkin } from './camera-calibration.ts';

const ISO_LADDER = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 6400];

// A cold, dim face (the lamp-off take at 3000K) is brought up and warmed, toward the targets, from the camera's values.
test('a cold, dim face raises ISO and white balance', () => {
  const step = nextCalibrationStep({ luma: 90, warmth: 0.03 }, { whiteBalanceKelvin: 3000, iso: 640 }, DEFAULT_CALIBRATION_TARGETS, ISO_LADDER);
  assert.equal(step.kind, 'adjust');
  assert.ok(step.settings.iso > 640 && ISO_LADDER.includes(step.settings.iso));
  assert.equal(step.settings.whiteBalanceKelvin, 4200);
});

test('a face on its targets settles without a change', () => {
  const current = { whiteBalanceKelvin: 4400, iso: 800 };
  assert.deepEqual(nextCalibrationStep({ luma: 121, warmth: 0.165 }, current, DEFAULT_CALIBRATION_TARGETS, ISO_LADDER), { kind: 'settled', settings: current });
});

// Past maxIso the camera can't help: calibration says the room needs light instead of choosing a noisy ISO.
test('a face too dim at the highest allowed ISO needs light', () => {
  const step = nextCalibrationStep({ luma: 60, warmth: 0.16 }, { whiteBalanceKelvin: 4400, iso: 3200 }, DEFAULT_CALIBRATION_TARGETS, ISO_LADDER);
  assert.equal(step.kind, 'needs-light');
  assert.equal(step.settings.iso, 3200);
});

test('skin is read from the middle of the face box, not its corners', () => {
  const width = 10;
  const height = 10;
  const pixels = new Uint8Array(width * height * 3).fill(0);
  // Only the box's middle is skin-coloured; the rest of the box is black background.
  for (let row = 2; row < 6; row++) for (let col = 2; col < 8; col++) pixels.set([200, 150, 100], (row * width + col) * 3);
  const reading = readSkin({ width, height, pixels }, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(Math.round(reading.luma), Math.round(0.2126 * 200 + 0.7152 * 150 + 0.0722 * 100));
  assert.equal(reading.warmth, 100 / 450);
});
