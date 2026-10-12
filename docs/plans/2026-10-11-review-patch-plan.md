# Review: slices laid into the cut, and a cleanup of the overhaul

Graham's requirement: when a watching agent fixes a note on a scene, it re-renders just that scene in seconds and the
review page lays it into the current video, so the fix can be seen without waiting for a full render. An agent must
find this path without hunting, and the result must be architecturally clean. The rest of the plan rethinks the
parts of 632dd017 that were bolted on.

Checked against the code: `reviewHandoffRenderOf` picks the newest video, slices included. `ReviewEntry.render`
is a bare hash and the page never reads it. `checkedFrames` lives in `render/engine/render-pipeline.ts`. Remote
rendering is the only caller of the join code. `waitForReviewChange` takes a `render` option that the CLI never
passes. `lib/output/render/` has no `models/` role yet. Not checked: whether the artifact route opens a path that
`listProjectArtifacts` doesn't list.

## 1. The scene patch

### Nouns: none new

- **Cut**: a full-length render (`out/video.*`, the animatic, a remote `joined.mp4`). It is the only kind of render
  that notes are placed on by default.
- **Slice**: already exists. It is a render of part of the video, and its snapshot records `frames {from, end}` and
  the whole timeline. `--scene <id>` is a slice whose span is that scene's.
- **Reply render**: already exists as `entry.render`. It becomes `{path, hash}`, the same shape as `writtenOn`. A
  reply whose render is a slice is how a slice reaches the page. There is no registry of slices and the page never
  scans for them.
- **Splice**: a check, not a stored thing. A pure function decides whether a slice fits a cut. The page lays in
  every reply slice that fits the cut being shown.

"Patch" stays a word we use in conversation. No type, file or flag is named after it.

### Data flow

1. The agent runs `studio review watch <p>`. For each video note, watch prints a scene block like this (scene id,
   span, source, look and fix all come from data it already has):
   ```
   scene: ink (bars/ink.tsx) · f240–f311 on out/video.mp4 r14
   look:  studio look p --video out/video.mp4 --frames 237:272 --crop …
   fix:   studio render p --scene ink, then studio review reply p 12 "<what changed>" --addressed --render out/wip/slices/scene-ink.mp4
   ```
   The `next:` line becomes `fix each note (its fix: line), then studio review watch p`.
2. `studio render <p> --scene ink` resolves to `--frames from:to-1` through the scene-span function, which includes
   the scene's crossfades. It writes `out/wip/slices/scene-ink.mp4` and its snapshot, and archives it by hash. Its
   progress record names `{scene, frames}`. It finishes by printing the splice verdict against the newest cut, then
   the exact reply line:
   `splices into out/video.mp4 r14 at f240–f311` or `won't splice: scene ink is 102 frames now, 90 in r14 — reply
   with it and it plays alone; render the whole video to see it in the cut`.
3. `studio review reply … --render <slice>` records `render {path, hash}`, archives the slice (it is pinned through
   `reviewReferencedHashes`, unchanged) and prints the same verdict. Recording this bumps the revision.
4. The page already refetches threads when the revision changes. A `reviewSplicesQueryOptions(project, cutHash,
   revision)` server function gathers every reply render across the threads, keeps those whose snapshot is a
   slice made after the cut, and runs the splice check on each. It returns
   `{thread, path, hash, from, end, refusal?, pictureOnly}[]`. Where two slices overlap, the newer one wins.
5. The stage lays each fitting slice in as a muted follower video, visible only inside `[from, end)`. The cut's
   audio keeps playing. A small tag reads `#12 slice`. The scenes lane hatches the spliced span, and a render in
   progress shows "re-rendering ink" over that scene's band.

### Flip, drop, retire

- **Hold `\`** while slices are laid in: the cut shows as it was rendered, with every slice hidden. With no slices
  and a compare version picked, `\` keeps its compare meaning. One key, one meaning ("show the other"): the
  slices, if any, come first.
- **Only the newest version of a path gets slices.** Picking an older version (`r=`) shows it as rendered.
- **A full render retires slices automatically.** Only slices made after the cut are laid in. When a new cut lands,
  every older slice drops out, and resolving a thread doesn't remove its slice before then. No expiry state is needed.
- **A slice that won't splice** isn't laid in. The thread's reply shows `▶ slice` with the refusal text, and the
  link opens `/artifacts/<slice>?r=<hash>`. A slice already loads correctly on its own, because `startsAt` comes
  from its snapshot.

### Timing rules (`renderSpliceRefusal`, pure)

`renderSpliceRefusal(cut: RenderSpliceSide, slice: RenderSpliceSide): string | null`, where a side is the
snapshot's `{frames, timeline, clock}`. A slice splices when all of these hold:

- the cut starts at 0 and covers the slice's span;
- fps, size and `durationInFrames` are equal, so nothing after the span has moved;
- each scene and crossfade that overlaps the span has the same `from/to/visible`;
- the line words and cues inside the span are the same, so the cut's audio still lines up;
- the clock's bars and cues inside the span are the same.

Sounds inside the span may differ. In that case `pictureOnly: true`, and the tag says "picture only". The function
compares the two timelines cut to the span. Nothing new is stored, and the snapshot stays at v11.

### Help and skills (what makes the path obvious)

- `render --scene` help: "Render one scene (its crossfades too), silent, to out/wip/slices/scene-<id>.mp4. Reply
  --render with it and the review page lays it into the cut over that scene, under the cut's sound. A scene whose
  length changed can't be laid in: render the whole video."
- `--frames` help loses "for --join" and says the slice goes to `out/wip/slices/`.
- `reply --render` help: "a slice (render --scene) is laid into the cut; a cut replaces it".
- In the video-motion skill, step 3 of "The review loop" is rewritten around `--scene`, the reply and `\`, and says
  when a full render is needed (the length changed, several scenes, handing over).

### File-by-file

- **New** `lib/output/render/models/render-frame-span.ts`: `checkedFrames` moved here and renamed
  `timelineFrameSpanOf`. Callers: `check --scene`, `render --scene`, watch's `scene:` line.
- **New** `lib/output/render/models/render-splice.ts` and its test. The snapshot types it reads move to
  `render/models/render-snapshot-model.ts`. Models can't import engine; the file I/O stays in engine.
- `cli/commands/render.ts`: add `--scene`, remove `--join`, and print the splice verdict and reply line.
  `keepRenderVersions` stays where it is.
- `render-slices.ts`: shrinks to `renderVideoSlice` and `refuseSliceOutside`. The default path moves to
  `out/wip/slices/`.
- `render-session.ts`: drop the `lossless` option; slices encode with `{crf: 18, preset: 'veryfast'}`.
- `remote-render.ts` takes over the piece assembly (`joinedRenderSlices`, `readRenderSlices`). Its `--frames`
  encodes straight to the slice, with no lossless copy beside it.
- `render-progress.ts` records `{kind: 'cut' | 'slice', path, scene?, frames?}` instead of guessed paths.
- `review-threads.ts`: `ReviewEntry.render` becomes `{path, hash}`. `review-ops.ts` validates it.
- **New** `review/engine/review-splices.ts`: reads the archived slice snapshots and calls the pure check.
- `project-artifacts.ts`: never lists `out/wip/slices/` (stated as negative space), and gains `newestProjectCut`.
  `reviewHandoffRenderOf` uses it.
- `review-markdown.ts`: the `scene:`/`fix:` block and the `next:` line. `cli/commands/review/reply.ts`: help and
  the verdict.
- Web: `review-compare-view.tsx` becomes a follower layer (§2 A), and `review-stage.tsx` mounts slice followers. The
  scenes lane, the thread entry's `▶ slice` and the `\` handling also change.

## 2. Redesigns and deletions, ranked

1. **The default render is the newest cut, and slices are hidden from the artifact list.** *Why:* today, once
   `--frames` has run, every note gets placed on the slice. *Payoff:* this is what makes the feature possible.
   *Risk:* low.
2. **One media clock with followers** (`web/src/shared/ui/linked-media-clock.ts`). The leader drives the frame.
   Followers register `{element, frameOf, visible(frame)}`, and one rAF loop corrects drift. `onTick` replaces the
   seven private rAF loops (transport readouts, timeline follow, voice lane, playhead, compare, script transport,
   script line). Decisions keep only "which is heard" and convert seconds at their edge. *Payoff:* about 200 lines
   gone, and compare and slices become one mechanism. *Risk:* medium. The first frame on entering a span is the
   delicate part, so a follower pre-rolls about 10 frames before `from`.
3. **Delete `--join` and the lossless file beside every slice** (0 joins against 68 `--frames` runs in the render
   history). The join code moves to remote rendering, its only user. *Payoff:* one less mode, half the encoding
   per slice. *Risk:* low.
4. **The server ships the raw `ReviewFile`, and each surface places threads itself.** Delete `readPlacedReviewThreads`,
   `PlacedReviewFile`, and `applyReviewOpsLocally`'s rebuilt file and guessed `nextId`. Optimistic updates become
   `applyReviewOpsToFile` on the cached file. *Payoff:* about 80 lines, one placement per surface, and slices and
   the cut placed the same way. *Risk:* low to medium.
5. **One project pulse.** `readProjectPulse(project)` returns `{revision, cuts: path→hash, agent, rendering,
   takeHash}`, polled once a second by one shared query. Every other query is `staleTime: Infinity`, keyed on its
   part of the pulse. This deletes `review-status.ts`, the decision poll with its `useIsMutating` hold, the
   script's 3 s poll, the projects' 5 s polls, and `artifacts` on `ReviewArtifact` (the second source for files on
   disk). *Payoff:* screens stop disagreeing, and "a slice arrived" is just a revision bump. *Risk:* medium,
   because it touches every screen.
6. **One watcher per project.** Delete `--as`, `--since`, the per-name cursors and the freshest-heartbeat scan,
   leaving one `out/.review/watch.json`. Also delete watch's `render` option and `placeForHandOff`, and return raw
   threads. *Why:* these options have no second user. *Risk:* low.
7. **Fold the script screen into the review route.** The take becomes an `audio` artifact whose stage is the lines.
   This deletes `script-screen.tsx`, `use-script-screen-value.ts` (the fake artifact and search adapter),
   `script-layout.tsx`, `script-transport.tsx`, `script-search.ts` and the script route. `ReviewScreenValue` then
   narrows to clock scope plus stage state. *Risk:* medium (route and URL change).
8. **One `ReviewThreadSplit`** for the side-thread layout. It replaces three copies and fixes the bugs where the
   script and decision threads go dead when folded. *Risk:* low.
9. **Auto-loading a newer render moves** from `ReviewHeader`'s effect into the route that owns
   `onLoadReplacement`. *Risk:* low.
10. **`ask` builds its anchor with `reviewVideoAnchorAt`** on `readReviewArtifact`'s timing, so there is one way to
    make a video anchor. *Risk:* low.
11. **Small merges and moves:**
    - `still-sheet.ts` and its cell types move to `lib/output/render/engine/` beside `render-stills.ts`.
    - Fold `listReviewRenderVersionsIn`, and fold `review-target.ts` into `open`.
    - Merge `use-review-threads` with `use-review-placed-threads`, and inline `use-review-timeline-hotkeys`.
    - `use-review-compare-target` becomes `useReviewRenderVersions`, with its query in `review-queries.ts`.
    - `review-frame-image.ts` becomes `review-mark-paint.ts`. `useReviewStillPixels` moves to
      `review-still-siblings.ts`.
    - Fix the stale comment on `REVIEW_FALLBACK_FPS`.
    - Prefix rule: names local to a feature drop `review`.
12. **Speed:** draw the timeline frame in the first drawing browser instead of a separate launch. *Payoff:* about
    2 s of a 10–20 s slice. *Risk:* medium (session plumbing). Last, and optional.

**Rejected:**
- A `pinned` marker in `out/.history/` (#9 render→review): it would be a second copy of what `review.json` already
  says. The CLI composing render with review is the imperative shell doing its job.
- One policy for the peak and still caches: too little payoff.
- A new `fix` field next to `render`: `render` already means "the render that shows the fix".
- A stored per-scene hash in the snapshot: the splice check can be derived from the timeline.
- Laying in slices without a reply: an agent's experimental `--frames` render would overlay the cut unasked.
- Keeping the decision screen's separate UI: it stays (it has real second uses). Only its sync core merges.

**Premise deletions:** the second polling cadence per screen (#5); placement on both sides (#4); options per watcher
name (#6); `--join` as a delivery path (#3); the script as a fake review (#7).

## 3. Docs and skills

- `skills/video-motion/SKILL.md`: "The review loop" stays the only full write-up. Step 3 is rewritten around
  `--scene`. The "a change in motion, quickly" row points to the loop. Flags are written as `--frames a:b`, the way
  watch prints them.
- `skills/video-kickoff/references/studio-map.md`: the Review row becomes one line pointing to video-motion.
- `skills/video-kickoff/SKILL.md` step 5 (both flows): keep only what belongs to that stage (pacing lives in
  `timeline.ts`; a change of length means re-rendering the animatic).
- `skills/video-motion/references/walkthrough.md:81` and `skills/video-gen/SKILL.md:66`: drop `studio preview`;
  notes come through the review loop.
- `cli/commands/review.ts`: the parent help is one sentence plus the verbs. `open` loses the repeated "carried by
  moment".
- `cli/commands/render.ts`: the description loses `--join` and lossless, and gains `--scene`.
- Delete the six `docs/plans/2026-10-11-review-studio-overhaul-*.md`. First fold any copy rule from ui-spec §7 that
  still holds into a short header in `web/src/shared/ui/theme.stylex.ts`. This plan is deleted when its work lands.

## 4. Work packages

| WP | Owns | Scope |
|---|---|---|
| **R: render** | `cli/commands/render.ts`, `lib/output/render/**` (new `models/`), `lib/output/remote-render/engine/remote-render.ts`, `render-pipeline.ts`'s `checkedFrames` callers | `--scene`, `out/wip/slices/`, delete `--join` and lossless, piece assembly to remote, `timelineFrameSpanOf`, `renderSpliceRefusal` and test, progress record, slice encoding preset, still-sheet arrives (11) |
| **V: review engine + CLI** | `lib/output/review/**` except `review-file.ts`'s placed reads, `cli/commands/review*` | `render {path,hash}`, `review-splices.ts`, newest cut, `project-artifacts` negative space, watch block and `next:`, one watcher (6), `ask` anchor (10), history/target folds, comment fix |
| **D: web data** | `web/src/features/*/controllers/**`, `use-review-ops.ts`, the threads hooks, `review-header.tsx`, routes, `review-file.ts` placed reads, the pulse server fn | raw file plus client placement (4), project pulse (5), `artifacts` off `ReviewArtifact`, splices query, auto-load in the route (9) |
| **S: web stage** | `web/src/shared/ui/linked-media-clock.ts`, `review-playback-store.ts`, `review-compare-view.tsx`, `review-stage.tsx`, the rAF readers (transport, timeline view, voice lane, playhead), `decision-playback.ts`, scenes lane, thread entry | media clock (2), slice followers, `\` rule, hatch band and "re-rendering", `▶ slice` with refusal |
| **L: web layout** | `web/src/features/script/**`, `review-screen*.tsx`, `decision-layout.tsx`, renames from 11 | script folded in (7), `ReviewThreadSplit` (8), `ReviewScreenValue` narrowed, renames |
| **K: docs** | `skills/**`, `docs/plans/*review-studio-overhaul*`, help strings only in `cli/commands/review*.ts` after V | §3 |

**Order:**
- R first publishes `renderSpliceRefusal`'s signature and `out/wip/slices/` (a few minutes). V and D then code
  against it.
- S lands the clock's `onTick` and follower API as its first commit. L starts after it, because the script's rAF
  readers are deleted by L, not converted.
- D's splices query needs V's `review-splices.ts`. Agree its return type (shown in §1) up front.
- K goes last, against the final help.
- #12 (timeline frame in the drawing browser) runs after R, if at all.

**Verification:**

- **Tests to add:**
  - `render-splice.test.ts` (3: splices; a scene's length changed; a line moved);
  - one `timelineFrameSpanOf` case with a crossfade;
  - the `review-markdown` fixture gains `scene:`/`fix:`;
  - the `review-ops` test covers `render {path,hash}`;
  - one pure test of the follower's frame window.
- **Tests to remove:** the join cases in `render-slices.test.ts`, the watch-cursor tests per `--as`, and anything on
  `PlacedReviewFile`.
- **Gates:** each WP runs `check:arch`, `lint`, `typecheck`, `test:gate` and `typecheck:web` separately, or
  remotely with `studio remote run`. R runs `stamp:gate` once, because the encoding path changed.
- **End to end** on `work/projects/zz-review-sandbox`, with Playwright at `/tmp/review-visual/` and
  `chromium.launch({channel:'chrome'})`:
  1. Run a full `studio render`, then `studio review open`.
  2. The page notes frame 250 in scene X. `studio review watch` prints `scene:`/`fix:` with the right span.
  3. Run the printed `render --scene`, which takes under 20 s and prints `splices into`, then the printed reply.
  4. Within 2 s the page shows the `#n slice` tag. Screenshots inside the span differ from the cut, and those just
     outside match it. While playing, the cut's `currentTime` advances and the follower is muted. Holding `\`
     shows the cut.
  5. Lengthen scene X in `timeline.ts` and render `--scene` again: it prints the refusal, and after the reply the
     thread shows `▶ slice` and it opens alone.
  6. A full render retires both slices.
  7. Repeat steps 2–4 on `zz-review-sandbox-voice` (voiced, so it checks lines and audio sync).
  8. Run `studio render --frames 0:30`, then watch: notes are still placed on `out/video.mp4`.

## 5. Questions for Graham

1. Should a slice stay laid in after its thread is resolved, until the next full render? **Default: yes.**
   Otherwise the cut reverts to the old look the moment Graham accepts a fix.
2. Can `--join` go, along with the lossless file beside each slice? It has never been used. **Default: delete.**
3. One watcher per project, with `--as` gone? **Default: yes.** Two agents watching one project would race on
   replies anyway.
4. Fold the script screen into the review route? The URL changes from `/script` to `/artifacts/<take>`.
   **Default: yes, as the last web package.**
5. Delete the six overhaul plan docs? **Default: yes, after folding §7's copy rules.**

## 6. Settled (overrides anything above it)

Graham's questions take their defaults (1 yes, 2 delete `--join` and the lossless file once 0 joins in the render history is checked, 3 yes, 5 yes), except #4.

- **Out of scope:** #7 (folding the script screen) and #12 (the timeline frame in the drawing browser). #8 `ReviewThreadSplit` stays.
- **Span:** `--scene <id>` is `--frames visible.from:visible.to-1` from `TimelineReport.scenes[i].visible`.
  - Point `check --scene` at `visible` too, and delete `checkedFrames`.
  - No `timelineFrameSpanOf` and no file for it.
- **What a cut is:** a cut is a snapshot with `frames.from === 0 && frames.end === timeline.durationInFrames`.
  - `newestProjectCut` filters on that, in `lib/output/render/engine` beside render-archive, so the render CLI never imports review.
  - `out/wip/slices/` is only for tidiness.
  - The progress record carries `{path, scene?, frames?}`, with no `kind`.
- **`renderSpliceRefusal`:** no `durationInFrames` rule, since only the scenes, crossfades, lines, cues and clock that overlap the span matter. fps and size must still match.
  - Tests:
    - splices;
    - the scene's length changed;
    - a line moved;
    - a later scene's length changed and it still splices;
    - a neighbour's crossfade moved and it refuses.
- **Newer than the cut:** compare when each render started, not when it finished.
  - The snapshot records `started` (ISO), written at the start of the render.
  - A slice lays in only if it started after the cut started.
- **A note written inside a laid-in span** goes on the slice: `writtenOn` is the slice's path and hash.
  - Watch places it through the slice's `startsAt`, so the frame image is the fixed picture.
  - One placement test.
- **`\` has one meaning:** "show the compare target".
  - With slices laid in, the default compare target is "as rendered (rN)", the cut without its slices, and it's listed in the compare picker.
  - No special case in the key handling.
- **During a crossfade,** watch's `scene:`/`fix:` names the scene being cut to.
- **The render CLI prints only the splice verdict and the reply line** with `<id>` left for the agent. Watch's `fix:` line has the id filled in.
- **Pieces that must not be forgotten:**
  - a `render/models` role folder in `lint/policy/studio-tree.ts`, plus the `visibility.json` grant for review importing render models;
  - the artifact route serving `out/wip/slices/` and `out/.history/<hash>/`;
  - `render {path,hash}` in the review-ops validation and in `reviewReferencedHashes`;
  - the archive comment saying slices are archived too;
  - the skill naming the limit: a fix to a shared component changes other scenes, which the composite won't show, so render the whole video.
- **Media clock:** the decision screen keeps its own playback in the first pass.
  - Follower entry: once the playhead is within about 10 frames of `from`, seek the follower to its frame 0 and wait on `requestVideoFrameCallback`. Show it only once its frame matches.
- **Watch:** delete `since` and `--as`, and keep one cursor file.
- **Pulse:** `cuts: path→hash` stays cheap through `renderFileStamp`'s mtime cache, and the take's hash gets the same cache.
- **Tests:** remove the remote `--frames` lossless-beside test along with the join cases.

## 7. Published signatures

R+V publish these; web packages code against them. Snapshot types live in `lib/output/render/models/render-snapshot-model.ts`
(`RenderSnapshot` gains `started: string`, ISO, when the render command began; `made` stays when it finished; still v11,
so a cut rendered before this lacks `started` and gets no slices until the next full render).

```ts
// lib/output/render/models/render-snapshot-model.ts (pure)
export const renderSnapshotIsCut: (s: Pick<RenderSnapshot, 'frames' | 'timeline'>) => boolean; // from 0 to durationInFrames

// lib/output/render/models/render-splice.ts (pure)
export const RENDER_SLICES_DIR = 'out/wip/slices';
export type RenderSliceSpan = { from: number; end: number } | { scene: string };
export const renderSlicePathOf: (span: RenderSliceSpan) => string; // out/wip/slices/scene-<id>.mp4 | frames-<a>-<b>.mp4
export type RenderSpliceSide = Pick<RenderSnapshot, 'frames' | 'timeline' | 'clock'>;
/** Why `slice` can't be laid into `cut` over its frames (a clause after "won't splice:"), or null when it can. */
export function renderSpliceRefusal(cut: RenderSpliceSide, slice: RenderSpliceSide): string | null;
/** Whether the sound effects inside the slice's span differ from the cut's (it splices picture only). */
export function renderSplicePictureOnly(cut: RenderSpliceSide, slice: RenderSpliceSide): boolean;

// lib/output/render/engine/render-cuts.ts
export type ProjectCut = { path: string; file: string; hash: string; snapshot: RenderSnapshot };
/** The newest cut (by snapshot.made) among the videos directly in out/ and out/wip/, or null. */
export function newestProjectCut(projectDir: string): ProjectCut | null;
/** `out/video.mp4 r14` */
export function formatRenderVersionName(projectDir: string, render: { path: string; hash: string }): string;
/** The one-line verdict the render CLI and reply print; null for a cut. */
export function formatRenderSpliceVerdict(projectDir: string, slice: RenderSnapshot): string | null;

// lib/output/render/engine/render-progress.ts
export type RenderProgress = { paths: string[]; startedAt: string; scene?: string; frames?: { from: number; end: number } };

// lib/output/review/engine/review-splices.ts
export type ReviewSplice = { thread: number; path: string; hash: string; from: number; end: number; refusal?: string; pictureOnly: boolean };
/**
 * Every reply render across `project`'s threads (folder name under work/projects/) that is a slice started after the cut
 * started, read from out/.history/<hash>/, with its verdict. [] unless `cut.hash` is the file at `cut.path` now (an
 * older version shows as rendered). Where two fitting slices overlap, the older is dropped. Oldest first.
 */
export function readReviewSplices(project: string, cut: { path: string; hash: string }): ReviewSplice[];

// lib/output/review/models/review-placement.ts
// ReviewPlacementTarget gains `splices?: readonly { hash: string; startsAt: number }[]` (the fitting splices,
// startsAt = from). A video note whose writtenOn.hash is one of them is placed at anchor.frame + startsAt, unshifted.
```

`ReviewEntry.render` is `ReviewEntryRender = { path: string; hash: string }`; the op validates a plain project path and a
10-hex hash. The artifact route (`resolveProjectMedia`) already serves `out/wip/slices/` and `out/.history/<hash>/`.

## 9. Settled after Codex review (overrides sections 6–8 where they conflict)

1. **A follower is ready after every seek, not only on entry.**
   - A seek or a change of source makes it not ready, and it stays hidden until the requested frame is presented.
   - Stale `requestVideoFrameCallback` results are rejected through a seek generation counter.
   - When paused, follower and leader must agree exactly. While playing, the tolerance is one frame, measured from presented-frame metadata (`mediaTime`) rather than `currentTime`.
   - A note's frame is the picture actually shown.
2. **Overlap is decided per frame, not per slice.**
   - The server (review-splices) resolves slices into non-overlapping winning intervals, `{thread, path, hash, from, end}`, where the newest slice wins each frame.
   - An older slice survives outside a newer one's span; test the chain A–B–C.
   - A slice already holds its crossfade composited, so the page never blends; it shows the slice's frames as they are.
   - The page preloads only the active slice and the next one.
3. **Newer means a later render start, everywhere,** including `newestProjectCut` (the cut that started last, ties broken by path).
   - This is a heuristic, written in a comment: a render reads its sources when bundling, and an edit made during a render can slip in.
   - Accept it; don't freeze inputs.
4. **Audio claim stays narrow.** The cut's sound always plays under a slice.
   - `pictureOnly` is true when any sound overlapping the span differs, by name or by start/end, including a tail running into the span.
   - Overlap tests are inclusive at `span.from`.
   - Scene `from` and `to` are compared explicitly.
5. **Pulse audit.** Every query is keyed on the pulse part it depends on. Check decisions, script inputs, artifact additions and deletions, and optimistic mutations.
   - The snapshot is written before the media file is renamed into place, so a hash is never advertised without its snapshot. If that's not already so, fix it.
6. **Naming churn:** only the renames §6 lists, nothing broader.
