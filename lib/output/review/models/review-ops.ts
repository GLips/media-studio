// review-ops.ts: every change to review/review.json, as an op. The page and the CLI both send ops, and the engine
// applies them to the newest file under its lock (lib/output/review/engine/review-file.ts), so two writers never
// clobber each other: ops name threads by id and re-apply cleanly onto whatever landed first. The one true conflict is
// an edit to a note someone else edited since it was loaded.
//
// Who may do what is checked here, not by the channel: the agent opens, replies, asks and marks addressed; only the
// reviewer resolves, reopens, deletes, picks and signs off.
import {
  emptyReviewFile, type ReviewAnchor, type ReviewAuthor, type ReviewCandidate, type ReviewDecision, type ReviewEntry, type ReviewEntryCommit,
  type ReviewEntryRender, type ReviewFile, type ReviewSignoff, type ReviewThread, type ReviewThreadKind, type ReviewWrittenOn,
} from './review-threads.ts';

/** The render a new note is on, before the engine adds the commit its snapshot records. */
export type ReviewRenderRef = Pick<ReviewWrittenOn, 'path' | 'hash'>;

type UnstampedAnchor<A> = A extends { writtenOn: ReviewWrittenOn } ? Omit<A, 'writtenOn' | 'image'> & { writtenOn: ReviewRenderRef } : A;
/** An anchor as a client sends it: the image travels as the op's bytes and the commit is filled from the snapshot. */
export type NewAnchor = UnstampedAnchor<ReviewAnchor>;

export type NewDecision = Pick<ReviewDecision, 'topic' | 'question' | 'choose' | 'about'> & { candidates: Omit<ReviewCandidate, 'verdict'>[] };

/**
 * One change. `image` is the frame as composed in the browser, JPEG or PNG. `thread.edit`'s `ifRev` is the file
 * revision the editor loaded the note at: it conflicts only when the note itself (text, kind, anchor) changed after
 * that, so a reply landing meanwhile doesn't.
 */
export type ReviewOp =
  | { op: 'thread.add'; kind: ReviewThreadKind; anchor: NewAnchor; text: string; image?: Uint8Array }
  | { op: 'thread.edit'; id: number; ifRev: number; text?: string; kind?: ReviewThreadKind; anchor?: Partial<NewAnchor>; image?: Uint8Array }
  | {
    op: 'thread.reply'; id: number; text: string; transition?: ReviewEntry['transition']; asks?: true; commit?: ReviewEntryCommit;
    render?: ReviewEntryRender;
  }
  | { op: 'thread.resolveAddressed'; ids: number[] }
  | { op: 'thread.takeBack'; id: number }
  | { op: 'thread.delete'; id: number }
  | { op: 'thread.restore'; thread: ReviewThread; image?: Uint8Array }
  | { op: 'decision.put'; decision: NewDecision }
  | { op: 'decision.verdict'; id: number; candidate: string; verdict: 'pick' | 'reject' | null }
  | { op: 'decision.close'; id: number }
  | { op: 'signoff'; signoff: ReviewSignoff };

/** The file after the ops, and the frame images to write and delete (project-relative) with it. `changed` holds ids. */
export type ReviewOpsApplied = { file: ReviewFile; writes: { path: string; bytes: Uint8Array }[]; deletes: string[]; changed: number[] };
/** A stale `thread.edit`: nothing was applied, and `conflict` is the note as it stands. */
export type ReviewOpsConflict = { conflict: ReviewThread; revision: number };

export type ReviewOpsContext = { author: ReviewAuthor; now: string; writtenOnOf: (render: ReviewRenderRef) => ReviewWrittenOn };

/** An op its author may not make, or that the file can't take; the message is a sentence for the person who sent it. */
export class ReviewOpRefused extends Error {
  override readonly name = 'ReviewOpRefused';
}

type Applying = ReviewOpsContext & {
  file: ReviewFile;
  rev: number;
  writes: Map<string, Uint8Array>;
  deletes: Set<string>;
  changed: Set<number>;
};

/**
 * Applies `ops` in order, each one revision, all or none: a refusal throws ReviewOpRefused and a stale edit returns
 * the conflict, either leaving `file` as it was.
 */
export function applyReviewOpsToFile(file: ReviewFile, ops: readonly ReviewOp[], context: ReviewOpsContext): ReviewOpsApplied | ReviewOpsConflict {
  const at: Applying = { ...context, file: structuredClone(file), rev: file.revision, writes: new Map(), deletes: new Set(), changed: new Set() };
  for (const op of ops) {
    at.rev += 1;
    const conflict = applyReviewOp(at, op);
    if (conflict) return { conflict: file.threads.find((t) => t.id === conflict.id) ?? conflict, revision: file.revision };
    at.file.revision = at.rev;
  }
  return { file: at.file, writes: [...at.writes].map(([path, bytes]) => ({ path, bytes })), deletes: [...at.deletes], changed: [...at.changed] };
}

/** Returns the thread a stale edit conflicts with, else nothing. */
function applyReviewOp(at: Applying, op: ReviewOp): ReviewThread | undefined {
  switch (op.op) {
    case 'thread.edit': return editReviewThread(at, op);
    case 'thread.add': addReviewThread(at, op); break;
    case 'thread.reply': replyToReviewThread(at, op); break;
    case 'thread.resolveAddressed': resolveAddressedReviewThreads(at, op.ids); break;
    case 'thread.takeBack': takeBackReviewTransition(at, op.id); break;
    case 'thread.delete': deleteReviewThread(at, op.id); break;
    case 'thread.restore': restoreReviewThread(at, op.thread, op.image); break;
    case 'decision.put': putReviewDecision(at, op.decision); break;
    case 'decision.verdict': setReviewVerdict(at, op); break;
    case 'decision.close': closeReviewDecision(at, op.id); break;
    case 'signoff': signOffReview(at, op.signoff); break;
  }
  return undefined;
}

const refuse = (sentence: string): never => { throw new ReviewOpRefused(sentence); };
const reviewerOnly = (at: Applying, what: string) => { if (at.author !== 'reviewer') refuse(`only the reviewer ${what}`); };

function threadOf(at: Applying, id: number): ReviewThread {
  return at.file.threads.find((t) => t.id === id) ?? refuse(`there's no thread #${id}`);
}

function openDecisionOf(at: Applying, id: number): ReviewDecision {
  const decision = at.file.decisions.find((d) => d.id === id) ?? refuse(`there's no decision #${id}`);
  return decision.state === 'open' ? decision : refuse(`decision #${id} is ${decision.state}`);
}

// A PNG starts with \x89PNG; the browser sends PNG only for a transparent render, JPEG otherwise.
const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
const frameImagePathOf = (id: number, bytes: Uint8Array) => `review/frames/${id}.${isPng(bytes) ? 'png' : 'jpg'}`;

function writeFrameImage(at: Applying, path: string, bytes: Uint8Array) {
  at.deletes.delete(path);
  at.writes.set(path, bytes);
}

function deleteFrameImage(at: Applying, path: string | undefined) {
  if (!path) return;
  at.writes.delete(path);
  at.deletes.add(path);
}

/** A video or still anchor's `image`, read across the anchor union. */
const imageOf = (anchor: ReviewAnchor) => (anchor.on === 'video' || anchor.on === 'still' ? anchor.image : undefined);

function stampedAnchorOf(at: Applying, anchor: NewAnchor, image: string | undefined): ReviewAnchor {
  if (anchor.on === 'video' || anchor.on === 'still') return { ...anchor, writtenOn: at.writtenOnOf(anchor.writtenOn), ...(image && { image }) };
  if (image) refuse('only a note on a video or a still has a frame image');
  if (anchor.on === 'decision' && !at.file.decisions.some((d) => d.id === anchor.decision)) refuse(`there's no decision #${anchor.decision}`);
  return anchor;
}

function touch(at: Applying, thread: ReviewThread) {
  thread.rev = at.rev;
  at.changed.add(thread.id);
}

function addReviewThread(at: Applying, op: Extract<ReviewOp, { op: 'thread.add' }>) {
  if (!op.text.trim()) refuse('a note needs text');
  const id = at.file.nextId;
  const image = op.image && frameImagePathOf(id, op.image);
  // An agent opens a thread only to ask something, so it starts waiting on the reviewer.
  const entry: ReviewEntry = { author: at.author, text: op.text, at: at.now, rev: at.rev, ...(at.author === 'agent' && { asks: true as const }) };
  const thread: ReviewThread = { id, kind: op.kind, state: 'open', rev: at.rev, anchor: stampedAnchorOf(at, op.anchor, image), entries: [entry] };
  if (op.image && image) writeFrameImage(at, image, op.image);
  at.file.nextId = id + 1;
  at.file.threads.push(thread);
  at.changed.add(id);
}

function editReviewThread(at: Applying, op: Extract<ReviewOp, { op: 'thread.edit' }>): ReviewThread | undefined {
  const thread = threadOf(at, op.id), note = thread.entries[0];
  if (note.author !== at.author) refuse(`only its author edits #${op.id}; reply to it instead`);
  if (note.rev > op.ifRev) return thread;
  if (op.text !== undefined) {
    if (!op.text.trim()) refuse('a note needs text');
    note.text = op.text;
  }
  if (op.kind) thread.kind = op.kind;
  const before = imageOf(thread.anchor);
  if (op.anchor) {
    if (op.anchor.on !== undefined && op.anchor.on !== thread.anchor.on) refuse(`#${op.id} is on the ${thread.anchor.on}: a new place needs a new note`);
    const writtenOn = 'writtenOn' in op.anchor && op.anchor.writtenOn ? { writtenOn: at.writtenOnOf(op.anchor.writtenOn) } : {};
    // SAFETY: `on` matched above, so the patch's fields belong to the anchor's own variant.
    thread.anchor = { ...thread.anchor, ...op.anchor, ...writtenOn } as ReviewAnchor;
  }
  if (op.image) {
    const anchor = thread.anchor;
    if (anchor.on !== 'video' && anchor.on !== 'still') return refuse('only a note on a video or a still has a frame image');
    const image = frameImagePathOf(thread.id, op.image);
    thread.anchor = { ...anchor, image };
    if (before !== image) deleteFrameImage(at, before);
    writeFrameImage(at, image, op.image);
  }
  note.rev = at.rev;
  touch(at, thread);
  return undefined;
}

function replyToReviewThread(at: Applying, op: Extract<ReviewOp, { op: 'thread.reply' }>) {
  const thread = threadOf(at, op.id);
  let transition = op.transition;
  if (at.author === 'agent') {
    if (transition === 'resolved' || transition === 'reopened') refuse(`only the reviewer resolves or reopens #${op.id}; reply --addressed once it's fixed`);
    if (transition && op.asks) refuse('a reply either asks or marks the note addressed, not both');
    if (transition === 'addressed' && thread.kind === 'keep') refuse(`#${op.id} is a keep: a standing constraint, with nothing to address`);
    // Addressed again is a fresh fix (a new render after more thought) on a note still waiting on the reviewer.
    if (transition === 'addressed' && thread.state === 'resolved') refuse(`#${op.id} is resolved already`);
  } else {
    if (transition === 'addressed') refuse('the agent marks a note addressed; resolve it instead');
    if (op.asks) refuse('a question from the reviewer is a note of kind question');
    // Answering an addressed note means it isn't done.
    if (!transition && thread.state === 'addressed') transition = 'reopened';
    const moves = transition === 'resolved' ? thread.state !== 'resolved' : transition === 'reopened' && (thread.state === 'addressed' || thread.state === 'resolved');
    if (!moves) transition = undefined;
  }
  if (!op.text.trim() && !transition) refuse('a reply needs text');
  if (op.render) refuseReplyRender(op.render);
  thread.entries.push({
    author: at.author, text: op.text, at: at.now, rev: at.rev,
    ...(op.commit && { commit: op.commit }), ...(op.render && { render: op.render }), ...(transition && { transition }), ...(op.asks && { asks: true as const }),
  });
  if (transition) thread.state = transition;
  touch(at, thread);
}

/** A render hash as renderFileStamp gives it: the first 10 hex digits of the file's SHA-256. */
const RENDER_HASH = /^[0-9a-f]{10}$/;

// The page opens a reply's render by its path, so it must be a plain path inside the project; the CLI and the page are
// both clients, so this is checked here, where every op lands. Normal form only (no `.`), so it matches the
// `render.path` its archived versions record.
function refuseReplyRender({ path, hash }: ReviewEntryRender) {
  if (path.startsWith('/') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) refuse(`${path} isn't a render's path inside the project`);
  if (!RENDER_HASH.test(hash)) refuse(`${hash} isn't a render's hash (10 hex digits)`);
}

/** Resolves those of `ids` still addressed: the rest moved on since the reviewer looked, so they're left as they are. */
function resolveAddressedReviewThreads(at: Applying, ids: readonly number[]) {
  reviewerOnly(at, 'resolves notes');
  for (const thread of at.file.threads) {
    if (!ids.includes(thread.id) || thread.state !== 'addressed') continue;
    thread.entries.push({ author: at.author, text: '', at: at.now, rev: at.rev, transition: 'resolved' });
    thread.state = 'resolved';
    touch(at, thread);
  }
}

/**
 * Undoes the reviewer's bare resolve or reopen, the thread's last entry: the entry goes and the state is the one the
 * entries before it left. Anything said since (an agent's reply) means the moment has passed, and nothing changes.
 */
function takeBackReviewTransition(at: Applying, id: number) {
  reviewerOnly(at, 'takes back a resolve or reopen');
  const thread = threadOf(at, id);
  const last = thread.entries.at(-1);
  if (!last || last.author !== 'reviewer' || !last.transition || last.text.trim() || thread.entries.length < 2) return;
  thread.entries.pop();
  thread.state = thread.entries.findLast((e) => e.transition)?.transition ?? 'open';
  touch(at, thread);
}

// Deleting a thread that's gone, or restoring one that's back, does nothing: two tabs can send the same.
function deleteReviewThread(at: Applying, id: number) {
  reviewerOnly(at, 'deletes notes');
  const thread = at.file.threads.find((t) => t.id === id);
  if (!thread) return;
  at.file.threads = at.file.threads.filter((t) => t !== thread);
  deleteFrameImage(at, imageOf(thread.anchor));
  at.changed.add(id);
}

// The image path is rebuilt from the id, never taken from the client: a later delete removes whatever path is stored.
function restoredAnchorOf(at: Applying, thread: ReviewThread, bytes: Uint8Array | undefined): ReviewAnchor {
  const anchor = thread.anchor;
  if (anchor.on !== 'video' && anchor.on !== 'still') return anchor;
  const { image: _sent, ...rest } = anchor;
  if (!bytes) return rest;
  const image = frameImagePathOf(thread.id, bytes);
  writeFrameImage(at, image, bytes);
  return { ...rest, image };
}

function restoreReviewThread(at: Applying, thread: ReviewThread, bytes: Uint8Array | undefined) {
  reviewerOnly(at, 'restores notes');
  if (at.file.threads.some((t) => t.id === thread.id)) return;
  // A restored reply's render pins its hash in the archive (reviewReferencedHashes), so it's held to a reply's rules.
  for (const { render } of thread.entries) if (render) refuseReplyRender(render);
  at.file.threads.push({ ...thread, anchor: restoredAnchorOf(at, thread, bytes), rev: at.rev });
  at.file.nextId = Math.max(at.file.nextId, thread.id + 1);
  at.changed.add(thread.id);
}

/**
 * Posts a decision, or re-posts the open one on its topic: its candidates replaced, keeping the verdict on any the
 * reviewer already judged that come back unchanged.
 */
function putReviewDecision(at: Applying, decision: NewDecision) {
  const keys = decision.candidates.map((c) => c.key);
  if (keys.length < 2) refuse('a decision needs two candidates or more');
  if (new Set(keys).size !== keys.length) refuse(`each candidate needs its own key: ${keys.join(', ')}`);
  const open = at.file.decisions.find((d) => d.topic === decision.topic && d.state === 'open');
  const verdictOf = (c: NewDecision['candidates'][number]) => {
    const was = open?.candidates.find((o) => o.key === c.key && o.media?.hash === c.media?.hash && o.text === c.text);
    return was?.verdict ? { verdict: was.verdict } : {};
  };
  const candidates = decision.candidates.map((c) => ({ ...c, ...verdictOf(c) }));
  const fields = { topic: decision.topic, question: decision.question, choose: decision.choose, ...(decision.about && { about: decision.about }), candidates };
  const id = open?.id ?? at.file.nextId;
  const posted: ReviewDecision = { id, ...fields, state: 'open', rev: at.rev, at: open?.at ?? at.now };
  if (open) at.file.decisions = at.file.decisions.map((d) => (d === open ? posted : d));
  else {
    at.file.nextId = id + 1;
    at.file.decisions.push(posted);
  }
  at.changed.add(id);
}

function setReviewVerdict(at: Applying, op: Extract<ReviewOp, { op: 'decision.verdict' }>) {
  reviewerOnly(at, 'picks and rejects candidates');
  const decision = openDecisionOf(at, op.id);
  const candidate = decision.candidates.find((c) => c.key === op.candidate) ?? refuse(`decision #${op.id} has no candidate ${op.candidate}`);
  // Choosing one: a pick takes the pick from whichever candidate had it.
  if (op.verdict === 'pick' && decision.choose === 'one') for (const c of decision.candidates) if (c.verdict === 'pick') delete c.verdict;
  if (op.verdict) candidate.verdict = op.verdict;
  else delete candidate.verdict;
  decision.rev = at.rev;
  at.changed.add(decision.id);
}

function closeReviewDecision(at: Applying, id: number) {
  reviewerOnly(at, 'signs off a decision');
  const decision = openDecisionOf(at, id);
  const picks = decision.candidates.filter((c) => c.verdict === 'pick').map((c) => c.key);
  if (decision.choose === 'one' && picks.length === 0) refuse(`decision #${id} asks for one: pick a candidate before signing off`);
  decision.state = 'decided';
  decision.decided = { picks, at: at.now };
  decision.rev = at.rev;
  at.changed.add(id);
}

/** A sign-off replaces the last on the same thing: a plan scene, or a render's path. */
function signOffReview(at: Applying, signoff: ReviewSignoff) {
  reviewerOnly(at, 'signs off');
  const same = (s: ReviewSignoff) => (s.on === 'plan' ? signoff.on === 'plan' && s.scene === signoff.scene : signoff.on === 'render' && s.path === signoff.path);
  at.file.signoffs = [...at.file.signoffs.filter((s) => !same(s)), signoff];
}

/**
 * Why `decision` won't take `ops` from the reviewer now (it's closed, nothing is picked), by the rules the engine
 * applies; null when it will. The decisions screen asks before it sends, and disables what would be refused.
 */
export function reviewDecisionRefusalOf(decision: ReviewDecision, ops: readonly ReviewOp[]): string | null {
  const file: ReviewFile = { ...emptyReviewFile(), revision: decision.rev, nextId: decision.id + 1, decisions: [decision] };
  try {
    applyReviewOpsToFile(file, ops, { author: 'reviewer', now: decision.at, writtenOnOf: (render) => render });
    return null;
  } catch (error) {
    if (error instanceof ReviewOpRefused) return error.message;
    throw error;
  }
}
