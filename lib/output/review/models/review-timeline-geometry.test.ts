import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  reviewRulerTicks, reviewTimelineFit, reviewTimelineFrameAt, reviewTimelineMaxZoom, reviewTimelineXOf, reviewTimelineZoomedAt,
} from './review-timeline-geometry.ts';

test('a frame round-trips through its x at every zoom, and zooming at the pointer keeps the frame under it', () => {
  const fit = reviewTimelineFit(742, 1043);
  for (let zoom = 1; zoom <= reviewTimelineMaxZoom(fit); zoom *= 2) {
    // Zoomed in about a third of the way across, so the view starts mid-render.
    const view = reviewTimelineZoomedAt(fit, zoom, 350);
    const shown = Array.from({ length: 742 }, (_, f) => f).filter((f) => reviewTimelineXOf(view, f) >= 0 && reviewTimelineXOf(view, f) < view.width);
    assert.ok(shown.length > 0);
    for (const frame of shown) assert.equal(reviewTimelineFrameAt(view, reviewTimelineXOf(view, frame)), frame, `f${frame} at zoom ${zoom}`);

    for (const x of [0, 211.5, 700, 1042]) {
      const before = reviewTimelineFrameAt(view, x);
      const closer = reviewTimelineZoomedAt(view, view.zoom * 1.5, x);
      assert.equal(reviewTimelineFrameAt(closer, x), before, `x ${x} zooming in from ${zoom}`);
    }
  }
});

test('beat ticks mark the music\'s downbeats, and crowded beats thin to them', () => {
  // 120 bpm at 30 fps in 4/4: a beat every 15 frames, a downbeat every 60.
  const beats = Array.from({ length: 16 }, (_, i) => ({ frame: i * 15, down: i % 4 === 0 }));
  const roomy = reviewRulerTicks(reviewTimelineFit(240, 1200), { fps: 30, beats });
  assert.deepEqual(roomy.filter((t) => t.kind === 'downbeat').map((t) => t.frame), [0, 60, 120, 180]);
  assert.equal(roomy.filter((t) => t.kind === 'beat').length, 12);

  const crowded = reviewRulerTicks(reviewTimelineFit(240, 60), { fps: 30, beats });
  assert.deepEqual(crowded.filter((t) => t.kind !== 'time').map((t) => [t.kind, t.frame]), [['downbeat', 0], ['downbeat', 60], ['downbeat', 120], ['downbeat', 180]]);
});
