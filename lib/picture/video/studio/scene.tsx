// scene.tsx: the scene clock, for components nested inside a scene. A scene's own render gets the clock directly;
// reusable pieces further down read it here.

import { createContext, useContext } from 'react';
import type { SceneClock } from '#lib/timing/timeline/models/video-layout.ts';

export const SceneContext = createContext<SceneClock | null>(null);

export function useScene(): SceneClock {
  const clock = useContext(SceneContext);
  if (!clock) throw new Error('useScene() is only available inside a scene');
  return clock;
}

/** The scene clock for a component that may also play outside a scene (a gate page, a still): null there. */
export const useSceneOrNull = (): SceneClock | null => useContext(SceneContext);
