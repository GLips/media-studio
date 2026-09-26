// The Complex buy box video. Scene times are seconds from each scene's start; `s.line(id).at(f)` is the moment a fraction
// `f` of the way through a voiced line, so beats stay on their words when the voice is re-timed.

import {
  Capture, EndCard, GlassCard, MotionTitle, Wash, W, camTop, defineScene, defineVideo, motionCurves, seg, view,
} from '#studio';
import { voice } from './audio/manifest.ts';
import { captures as C } from './captures/index.ts';

const INK = '#1c365e';
const ACCENT = '#b82b2b';

const title = defineScene({
  id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0,
  render: (s) => <MotionTitle s={s} shot={C.home} eyebrow="WALKTHROUGH" title="Complex buy box" accent={ACCENT} />,
});

const outro = defineScene({
  id: 'outro', lines: ['outro'], lead: 0.6, tail: 3.4,
  render: (s) => {
    const blur = seg(s.t, 0, 1.0);
    return (
      <>
        <Capture view={view(C.home, camTop(C.home))} blur={34 * blur} />
        <Wash color="22, 40, 70" from={0.62 * blur} to={0.38 * blur} x0={0} x1={W} />
        <GlassCard k={seg(s.t, 0.4, 1.3, motionCurves.cubic.entrance) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1))} eyebrow="IN SHORT"
          points={['The first takeaway', 'The second takeaway']} accent={ACCENT} ink={INK} />
        <EndCard k={seg(s.t, s.dur - 2.4, s.dur - 1.6)} title="Complex buy box" bg={INK} />
      </>
    );
  },
});

export default defineVideo({ title: "Complex buy box", voice, scenes: [title, outro] });
