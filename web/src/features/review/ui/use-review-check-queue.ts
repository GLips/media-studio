// use-review-check-queue.ts: check mode on a render's thread (`Shift+V`, or the button by ◐): each addressed note in
// moment order is sought, compared against the render it was written on and looped, so a fix is looked at before `E`
// resolves it, `U` reopens it or `Shift+V` passes it by. The walk itself is review-check-queue.ts; this binds it to
// the clock, the URL and the keys.
import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { type PlacedReviewThread, reviewNoteLoopOf, reviewThreadFrameOf } from '#lib/output/review/models/review-placement.ts';
import type { ReviewLoopRange } from './review-playback-store.ts';
import { reviewCheckQueueAfter, reviewCheckQueueSkip, startReviewCheckQueue, type ReviewCheckQueue } from './review-check-queue.ts';
import { type ReviewThreadCompare, type ReviewThreadMedia, useReviewThreadScope } from './review-thread-scope.tsx';
import type { ReviewThreadActions } from './use-review-thread-panel.ts';

/** What check mode puts back on leaving: the loop and the compare as they were on entering. */
type ReviewCheckBefore = { loop: ReviewLoopRange | null; compare: ReviewThreadCompare };

/** Where a note's fix is compared from: the render it was written on, or why there's nothing to compare. */
export type ReviewCheckCompare = { vs: string; label: string } | { vs?: undefined; label: string };

/** The note's own render from the open render's history; a note written on the render on show has no before. */
function reviewCheckCompareOf(thread: PlacedReviewThread, media: ReviewThreadMedia): ReviewCheckCompare {
  if (thread.anchor.on !== 'video') return { label: 'not on a render' };
  const { hash } = thread.anchor.writtenOn;
  if (hash === media.artifact.render.hash) return { label: 'written on this render' };
  const version = media.versions.find((v) => v.hash === hash);
  return version ? { vs: hash, label: `vs r${version.r}` } : { label: 'original render gone' };
}

/** Check mode as the header shows it: the note on show, its place in the queue, and what it's compared against. */
export type ReviewCheckStep = { at: number; of: number; compare: ReviewCheckCompare; leave: () => void };

export type ReviewCheck = {
  /** Null outside check mode. */
  step: ReviewCheckStep | null;
  /** Enters check mode; absent with no addressed note placed on this render. */
  start: (() => void) | undefined;
};

const checkKey = (hotkey: UseHotkeyDefinition['hotkey'], name: string, callback: () => void, ignoreInputs?: boolean): UseHotkeyDefinition =>
  ({ hotkey, callback, options: { meta: { group: 'notes', name }, ...(ignoreInputs !== undefined && { ignoreInputs }) } });

/**
 * Check mode over `scoped`, the panel's threads, on a render's thread (`enabled`). A note leaves the queue by any
 * resolve or reopen, the queue's `E` `U` or the thread's own, and the next one is shown; the last one leaves.
 */
export function useReviewCheckQueue(scoped: readonly PlacedReviewThread[], actions: ReviewThreadActions, enabled: boolean): ReviewCheck {
  const { media } = useReviewThreadScope();
  const [checking, setChecking] = useState<{ queue: ReviewCheckQueue; before: ReviewCheckBefore } | null>(null);
  const addressed = useMemo(() => new Set(scoped.filter((t) => t.state === 'addressed').map((t) => t.id)), [scoped]);
  const queue = checking && reviewCheckQueueAfter(checking.queue, addressed);
  const id = queue?.ids[queue.at];
  const thread = scoped.find((t) => t.id === id);
  const compare = thread && media ? reviewCheckCompareOf(thread, media) : undefined;

  // The last note left the queue: check mode ends here, in render, so the queue can't come back to life when an undo
  // makes a note addressed again.
  if (checking && queue === null) setChecking(null);
  // Leaving by any road (a key, the last note, the screen closing) stops the loop and puts the old one back.
  // Keyed on `before`, which a skip carries over, so stepping doesn't run the cleanup.
  const playback = media?.playback, before = checking?.before;
  useEffect(() => {
    if (!before || !playback) return undefined;
    return () => {
      playback.pause();
      playback.setLoop(before.loop);
    };
  }, [before, playback]);
  /** Esc, or the row's Esc: the compare goes back too, which the last note's end leaves on its render. */
  const leave = () => {
    if (checking) media?.setCompare(checking.before.compare);
    setChecking(null);
  };
  const show = useEffectEvent(() => {
    const frame = thread && reviewThreadFrameOf(thread);
    if (!media || !thread || !compare || frame === undefined) return;
    const { timing } = media;
    media.setCompare(compare.vs ? { note: thread.id, vs: compare.vs } : { note: thread.id, vs: undefined, cmp: undefined, w: undefined });
    media.playback.setLoop(reviewNoteLoopOf(thread, timing.fps, timing.durationInFrames));
    media.playback.seek(frame);
    media.playback.play();
  });
  // Keyed on the id alone: a poll that hands back the same note as a new object doesn't seek it again.
  useEffect(() => {
    if (id !== undefined) show();
  }, [id]);

  const start = enabled && media && scoped.some((t) => t.state === 'addressed' && reviewThreadFrameOf(t) !== undefined)
    ? () => {
      const taken = startReviewCheckQueue(scoped.map((t) => ({ id: t.id, state: t.state, frame: reviewThreadFrameOf(t) })));
      if (taken) setChecking({ queue: taken, before: { loop: media.playback.getState().loop, compare: media.compare } });
    }
    : undefined;

  /** On past the note on show, left addressed; past the last, the check ends as Esc ends it. */
  const skip = () => {
    const next = checking && queue && reviewCheckQueueSkip(queue, addressed);
    if (next) setChecking({ ...checking, queue: next });
    else leave();
  };
  const check = queue ? skip : start;
  // Left out, not disabled, when they don't apply: a disabled key still holds its binding.
  useHotkeys([
    ...(check ? [checkKey('Shift+V', queue ? 'Next to check' : 'Check addressed', check)] : []),
    ...(queue && id !== undefined ? [
      checkKey('E', 'Resolve and next', () => actions.resolve([id])),
      checkKey('U', 'Reopen and next', () => actions.reopen([id])),
      // Not from a field: there Escape is the composer's, and a half-written reply shouldn't end the check.
      ...(media?.drawing ? [] : [checkKey('Escape', 'Leave check', leave, true)]),
    ] : []),
  ]);

  return {
    step: queue && compare ? { at: queue.at + 1, of: queue.ids.length, compare, leave } : null,
    start,
  };
}
