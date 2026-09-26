import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import type { ReviewPlayback } from './use-review-playback.ts';

/**
 * Space plays; `,` `.` or the arrows step a frame, ten with Shift; Esc drops the note being written. Typing in a note
 * field is left alone: the library skips unmodified keys in an input.
 */
export function useReviewHotkeys({ playback, isVideo, onCancelDraft }: { playback: ReviewPlayback; isVideo: boolean; onCancelDraft: () => void }) {
  const { frame, seekToFrame, togglePlaying } = playback;
  const video = { enabled: isVideo };
  // Shift+, is spelled raw: the library's typed spellings leave out shifted punctuation, which moves with the layout.
  const steps = (keys: readonly string[], by: number): UseHotkeyDefinition[] => keys.flatMap((key) => [
    { hotkey: { key }, callback: () => seekToFrame(frame + by), options: video },
    { hotkey: { key, shift: true }, callback: () => seekToFrame(frame + by * 10), options: video },
  ]);
  useHotkeys([
    { hotkey: 'Space', callback: togglePlaying, options: video },
    ...steps(['ArrowLeft', ','], -1),
    ...steps(['ArrowRight', '.'], 1),
    { hotkey: 'Escape', callback: onCancelDraft },
  ]);
}
