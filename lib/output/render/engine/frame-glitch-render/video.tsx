// Blank-frame check: not a product video, and not a project here. A textured picture whose lower half drops to black
// on frame 12 alone, as a frame read back half-painted does. lib/output/render/engine/frame-glitch-render.test.ts
// copies it into a project of a throwaway studio and renders it.

import { useCurrentFrame } from 'remotion';
import { defineVideo, sceneForTimelineClock } from '#studio';
import { defineStoryboard } from '#lib/timing/storyboard/models/storyboard.ts';

const TEXTURE = 'repeating-linear-gradient(45deg, rgb(90, 110, 130) 0 6px, rgb(170, 160, 140) 6px 12px)';

function TornOnFrameTwelve() {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', inset: 0, background: TEXTURE }}>
      {frame === 12 && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', background: 'black' }} />}
    </div>
  );
}

const storyboard = defineStoryboard({
  title: 'Blank-frame check', target: { seconds: 1 },
  scenes: { torn: { onScreen: 'A textured frame, torn once', motion: 'None', seconds: 1 } },
});

export default defineVideo({
  title: 'Blank-frame check', format: { width: 320, height: 180 }, storyboard,
  scenes: { torn: (clock) => sceneForTimelineClock(clock, { render: () => <TornOnFrameTwelve /> }) },
});
