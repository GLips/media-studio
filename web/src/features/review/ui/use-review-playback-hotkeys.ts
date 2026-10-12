import { getKeyStateTracker, useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { type PlacedReviewThread, reviewNoteLoopOf } from '#lib/output/review/models/review-placement.ts';
import { hotkeySequencePending } from '#web/shared/ui/use-global-hotkeys.ts';
import type { ReviewLoopRange } from './review-playback-store.ts';
import { useReviewScreen, type ReviewScreenMode, type ReviewScreenValue } from './review-screen-context.tsx';
import { useReviewThreads } from './use-review-threads.ts';

/** How far `Alt+ArrowUp` and `Alt+ArrowDown` move the volume. */
const REVIEW_VOLUME_STEP = 0.1;

type PlaybackKey = UseHotkeyDefinition & { readonly modes: readonly ReviewScreenMode[] };

const ALL_MODES: readonly ReviewScreenMode[] = ['stage', 'board', 'draw'];
const ON_STAGE: readonly ReviewScreenMode[] = ['stage', 'draw'];

const playbackKey = (hotkey: UseHotkeyDefinition['hotkey'], name: string, callback: () => void, modes = ON_STAGE, requireReset = false): PlaybackKey =>
  ({ hotkey, callback, modes, options: { requireReset, meta: { group: 'playback', name } } });

/** The next frame after `frame` in `frames`, or before it going back; undefined past the last. */
function reviewFrameBeside(frames: readonly number[], frame: number, direction: -1 | 1): number | undefined {
  return direction > 0 ? frames.find((f) => f > frame) : frames.findLast((f) => f < frame);
}

/** `/` and the transport's loop: the marked range, else the note in focus, else the scene under the playhead. */
export function reviewLoopFor({ search, artifact, timing }: ReviewScreenValue, frame: number, note: PlacedReviewThread | undefined): ReviewLoopRange | null {
  if (search.in !== undefined || search.out !== undefined) return { from: search.in ?? 0, to: search.out ?? timing.durationInFrames - 1 };
  const noteLoop = note && reviewNoteLoopOf(note, timing.fps, timing.durationInFrames);
  if (noteLoop) return noteLoop;
  const scene = artifact.scenes?.find((s) => s.from <= frame && frame < s.to);
  return scene ? { from: scene.from, to: scene.to - 1 } : null;
}

/** Focused controls whose own Enter beats "Note here". */
const REVIEW_ENTER_OWNERS = 'button, a[href], [role="menuitem"], [role="option"], [role="button"], [role="tab"]';

/** K held while J or L is pressed steps a frame instead of shuttling, as in an NLE. */
const kHeld = () => getKeyStateTracker().isKeyHeld('K');

/**
 * The transport on NLE keys (J/K/L, arrows, Home/End, I/O, scene and cue jumps, the loop, volume) and `N` to note the
 * playhead. Only a video registers them, and on the Board only those that leave the arrows and Enter to it.
 */
export function useReviewPlaybackHotkeys() {
  const screen = useReviewScreen();
  const { artifact, playback, timing, draft, search, setSearch, mode } = screen;
  const threads = useReviewThreads();
  const sceneStarts = (artifact.scenes ?? []).map((s) => s.from);
  const cueFrames = [...new Set((artifact.marks?.moments ?? []).map((m) => m.frame))].toSorted((a, b) => a - b);
  const jump = (frames: readonly number[], direction: -1 | 1) => () => {
    const to = reviewFrameBeside(frames, playback.frameNow(), direction);
    if (to !== undefined) playback.seek(to);
  };
  const noteAtPlayhead = () => {
    if (hotkeySequencePending()) return;
    playback.pause();
    const frame = playback.frameNow(), writtenOn = { path: artifact.path, hash: artifact.render.hash };
    const marked = search.in !== undefined || search.out !== undefined
      ? { from: search.in ?? 0, to: search.out ?? timing.durationInFrames - 1 }
      : null;
    // A marked range the playhead sits in becomes the note's span; one elsewhere is left to the loop.
    draft.setAnchor(marked && marked.from <= frame && frame <= marked.to && marked.from < marked.to
      ? { on: 'video', frame: marked.from, end: marked.to, writtenOn }
      : { on: 'video', frame, writtenOn });
  };
  const toggleLoop = () => {
    if (playback.getState().loop) return playback.setLoop(null);
    const loop = reviewLoopFor(screen, playback.frameNow(), threads?.threads.find((t) => t.id === screen.search.note));
    if (!loop) return undefined;
    playback.setLoop(loop);
    playback.seek(loop.from);
    playback.play();
  };

  const keys: PlaybackKey[] = [
    playbackKey('Space', 'Play', playback.toggle, ALL_MODES),
    playbackKey('J', 'Reverse', () => (kHeld() ? playback.stepBy(-1) : playback.shuttle(-1)), ALL_MODES, true),
    playbackKey('K', 'Stop', playback.stop, ALL_MODES),
    playbackKey('L', 'Forward', () => (kHeld() ? playback.stepBy(1) : playback.shuttle(1)), ALL_MODES, true),
    playbackKey('ArrowLeft', 'Frame back', () => playback.stepBy(-1)),
    playbackKey('ArrowRight', 'Frame forward', () => playback.stepBy(1)),
    playbackKey('Shift+ArrowLeft', 'Ten frames back', () => playback.stepBy(-10)),
    playbackKey('Shift+ArrowRight', 'Ten frames forward', () => playback.stepBy(10)),
    playbackKey('Home', 'Start', () => playback.seek(0)),
    playbackKey('End', 'End', () => playback.seek(timing.durationInFrames - 1)),
    playbackKey('I', 'Mark in', () => setSearch({ in: playback.frameNow() })),
    playbackKey('O', 'Mark out', () => setSearch({ out: playback.frameNow() })),
    playbackKey('Alt+X', 'Clear marks', () => setSearch({ in: undefined, out: undefined })),
    // Shifted brackets are spelled raw: the typed spellings leave out shifted punctuation, which moves with the layout.
    playbackKey({ key: '[', shift: true }, 'Previous scene', jump(sceneStarts, -1)),
    playbackKey({ key: ']', shift: true }, 'Next scene', jump(sceneStarts, 1)),
    playbackKey({ key: "'" }, 'Next cue', jump(cueFrames, 1)),
    playbackKey({ key: ';' }, 'Previous cue', jump(cueFrames, -1)),
    playbackKey('/', 'Loop', toggleLoop),
    playbackKey('Alt+/', 'Loop rate', playback.cycleLoopRate, ALL_MODES),
    playbackKey('M', 'Mute', () => playback.setMuted(!playback.getState().muted), ALL_MODES),
    playbackKey('Alt+ArrowUp', 'Louder', () => playback.setVolume(playback.getState().volume + REVIEW_VOLUME_STEP), ALL_MODES),
    playbackKey('Alt+ArrowDown', 'Quieter', () => playback.setVolume(playback.getState().volume - REVIEW_VOLUME_STEP), ALL_MODES),
    playbackKey('N', 'Note here', noteAtPlayhead),
    {
      hotkey: 'Enter', modes: ON_STAGE, options: { preventDefault: false, meta: { group: 'playback', name: 'Note here' } },
      // Enter on a focused button, menu item or link is that control's: the note gives way and the press goes through.
      callback: (event) => {
        if (event.target instanceof Element && event.target.closest(REVIEW_ENTER_OWNERS)) return;
        event.preventDefault();
        noteAtPlayhead();
      },
    },
  ];
  // Left out rather than disabled: a disabled key still holds its binding, and the Board binds the arrows and Enter.
  useHotkeys(artifact.kind === 'video' ? keys.filter((k) => k.modes.includes(mode)) : []);
}
