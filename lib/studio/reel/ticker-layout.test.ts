import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutGlyphLine, layoutTickerRow, type GlyphAxes, type TickerRowStyle } from './ticker-layout.ts';

const close = (actual: readonly number[], expected: readonly number[], within: number) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((a, i) => assert.ok(Math.abs(a - expected[i]) <= within, `${i}: ${a} is not ${expected[i]}`));
};

test('sets glyphs where the font engine does, between its masters and each at its own axes', () => {
  // At 1000 px, so pixels are font units. Expected from Archivo itself: fontTools' advances and HarfBuzz's kerning,
  // a mixed pair kerned at the mean of its axes. Off every master, so avar and the interpolation are both in play.
  const line = (text: string, axes: GlyphAxes[]) => layoutGlyphLine([...text].map((char, i) => ({ char, axes: axes[i] })), 1000);

  const even = line('MOTAV', Array(5).fill({ wght: 437, wdth: 81.5 }));
  close(even.x, [0, 733.771, 1363.4, 1804.157, 2340.56], 0.05);
  close([even.width], [2887.992], 0.05);

  const mixed = line('WAVE', [{ wght: 300, wdth: 70 }, { wght: 650, wdth: 100 }, { wght: 800, wdth: 115 }, { wght: 900, wdth: 125 }]);
  close(mixed.x, [0, 661.78, 1331.749, 2165.937], 0.05);
  close([mixed.width], [3025.937], 0.05);
});

test('a ticker row keeps its place however much of it is laid out, as a band slides in or out', () => {
  const style: TickerRowStyle = {
    unit: [...'MOTION', null], size: 160, breath: { period: 0.875, lag: 0.047 }, phase: 0.3,
    light: { wght: 460, wdth: 62, scaleX: 0.75, tracking: -0.037, dot: 0.05 },
    bold: { wght: 840, wdth: 122, scaleX: 1, tracking: -0.065, dot: 0.75 },
  };
  const row = (from: number, to: number) => layoutTickerRow(1.234, style, { offset: -285, from, to, centre: 960, anchor: 1920 });
  const whole = new Map(row(0, 1920).map((s) => [s.index, s.x]));
  for (const part of [row(1300, 2100), row(-200, 500)]) {
    const shared = part.filter((s) => whole.has(s.index));
    assert.ok(shared.length >= 5);
    for (const s of shared) assert.ok(Math.abs(s.x - whole.get(s.index)!) < 1e-9, `slot ${s.index} moved`);
  }
});
