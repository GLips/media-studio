// The reel's look, shared by every bar: its palette, and the 174 inks the ink bars and the finale draw from.

import { seededRandom } from '../../lib/studio/api.ts';

export const P = {
  ground: '#0c0c0e', red: '#ee4c23', blue: '#4144f4', cream: '#f3f0e7', ink: '#140b0e',
  // The Solice's three swatches, sampled from the capture.
  black: '#000000', magenta: '#ff00c2', graphite: '#3d404b',
} as const;

export type Ink = { color: string; hue: number; chroma: number; lightness: number };

/**
 * 174 inks, as a maker's chart runs: 150 hues round the wheel, each at one of five strengths so neighbours differ in
 * lightness, then 24 blacks, greys and whites. `inksByHue` is the chart order (for rings of a ripple); `inks` is a
 * seeded shuffle (for a field where every ink sits somewhere).
 */
export const inksByHue: Ink[] = (() => {
  const out: Ink[] = [];
  const strengths = [[0.62, 0.2], [0.48, 0.17], [0.74, 0.15], [0.38, 0.12], [0.56, 0.22]] as const;
  for (let i = 0; i < 150; i++) {
    const hue = (i / 150) * 360, [l, c] = strengths[i % 5];
    out.push({ color: `oklch(${l} ${c} ${hue.toFixed(1)})`, hue, chroma: c, lightness: l });
  }
  for (let i = 0; i < 24; i++) {
    const l = 0.12 + i * 0.036;
    out.push({ color: `oklch(${l.toFixed(3)} 0.01 60)`, hue: 60, chroma: 0.01, lightness: l });
  }
  return out;
})();

export const inks: Ink[] = (() => {
  const rnd = seededRandom('inks');
  return inksByHue.map((ink) => [rnd(), ink] as const).sort((a, b) => a[0] - b[0]).map(([, ink]) => ink);
})();

// The shop's ink search finds 17 of its 174 for "blue"; the 17 chart hues nearest cobalt's stand in for them.
const BLUE_HUE = 258;
const blueSet = new Set(
  inksByHue.filter((ink) => ink.chroma > 0.05).sort((a, b) => Math.abs(a.hue - BLUE_HUE) - Math.abs(b.hue - BLUE_HUE)).slice(0, 17),
);
export const isBlueInk = (ink: Ink) => blueSet.has(ink);
