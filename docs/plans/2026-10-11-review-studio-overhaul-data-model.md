# Review studio overhaul: data-model (design input to the plan)

# Review studio: design for the data model and agent loop

I checked this against the current models, engine, CLI, snapshot and the real notes files. The motion-showcase animatic notes sit in `notes-wip.animatic.json`, and `notes-video.json` never sees them. That is the strongest argument for keeping notes per project.

## 0. Recommendation: one review file per project, one thread primitive

Notes, decision feedback, script notes and sign-offs all share one `ReviewThread` primitive. They live in a single file per project, `review/review.json`, behind one revision counter, one lock, one live poll and one `watch`.

- **Why one file:**
  - The agent cursor is a single integer.
  - One op can resolve a thread and record a pick atomically.
  - The page polls one stat.
- **Size:** hundreds of threads come to tens of kB, and contention under the lock is a matter of milliseconds.
- **Not in this file:** candidate media lives in `out/decisions/<topic>/`, not under `review/`, because `review/` is committed.
- **Old `review/notes-*.json` files:** nothing reads them, and `reviewNotesPathOf` is removed. The implementer deletes them only in the `zz-review-sandbox*` clones. The ones in Graham's projects get listed for him to delete. We don't touch them.

```ts
// lib/output/review/models/review-threads.ts
export const REVIEW_FILE_VERSION = 1;
export type ReviewAuthor = 'reviewer' | 'agent';   // set by the channel: page = reviewer, CLI = agent
export type ReviewThreadState = 'open' | 'addressed' | 'resolved' | 'reopened';
export type ReviewThreadKind = 'fix' | 'question' | 'keep';

export type ReviewFile = {
  version: typeof REVIEW_FILE_VERSION;
  revision: number;          // +1 per applied op; the If-Match value and the watch cursor
  nextId: number;            // short ids: 1, 2, 3… shared by threads and decisions ("#12")
  threads: ReviewThread[];
  decisions: ReviewDecision[];
  signoffs: ReviewSignoff[];
};

export type ReviewThread = {
  id: number;
  kind: ReviewThreadKind;
  state: ReviewThreadState;
  rev: number;               // file revision this thread last changed at
  anchor: ReviewAnchor;
  entries: ReviewEntry[];    // entries[0] is the note itself
};

export type ReviewEntry = {
  author: ReviewAuthor; text: string; at: string; rev: number;
  commit?: { engine: string; workspace?: string };   // `--commit HEAD`, resolved to hashes
  render?: string;                                   // render hash the agent says shows the fix
  transition?: Exclude<ReviewThreadState, 'open'>;
  asks?: true;                                       // agent question: waiting on the reviewer
};
```

## 1. Notes v2: anchors and placement

```ts
export type ReviewPoint = { x: number; y: number };          // 0–1
export type ReviewMark =
  | { kind: 'arrow'; from: ReviewPoint; to: ReviewPoint }
  | { kind: 'ellipse'; c: ReviewPoint; rx: number; ry: number }
  | { kind: 'path'; points: ReviewPoint[] };                  // simplified on save

export type ReviewWrittenOn = {
  path: string; hash: string;                                 // never rewritten
  commit?: { engine: GitState; workspace: GitState | null };  // copied from that render's snapshot
};

export type ReviewAnchor =
  | { on: 'video'; writtenOn: ReviewWrittenOn; frame: number; end?: number; point?: ReviewPoint;
      marks?: ReviewMark[]; cue?: string; moment?: ReviewMoment; image: string }
  | { on: 'still'; writtenOn: ReviewWrittenOn; point?: ReviewPoint; marks?: ReviewMark[];
      cell?: string; image: string }
  | { on: 'script'; scriptHash: string; line: string; word?: number; wordEnd?: number;
      text?: string; take?: string }
  | { on: 'decision'; decision: number; candidate?: string }
  | { on: 'project' };
```

**Where a note shows:** a video note appears on every video render of the project (animatic, wip slices, final, either half of a transparent pair). Each project has one video composition (`video.tsx`). Still notes key on still `path`, and on a variant sheet they key on `cell` (the variant name).

**Placement is computed on read and never stored:**

```ts
type ReviewPlacement =
  | { frame: number; end?: number; shifted: boolean }
  | { unplaced: string };
```

- With a moment, `placeReviewMoment` places the note.
- A note without a moment (no snapshot) places only on the same `hash`.
- Because `writtenOn` is never rewritten, a carried-over note can't pass for a fresh one.
- This fixes the restamp bug and removes `movedFrom`.

**State machine:**

| from → to | who |
|---|---|
| open/reopened → addressed | agent (reply `--addressed`) |
| addressed → resolved | reviewer |
| any → resolved | reviewer (dismiss) |
| addressed/resolved → reopened | reviewer (a reply on an addressed note reopens it by default) |
| delete | reviewer only; the page keeps an undo through a `restore` op |

- Agents can never resolve or reopen.
- `kind: 'keep'` threads have no lifecycle for the agent. They are always listed as standing constraints until the reviewer resolves or deletes them, and they never wake `watch`.
- "Waiting on" is derived: the last entry carries `asks` → waiting on the reviewer; otherwise an open or reopened thread is waiting on the agent.
- The page hides resolved threads by default. "Clear resolved" deletes them in bulk, which is the answer to Graham deleting notes one at a time.

## 2. Concurrency and live updates

**All writes are operations** applied by one engine function. The page's server function and the CLI both call it.

```ts
export type ReviewOp =
  | { op: 'thread.add'; kind: ReviewThreadKind; anchor: NewAnchor; text: string; image?: Uint8Array }
  | { op: 'thread.edit'; id: number; ifRev: number; text?: string; kind?: ReviewThreadKind; anchor?: Partial<NewAnchor>; image?: Uint8Array }
  | { op: 'thread.reply'; id: number; text: string; transition?: ReviewEntry['transition']; asks?: true; commit?: string; render?: string }
  | { op: 'thread.resolveAddressed'; ids: number[] }
  | { op: 'thread.delete'; id: number } | { op: 'thread.restore'; thread: ReviewThread }
  | { op: 'decision.put'; decision: NewDecision } | { op: 'decision.verdict'; id: number; candidate: string; verdict: 'pick' | 'reject' | null }
  | { op: 'decision.close'; id: number } | { op: 'signoff'; signoff: ReviewSignoff };

applyReviewOps(project, ops, author): { revision: number; file: ReviewFile }
  | { conflict: ReviewThread; revision: number }   // HTTP 409 from the server fn
```

- **Writing:** the engine takes the lock `review/review.json.lock` (`open wx`, retried every 5 ms for up to 2 s, treated as stale after 10 s), reads the latest file, checks author rights and transitions, applies the ops, bumps `revision`, writes to a temp file and renames it over.
- **Conflicts:** ops are id-targeted, so they rebase themselves server-side onto the latest file. That is the brief's "re-read and re-apply", done once under the lock.
- **The only true conflict** is `thread.edit` when `ifRev` no longer matches, meaning another tab edited the same note. That returns 409 with the current thread, and the page keeps the user's text in the composer and shows both versions.
- **Instead of If-Match on the whole file:** the client never sends the whole list again.

**How the page learns of outside changes: polling, not SSE.**

- The existing 2 s status query becomes 1 s and returns `reviewRevision`, read from mtime with a cached parse.
- When the revision changes, the page refetches the `review-threads` query (placed against the loaded render) and keeps local drafts.
- Why polling: CLI writes happen without the server, polling survives server restarts and tab sleep, `fs.watch` on macOS loses rename-replaced files, and the cost is one `stat` a second.

**`studio review watch <p>`:**

- **Cursor:** `--since N` if given, otherwise the named cursor `review/.cursors/<--as agent>` (git-ignored). A run never re-prints what it already showed, and never misses changes made while the agent was busy.
- **Blocking:** it blocks by polling at 300 ms until a thread or decision has `rev > cursor` with a reviewer-authored change. The agent's own replies don't wake it.
- **Settle:** after the first change it waits for `--settle 3s` of quiet, so a burst of notes arrives as one batch.
- **Output:** the changed items in the same markdown as `notes`. It saves the cursor, prints `next: studio review watch <p>`, and exits 0.
- **Timeout:** `--timeout <dur>` defaults to none. On timeout it exits 2 with `no change since rN`.

## 3. CLI surface (`cli/commands/review/*`)

```
studio review <target> [--port] [--no-open]                      # unchanged opener
studio review notes <p> [--all|--state open,reopened (default)] [--on video|still|script|decision]
                        [--render out/video.mp4 (default newest)] [--since N] [--json]
studio review watch <p> [--as agent] [--since N] [--settle 3s] [--timeout 30m] [--json]
studio review reply <p> <id> "text" [--addressed|--question] [--commit HEAD] [--render out/video.mp4]
studio review ask <p> "text" [--at f120[:140] | --line <id>[:word] | --still <path>]  # agent-opened thread, asks
studio review decide <p> --spec <file|-> | <p> <topic> --question "…" --candidate <path|text:…>[=label] … [--many]
studio review decisions <p> [--open] [--json]
```

- There is no `resolve` command, and `reply` refuses resolve or reopen.
- `--json` emits `{ revision, threads: (ReviewThread & { placement })[], decisions }`.

**Markdown for one item:**

```
### #12 fix · open · bar 4 · final · beat 2 · ink.strike2 — f266 (0:08.87) on out/video.mp4 `a1b2c3d4e5`
written on out/wip/animatic.mp4 `cfbb1d2063` (workspace 3f2e1a0, engine c2f33d9) · now f270 (+4)
point (941, 530) px of 1920×1080 · under it: `ink/needle` · sound buzz.strike `ink/needle-strike-2` f267
scene source: work/projects/2026-09-motion-showcase/bars/ink.tsx
frame: work/projects/2026-09-motion-showcase/review/frames/12.jpg
look: studio look 2026-09-motion-showcase --video out/video.mp4 --frames 263:277 --crop 741,380,400,300

The second strike lands soft…

  > agent (r41, commit 9ac1e2f): …
```

- **Paths:** repo-relative, so an agent can `Read` them from any working directory.
- **Paragraphs:** kept intact (no `\n` flattening).
- **Keep threads:** a `## Keep` section always lists them.

## 4. Frame images

- **Who cuts them:** the browser composes the image at the moment of `thread.add` or `edit`, using the paused `<video>`/`<img>` at native size plus the same mark renderer the stage uses, and sends it inside the op.
- **Why not server-side ffmpeg:** the browser image is exactly what Graham saw, and burning freehand vectors in ffmpeg is fragile.
- **Format:** JPEG q0.85, or PNG for transparent renders.
- **Storage:** `review/frames/<id>.(jpg|png)`, written and deleted inside the same locked op. `restore` re-sends the image.
- **Which frame:** the `writtenOn` frame, which is a range's first frame. To see the current render, agents use the `look:` line.

## 5. Render history

- **Location:** `out/.history/<hash>/<file>` plus its `<name>.snapshot.json`.
- **Cost:** copies use `copyFileSync(…, COPYFILE_FICLONE)`, which is a free clone on APFS.
- **Who writes:**
  - `studio render` archives after `writeRenderSnapshot`.
  - `applyReviewOps` archives any `writtenOn.hash` that is still on disk and not yet archived, so files replaced outside `studio render` are covered too.
- **Snapshot changes** (`RENDER_SNAPSHOT_VERSION` becomes 11):
  - `render.path` (project-relative), so the history can list versions by path.
  - `source: { engine: GitState; workspace: GitState | null }`, from `gitState`.
- **Pruning** happens at the end of `studio render`:
  - It keeps the last 8 versions per path, plus every hash referenced by a thread's `writtenOn` or a decision candidate.
  - Unreferenced versions over 5 GB per project are dropped oldest first.

## 6. Decisions

```ts
export type ReviewDecision = {
  id: number; topic: string; question: string; choose: 'one' | 'many';
  state: 'open' | 'decided' | 'withdrawn'; rev: number; at: string;
  about?: { scene?: string; moment?: ReviewMoment; line?: string };
  candidates: ReviewCandidate[];
  decided?: { picks: string[]; at: string };   // reviewer sign-off
};

export type ReviewCandidate = {
  key: string;            // 'a', 'b', …
  label: string;
  media?: { path: string; kind: 'image' | 'video' | 'audio'; hash: string };
  text?: string;
  meta: Readonly<Record<string, string | number>>;   // model, seed, cost, voice, prompt
  verdict?: 'pick' | 'reject';
};
```

- **Media paths:** project-relative, checked at `decision.put` through `resolveProjectMedia` (the file must be inside the project, a known media type, and its realpath must stay in the project). They are served by the existing `/media/$project` route.
- **Changed files:** if a candidate file's bytes change, its `hash` shows it as stale.
- **Where agents write candidates:** `out/decisions/<topic>/`.
- **Who does what:** verdicts and `decision.close` are reviewer-only. Close requires at least one pick when `choose` is `'one'`.
- **Feedback:** comments on a candidate are threads anchored `{ on: 'decision', candidate }`.
- **Watch:** it wakes on verdicts and on close.

## 7. Script review

- **Anchoring:** threads use `{ on: 'script', line, word, wordEnd, text, scriptHash }`.
- **Placement on an edited script:** by line id, then the same word nearest its old index. This is the existing word logic in `placeReviewMoment`, pulled out as a shared `placeReviewWord`.
- **Takes:** `take` is the hash from `audio/take.json`, so a note can be about a delivery rather than the words.
- **Sign-off:**

```ts
export type ReviewSignoff =
  | { on: 'script'; hash: string; at: string }   // sha256 of voice + [id, text] lines, first 10 hex
  | { on: 'render'; path: string; hash: string; rung?: SceneRung; at: string };
```

  The page and `notes` mark a script sign-off stale when the current script hash differs. Comparing voices ("draft vs paid take", "audition voices") is a decision whose candidates are audio files.

## Implementation notes

- **Where things live:**
  - The models (`review-threads.ts`, `review-ops.ts`, markdown) go in `lib/output/review/models/` and are pure, so the 2–5 tests for ops, transitions and placement live there.
  - The engine pieces (`review-file.ts` for lock and apply, `review-watch.ts`, `review-history.ts`) go in `lib/output/review/engine/`.
- **What gets removed:** `saveReviewNotes`, `submitReviewNotes` (the whole-list save), `ReviewNotesFile`, `movedFrom`/`unplaced`/`render` on notes, and `reviewNotesPathOf`.
- **Skills:** the review paragraph in `skills/video-motion/SKILL.md` (lines 185–190) and the review steps in `video-kickoff`, `stills`, `video-sound` and `video-gen` become one loop: open the review, background `studio review watch`, then `reply --addressed` / `--question` / `ask`, and never resolve.

## Not checked

- `take.json`'s `heard` is keyed by a hash rather than a line id. That's why the script anchor uses the voiceover line ids.
- I assumed `out/` is git-ignored in the workspace, so `.history` and the decision media stay out of git.
- I assumed one video composition per project. motion-showcase also has a `reel.tsx`; if that's a second composition, the snapshot needs a composition id and video anchors would key on it.