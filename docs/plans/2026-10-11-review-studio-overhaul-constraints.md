# Review studio overhaul: constraints (design input to the plan)

Design constraints for the review studio overhaul (read-only pass; no source edited in `/Users/graham/Programming/media-studio-review`)

**Layout and grants (`lint/policy/studio-tree.ts`)**
- None of the brief's pieces needs a new `LIB_AREAS` entry or a change to `LIB_LAYERS`. Everything fits in `lib/output/*`, which is a peer area.
- A `visibility.json` at `lib/<area>/<feature>/visibility.json` lists the features allowed to import that feature, each with a reason (example: `lib/output/render/visibility.json`). Web and cli are not features, so they need no grants. Foundations (platform, timing, picture/captions, picture/stills, picture/measurement) need none either.
- The review feature already imports render and sfx-cues, and both grant it. It has no `visibility.json` of its own, so no other lib feature imports it.
- **Cycle trap:** review imports render, so render must never import review (feature-cycles), and render would also need a grant from review. That decides where three things go:
  - The commit stamp belongs in render's snapshot.
  - The "render in progress" marker belongs in `lib/output/render/engine`, and review reads it.
  - Waveform peaks must not be computed by `studio render` through review code. Either compute them in review on demand, cached by hash the way `review-stills.ts` does, or put a primitive in `lib/platform/ffmpeg/engine` (a foundation) that render can call.

**Where each piece goes**
- **Pure note lifecycle** (ids, `writtenOn`, threads, states, carrying notes by moment, revision/CAS check, markdown): `lib/output/review/models/`. Extend `review-notes.ts` and `review-moment.ts`, but keep each file under 600 lines (file-size).
- **Splitting files:** the folder-width check is advisory and fires past 15 source files. `review/models` has 4 today, so splitting into `review-note-thread.ts`, `review-drawing.ts` and so on is fine.
- **Decisions:** make a new peer feature `lib/output/review-decisions/{models,engine}` (or keep it inside review). If review's dashboard code imports it, add `lib/output/review-decisions/visibility.json` with `"lib/output/review": "<reason>"`.
- **Read-along:** in review, reading `timing/voice` (a foundation). The `take.json` types are private to `lib/timing/voice/engine/voice-project.ts` (line 38), so export a model type from `lib/timing/voice/models/`.
- **Guide overlays:**
  - Platform UI zones: `STILL_UI_ZONES` and `STILL_FEED_SIZES` in `lib/picture/stills/models/still-presets.ts`.
  - Caption band: `captionSafeArea`, `pillCaptionBand` and `captionFreeRect` in `lib/picture/captions/models/caption-band.ts`.
  - There is no generic title/action-safe or thirds geometry anywhere in lib. `framing-check.ts` checks overlaps in bounding boxes and holds no guide geometry. Write a small pure model in review/models that pulls the zones and the caption band.
- **Engine I/O** (CAS save, watch, frame burn-in, peaks, version store): `lib/output/review/engine/`.
  - Commit for the snapshot: `gitState(dir)` is in `lib/platform/host/engine/hosts.ts`; `render-history.ts:87` shows the engine-plus-workspace pattern.
  - Bumping `RENDER_SNAPSHOT_VERSION` (currently 10) makes `loadRenderSnapshot` reject every existing render's snapshot (shown as "render it again"). That fits the no-compat rule, but every old render loses its timing in review.
  - `remote-render.ts:74,78` also writes snapshots and runs in a container, so the commit has to be passed in, not read there.
- **Concurrency limit:** there is no limiter in `lib/platform`. `review-stills.ts` and `still-sheet.ts:103` start ffmpeg without a bound. Add a small limiter in the review engine (or a platform foundation).
- **Note frame images:** ffmpeg has no SVG/circle drawing. Use `rasterizeHtmlPages` (`lib/platform/raster/engine/html-raster.ts`, Chrome), as `still-sheet.ts` does, or an ffmpeg overlay of a generated PNG.
- **CLI:** `cli/commands/review.ts`, kept thin with lazy `await import('#lib/...engine...')`.
  - **citty 0.2.2 gotcha:** once a command has `subCommands`, any first positional that isn't a subcommand name throws `Unknown command`, and `default` applies only when there is no positional. So `studio review <project>` cannot stay alongside `notes`/`reply`/`watch`/`decide`.
  - Options: make it `studio review open <target>` and drop the old form, which matches the no-compat rule, or make the verbs top-level commands.
  - Subcommand pattern to copy: `cli/commands/paint.ts:176`, `remote.ts:105`. Strict flags: `refuseUnknownCommandFlags` in `cli/command-flags.ts`.

**Web (`web/src`)**
- **Server functions** go only in `features/<f>/controllers/`, spelled `.validator(Schema.toStandardSchemaV1(...))` (never `.inputValidator`). A module that defines them exports only the server functions and types. Copy `features/review/controllers/review-artifact.ts`.
- **Engine code** is reached only through `infrastructure/studio-engine.server.ts` (`WEB_ENGINE_DOOR`); add re-exports there. Vite's importProtection also errors on `#lib/*/*/engine/` from client code.
- **Routes stay thin:**
  - Raw HTTP: `server: { handlers: { GET } }` calling a `createServerOnlyFn` from the feature barrel (`routes/review-stills.$project.ts` with `controllers/review-still-response.ts`). This suits SSE for live updates and frame/peaks files.
  - Pages: a loader with `ensureQueryData` (`routes/projects.$project.artifacts.$.tsx`).
  - Routes may import lib models directly (`projects.$project.index.tsx`).
- **Live updates:** today `review-queries.ts` polls status every 2 s (`refetchInterval`) and the artifact query has `staleTime: Infinity`. Extend the status poll with a notes revision, or add SSE.
- **Saves:** `use-review-notes.ts` serializes saves with a mutation `scope`. Replace the whole-file save with per-op plus revision.
- **Validation:** the note's Effect Schema lives in `controllers/review-note-schema.ts`, tied to the model with `satisfies`. The CLI and `watch` read the same file, so consider moving the schema into `lib/output/review/models`. Effect has no SDK owner restriction (`lint/policy/sdk-owners.ts`) and lib doesn't use it yet. Unverified whether model-purity objects.
- **Styling rules:**
  - No raw `div`/`span`/`button`/`img` in features (no-raw-primitives); use Mantine Box/Group/Stack/Text/UnstyledButton.
  - Wrapped Mantine components (TextInput, Textarea) must come from `shared/ui/*` (vendor-component-containment).
  - No inline colour, font size or `style` props, and no StyleX border shorthand. Every value is a token from `shared/ui/theme.stylex.ts` (which may export only `defineVars`); shadows only from `shared/ui/shadows.ts`.
- **Component lint:** warnings at 7+ hooks or 8+ props per component; one component export per file (warn); no async `useEffect` (no-async-effect).
- **Feature layering:** inside a feature, `ui` imports `controllers` and never the reverse; other code reaches a feature only through its `index.ts`.
- **Hotkeys (`@tanstack/react-hotkeys` 0.10):** `useHotkeys`, `useHotkeyRegistrations` (feeds a `?` cheatsheet), `useKeyHold` (hold-to-compare, K+J/L), `useHeldKeys`, `HotkeysProvider`, `useHotkeySequence`. `formatForDisplay` and `formatWithLabels` come from `@tanstack/hotkeys`.
  - Options: `enabled`, `ignoreInputs`, `target` (element-scoped), `conflictBehavior`, `requireReset`, `eventType`, `meta {name, description}`; `HotkeyMeta` is augmentable (e.g. a category).
  - There is no named "scope" API: scope through `target` and `enabled`.
  - Shifted punctuation needs the raw spelling (see `use-review-hotkeys.ts`).

**Comments and naming:** under 60 words and 15 lines per comment (no-long-comments), and every `as` needs a `// SAFETY:` comment. No `as unknown as` and no `Record<string, unknown>` bags (no-opaque-record).

**Tests**
- `npm run test:gate` is `node --test 'lib/**/*.test.ts' 'lint/**/*.test.ts'`.
- No web or cli tests run anywhere, so put testable logic in `lib/output/review/models` (or engine) specs named after their module (test-file-mirror).
- Patterns: `review-notes.test.ts`, `review-moment.test.ts`, `still-sheet.test.ts`.

**Running from the worktree**
- **App:** `node cli/studio.ts review <target> --port 4393 --no-open`. That argument shape changes if `review` gains subcommands.
- **Checks**, each on its own:
  - `npm run check:arch -- --scope public`: about 19 s, passes now.
  - `npm run lint -- --scope public`
  - `npm run typecheck:gate`
  - `npm run typecheck:web`
  - `npm run test:gate`
  - With no `--scope`, check:arch and lint also judge `work/`, which is Graham's real workspace through a symlink.
  - `npm run typecheck` and `npm test` include `work/projects`.
- **Baselines:** fixing a baselined finding leaves a stale entry that blocks, so rerun with `-- --scope public --update-baseline`.

**Worktree gotchas**
- `node_modules` and `work` are symlinks into `../media-studio`.
  - `resolveProjectMedia` returns realpaths, so `saveReviewNotes` writes `media: relative(STUDIO_ROOT, media)` as `../media-studio/work/projects/...` from this worktree. That feeds the brief's header-path bug.
  - Unverified: Vite's dep cache (`node_modules/.vite`) is shared with the main checkout's app.
  - Unverified: whether `studio remote run` handles the symlinked tree.
- Only the sandbox projects should be written to. `work/projects/zz-review-sandbox-voice/audio/take.json` exists, as does `review/notes-*.json` in `zz-review-sandbox`.
- `docs/doc-budgets.manifest.json` is empty, so docs have no word ceilings. `skills/` is ungoverned (`skills/video-motion`, `video-kickoff`, `stills`, `video-sound`, `video-gen` `SKILL.md`).