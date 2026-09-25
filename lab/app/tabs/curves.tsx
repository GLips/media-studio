// curves.tsx: the lab's Curves & springs tab: the studio's easing curves racing the same move (curves/eases.tsx),
// then its two spring models side by side on the same moves and bounces (curves/springs.tsx).
import { LabTabIntro } from '../ui.tsx';
import { CurvesEasesBench } from './curves/eases.tsx';
import { CurvesSpringsBench } from './curves/springs.tsx';
import './curves.css';

export function CurvesTab() {
  return (
    <>
      <LabTabIntro
        number={1}
        title="Curves & springs"
        what={<>How something gets from A to B. Almost nothing in the real world moves at a steady speed: it picks up speed, then slows to a stop. An <b>easing curve</b> is that speed-up and slow-down, written down so every move in a video shares it; the studio has a few named ones. A <b>spring</b> is the physical version: the object is pulled home as if by a rubber band, and can overshoot and wobble before it settles.</>}
        when="Every move in every video: a card sliding in, a caption popping up, the camera pushing in on a detail. Walkthroughs of an app use calm curves; teasers and showreels cut to music use snappier ones and springs."
        bad="Linear motion: the thing starts at full speed and stops dead, like a robot. Or a mix of unrelated curves, so the video feels twitchy, or a slow, lazy spring that wobbles long after the moment has passed."
        good="Things arrive fast and slow into place, so the eye knows exactly when they’ve landed. One family of curves throughout, and springs kept quick, saved for things that should feel alive."
      />
      <h3 className="curves-section"><span className="hud">A</span> Easing curves</h3>
      <CurvesEasesBench />
      <h3 className="curves-section"><span className="hud">B</span> Springs: arrive on the beat, or keep the same feel?</h3>
      <CurvesSpringsBench />
    </>
  );
}
