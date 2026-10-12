// use-review-thread-panel.ts: what the thread panel does and watches. The actions turn a key or a click into one batch
// of ops; deletes keep the thread (and its frame image's bytes) for Undo and `Mod+Z`. The live half follows the
// playhead down the list and flashes a row when the agent's reply lands.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type PlacedReviewThread, reviewThreadFrameOf, reviewVideoAnchorAt } from '#lib/output/review/models/review-placement.ts';
import type { ReviewThread } from '#lib/output/review/models/review-threads.ts';
import { projectFileUrl } from '#web/shared/media-urls.ts';
import type { DecodedReviewOp } from '../controllers/review-op-schema.ts';
import { composeShownReviewFrame } from './review-mark-paint.ts';
import type { ReviewPlayback } from './review-playback-store.ts';
import { useReviewThreadScope } from './review-thread-scope.tsx';

/** How long a deleted row offers Undo in place; `Mod+Z` reaches further back. */
const REVIEW_UNDO_SHOWN_MS = 6000;
/** How long a landed reply lights its row. */
const REVIEW_FLASH_MS = 1000;
/** A reader who scrolled the thread this recently keeps their place: playback doesn't scroll it under them. */
const REVIEW_MANUAL_SCROLL_HOLD_MS = 3000;
/** How often a playing clock is asked which note it's on: a list row, not a frame, so four times a second is plenty. */
const REVIEW_FOLLOW_POLL_MS = 250;
const REVIEW_COPIED_MS = 1200;

/** A batch of deleted threads with their frame images' bytes, as Undo restores them. */
type ReviewDeletedBatch = { key: number; threads: { thread: ReviewThread; image?: Uint8Array }[]; shown: boolean; resolvedGroup: boolean };

/**
 * One step `Mod+Z` takes back and `Mod+Shift+Z` makes again: a delete (its batch, by key, or once undone the ids to
 * delete again), or the resolves and reopens of one key, taken back thread by thread.
 */
type ReviewUndoStep = { kind: 'delete'; key: number; ids: readonly number[] } | { kind: 'transition'; ids: readonly number[]; batch: DecodedReviewOp[] };
type ReviewUndoHistory = { undo: readonly ReviewUndoStep[]; redo: readonly ReviewUndoStep[] };

/** An inline field open on a row: a reply, or an edit with the newer text another tab saved over it. */
export type ReviewThreadInline = { id: number; mode: 'reply' | 'edit'; conflict?: { text: string; rev: number } };

async function frameImageBytes(project: string, image: string | undefined): Promise<Uint8Array | undefined> {
  if (!image) return undefined;
  const response = await fetch(projectFileUrl(project, image));
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
}

const imageOf = ({ anchor }: ReviewThread) => (anchor.on === 'video' || anchor.on === 'still' ? anchor.image : undefined);
const bareThreadOf = ({ placement: _placement, ...thread }: PlacedReviewThread): ReviewThread => thread;

/**
 * Everything a key or click on the thread does. `scoped` is the panel's threads, so the bulk actions reach only what
 * the panel shows.
 */
export function useReviewThreadActions(scoped: readonly PlacedReviewThread[]) {
  const { project, ops, media, search, setSearch, markdownOf } = useReviewThreadScope();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [inline, setInline] = useState<ReviewThreadInline | null>(null);
  const [deleted, setDeleted] = useState<readonly ReviewDeletedBatch[]>([]);
  const [history, setHistory] = useState<ReviewUndoHistory>({ undo: [], redo: [] });
  const [copied, setCopied] = useState(false);
  const byId = (ids: readonly number[]) => scoped.filter((t) => ids.includes(t.id));
  const send = (batch: DecodedReviewOp[]) => (batch.length ? ops.apply(batch) : Promise.resolve(undefined));

  const did = (step: ReviewUndoStep) => setHistory(({ undo }) => ({ undo: [...undo, step], redo: [] }));

  const remove = async (threads: readonly PlacedReviewThread[], resolvedGroup = false, redoing = false) => {
    if (!threads.length) return;
    const kept = await Promise.all(threads.map(async (t) => ({ thread: bareThreadOf(t), image: await frameImageBytes(project, imageOf(t)) })));
    const key = Date.now();
    const step: ReviewUndoStep = { kind: 'delete', key, ids: threads.map((t) => t.id) };
    if (redoing) setHistory(({ undo, redo }) => ({ undo: [...undo, step], redo }));
    else did(step);
    setDeleted((batches) => [...batches, { key, threads: kept, shown: true, resolvedGroup }]);
    setSelected(new Set());
    setTimeout(() => setDeleted((batches) => batches.map((b) => (b.key === key ? { ...b, shown: false } : b))), REVIEW_UNDO_SHOWN_MS);
    await send(threads.map((t) => ({ op: 'thread.delete', id: t.id })));
  };

  /** Brings a deleted batch back; the inline Undo's step leaves the history with it. */
  const restore = (key: number) => {
    const batch = deleted.find((b) => b.key === key);
    if (!batch) return;
    setDeleted((batches) => batches.filter((b) => b !== batch));
    setHistory(({ undo, redo }) => ({ undo: undo.filter((s) => s.kind !== 'delete' || s.key !== key), redo }));
    void send(batch.threads.map(({ thread, image }): DecodedReviewOp => (image ? { op: 'thread.restore', thread, image } : { op: 'thread.restore', thread })));
  };

  const reply = (ids: readonly number[], transition?: 'resolved' | 'reopened', text = '') =>
    void send(ids.map((id): DecodedReviewOp => (transition ? { op: 'thread.reply', id, text, transition } : { op: 'thread.reply', id, text })));

  const transition = (ids: readonly number[], batch: DecodedReviewOp[]) => {
    if (!ids.length) return;
    did({ kind: 'transition', ids, batch });
    void send(batch);
  };

  const undo = () => {
    const step = history.undo.at(-1);
    if (!step) return;
    setHistory(({ undo: done, redo }) => ({ undo: done.slice(0, -1), redo: [...redo, step] }));
    if (step.kind === 'transition') void send(step.ids.map((id) => ({ op: 'thread.takeBack', id })));
    else restore(step.key);
  };
  const redo = () => {
    const step = history.redo.at(-1);
    if (!step) return;
    setHistory(({ undo: done, redo: undone }) => ({ undo: step.kind === 'transition' ? [...done, step] : done, redo: undone.slice(0, -1) }));
    // A delete made again is a new batch, with its own Undo and its own step.
    if (step.kind === 'delete') void remove(byId(step.ids), false, true);
    else void send(step.batch);
  };

  return {
    selected,
    inline,
    deleted,
    copied,
    failed: ops.failed,
    /** Brings a note into focus: the URL names it, its row opens, and the playhead goes to it. */
    open: (thread: PlacedReviewThread) => {
      setSearch({ note: thread.id });
      const frame = reviewThreadFrameOf(thread);
      if (frame !== undefined) media?.playback.seek(frame);
    },
    /** Lets go of the note in focus: the URL no longer names it and its row closes. */
    close: () => search.note !== undefined && setSearch({ note: undefined }),
    toggleSelected: (id: number) => {
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    clearSelected: () => setSelected(new Set()),
    startInline: (id: number, mode: ReviewThreadInline['mode']) => setInline({ id, mode }),
    endInline: () => setInline(null),
    sendReply: (id: number, text: string) => {
      setInline(null);
      reply([id], undefined, text);
    },
    /** Saves an edit over the note as loaded, or as the other tab left it once the reviewer has seen both. */
    saveEdit: async (thread: PlacedReviewThread, text: string): Promise<boolean> => {
      const ifRev = inline?.conflict?.rev ?? thread.entries[0].rev;
      const answer = await send([{ op: 'thread.edit', id: thread.id, ifRev, text }]);
      if (answer && 'conflict' in answer) {
        const [note] = answer.conflict.entries;
        setInline({ id: thread.id, mode: 'edit', conflict: { text: note.text, rev: note.rev } });
        return false;
      }
      setInline(null);
      return true;
    },
    resolve: (ids: readonly number[]) => {
      const moving = byId(ids).filter((t) => t.state !== 'resolved').map((t) => t.id);
      transition(moving, moving.map((id) => ({ op: 'thread.reply', id, text: '', transition: 'resolved' })));
    },
    reopen: (ids: readonly number[]) => {
      const moving = byId(ids).filter((t) => t.state === 'addressed' || t.state === 'resolved').map((t) => t.id);
      transition(moving, moving.map((id) => ({ op: 'thread.reply', id, text: '', transition: 'reopened' })));
    },
    remove: (ids: readonly number[]) => void remove(byId(ids)),
    resolveAddressed: () => {
      const ids = scoped.filter((t) => t.state === 'addressed').map((t) => t.id);
      transition(ids, [{ op: 'thread.resolveAddressed', ids }]);
    },
    clearResolved: () => void remove(scoped.filter((t) => t.state === 'resolved'), true),
    restore,
    undo,
    redo,
    /** Moves an unplaced note to the playhead on this render, its range kept as long and its image cut again. */
    repin: async (thread: PlacedReviewThread) => {
      const { anchor } = thread;
      if (anchor.on !== 'video' || !media) return;
      const { artifact, playback } = media;
      const frame = playback.frameNow();
      const image = await composeShownReviewFrame({ point: anchor.point, marks: anchor.marks, transparent: artifact.transparent });
      const end = anchor.end === undefined ? {} : { end: frame + anchor.end - anchor.frame };
      await send([{ op: 'thread.edit', id: thread.id, ifRev: thread.entries[0].rev, anchor: { ...reviewVideoAnchorAt(artifact, frame), ...end }, ...(image && { image }) }]);
    },
    /** The open and reopened notes, and every keep, as the markdown an agent acts on; absent with no notes to copy. */
    copy: markdownOf && scoped.length ? async () => {
      await navigator.clipboard.writeText(markdownOf(scoped));
      setCopied(true);
      setTimeout(() => setCopied(false), REVIEW_COPIED_MS);
    } : undefined,
    cycleFilter: () => {
      const order = ['active', 'open', 'all'] as const;
      setSearch({ filter: order[(order.indexOf(search.filter ?? 'active') + 1) % order.length] });
    },
  };
}

export type ReviewThreadActions = ReturnType<typeof useReviewThreadActions>;

/**
 * Lets go of the note in focus (`?note=`) once the panel no longer shows it: deleted, or resolved out of the list.
 * Not before the threads first load, when nothing shows yet.
 */
export function useReviewNoteFocusRelease(shown: readonly PlacedReviewThread[] | undefined) {
  const { search, setSearch } = useReviewThreadScope();
  const gone = shown !== undefined && search.note !== undefined && !shown.some((t) => t.id === search.note);
  useEffect(() => {
    if (gone) setSearch({ note: undefined });
  }, [gone, setSearch]);
}

/** The last note at or before `frame`, as a lyric sheet follows its song. */
function reviewThreadAt(placed: readonly PlacedReviewThread[], frame: number): number | null {
  let at: number | null = null;
  for (const thread of placed) {
    const from = reviewThreadFrameOf(thread);
    if (from !== undefined && from <= frame) at = thread.id;
  }
  return at;
}

const NO_PLAYBACK_SUBSCRIPTION = () => () => undefined;

/**
 * The live list: the row under the playhead (scrolled to unless the reader scrolled within 3 s), and the rows whose
 * agent reply just landed. While playing, the clock is polled, and the panel renders only when the row changes.
 * Without a clock (a decision's thread) no row is under the playhead.
 */
export function useReviewThreadLive(placed: readonly PlacedReviewThread[], playback: ReviewPlayback | undefined) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const manualScrollAt = useRef(0);
  const subscribe = playback?.subscribe ?? NO_PLAYBACK_SUBSCRIPTION;
  const playing = useSyncExternalStore(subscribe, () => playback?.getState().playing ?? false);
  const settled = useSyncExternalStore(subscribe, () => playback?.getState().frame);
  const [playingAt, setPlayingAt] = useState<number | null>(null);
  const settledAt = settled === undefined ? null : reviewThreadAt(placed, settled);
  const currentId = playing ? playingAt : settledAt;

  useEffect(() => {
    if (!playing || !playback) return undefined;
    const poll = () => setPlayingAt(reviewThreadAt(placed, playback.frameNow()));
    poll();
    const timer = setInterval(poll, REVIEW_FOLLOW_POLL_MS);
    return () => clearInterval(timer);
  }, [playing, placed, playback]);

  useEffect(() => {
    if (currentId === null || Date.now() - manualScrollAt.current < REVIEW_MANUAL_SCROLL_HOLD_MS) return;
    viewportRef.current?.querySelector(`[data-thread-id="${currentId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  return { currentId, viewportRef, flashing: useReviewReplyFlash(placed), markManualScroll: () => { manualScrollAt.current = Date.now(); } };
}

/** Threads whose newest entry is an agent's that arrived since the last look, lit for a second. Not on first load. */
function useReviewReplyFlash(threads: readonly PlacedReviewThread[]): ReadonlySet<number> {
  const seen = useRef<Map<number, number> | null>(null);
  const [flashing, setFlashing] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(threads.map((t) => [t.id, t.entries.length]));
    if (!before) return undefined;
    const landed = threads.filter((t) => t.entries.length > (before.get(t.id) ?? t.entries.length) && t.entries.at(-1)?.author === 'agent').map((t) => t.id);
    if (!landed.length) return undefined;
    setFlashing((current) => new Set([...current, ...landed]));
    // Not cleared with the effect: the next revision can land inside the second, and the light must still go out.
    setTimeout(() => setFlashing((current) => new Set([...current].filter((id) => !landed.includes(id)))), REVIEW_FLASH_MS);
    return undefined;
  }, [threads]);
  return flashing;
}
