import { useHotkeys, useKeyHold, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import type { ReviewMark } from '#lib/output/review/models/review-threads.ts';

/** What a drag draws in draw mode. */
export type ReviewDrawTool = ReviewMark['kind'];

type ReviewStageHotkeyActions = {
  /** Where the cheatsheet lists `Z`, `H` and `D`: beside a video's playback keys, or a still's own. */
  readonly group: 'playback' | 'still';
  readonly toggleActualSize: () => void;
  readonly cycleGuides: () => void;
  readonly toggleDraw: () => void;
  /** Null when there's no other version to compare with: the compare keys are left out. */
  readonly compare: { readonly flip: () => void; readonly wipe: () => void; readonly side: () => void } | null;
  /** Set only in draw mode, when the tool keys and Backspace belong to the strokes. */
  readonly draw: { readonly setTool: (tool: ReviewDrawTool) => void; readonly popMark: () => void; readonly done: () => void } | null;
};

const stageKey = (hotkey: UseHotkeyDefinition['hotkey'], group: 'playback' | 'still' | 'compare' | 'draw', name: string, callback: () => void): UseHotkeyDefinition =>
  ({ hotkey, callback, options: { meta: { group, name } } });

/**
 * The stage's keys: `Z` 1:1, `H` guides, `D` draw; compare's `\` (held), `W` and `Shift+W`; and, while drawing, the
 * tools, `Backspace` and `Escape`. Keys that don't apply are left out, not disabled, since a disabled key still holds
 * its binding. Answers whether `\` is held, which flips to the other version.
 */
export function useReviewStageHotkeys({ group, toggleActualSize, cycleGuides, toggleDraw, compare, draw }: ReviewStageHotkeyActions): { flipped: boolean } {
  const backslashHeld = useKeyHold('\\');
  // `Mod+\` folds the thread away: that press isn't a flip.
  const metaHeld = useKeyHold('Meta');
  const controlHeld = useKeyHold('Control');
  const modHeld = metaHeld || controlHeld;
  useHotkeys([
    stageKey('Z', group, 'Fit / 1:1', toggleActualSize),
    stageKey('H', group, 'Guides', cycleGuides),
    stageKey('D', group, 'Draw', toggleDraw),
    // The flip itself is the key being held (useKeyHold); its press only readies the other version.
    ...(compare ? [
      stageKey('\\', 'compare', 'Flip (hold)', compare.flip),
      stageKey('W', 'compare', 'Wipe', compare.wipe),
      stageKey('Shift+W', 'compare', 'Side by side', compare.side),
    ] : []),
    ...(draw ? [
      stageKey('A', 'draw', 'Arrow', () => draw.setTool('arrow')),
      stageKey('C', 'draw', 'Circle', () => draw.setTool('ellipse')),
      stageKey('P', 'draw', 'Pen', () => draw.setTool('path')),
      stageKey('Backspace', 'draw', 'Undo stroke', draw.popMark),
      stageKey('Escape', 'draw', 'Done drawing', draw.done),
    ] : []),
  ]);
  return { flipped: compare !== null && backslashHeld && !modHeld };
}
