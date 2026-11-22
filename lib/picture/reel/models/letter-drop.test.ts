import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strainEllipse } from '#lib/picture/motion/models/strain.ts';
import { letterDropAt, letterDropDuration, type LetterDropOptions } from './letter-drop.ts';

const OPTIONS: LetterDropOptions = { height: 480, fall: 0.32, contact: 0.12, landingStretch: 1.4, squash: 1.9, rebound: 0.08 };

test('a letter lands stretched on its foot, squashes flat there, hops and comes to rest round', () => {
  const touch = letterDropAt(OPTIONS.fall - 1e-6, OPTIONS);
  assert.ok(touch.lift < 0.01, `touches at ${touch.lift} px`);
  const landing = strainEllipse(touch.strain);
  assert.ok(Math.abs(landing.aspect - 1.4) < 1e-3 && Math.abs(Math.abs(landing.angle) - Math.PI / 2) < 1e-6, 'tall as it lands');
  const deepest = letterDropAt(OPTIONS.fall + OPTIONS.contact / 2, OPTIONS);
  assert.equal(deepest.lift, 0);
  assert.ok(Math.abs(strainEllipse(deepest.strain).aspect - 1.9) < 1e-9 && strainEllipse(deepest.strain).angle === 0, 'flat at its deepest');
  assert.ok(letterDropAt(OPTIONS.fall + OPTIONS.contact + 0.05, OPTIONS).lift > 0, 'hops');
  const rest = letterDropAt(letterDropDuration(OPTIONS) + 0.01, OPTIONS);
  assert.deepEqual({ lift: rest.lift, aspect: strainEllipse(rest.strain).aspect }, { lift: 0, aspect: 1 });
});
