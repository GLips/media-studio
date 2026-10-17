import { useHotkeys } from '@tanstack/react-hotkeys';
import type { PlanScreenValue } from './plan-screen-context.tsx';
import { planFlagStepFrom, planSceneIndexAt } from './plan-timing.ts';

/**
 * `F` and `Shift+F` step the playhead to the next or previous flag, and the scene in focus (scrolled into view) to the
 * one it starts in. The step is from the playhead, so the transport's counter and the keys walk the same way.
 * Returns the step, for the counter to call.
 */
export function usePlanFlagHotkeys({ timing, playback, search, setSearch, focusedScene }: PlanScreenValue): (by: 1 | -1) => void {
  const stepFlag = (by: 1 | -1) => {
    if (!timing) return;
    const flag = planFlagStepFrom(timing.flags, playback.frameNow(), by);
    if (!flag) return;
    playback.seek(flag.from);
    const scene = timing.scenes[planSceneIndexAt(timing.scenes, flag.from)]?.id;
    if (scene === undefined) return;
    if (scene !== focusedScene) setSearch({ scene, ...(search.note !== undefined && { note: undefined }) });
    document.querySelector(`[data-plan-scene="${CSS.escape(scene)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  useHotkeys([
    { hotkey: 'F', callback: () => stepFlag(1), options: { enabled: timing !== null, meta: { group: 'plan', name: 'Next flag' } } },
    { hotkey: 'Shift+F', callback: () => stepFlag(-1), options: { enabled: timing !== null, meta: { group: 'plan', name: 'Previous flag' } } },
  ]);
  return stepFlag;
}
