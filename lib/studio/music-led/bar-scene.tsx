// bar-scene.tsx: a music-led video's scenes, bound to its timeline. A bar's scene takes its length from the bar's
// resolved clock, so a composition binds pictures to the timeline without restating any of its timing.

import type { ReactNode } from 'react';
import type { BarClock } from '../../models/timeline/bar-timeline.ts';
import { FPS } from '../frame.ts';
import { defineScene, type SceneClock, type SceneDef } from '../timeline.ts';

/** The scene that plays one bar: a hard cut in on its first frame, lasting until the next bar's. */
export function sceneForBar(bar: BarClock, { note, render }: { note?: string; render: (s: SceneClock) => ReactNode }): SceneDef {
  return defineScene({ id: bar.id, note, min: (bar.to - bar.from) / FPS, lead: 0, tail: 0, cut: true, render });
}
