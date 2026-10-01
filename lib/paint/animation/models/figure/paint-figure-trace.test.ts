import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StampGrid } from '#lib/paint/painting/models/stamp-region.ts';
import { tracePaintFigurePieces } from './paint-figure-trace.ts';

test('a traced ring is one piece hugging its outer circle, its hole filled, from a grid four px coarse', () => {
  const cell = 4, columns = 41, rows = 41, values = new Float32Array(columns * rows);
  // A ring about (80, 80): outer radius 60, inner 25, signed distance positive inside.
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) { const r = Math.hypot(i * cell - 80, j * cell - 80); values[j * columns + i] = Math.min(60 - r, r - 25); }
  const grid: StampGrid = { x0: 0, y0: 0, cell, columns, rows, values };
  const pieces = tracePaintFigurePieces(grid, { tolerance: 0.3, smoothing: 0 });
  assert.equal(pieces.length, 1);
  const radii = pieces[0].map((p) => Math.hypot(p.x - 80, p.y - 80));
  assert.ok(Math.min(...radii) > 59.5 && Math.max(...radii) < 60.5, `outline within half a px of the circle: ${Math.min(...radii)}–${Math.max(...radii)}`);
});
