# Review studio overhaul: implementation plan

Inputs: the brief (`2026-10-11-review-studio-overhaul-brief.md`), the constraints pass, the data/loop model, the UI spec
(devtool base) and the hotkeys report. Where they disagree, the decisions below win. Specs are cited, not repeated:
"data §2" is the data/loop model, "UI §4" the UI spec.

## Decisions

1. **One file per project:** `review/review.json` (data §0) holds threads, decisions and sign-offs. There is no
   `review/decisions/<topic>.json`. Candidate media go in `out/decisions/<topic>/`, which is git-ignored (verified:
   `work/.gitignore` ignores `projects/*/out/`). Old `review/notes-*.json` files are not read. Delete them only in the
   `zz-review-sandbox*` clones, and list Graham's for him.
2. **Every write is an op** applied by `applyReviewOps` under a lockfile (data §2). The only 409 is a stale `ifRev` on
   `thread.edit`. The pure core returns `{ file, writes, deletes }`, and the engine performs them. `--commit HEAD` is
   resolved to hashes in the CLI before the op is built, so ops carry hashes.
3. **Live updates poll; there is no SSE.** The status query polls every 1 s and returns `reviewRevision`, agent
   presence and the render-in-progress marker.
4. **Agent state lives in `out/.review/watch-<as>.json`** (`{ cursor, since, beat }`). That covers both the watch cursor
   and the `◆` presence heartbeat, beating every 5 s and counting as fresh under 15 s. Because `out/` is ignored, the
   workspace `.gitignore` is not edited.
5. **The browser composes frame images** (data §4) and they are stored at `review/frames/<id>.jpg|png`, which is
   committed. Agent-opened threads (`ask`) have no image, so `image` is optional on video and still anchors.
6. **Snapshot v11** adds `render.path` and `source: { engine, workspace }` from `gitState`. `remote-render` gets the
   source passed in. Old renders read as "render it again", per the no-compat rule.
7. **CLI:** citty can't keep `studio review <target>` beside subcommands, so the opener becomes
   `studio review open <target>`. The old form is dropped and every doc and skill is updated.
8. **Waveform peaks are computed by the review engine on demand**, cached by hash like `review-stills.ts`, through
   `lib/platform/ffmpeg/engine/ffmpeg.ts`. Render never imports review.
9. **The render-in-progress marker** is `lib/output/render/engine/render-progress.ts`, which writes
   `out/.render-progress.json`. Review reads it.
10. **Decisions stay inside the review feature** (models and engine). No new lib feature and no `visibility.json`.
11. **Read-along** reads `timing/voice` (a foundation). `VoiceTakeFile` is exported from
    `lib/timing/voice/models/voice-take.ts`.
12. **Guides** come from a pure `review-guides.ts` in review models, built from `STILL_UI_ZONES`/`STILL_FEED_SIZES` and
    `captionSafeArea`/`captionFreeRect`, plus title/action-safe and thirds defined there. Nothing else in lib defines
    those.
13. **No new npm dependencies.** `node_modules` is the main checkout's (a symlink). Quick-open is `Modal` + `ScrollArea`
    with no `@mantine/spotlight`, and markdown bodies render paragraphs and inline code only.
14. **Validation:** browser ops are validated by an Effect Schema in web controllers. The engine reads `review.json`
    trusting its shape (it is the only writer) and refuses any `version` other than `REVIEW_FILE_VERSION`.
15. **Hotkeys:** we use TanStack Hotkeys 0.10 as described in UI §8.
    - `HotkeysProvider` (with `conflictBehavior: 'error'`) sits in `__root.tsx`.
    - `HotkeyMeta` carries `{ group, name }`.
    - Each package registers its own group's keys in its own hook. The key table in UI §8 is the allocation, and a
      collision throws in dev.
    - `Shift+/` is the cheatsheet and `/` is loop.
16. **`rN`** is the 1-based index of a render among the archived versions of its path, ordered by snapshot time.
17. **Markdown and CLI paths are built from the project slug** (`work/projects/<p>/...`), never from the realpath. That
    fixes the `../media-studio/work` header bug in this worktree.

## Ground rules for every package

- All work happens in `/Users/graham/Programming/media-studio-review`. Write only to `zz-review-sandbox` and
  `zz-review-sandbox-voice`.
- **Own only your listed files.** If you need a change in someone else's file, write it under "Requests" in your final
  report, and wave 2 applies it. Never edit `web/src/features/*/index.ts` or `studio-engine.server.ts` in wave 1: wave 0
  pre-exports everything.
- **Stubs:** wave 0 creates every file a wave-1 package fills, with its final exported signature and a placeholder
  body. A wave-1 owner replaces the body and keeps the signature. Changing a signature is a Request.
- **Done means:**
  - Your files are clean under `npm run lint -- --scope public` and `npm run check:arch -- --scope public` (filter the
    output to your paths, since siblings are mid-edit).
  - `npm run typecheck:gate` and `npm run typecheck:web` show no errors in your files.
  - `npm run test:gate` passes for your specs.
  - Run each command on its own, never chained.
- **The orchestrator runs the full gate at the end of each wave** and commits. Packages don't commit.
- **Code rules:**
  - Comments: under 60 words; `// SAFETY:` on every `as`.
  - No raw primitives, inline styles or non-token values.
  - Under 7 hooks and 8 props per component, and one component per file.
  - Tests are named after their module and live in `lib/`.

---

## Wave 0: foundation (3 packages, parallel)

### P0-M: models

**Goal:** the pure core of threads, ops, placement, markdown, decisions, script anchors and guides.

**Owns**
- `lib/output/review/models/`:
  - `review-threads.ts`, `review-ops.ts`, `review-placement.ts`, `review-markdown.ts`, `review-script.ts`,
    `review-guides.ts`, each with a `.test.ts` where listed below.
  - Edits to `review-notes.ts`, `review-moment.ts`, `review-artifact.ts` and their tests.
- `lib/timing/voice/models/voice-take.ts` (one exported type).

**Provides** (exact names)
- **`review-threads.ts`**
  - Constant: `REVIEW_FILE_VERSION`.
  - Types: `ReviewFile`, `ReviewThread`, `ReviewEntry`, `ReviewAuthor`, `ReviewThreadState`, `ReviewThreadKind`,
    `ReviewAnchor`, `ReviewWrittenOn`, `ReviewPoint`, `ReviewMark`, `ReviewDecision`, `ReviewCandidate`,
    `ReviewSignoff`. Shapes are as in data §0, §1, §6 and §7, except `image?` is optional (Decision 5).
  - `emptyReviewFile()`.
  - `reviewThreadWaitingOn(t): 'reviewer' | 'agent' | null`.
- **`review-ops.ts`**
  - Types: `ReviewOp` (data §2, with `commit?: { engine: string; workspace?: string }`), `NewAnchor`, `NewDecision`,
    `ReviewOpsApplied = { file; writes: { path; bytes }[]; deletes: string[]; changed: number[] }`,
    `ReviewOpsConflict = { conflict: ReviewThread; revision }`.
  - `applyReviewOpsToFile(file, ops, { author, now, writtenOnOf }): ReviewOpsApplied | ReviewOpsConflict`. It enforces
    data §1's state table and §6's reviewer-only verdicts and close, throwing `ReviewOpRefused` with a sentence.
- **`review-placement.ts`**
  - Types: `ReviewPlacement` (data §1), `ReviewPlacementTarget = { hash; path; timing?: ReviewTiming; durationInFrames;
    scriptLines? }`, `PlacedReviewThread = ReviewThread & { placement: ReviewPlacement }`.
  - `placeReviewThread(thread, target)` and `placeReviewWord(...)`. `placeReviewWord` is pulled out of
    `placeReviewMoment`.
- **`review-markdown.ts`**
  - `formatReviewThreadsMarkdown(items: PlacedReviewThread[], { project, renderPath, renderHash, fps, size, states })`
    produces the data §3 layout.
  - Paragraphs are kept, there is a `## Keep` section, and paths are built from the slug.
- **`review-script.ts`**
  - Type: `ReviewScriptLine = { id; text; start?; end?; words?: SpokenWord[] }`.
  - `reviewScriptSignoffStale(signoffs, currentHash)`. The hash itself (sha256 of voice + `[id, text]` lines, first
    10 hex) is computed in the engine (`review-script-source.ts`, P-R), so models stay free of `node:crypto`.
- **`review-guides.ts`**: `ReviewGuideSet = 'safe' | 'platform' | 'thirds'` and
  `reviewGuidesFor(set, { w, h, platform? }): ReviewGuideShape[]`, with shapes as 0–1 rects and lines.
- **`voice-take.ts`**: `VoiceTakeFile`, the `take.json` shape moved from `voice-project.ts`, which then imports it.
  - Line 38 of `lib/timing/voice/engine/voice-project.ts` changes to import it. That one-line edit is owned here.

**Removes**
- `ReviewNote`, `ReviewNotesFile`, `REVIEW_NOTES_VERSION`, `placeReviewNotes`, `reviewNoteRenderOf`,
  `formatReviewNotesMarkdown`, `reviewNotesPathOf` and `movedFrom`.
- `ReviewMomentPlacement`'s `gone` becomes `{ unplaced: string }`.
- Kept: `reviewNoteContext`, `reviewElementsUnder`, `ReviewScene`, `ReviewSoundMarker`, `formatReviewMoment`.

**Tests (5)**
1. Agent `reply --addressed`, then reviewer resolve, succeeds. An agent resolve or reopen throws, and a reviewer reply
   on an addressed thread reopens it.
2. Two ops built on the same stale revision both apply, because they are id-targeted. A `thread.edit` with a stale
   `ifRev` returns a conflict holding the current thread.
3. A note written on the animatic places on the final render with `shifted: true` when the moment moved, and its
   `writtenOn` is unchanged. A note with no moment on another hash becomes `unplaced`.
4. The markdown keeps a two-paragraph note intact, lists only open and reopened notes by default, and always lists
   `keep`.
5. A decision close with `choose: 'one'` and no pick is refused.

### P0-E: engine, server functions, snapshot

**Goal:** locked I/O, the watch, status, the cut queue, snapshot v11, the render-progress marker, and the web
controllers that expose them.

**Owns**
- **Review engine** (`lib/output/review/engine/`):
  - New: `review-file.ts`, `review-watch.ts`, `review-status.ts`, `review-cut-queue.ts`, and `review-file.test.ts` and
    `review-watch.test.ts`.
  - Edits to `review-artifact.ts` (removing the notes save and load).
- **Stubs for wave 1:** `review-peaks.ts`, `review-history.ts`, `review-script-source.ts`, `review-dashboard.ts`.
- **Render engine** (`lib/output/render/engine/`): `render-snapshot.ts`, `render-snapshot.test.ts`, new
  `render-progress.ts`, and the snapshot call sites in `remote-render.ts` (the source is passed in).
- **Web:**
  - `web/src/infrastructure/studio-engine.server.ts`: every re-export, including the stubs.
  - `web/src/features/review/controllers/`: new `review-ops.ts` (server functions), `review-op-schema.ts` and
    `use-review-ops.ts`; edits to `review-queries.ts` and `review-artifact.ts`.
  - Deletes `use-review-notes.ts` and `review-note-schema.ts`.

**Provides**
- **`review-file.ts`**
  - `reviewFilePathOf(projectDir)`.
  - `readReviewFile(project): ReviewFile`.
  - `applyReviewOps(project, ops, author): ReviewOpsApplied | ReviewOpsConflict`. The lock is `wx` with a 5 ms retry,
    a 2 s limit and a 10 s stale age. It writes to a temp file and renames, and writes frames inside the lock. It fills
    `writtenOn.commit` from the render's snapshot `source`.
  - `readPlacedReviewThreads(project, renderPath): { revision; threads: PlacedReviewThread[]; decisions; signoffs }`.
- **`review-watch.ts`**
  - `waitForReviewChange({ project, as, since?, settleMs, timeoutMs? }): { revision; changed: PlacedReviewThread[];
    decisions } | { timeout: number }`.
  - It polls every 300 ms and wakes only on reviewer-authored revisions, never on `keep` threads. It beats presence and
    saves the cursor.
- **`review-status.ts`**: `readReviewStatus(project, path): { revision; render; artifacts; agent?: { since };
  rendering?: { path; startedAt } }`. The revision comes from an mtime-cached parse.
- **`review-cut-queue.ts`**: `runInReviewCutQueue<T>(job): Promise<T>`, with concurrency 2. `review-stills.ts` and
  `still-sheet.ts` adopt it in wave 1 (P-B).
- **`render-progress.ts`**: `writeRenderProgress(projectDir, path)`, `clearRenderProgress(projectDir)` and
  `readRenderProgress(projectDir)`.
- **`render-snapshot.ts`**: `RENDER_SNAPSHOT_VERSION = 11`, and the snapshot gains `render.path` and
  `source: { engine: GitState; workspace: GitState | null }`.
- **Web controllers**
  - Server functions: `applyReviewOpsFn` (returns 409 data on conflict) and `readReviewThreadsFn`.
  - Queries: `reviewStatusQuery` (1 s refetch) and `reviewThreadsQuery(project, path, revision)`.
  - `useReviewOps()` returns `{ apply(ops), pending, failed, retry }`. It is optimistic, has the mutation `scope`, and
    refetches threads when `status.revision` moves.
  - Ops are validated with `.validator(Schema.toStandardSchemaV1(ReviewOpsInput))`.
- **Frame images** are served by the existing `/media/$project` route. Confirm that `resolveProjectMedia` accepts
  `review/frames/*.jpg|png` and extend it if not; `project-media.ts` is owned here.

**Tests (3)**
1. Twenty concurrent `applyReviewOps` calls on a temp project, half reviewer and half agent, end with 20 threads and
   `revision === 20`.
2. `waitForReviewChange` ignores an agent reply, and wakes once on two reviewer adds 1 s apart when the settle is 3 s.
3. A v10 snapshot is refused with "render it again", and a v11 snapshot round-trips `source`.

### P0-C: shell, tokens, hotkeys, URL, playback, draft

**Goal:**
- The app shell and tokens, and the review screen as a layout with slots.
- Hotkey infrastructure, the playback store, the draft store and the search schema.
- A stub for every wave-1 UI file.
- Deletion of the old UI.

**Owns**
- **Tokens:** `web/src/shared/ui/theme.stylex.ts`, per UI §6: removals, re-roles, new colour, size and radius tokens.
- **New in `web/src/shared/ui/`:**
  - Layout and controls: `studio-shell.tsx` (`StudioShell`: a 100dvh grid with a 28px bar, `◂` up, slots), `icon-button.tsx` (`IconButton`), `hotkey-tooltip.tsx` (`HotkeyTooltip { name }`, which looks up `<Kbd>` by `meta.name`), `fade-scroll.tsx` (`FadeScroll`), `skeleton-tile.tsx` (`SkeletonTile { aspect }`).
  - Hotkey support: `hotkey-meta.d.ts` (UI §8 groups plus `dashboard`), `hotkey-cheatsheet.tsx` (`HotkeyCheatsheet`), `use-hotkey-label.ts` (`useHotkeyLabel(name)`), `use-global-hotkeys.ts` (the global group; `Mod+K` opens `QuickOpen`).
  - Stub: `quick-open.tsx` (`QuickOpen { opened, onClose }`).
- **Edits in `web/src/shared/ui/`:** `studio-header.tsx`, `route-error-page.tsx`, `route-pending-page.tsx` and `readout.tsx`, which get the shell with `◂`, skeletons and no bare spinners.
- **Elsewhere in `web/src`:**
  - `web/src/routes/__root.tsx`: adds `HotkeysProvider`.
  - `web/src/routes/projects.$project.artifacts.$.tsx`: `validateSearch`.
- **New in `web/src/features/review/`:**
  - `controllers/review-search.ts`: the Effect search schema `ReviewSearch` with `f note in out r vs cmp w view still
    filter z` (UI §9), plus `useReviewSearch()`, which writes `f`/`w` with `replace`, debounced 150 ms, and pushes
    history for `note`, file, `r` and `view`.
  - `ui/review-screen-context.tsx`: `ReviewScreenProvider` and `useReviewScreen(): { project; artifact; timing;
    status; playback; draft; search; setSearch; mode; setMode }`, where `mode` is `'stage' | 'board' | 'draw'`.
  - `ui/review-playback-store.ts`: `createReviewPlayback(media)` returns a `ReviewPlayback` with `play`, `pause`,
    `toggle`, `seek`, `stepBy`, `shuttle(dir)`, `stop`, `setLoop(range | null)`, `cycleLoopRate`, `muted`, `volume`,
    `subscribe`, `frameNow()`.
    - The rAF loop writes `--review-frame` on the screen root, and React state changes only on pause or seek.
    - `useReviewFrame()` returns that settled frame.
  - `ui/use-review-playback-hotkeys.ts`: the playback group (J/K/L with `requireReset`, K-held step, arrows with
    `shiftKey`, Home/End, I/O, `Alt+X`, `{` `}`, `'` `;`, `/`, `Alt+/`, M, `Alt+Up`/`Alt+Down`).
  - `ui/use-review-draft.ts`: `useReviewDraft()` returns a `ReviewDraft { kind; anchor: Partial<NewAnchor>; text;
    marks }`. Drafts are kept per file in `sessionStorage`, with `setAnchor`, `setText`, `cycleKind`, `addMark`,
    `popMark`, `discard` and `isOpen`.
  - Edits to `ui/review-screen.tsx` (the grid: stage | thread 360, dock below, `Mod+\` collapses the thread, mode
    switch) and `ui/review-header.tsx` (UI §1, including the save-failure-only state; the `copied || saveState` bug
    dies with it), plus `features/review/index.ts`.
- **Stubs it creates, with final props, owned in wave 1:**
  - `ui/review-dock.tsx`: `ReviewDock { lanes?: ReviewLaneId[] }`.
  - `ui/review-stage.tsx`: `ReviewStage`.
  - `ui/review-compare-menu.tsx`: `ReviewCompareMenu`.
  - `ui/review-frame-image.ts`: `composeReviewFrameImage(media, { point?, marks?, transparent }): Promise<Uint8Array>`.
  - `ui/review-board.tsx`: `ReviewBoard`.
  - `ui/review-stills-view.tsx`: `ReviewStillsView`.
  - `ui/review-thread-panel.tsx`: `ReviewThreadPanel { on: ReviewAnchor['on']; decision?: number;
    candidate?: string }`.
  - `ui/review-render-menu.tsx`: `ReviewRenderMenu`.
- **Deletes these old UI files:**
  - `review-banners`, `review-note-list`, `review-note-number`, `review-note-context-lines`, `review-note-format`.
  - `review-composer`, `review-scrubber`, `review-storyboard`, `review-timing-marks`, `review-transport`.
  - `use-review-hotkeys`, `use-review-playback`, `review-scene-rung`.

**Acceptance:**
- The app boots on `zz-review-sandbox` with the shell and empty slots.
- `Shift+/` opens a cheatsheet listing the global and playback groups.
- `?f=120` reloads onto frame 120.
- No page scrolls at 1440×720.

---

## Wave 1: features (8 packages, parallel)

Every package consumes `useReviewScreen()`, `useReviewOps()`, the tokens and `HotkeyTooltip`. Each registers its own
hotkey group in its own hook, per UI §8, and every icon button's tooltip uses `HotkeyTooltip`.

### P-T: timeline dock and waveform

**Owns**
- `web/src/features/review/ui/`: `review-dock.tsx`, and new `review-lane-*.tsx` (ruler, scenes, marks, notes, voice,
  sound), `review-lane-gutter.tsx`, `review-hover-preview.tsx` and `use-review-timeline-hotkeys.ts`.
- `lib/output/review/models/`: new `review-timeline-geometry.ts` and its `.test.ts`.
- `lib/output/review/engine/review-peaks.ts`.
- `web/src/routes/review-peaks.$project.ts` and `web/src/features/review/controllers/review-peaks-response.ts`.

**Builds:** UI §2 (playhead) and §3 (lanes, gutter, zoom, compare cut ticks).
- The whole dock is the scrubber, with `role=slider` and `aria-valuetext` set to the timecode.
- The playhead is CSS on `--review-frame`.
- Peaks go to `out/.review/peaks/<hash>.json` through the cut queue.

**Tests (2):**
1. `timelineGeometry` round-trips frame to x and back at every zoom, and zooming with the pointer keeps the frame under
   the pointer.
2. Beat ticks mark downbeats.

**Acceptance:**
- The playhead is visible at rest on every lane, and a press anywhere in the dock seeks.
- Hovering shows the ghost line and preview.
- No lane appears without data, and no colour appears outside the notes lane.

### P-S: video stage, drawing, compare, frame image

**Owns**
- `web/src/features/review/ui/`: `review-stage.tsx`, `review-compare-menu.tsx`, `review-frame-image.ts`, and new
  `review-stage-marks.tsx`, `review-draw-strip.tsx`, `review-guides-overlay.tsx`, `review-compare-view.tsx`,
  `use-review-stage-zoom.ts` and `use-review-stage-hotkeys.ts` (compare, draw, `Z`, `H`, `D`).

**Builds**
- The stage, fitted and letterboxed. Crosshair clicks pin into the draft.
- Zoom and pan, with `Z` for fit/1:1 and `Space`-drag to pan.
- Guides from `reviewGuidesFor`.
- Draw mode, with `A`, `C`, `P` and `Backspace`.
- Compare (UI §5):
  - Hold `\` to flip, `W` for wipe and `Shift+W` for side by side.
  - Renders are aligned by `placeReviewMoment`.
  - The other render is fetched via `listReviewRenderVersions`, in `review-history.ts` (stubbed by P0-E, filled by P-C).
- `composeReviewFrameImage` draws the paused frame at native size with the same mark renderer as the stage.

**Tests:** none in lib; the logic is in P0-M's guides and placement.

**Acceptance:**
- A 9:16 render fits inside 1440×720.
- Strokes save as 0–1 vectors and reappear in the state colour.
- The saved `review/frames/<id>.jpg` shows the circle and strokes.

### P-B: board, stills and the bounded cut queue

**Owns**
- `web/src/features/review/ui/`: `review-board.tsx`, `review-stills-view.tsx`, and new `review-filmstrip.tsx`,
  `review-still-grid.tsx` and `use-review-board-hotkeys.ts`.
- `lib/output/review/models/`: `review-storyboard.ts` and its test (true aspect).
- `lib/output/review/engine/`: `review-stills.ts` and `still-sheet.ts`, both adopting `runInReviewCutQueue`, and
  keying cuts by hash so a replaced render doesn't 410.
- Edits to `web/src/routes/review-stills.$project.ts` and `controllers/review-still-response.ts`.

**Builds** (UI §5)
- The Board: `B`, skeleton tiles at the true aspect, `Enter`/click seeks back to the stage.
- The stills grid and single view, the filmstrip, and `ArrowLeft`/`ArrowRight` to step.
- The proof-ground `SegmentedControl`.

**Tests (2):**
1. A storyboard of a 9:16 render yields tiles at the 9:16 aspect.
2. The cut queue never runs more than 2 ffmpeg processes at once: a fake job counts how many run concurrently.

### P-N: thread panel

**Owns**
- `web/src/features/review/ui/`: `review-thread-panel.tsx`, and new `review-thread-row.tsx`, `review-thread-filter.tsx`,
  `review-thread-composer.tsx`, `review-thread-unplaced.tsx`, `review-thread-body.tsx`, `use-review-thread-hotkeys.ts`
  (bound to `threadRef`) and `use-review-composer-hotkeys.ts` (bound to `composerRef`).

**Builds:** UI §4.
- **Filter chips:** resolved threads are collapsed by default.
- **Rows:**
  - `r11` appears only when `writtenOn` differs from the current render.
  - Paragraph bodies and replies with the `◆` commit chip.
  - The row under the playhead follows playback (paused after a manual scroll within 3 s).
- **Hover actions** and `X` selection.
- **Bulk:** "Resolve all addressed" (`Shift+E`) and "Clear resolved".
- **Delete:** an inline 6 s Undo and `Mod+Z` via `thread.restore`.
- **Unplaced group:** Re-pin and Resolve.
- **Live updates:** `flash` when a reply lands, and a `caution` rule on agent questions.
- **Composer:**
  - `Tab` cycles the kind, `Mod+Enter` saves, and the image comes from `composeReviewFrameImage`.
  - `Escape` keeps the draft, and only an empty draft discards. The global Esc has `ignoreInputs: true`.
- **`Mod+Shift+C`** copies `formatReviewThreadsMarkdown` (open and reopened).
- **409 handling:** the user's text stays in the composer, and both versions are shown.

**Acceptance:**
- No thread action needs more than one key or click.
- Thirty notes resolve in two keystrokes (`Shift+E`, then "clear resolved").
- Copy excludes resolved notes.

### P-C: CLI, render history, skills

**Owns**
- `cli/commands/review.ts`, which becomes a parent with `subCommands`, and new
  `cli/commands/review/{open,notes,watch,reply,ask,decide,decisions}.ts`.
- `cli/commands/render.ts`: render-progress write/clear, archive and prune calls.
- New `lib/output/render/engine/render-archive.ts` and `render-archive.test.ts`.
- `lib/output/review/engine/review-history.ts` (the stub) and `review-history.test.ts`.
- `web/src/features/review/ui/review-render-menu.tsx`.
- The `SKILL.md` files in `skills/video-motion`, `video-kickoff`, `stills`, `video-sound` and `video-gen`.
- `docs/` mentions of `studio review`, and the review section of `lint/overview.md` if present.

**Builds**
- The data §3 surface, with `open` replacing the bare form (Decision 7), thin commands, lazy imports and
  `refuseUnknownCommandFlags`.
- **`archiveRender(projectDir, file, snapshot)`:** a `COPYFILE_FICLONE` copy into `out/.history/<hash>/`.
- **`pruneRenderArchive(projectDir, keepHashes)`:** keeps the last 8 per path plus every referenced hash, under a 5 GB
  cap.
- **`listReviewRenderVersions(project, path)`** returns `{ r, hash, at, source }[]`.
- **The `r14 ▾` menu.**
- **Skills:** one loop, written once in `video-motion` and referenced by the others.
  1. `studio review open`.
  2. Background `studio review watch` and act on its output.
  3. `reply --addressed` with `--commit HEAD` and `--render`.
  4. `--question` / `ask` when unsure.
  5. Never resolve.
  6. Post choices with `decide`.

**Tests (2):**
1. A prune keeps referenced hashes and the newest 8, and drops the rest.
2. `listReviewRenderVersions` numbers versions oldest-first.

**Acceptance (sandbox):**
1. `studio review watch zz-review-sandbox` blocks, a note added in the page wakes it within about 3.5 s, and the output
   holds the frame path and the `look:` line.
2. `reply 3 "…" --addressed --commit HEAD` shows in the page within 1 s.

### P-D: decisions surface

**Owns**
- New `web/src/features/decisions/**` (index, controllers, ui, `use-decision-hotkeys.ts`).
- New `web/src/routes/projects.$project.decisions.$topic.tsx`.

**Builds:** UI §5 Decisions.
- Survey and two-up views, with one shared transport for audio and video; swapping keeps the time.
- `P`/`X`/`U`, `1`–`9`, `F` (picks only) and `Mod+Enter` to sign off.
- Each candidate has a thread through `ReviewThreadPanel on="decision"`.
- Meta sits in mono on each frame's bottom edge.
- Candidates whose hash went stale are marked.

**Acceptance:** `studio review decide zz-review-sandbox music-bed --question … --candidate …` posts the decision. Then
three audio candidates in the page can be picked, two-upped and signed off, and `watch` prints the pick.

### P-R: script read-along

**Owns**
- New `web/src/features/script/**`.
- New `web/src/routes/projects.$project.script.tsx`.
- `lib/output/review/engine/review-script-source.ts` (stub): `readReviewScript(project): { voice; lines:
  ReviewScriptLine[]; takes: { hash; label }[]; hash }`, and new `review-script-source.test.ts`.

**Builds:** UI §5 Script.
- Karaoke: the current line is `cream` and the current word gets a `cobalt` sweep.
- Clicking a word seeks, and `N` notes a line or a selection.
- The take switch, the sign-off ✓ (stale when the hash changes), and a dock with only `lanes={['voice','sound']}`.

**Test (1):** reading `zz-review-sandbox-voice` gives line words in time order and a stable hash.

### P-P: dashboard, project page and quick-open

**Owns**
- `web/src/features/projects/**`.
- `web/src/routes/index.tsx` and `web/src/routes/projects.$project.index.tsx`.
- `web/src/shared/ui/quick-open.tsx`.
- `lib/output/review/engine/review-dashboard.ts` (stub) and `review-dashboard.test.ts`.

**Builds:** UI §5 Dashboard and Project page.
- `summarizeReviewProjects()` returns, per project, the thumbnail path, glyph counts (open, addressed, asks), open
  decisions, unsigned script, newest render and its age, and the last review revision time.
- The "Awaiting you" list, and 40px rows with zero counts hidden.
- `Mod+K` quick-open over projects, files, decisions and the script.

**Test (1):** awaiting-you lists a project with an addressed thread or an open decision, and omits a project whose
threads are all resolved.

---

## Wave 2: integration and polish (sequential, 1–2 agents)

1. **Requests:** apply the Requests from wave-1 reports, and run the barrel and engine-door edits.
2. **Bug sweep:** every brief bug, with its owner and how it is checked.

   | Bug | Fixed in | Check |
   |---|---|---|
   | `styles.span` width null | P-T (the file is deleted; playhead is CSS) | Playhead visible at rest |
   | `copied \|\| saveState` | P0-C header | Save failure shows `not saved · retry` after a copy |
   | Esc and file switch drop drafts | P0-C draft store, P-N composer | Draft survives Esc, file switch and auto-load |
   | One-click delete | P-N undo | Undo and `Mod+Z` restore the thread and its image |
   | Whole-file save clobbers | P0-E ops and lock | Concurrency test; CLI reply during page edit kept |
   | Restamp on carry | P0-M `writtenOn` | Placement test |
   | Markdown flattening | P0-M | Markdown test |
   | Storyboard 16:9 | P-B | Board test with 9:16 |
   | Radios swallow keys | P-B `SegmentedControl` | Click a ground, then `Space` plays |
   | 410 after replace | P-B hash-keyed cuts; P0-C header link | Replace a sandbox render; board and download work |
   | `setFrame` re-render, unbounded ffmpeg | P0-C store, P-B queue | React profiler: no commits while playing; ≤2 ffmpeg |
   | Header path | Decision 17 | Markdown shows `work/projects/zz-review-sandbox/...` |
   | v1 files read as "render unknown" | P0-M/P0-E (not read) | No "RENDER UNKNOWN" anywhere |
   | 72vh stage, 9:16 overflow, 1600 cap | P0-C grid, P-S fit | 1440×720 and 1920×1080: no page scroll, no gutters |
   | Storyboard seeks 3500px down | P-B board replaces it | `Enter` lands on the stage |
   | Noise list (brief) | Wave 2 copy pass | Section 3 below |
   | Index text list | P-P | Dashboard has thumbnails and counts |
   | a11y: slider, focusable notes, keyboard pin | P-T, P-N, P0-C | `N` at playhead pins without a mouse |

3. **Copy pass** against UI §7. Grep the UI for each removed string, all-caps headings, counted singletons, zero counts
   and bare `Loader`, and remove every hit.
4. **Perf:** confirm the frame store, the cut queue, and a 1 s status poll that costs one `stat`. A threads refetch
   happens only on a revision change.
5. **a11y:**
   - The focus ring is `cream` with `:focus-visible`.
   - The dock is a slider and notes are `listitem`s.
   - Every icon button has a tooltip label from the registry.
6. **Docs:** the `studio review` sections in `docs/` agree with the CLI. `lint/overview.md` gets a new rule only if
   one was added.
7. **Old notes files:** delete `review/notes-*.json` in the sandbox clones, and list Graham's in the final report.
8. **Baselines:** run `-- --scope public --update-baseline` where fixes left stale entries.

---

## Verification

### Checks (each run on its own, from the worktree)
- `npm run check:arch -- --scope public`
- `npm run lint -- --scope public`
- `npm run typecheck:gate`
- `npm run typecheck:web`
- `npm run test:gate`
- Not run: `stamp:gate`, since no rendering changed.

### Browser audit (Chrome)

Serve `node cli/studio.ts review open zz-review-sandbox --port 4393 --no-open` and use 1440×720, then 1920×1080. Each
verbatim complaint becomes an observable pass condition.

| Graham said | Passes when |
|---|---|
| "old notes are in there… delete them one at a time" | After an agent marks 5 notes addressed, `Shift+E` resolves them and they collapse into `✓ 5 resolved ▸`; "Clear resolved" removes them in one action |
| "badges that say moved from… moment gone… I don't know what that means" | No "moved", "gone", "render unknown" or raw coordinates appear. A carried note shows only `r11` in dim mono, and an unplaced one sits in the collapsed `unplaced` group with its frame image |
| "If I copy all the notes… all this stuff comes back" | `Mod+Shift+C` output holds only open and reopened threads plus `## Keep` |
| "not very readable" | Type is 11/12/13 px tokens. No all-caps headings, no counted singletons, no zero counts, no hint lines |
| "no line indicator of where the frame is" | A 2px cream playhead is visible through the stage edge and every lane at rest, while playing and after seeking |
| "unclear what parts are interactive" | Hovering any clickable shows `pointer` plus a `raised` fill within a frame. Hovering decoration changes nothing. Every icon has a name+key tooltip |
| "gray bar with badges 'final'… yellow parts and yellow dots" | No FINAL/BLOCKING pills: rungs are hatch vs solid, with the name on hover. Colour appears only in the notes lane and the thread, and it means state |
| "only place I can click to scrub" | A press anywhere in the dock (ruler, any lane, gutter excepted) seeks, and dragging scrubs |
| "storyboard layer is just kind of weird" | No storyboard below the fold. `B` swaps the stage for the Board, and `Enter` returns to the stage at that scene |
| "dense power-user UI" | No page scroll at 1440×720. The stage is ≥516px tall. Everything in UI §8 works from the keyboard, and `Shift+/` lists it |
| "agents observe the notes as I add them… add replies, questions" | A background `watch` wakes on a page note. An agent `reply --question` appears within 1 s with a `caution` rule, and `◆` shows presence |
| "agent makes a couple of candidates and I choose" | A decision of 3 candidates: survey, two-up with time kept on swap, `P` pick, `Mod+Enter` sign off; `watch` prints the pick |

### Also verify
- `?f=…&note=…` survives a reload and a render switch.
- A new render auto-loads with no draft open, and with a draft open it shows `[rN ↻]`.
- Two tabs plus a CLI reply lose no edits.
- A 9:16 still fits and `Z` toggles 1:1.
- Guides cycle with `H`.
- The script page highlights words in time on `zz-review-sandbox-voice`.
- Nothing was written to a non-sandbox project: `git -C work status` shows only sandbox paths, which are ignored.

---

## Wave 0 as built

Wave 1 uses these where they differ from the Provides lists above.

**Models (P0-M)**
- `ReviewGuideShape` is `ReviewGuideOverlay` (lint refuses "Shape"). Also exported: `REVIEW_GUIDE_SETS`,
  `ReviewGuideRect`, `reviewGuidePlatformOf`.
- `placeReviewWord` lives in `review-moment.ts`, not `review-placement.ts`.
- `placeReviewThread(thread, target): ReviewPlacement | null`; null means the thread isn't about this target.
  `ReviewPlacement` has a middle variant `{ word?; wordEnd?; shifted }` for still, script, decision and project threads.
- `ReviewPlacementTarget` gains `kind: ReviewMediaKind`.
- `ReviewWrittenOn.commit` is `ReviewRenderSource` (structural; models can't import `GitState`). Also exported:
  `ReviewSourceCommit`, `ReviewEntryCommit`.
- The third argument of `applyReviewOpsToFile` is `ReviewOpsContext`, with `writtenOnOf: (render: ReviewRenderRef) =>
  ReviewWrittenOn`.
- `thread.restore` carries `image?: Uint8Array`.
- `ifRev`: a `thread.edit` conflicts only when `entries[0].rev > ifRev`; a reply never conflicts. Send `thread.rev` or
  `entries[0].rev`.
- An agent's `thread.add` gets `asks: true` on its first entry.
- `decision.put` updates the open decision on the same topic (verdicts kept on unchanged candidates), needs at least
  two candidates; under `choose: 'one'` a new pick clears the others.
- `formatReviewThreadsMarkdown`: `states` optional (open and reopened by default), `size` may be null, optional
  `sources` and `sceneSources`.
- Added: `reviewScriptLineWords`, and `ReviewNotePlace` (the argument of `reviewNoteContext`).
- `ReviewArtifact` no longer has `notes` or `notesPath`.

**Engine (P0-E)**
- `readReviewFile(projectDir)`, `applyReviewOps(projectDir, ops, author)` and `waitForReviewChange({ projectDir, ... ,
  render? })` take the project folder, not its name; web resolves it with `projectFolderNamed` (on the engine door).
  `waitForReviewChange` places changed threads on `render`; without it, video and still notes come back unplaced.
  `readReviewStatus` and `readPlacedReviewThreads` take the name.
- The lock is the platform `studio-lock-file.ts`: stale when its holder process has ended, not after 10 s.
- `ReviewRenderVersion` (`review-history.ts`) is `{ r; hash; at; source; file }`; `file` is the archived copy's path.
- `review-peaks.ts` stub: `reviewPeaksFileOf(project, path): Promise<string>` and `ReviewPeaks { hash; perSecond; peaks }`.
- `writeRenderSnapshot(render, made)`: `made.source` optional, defaulting to `readRenderSource()`; `render.path` is
  `string | null` (null outside a project). `joinVideoSlices` takes `source?` too; remote renders pass theirs.
- Render progress records its process and reads as nothing once that process has ended.
- `useReviewOps(artifact)` takes `{ project, path, kind, render }`; `apply(ops)` resolves to the server's answer or
  `undefined` when the batch failed. `failed` and `retry` are shared across every caller through the mutation cache
  (key `['review-ops', project]`).

**Shell (P0-C)**
- `createReviewPlayback({ fps, durationInFrames, startFrame })`; the stage and root attach through the `attachMedia` /
  `attachRoot` ref callbacks. Also `useReviewPlaybackClock` and `useReviewPlaybackState(playback, select)`.
  `useReviewFrame()` lives in `review-screen-context.tsx`.
- `useReviewDraft(file)` takes the file key.
- Global keys, the cheatsheet and quick-open mount once in `web/src/shared/ui/studio-overlays.tsx` (from `__root.tsx`),
  not in the shell.
- New `review-transport-bar.tsx` (transport row; no wave-1 owner; P-T may take it with the dock) and
  `review-screen-layout.tsx`.
- `validateSearch` is `reviewSearchValidator`. `r` and `vs` are render hashes, `z` is `1` or absent. A malformed
  search shows the route error page (HTTP 500 on SSR).
- With `conflictBehavior: 'error'`, a disabled registration still holds its key: leave a key out of the list rather than
  `enabled: false`.

---

## Wave 1 as built

Wave 2 uses these where they differ from the package sections above. Nothing is committed yet.

**Integration (requests applied)**
- **Engine door:** adds `readReviewFile` and `readReviewWatchPresence`. It drops `listProjectsWithArtifacts`, along with
  `ProjectListing` and `landingArtifactOf`.
- **Review barrel:** the script page reaches the review only through `features/review/index.ts`. The barrel exports
  `ReviewScreenProvider`, `useReviewScreen`, `useReviewStatus`, `ReviewScreenValue`, `REVIEW_FRAME_VAR`,
  `useReviewPlaybackClock`, `useReviewPlaybackState`, `ReviewPlayback`, `useReviewDraft`, `useReviewOps`,
  `useReviewThreads`, `reviewMediaUrl` and `SetReviewSearch`. `features/review/visibility.json` grants
  `web/src/features/script`.
- **Guides:** `guides` and `setGuides` now live in `ReviewScreenValue`, set up by `useReviewScreenView` in
  `review-screen.tsx`. The script page passes `null`. `nextReviewGuideSet` is in `review-guides.ts`. The transport
  carries a ⌗ "Guides" button and the proof-ground swatches for transparent renders. Its loop uses the exported
  `reviewLoopFor`, so it now covers notes as `/` does.
- **Stills on the stage:** `ReviewStage` draws a still as an `<img>` and pins `on: 'still'` anchors. Stage marks show
  placed still notes. `reviewIsProofed` (`use-review-proof-ground.ts`) picks the proof ground for transparent renders
  and for png/webp stills. The stage `<video>`/`<img>` carry `data-review-media`, so notes save with a frame image.
- **P-S Request 1 (`mediaNow`):** declined. `data-review-media` covers both the video and the still, and the playback
  store never sees an `<img>`.
- **Space-pan:** dropped from the spec. `Space` always plays, and at 1:1 a plain drag or the wheel pans.
- **Screen keys:** `ReviewScreenHotkeys` is a null component rendered before the slots. It runs playback and `B`
  (`useReviewBoardToggleHotkey`). Its effects run before the slots' effects, so the Board's arrows no longer collide
  with the playback arrows on the switch. Before this change the Board threw `'ArrowLeft' is already registered`.
- **Thread fold:** the thread stays mounted at zero width when `Mod+\` folds it. Focus landing in it (`G N`) unfolds it.
- **New keys:** `N`/`Enter` "Note here" yield to a pending `G` sequence (`hotkeySequencePending` in
  `use-global-hotkeys.ts`). `G S` opens the script.
- **Quick-open:** the provider takes `source: QuickOpenEntriesSource`, a function that wraps the body, rather than a
  hook passed as a value (lint refuses that). Projects exports `studioQuickOpenEntries`, and `__root.tsx` mounts it.
- **Hotkey registry readers:** they subscribe to a string snapshot (`useHotkeyRegistryString`) and mount only while
  shown (tooltip label, cheatsheet body). This removed the "Cannot update HotkeyCheatsheet while rendering" warnings.
  useHotkeys re-sets options during render.
- **`?r=<hash>`:** handled end to end:
  - `readReviewArtifact(project, path, render?)` loads the archived copy under the logical path.
  - The route passes `r` through `loaderDeps`.
  - `/media` serves a replaced render's bytes from `out/.history/`, or answers 410.
  - The header doesn't auto-reload while `r` is set.
- **Script threads:** `reviewPlacementTargetOf` returns `kind: 'audio'` with the script's lines for the take, so the
  script page's thread lists script notes. `ReviewPlacementTarget.kind` is `ReviewMediaKind | 'audio'`.
- **Thread rows:** a carried note shows `rN` when its hash is a kept version of this path, and a 7-char hash otherwise.
- **`review open <project>`:** opens the project page.
- **P-C Request 2 (`shadows.selectedEdge`):** declined. Four files already draw the selected edge as an inset 2px cream
  outline, and that stays the one way.
- **Other fixes:**
  - `review-script-source.ts` returns typed reads (no-unknown-returns).
  - The marks lane's duplicate React keys are fixed.
  - Lint findings fixed in stage and compare-menu.

**Open gaps for wave 2, most important first**
1. **Decision threads aren't mounted.** `ReviewThreadPanel` needs `useReviewScreen()`. The recommended fix (P-D's
   option a) is a small `ReviewThreadScope` context for project, threads source, ops target, filter and note search,
   and draft key. The review screen, script page and decisions page would each provide it. Then restore the 360px
   `thread` column and `Mod+\` in `decision-screen.tsx`. The composer must also build decision anchors.
2. **Overlays not checked in a real browser.** The cheatsheet, quick-open and `G N` focus weren't confirmed, because the
   shared Chrome kept the tab hidden: no rAF, so Mantine modals never mount and video stays black. Check them by
   eye at 1440×720.
3. **Threads on a pinned version (`r`).** They are placed on the file on disk, not on the version shown.
4. **Compare cut ticks.** Not built; they need the compared render's scenes.
5. **Replay bracket span.** Not drawn: moments carry only a frame.
6. **Draw mode.** The transport's Draw button enters draw mode without pinning the draft, unlike `D`.
7. **Takes.** The take switch only ever shows one take.
8. **Wipe.** On a transparent render, the open render shows through the other's clear areas.
9. **Copy pass, perf, a11y and old notes files** (wave 2 items 3–8) are untouched.

## Wave 2 as built

These are the review fixes from two review rounds. Nothing is committed.

**Correctness**
- Restore ops rebuild a frame image's path from the thread id, so a client-sent `image` can't delete project files.
- The handoff reads the script from the project folder.
- Peaks validate `render` against the path before the hash names a file. They answer 410 when no copy is kept, and
  serve an unpinned candidate as its file is now.
- The review file, watch presence, render progress and peaks are written through `replaceFileWhole` (temp + rename).
- The archive prune skips a `<hash>/` folder that is still being copied.
- It prunes against `reviewReferencedHashes`, and only video renders are archived.
- The render marker lists every path being written.
- The watch loop polls on a `for await` timer.
- `.tanstack/` is ignored.

**One rule per concept**
- `reviewThreadTone` and `REVIEW_THREAD_TONES` mark thread state on every surface.
- `reviewDecisionOnTopic` and `reviewDecisionTopics` pick a topic's decision for the dashboard and the decisions page.
- `readReviewDecisionView` is the decisions page's one engine read. The decision-ops schema copy and `withdrawn` are
  gone.
- `reviewDecisionRefusalOf` guards `decide`.
- The shared modules:
  - URL builders in `shared/media-urls.ts`.
  - `formatReviewClock`.
  - `formatStudioAgo`.
  - `REVIEW_FALLBACK_FPS` and `reviewFrameAt`.
  - `useRouteSearchWriter`.
  - `review-marks.ts`.
  - The placement helpers in `review-placement.ts`.
- Candidate kind `image` becomes `still`.
- `review-notes.ts` is renamed `review-context.ts`.
- `HotkeyTooltip` names its key explicitly.
- Unregistered keys are left out of the list rather than set `enabled:false`.

**Remaining gaps**
1. Nothing in this wave was checked in a browser. Wave 1's overlay check (gap 2) still stands.
2. These were held for discussion:
   - A shared playback-store core.
   - A `ReviewDockScope` to replace the script page's stand-in artifact.
   - Undo as a reducer in `useReviewThreadActions`.
   - One hotkey builder.
   - Typed hotkey names (`hotkey` is a string).
3. Wave 1 gaps 3–9 are untouched.
4. `review/engine` is 16 files wide, over the advisory 15.

## Visual pass as built

Two rounds of by-eye critique in Chrome at 1280, 1440 and 1920 on `zz-review-sandbox` and `zz-review-sandbox-voice`, one
agent per area (video, stills, decide/script, dashboard), each fixing its own files.

- **Video:** 13 of 14 round-2 findings fixed. The board scrolls the whole current tile into view (`use-review-board-cursor.ts`),
  note bars and dots cluster in one pass, the ruler's hover time hides ticks and yields to the flag, the zoom overview
  row is always reserved, scene and mark names clip at their neighbour, the waveform leaves a strip for effect names,
  and the draw strip sits in the letterbox when there's room.
- **Stills:** 7 fixed (guide chips drawn last and inset, scroll-into-view in grid and filmstrip, ringed dots, edged
  swatches, middle-cut names), 2 declined (grid swatches, pin hover state).
- **Decide/script:** mouse pick/reject on cards, "1 A" labels with Esc for survey, scrub-past-end keeps the shared time,
  word-anchored script notes, centred script column.
- **Dashboard:** weight-600 names, "Awaiting you" capped at 3 rows per project, one 960px list width, folder groups and
  waiting-first order on the project page, URL breadcrumb while pending, worded count tooltips, one quick-open highlight.
- Gate fixes: shadows moved into `shadows.ts` (`spokenUnderline`, `groundRing`), raw spans in the still grid became `Box`.

**Open (shared files, not yet done):** stills folder URL and folder rows; Fit capped at 100% for stills; short
platform zone labels in `still-presets.ts`; caret at end of a restored draft; a `still` hotkey group; frame snap on
pause; "Up a level"; keys sheet group breaks and ⌘K swallowed while it fades; error-page padding; thread panel `head`
slot and dropping "New note N" beside an open composer; script type at 19px and a taller script dock with a lifted
playhead tag and legible lane glyphs; timed decision-note anchors; Esc in the thread clearing `note`; composer focus
ring; script-row age on the dashboard.
