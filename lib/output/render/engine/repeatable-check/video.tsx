// Repeatability check: not a product video, and not a project here. A frame that differs by one level at one pixel
// depending on whether its tab has drawn before, as a GPU renderer's first draw can round, which
// lib/output/render/engine/repeatable-check.test.ts copies into a project of a throwaway studio and runs
// checkFramesRepeatable on. The flat grey around the pixel is what a lossy capture would round the difference into.

import { useLayoutEffect } from 'react';
import { defineVideo, sceneForTimelineClock } from '#studio';
import { bindTimeline } from '#lib/timing/timeline/models/bind-timeline.ts';
import { defineTimeline, fixedSpan } from '#lib/timing/timeline/models/timeline.ts';

// Deliberately module state: a tab's first draw is the one that differs.
let tabHasDrawn = false;

function FirstDrawDiffers() {
  const level = tabHasDrawn ? 129 : 128;
  useLayoutEffect(() => { tabHasDrawn = true; });
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgb(128, 128, 128)' }} />
      <div style={{ position: 'absolute', left: 100, top: 60, width: 1, height: 1, background: `rgb(${level}, ${level}, ${level})` }} />
    </>
  );
}

const timeline = defineTimeline({ scenes: { grey: fixedSpan(2) } });

export default defineVideo({
  title: 'Repeatability check', format: { width: 320, height: 180 }, timeline, voice: {},
  scenes: bindTimeline(timeline, { grey: (clock) => sceneForTimelineClock(clock, { render: () => <FirstDrawDiffers /> }) }),
});
