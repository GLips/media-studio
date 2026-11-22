import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAffine } from '#lib/picture/frame/models/geometry.ts';
import { mixStrain, strainAbout, strainAffine, strainAlong, strainCssMatrix, strainMatrix, strainMatrix3, strainEllipse } from './strain.ts';

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} against ${b}`);

test('every strain and every blend of two keeps area, and the 3D stretch keeps volume', () => {
  const tall = strainAlong(2.4, Math.PI / 2), tilted = strainAlong(1.7, 0.6);
  for (const k of [0, 0.25, 0.5, 0.9, 1]) {
    const [[a, b], [c, d]] = strainMatrix(mixStrain(tall, tilted, k));
    near(a * d - b * c, 1, `det at ${k}`);
  }
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = strainMatrix3(Math.log(0.7), { x: 0.6, y: 0.8, z: 0 });
  near(m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20), 1, 'det 3');
});

test('a tall stretch blends into a flat squash through round, never turning its axis', () => {
  const tall = strainAlong(2, Math.PI / 2), flat = strainAlong(2, 0);
  near(strainEllipse(mixStrain(tall, flat, 0.5)).aspect, 1, 'halfway');
  for (const k of [0.1, 0.3, 0.7, 0.9]) {
    const [[, b]] = strainMatrix(mixStrain(tall, flat, k));
    near(b, 0, `shear at ${k}`);
  }
});

test('the pivot stays put, and the CSS matrix is the same map', () => {
  const s = strainAlong(1.8, 0.4), pivot = { x: 120, y: 640 }, p = { x: 300, y: 500 };
  const moved = strainAbout(s, pivot)(pivot);
  near(moved.x, pivot.x, 'x');
  near(moved.y, pivot.y, 'y');
  const css = strainCssMatrix(s, pivot).match(/^matrix\((.*)\)$/)![1].split(',').map(Number);
  const [a, b, c, d, e, f] = strainAffine(s, pivot);
  assert.deepEqual(css, [a, b, c, d, e, f]);
  near(applyAffine(strainAffine(s, pivot), p).x, strainAbout(s, pivot)(p).x, 'same map');
});
