import assert from 'node:assert/strict';
import { test } from 'node:test';
import { framingProblems, takeFitWarnings, type FramingMark } from './framing-check.ts';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const mark = (m: Partial<FramingMark> & Pick<FramingMark, 'kind' | 'rect'>): FramingMark =>
  ({ shown: m.rect, strength: 1, opacity: 1, scene: 'combo', ...m });
const caption = mark({ kind: 'caption', rect: box(300, 900, 1320, 120), scene: undefined });

test('an expected highlight must be drawn and clear for its whole span; any highlight must not be cut off', () => {
  const fps = 10, expectations = [{ scene: 'combo', see: 'matches', start: 1, end: 1.3 }];
  const matches = (y: number) => mark({ kind: 'subject', name: 'matches', rect: box(400, y, 300, 80) });
  const reports = [
    { frame: 10, marks: [caption] },                    // not drawn yet
    { frame: 11, marks: [caption, matches(400)] },      // fine
    { frame: 12, marks: [caption, matches(880)] },      // slid under the caption
    { frame: 20, marks: [mark({ kind: 'subject', rect: box(900, 300, 200, 80), shown: box(900, 300, 60, 80) })] },
  ].map((r) => ({ ...r, takeFitStrains: [] }));
  assert.deepEqual(framingProblems(reports, expectations, fps, 5).map((p) => [p.from, p.problem]), [
    [1, 'expected highlight "matches" isn\'t drawn (expect, 1.00–1.30s)'],
    [1.2, 'highlight "matches" is under the caption'],
    [1.2, 'expected highlight "matches" is under the caption (expect, 1.00–1.30s)'],
    [2, 'a highlight is cut off by its panel'],
  ]);
});

test('a strained take fit is warned of once, by the scene painting it alone', () => {
  const strain = { from: 'pick', to: 'shown', speed: 1.9 };
  const reports = [
    { frame: 0, marks: [], takeFitStrains: [{ ...strain, scenes: ['intro', 'photos'] }] }, // crossfading in
    { frame: 5, marks: [], takeFitStrains: [{ ...strain, scenes: ['photos'] }] },
    { frame: 10, marks: [], takeFitStrains: [{ ...strain, scenes: ['photos'] }] },
  ];
  assert.deepEqual(takeFitWarnings(reports).map((w) => w.scene), ['photos']);
  assert.deepEqual(takeFitWarnings(reports.slice(0, 1)).map((w) => w.scene), ['intro / photos']);
});
