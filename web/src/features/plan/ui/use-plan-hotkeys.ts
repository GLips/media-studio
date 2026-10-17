import { useHotkeys } from '@tanstack/react-hotkeys';
import type { RefObject } from 'react';
import { hotkeySequencePending } from '#web/shared/ui/use-global-hotkeys.ts';
import { planNoteAnchorOf, planSelectionIn } from './plan-notes.ts';
import type { PlanScreenValue } from './plan-screen-context.tsx';

/**
 * The plan's keys: `Space` plays, `J` `K` (or the arrows) move the focus and playhead a scene, `N` notes the selected
 * words, else the cell last clicked, else the scene in focus, `S` signs that scene off, and `Escape` lets go of the
 * selection, target and open note. `body` is where a selection is looked for.
 */
export function usePlanHotkeys(screen: PlanScreenValue, body: RefObject<HTMLElement | null>) {
  const { plan, timing, playback, search, setSearch, draft, target, setTarget, focusedScene, signOff } = screen;
  const scenes = Object.keys(plan.storyboard.scenes);
  const moveScene = (by: -1 | 1) => () => {
    const at = Math.max(0, scenes.indexOf(focusedScene ?? ''));
    const next = scenes[Math.max(0, Math.min(scenes.length - 1, at + by))];
    if (next === undefined) return;
    window.getSelection()?.removeAllRanges();
    setSearch({ scene: next, ...(search.note !== undefined && { note: undefined }) });
    const placed = timing?.scenes.find((s) => s.id === next);
    if (placed) playback.seek(placed.from);
    body.current?.querySelector(`[data-plan-scene="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const note = () => {
    // The N of `G N` goes to the thread, not to a note.
    if (hotkeySequencePending()) return;
    const selected = body.current ? planSelectionIn(body.current) : null;
    const on = selected?.target ?? target ?? (focusedScene === null ? null : { field: 'scene' as const, scene: focusedScene });
    if (!on) return;
    playback.pause();
    window.getSelection()?.removeAllRanges();
    setTarget(on);
    draft.setAnchor(planNoteAnchorOf(on, selected?.text ?? null, plan));
  };
  const signOffFocused = () => {
    // The S of `G S` goes to the plan, which this already is.
    if (hotkeySequencePending() || focusedScene === null) return;
    if (screen.signoffs.get(focusedScene)?.state !== 'signed') signOff(focusedScene);
  };
  const letGo = () => {
    window.getSelection()?.removeAllRanges();
    setTarget(null);
    if (search.note !== undefined) setSearch({ note: undefined });
  };
  useHotkeys([
    { hotkey: 'Space', callback: playback.toggle, options: { meta: { group: 'plan', name: 'Play' } } },
    { hotkey: 'J', callback: moveScene(1), options: { meta: { group: 'plan', name: 'Next scene' } } },
    { hotkey: 'K', callback: moveScene(-1), options: { meta: { group: 'plan', name: 'Previous scene' } } },
    { hotkey: 'ArrowDown', callback: moveScene(1), options: { meta: { group: 'plan', name: 'Next scene' } } },
    { hotkey: 'ArrowUp', callback: moveScene(-1), options: { meta: { group: 'plan', name: 'Previous scene' } } },
    { hotkey: 'N', callback: note, options: { meta: { group: 'plan', name: 'Note' } } },
    { hotkey: 'S', callback: signOffFocused, options: { meta: { group: 'plan', name: 'Sign off scene' } } },
    { hotkey: 'Escape', callback: letGo, options: { ignoreInputs: true, meta: { group: 'plan', name: 'Let go' } } },
  ]);
}
