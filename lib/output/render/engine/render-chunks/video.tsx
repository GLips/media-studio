// Chunk watchdog check: not a product video, and not a project here. Frame 2 asks a server at its `askAt` prop whether
// to draw, and holds until it's told to, as a page whose GPU process hung would. lib/output/render/engine/
// render-chunks.test.ts copies it into a project of a throwaway studio and draws it in chunks.

import { useLayoutEffect } from 'react';
import { getInputProps, useCurrentFrame, useDelayRender } from 'remotion';
import { defineVideo, sceneForTimelineClock } from '#studio';
import { bindTimeline } from '#lib/timing/timeline/models/bind-timeline.ts';
import { defineTimeline, fixedSpan } from '#lib/timing/timeline/models/timeline.ts';

function AsksBeforeFrameTwo() {
  const frame = useCurrentFrame();
  const { delayRender, continueRender } = useDelayRender();
  useLayoutEffect(() => {
    if (frame !== 2) return;
    const held = delayRender('asking the test whether frame 2 draws');
    // SAFETY: render-chunks.test.ts renders this video only with its server's address as `askAt`.
    const { askAt } = getInputProps() as { askAt: string };
    void fetch(askAt).then((response) => response.text()).then((answer) => answer === 'draw' && continueRender(held));
  }, [frame, delayRender, continueRender]);
  return <div style={{ position: 'absolute', inset: 0, background: 'rgb(128, 128, 128)' }} />;
}

const timeline = defineTimeline({ scenes: { grey: fixedSpan(1) } });

export default defineVideo({
  title: 'Chunk watchdog check', format: { width: 320, height: 180 }, timeline, voice: {},
  scenes: bindTimeline(timeline, { grey: (clock) => sceneForTimelineClock(clock, { render: () => <AsksBeforeFrameTwo /> }) }),
});
