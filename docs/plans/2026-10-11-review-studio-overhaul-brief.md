# Review studio overhaul: brief

Worktree: `/Users/graham/Programming/media-studio-review` (branch `review-studio-overhaul`). `node_modules` and `work/` are
symlinks to the main checkout's, so `work/projects/*` are Graham's real projects: never leave notes, decisions or other
files you wrote in them. For anything that writes, use the delete-safe sandbox clones `work/projects/zz-review-sandbox/`
(of motion-showcase: music, sfx cues, notes) and `work/projects/zz-review-sandbox-voice/` (of fodmap-app-preview:
voiceover.json, audio/take.json, notes), git-excluded in the workspace repo. Serve the app from this worktree with `node cli/studio.ts review <target> --port 4393 --no-open`.

The studio web app (`web/src`, Mantine 9 + StyleX + TanStack Router/Start/Query/Form/Hotkeys 0.10, React 19) today only
reviews renders and stills (`studio review`, `cli/commands/review.ts`, `web/src/features/review`, `lib/output/review`).

## What Graham said (verbatim, the bar to clear)

> When I go back to the studio after an iteration has run and I've given feedback, all my old notes are in there and I
> have to go through and delete them one at a time. There are badges that say moved from this or render blah blah,
> moment gone — I don't know what that means. If I copy all the notes, I assume all this stuff comes back in. The whole
> UI is just not very readable. I don't see any line indicator of where the frame is unless I click and highlight. It's
> unclear what parts are interactive and what aren't. There's a gray bar with badges that say "final" sometimes, yellow
> parts and yellow dots underneath — I don't know what those are — and a bar underneath that's the only place I can
> click to scrub. The storyboard layer is just kind of weird. The UI could use a serious polish pass.

> This should be a dense power-user UI. No egregious copy labeling stuff that should be obvious from context. Consider it
> as a whole.

> Agents should be able to observe the notes as I add them and start working; better, agents add replies, responses
> and questions themselves.

> Decisions: the agent makes a couple of candidates (renders, stills, music beds, voices, gen models) and I choose.

## Confirmed bugs

- `review-scrubber.tsx:37` `styles.span` sets `width: null`, zeroing playhead, sound markers and cut lines (verified).
- `review-header.tsx:60` `copied || saveState`: `copied` never clears, hiding later save errors (verified).
- Esc (global hotkey, `use-review-hotkeys.ts:20`) and composer `onEscape` drop drafts silently; switching file / loading
  new render drops drafts too.
- Delete is one click, no undo.
- Notes saved whole, no compare-and-swap: page clobbers agent/CLI/other-tab writes; `updateNotes` uses stale `notes`.
- `placeReviewNotes` restamps `render` on carried notes with zero shift: carry-overs look fresh. Need a fixed `writtenOn`.
- Markdown flattens multi-paragraph notes (`.replace(/\n+/g, ' ')`).
- Storyboard hard-codes 16:9 cover; tall/square renders crop.
- Proof-ground radios swallow hotkeys after click.
- After replace: download link and storyboard stills 410.
- `setFrame` per presented frame re-renders the entire screen; storyboard still cuts spawn unbounded ffmpeg
  (`review-stills.ts:25`, `still-sheet.ts:103`).
- Header "saved to review/notes-…" path relative to project while `media` is repo-relative.
- Old `version: 1` notes files load silently as "render unknown". (No migration: drop obsolete paths.)

## Layout / polish findings (from driving it in Chrome)

- Stage is 72vh: at 1440×723 transport and scrubber are below the fold; 9:16 stills overflow.
- Storyboard still click seeks but leaves you ~3500px below the player; stills misalign in rows; black boxes while
  cutting.
- Noise: RENDER UNKNOWN on every legacy note, raw `(0.80, 0.83)` in note headers, orange "newer file" banner on
  deliberately opened older files, long mono hint line, "1 SCENES"/"1 videos", truncated scene labels "e…", bare
  spinners, error pages with no way back, 1600px cap with wide gutters at 1920.
- Notes panel scrolls independently with no cue and doesn't follow playback.
- Projects index: text list, "0 STILLS" pills, no thumbnails, counts, last reviewed; no per-project page.
- Accessibility: scrubber is not a slider, notes not focusable, pin by mouse only.

## Features to build

### Review loop with agents (highest leverage)
- Note lifecycle on the code-review model (Gerrit/GitHub PR): each note has a stable short id, `writtenOn` render (never
  overwritten), a thread of replies (`author: 'reviewer' | 'agent'`, text, optional commit, render, time), and a state:
  open → addressed (agent) → resolved (reviewer only) or reopened. Kind: fix / question / keep.
- Copy notes and agent reads default to open/reopened notes only. Bulk resolve ("resolve all addressed after verifying").
- Notes per project keyed by moment, so animatic notes carry to the delivered render (Gerrit carries comments across
  patchsets). Decide in design whether one file per project or per render family.
- Safe concurrent writes: optimistic concurrency (revision counter / If-Match), page reloads live on external change.
- CLI: `studio review notes <p> [--open] [--json]` (placed on the current render, markdown with source file paths,
  pixel coords, frame image paths, a ready `studio look` line), `studio review reply <p> <id> "…" [--commit HEAD]
  [--addressed|--question]`, `studio review watch <p>` (blocks until notes change, prints the new/changed ones, exits;
  an agent runs it in the background and is woken on each comment).
- Frame image per note: the frame with the point circled and any drawing burned in, saved beside the notes, linked in the
  markdown so a multimodal agent can Read it.
- Drawing on the frame (arrow, circle, freehand), stored as 0–1 vectors.
- Render commit (workspace + engine, dirty flag) in the render snapshot (`lib/output/render/engine/render-snapshot.ts`;
  `render-history.ts` already computes via `gitState`); shown in the header and markdown.
- Auto-load a new render when no draft is open; optional "render in progress" marker from `studio render`.
- Skills (`skills/video-motion`, `video-kickoff`, `stills`, `video-sound`, `video-gen`) updated to the loop: open the
  review, run `studio review watch` in the background, reply/ask/mark addressed through the CLI.

### Viewer
- Keyboard on NLE conventions: J/K/L shuttle (rates), K+J/L step, I/O mark range, Home/End, `[` `]` prev/next note,
  Shift+`[` `]` prev/next scene, a key for next cue, `n`/Enter new note at playhead, `?` cheatsheet driven by the hotkey
  registry, mute/volume, loop range/note/scene at 0.25/0.5/1×. Use TanStack Hotkeys' primitives properly (scopes,
  registrations for the cheatsheet, formatting for display, ignore-inputs correctly).
- URL state `?f=<frame>&note=<id>` (+ file) survives reload, render switch and is copy-linkable.
- Zoom/pan/1:1 on stage; prev/next + thumbnail grid for stills; guide overlays (safe areas, platform crops, thirds) from
  the framing check's own geometry if it exists in `lib/`.
- Render history + compare: keep each render's bytes by hash (pruned), compare against an earlier one by toggle (hold),
  wipe, side-by-side, aligned by moment (`placeReviewMoment`). No pixel-diff (paint renders shift run to run).
- Waveform lane from peaks computed with ffmpeg into a sidecar.
- Projects index → dashboard: thumbnails, open-note counts, last reviewed, open decisions, stale items, per-project page
  listing every file.

### New review surfaces
- Decision primitive: `review/decisions/<topic>.json` = question + candidates (media or text, meta like cost, model,
  seed) + pick/reject + notes + sign-off. Agent writes via CLI (`studio review decide …` or similar), human picks in the
  app (Lightroom culling: P/X, two-up compare, survey, filter to picks; synced A/B player for audio/video, switching
  keeps the playhead), agent reads/watches the answer. Retires `scratch/**` hand-made A/B pages and `out/watch.html`.
- Script and voice read-along: `voiceover.json` lines + `audio/take.json` word times, karaoke highlight, notes on a line
  or word, sign-off on the script hash; A/B draft vs paid take or audition voices via decisions.
- Later tier if time: SFX cue sheet over `sfx/cues.json` alternatives, music fit/seam view, caption review.

## Prior art to follow (and deliberate departures)
- Gerrit/GitHub review threads for note lifecycle; resolving is the reviewer's.
- Frame.io version stacks, RV compare modes (wipe on W), SyncSketch ghosting; departure: align by moment, no diff mode.
- NLE keys J/K/L, I/O; departure: `[` `]` for notes since Shift+arrows step 10.
- Lightroom culling for decisions; pick/reject not star ratings.
- Descript for script read-along.
- HTTP ETag/If-Match for concurrent writes.
- Skip team features: roles, @mentions, assignees, share links.

## Repo rules that bite
- `lib/<area>/<feature>/{models,studio,engine}` import rules; feature layers and `visibility.json` grants; `#lib/*`
  imports; `lint/policy/studio-tree.ts` declares folders. Web app lives in `web/src/{features,shared,infrastructure,routes}`.
- Checks: `npm run check:arch`, `npm run lint`, `npm run typecheck`, `npm run typecheck:web`, `npm test`, each on its own.
  Heavy suites can go to the cloud: `studio remote run typecheck lint test:gate`.
- Comments: why, not what; under 60 words; no archaeology. Names greppable, one term per concept.
- No backward compatibility: no migrations of old notes files, remove obsolete paths.
- Tests: 2–5 per feature, behaviour through public interfaces, pure models in `models/`.
