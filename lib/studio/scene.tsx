// scene.tsx: the scene clock, for components nested inside a scene. A scene's own render gets the clock directly
// (typed to its lines); reusable pieces further down read it here.

import { createContext, useContext } from 'react';
import type { SceneClock } from './timeline.ts';

export const SceneContext = createContext<SceneClock | null>(null);

export function useScene(): SceneClock {
  const clock = useContext(SceneContext);
  if (!clock) throw new Error('useScene() is only available inside a scene');
  return clock;
}
