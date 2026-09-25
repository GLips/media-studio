# Enforced architecture for the studio: plan

Ticket: vid-39. Status: **settled**. Graham decided the direction with the foreman and a second Codex review (session `01a0da53-ed26-7550-a642-e0db9a9f7683`). This document plans; the slices in §9 carry it out.

Graham wants **strong guardrails, above all so a new project starts on the right path**. A rule is dropped only case by case, with its reason written down (§5.4).

## Background

This plan was produced with the `enforced-architecture` skill, adapted. The skill's unit is a web-app feature. Here it is a **video project** (`projects/<p>/`), built on a shared studio (`lib/`, `cli/`, `lab/`, `skills/`).

- **Taken from the skill:** its machinery. Two tiers (oxlint per file, structural over the tree), one policy both tiers read, blocking rules, and specs with an adversarial case.
- **Left behind:** its web-app position table. The studio gets its own classifier and table.

vid-23 spent 76% of its agent time on model turns. Two causes drove the turn count, and every rule below answers one of them:
- **one fact restated in many files**, which was timing;
- **big files holding several concerns.**

Facts are measured at `7411013` (after vid-23's `f3115a5`). vid-43 refreshes the full violation inventory as its first step.

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **A studio classifier and import table** reuses the catalog's resolver, import graph, runners and diagnostics, and the reused rules (§5.1). Mapping the studio onto routes/features/domains would hide what each position may actually do |
| D2 | **Split `lib/` into `models/`, `studio/` and `engine/`, incrementally, one slice at a time.** The top level of each holds **only subfolders** (plus `lib/studio/api.ts`) |
| D3 | **A typed timeline with named cues and resolved local clocks** (§3) replaces the opaque `Moment` of the first draft. Local numeric animation inside a scene is legal |
| D4 | **Aliases `#studio`, `#models/*`, `#engine/*`** (package.json subpath imports). Both tiers resolve an alias to its canonical file *before* checking ownership. Re-exports keep their dependency edges |
| D5 | **One owner module per contained SDK:** playwright, ffmpeg/ffprobe, `@remotion/renderer` with `@remotion/bundler`, and esbuild |
| D6 | **`studio new` scaffolds compliant projects** for each capability (§6). New projects block from their first commit. Older projects are baselined and block as each one migrates |
| D7 | **Each committing agent works in its own git worktree**, with one integration owner (§8) |
| D8 | **Docs:** CLAUDE.md plus the skills, with word budgets. No `docs/architecture/` |

---

## 2. Target architecture

### Tree

```
lib/
  models/              Loads in plain Node, with no DOM, rendering or I/O. Subfolders only, e.g.:
    timeline/          defineTimeline, its drivers, cues, speech cues, landmarks, local-clock resolution
    motion/            easing, springs, motion graph
    reel/              each reel piece's model (pose, plan, layout): bouncingBallAt, needlePoseAt, reelHudBoxes …
  studio/              Render: React, Remotion, three, p5. Subfolders only, plus:
    api.ts             the ONE barrel a project's picture imports (#studio)
    timeline/ fonts/ frame/ reel/ paint/ …
  engine/              Node: fs, spawn, and the contained SDKs. Subfolders only, e.g.:
    render/ bundle/ capture/ ffmpeg/ voice/ generation/ snapshot/
cli/                   citty commands over engine
lab/                   server (→ engine, models) and app (→ studio, models)
brands/<kit>/brand.ts  a brand kit
projects/<p>/
  timeline.ts          schedule declarations ONLY: defineTimeline's scenes, cues, landmarks, replays. Imports #models/*, never #studio
  video.tsx            composition: bindTimeline maps each scene to its component
  stills.tsx           still designs, presets, variants
  brand.ts             the project's brand overrides
  capture.ts           shots, through #engine/capture
  bars/<id>.tsx | scenes/<id>.tsx    one scene per file
  bars/<id>/ | scenes/<id>/          that scene's own helpers, including a project-specific x-model.ts
  <declared shared modules>          e.g. look.ts (palette, inks): shared by scenes, never importing back into one
  sfx/                 sounds named by role
  tools/               project QA levers; timing comes from `studio clock`
  review/              notes
  generated/           generated modules (brand.ts merge, …)
  out/                 renders, each with its snapshot beside it
scratch/               gitignored. No tracked file refers to it
```

**Folder rules.** Folder names are free and grouped by domain; the tree above is a sketch, not a fixed list. Modules inside a folder are imported explicitly, and folders don't each get an `index.ts` barrel. An advisory warning fires when a folder holds more than about 15 source files directly.

### Where work goes

| Working on… | Look in |
|---|---|
| When anything happens | `projects/<p>/timeline.ts` |
| A scene's picture | `bars/<id>.tsx` or `scenes/<id>.tsx`, with its helpers in the folder of the same name |
| A reusable piece's pose, plan or layout | `lib/models/reel/` |
| That piece's drawing | `lib/studio/reel/` |
| A question asked of a render | a `studio` command (vid-38) |
| Bar and beat frames for a Python or shell tool | `studio clock <project>` (vid-41) |
| Starting a project | `studio new` |

### Dependency graph (anything absent is denied)

```
cli, lab/server, project capture, project tools ──► engine ──► models
project video, scenes, stills ──► #studio ──► studio ──► models
project timeline.ts, x-model.ts ──► #models/*          (never #studio: its barrel pulls in rendering)
scene ──► its own folder, declared shared modules, #studio, #models/*
lab/app ──► studio, models

DENIED: project → another project · tracked file → scratch/ · shared module → a scene ·
        scene → another scene's folder · models → studio | engine | DOM | I/O · studio → engine
```

---

## 3. The timing contract

vid-41 (41a) builds it, starting from the showcase's `timeline.ts` and `tools/bar-clock.ts`, whose conversion rendered pixel-identical. vid-41b adds the real voice driver. Settled with Graham and Codex (session `01a0da9d-8dea-75d3-97ea-70ff27429c1f`).

**One resolved timeline.** `defineTimeline` in `timeline.ts` lists scenes in order. Each scene has exactly one of three drivers, and only these three: a closed set, not a plug-in point.
- **`beatSpan`**: a length in beats on a beat grid. The grid is backed by a fitted recording or is tempo-only, so rhythm doesn't need sound.
- **`voiceSpan`**: lines plus lead, gap, tail and a minimum. The recorded speech sets the length.
- **`fixedSpan`**: a length in seconds.

Resolution yields every scene's origin, nominal span and visible span, the audio placements, cues and landmarks. It is the one result the render, `studio clock` and the checks all read.

**One duration authority per scene.**
- **Voice over a bed:** the voice sets the length. The bed is trimmed, looped or explicitly refit afterwards.
- **A voiced line in a music scene:** placed inside its beats. If it overflows, resolution fails.
- **Never silently:** speech is not stretched, the recording is not lengthened, and a voice scene can't push later music scenes off their beats.
- **No `fixedSpan` inside a musical section.**

**Units.**
- `s.t` is in seconds.
- Positions are authored in beats (music) or words (speech: `{ line, phrase, nth? }`, replacing offsets like sale-only-view's `landAt + 3.2`).
- A frame duration is an explicit escape hatch, for two-frame flashes.
- Frames are rounded once, at render.
- Picture lead and sound lag are separate explicit offsets.

**Cues** live under their owning scene in `timeline.ts`. Their qualified names (`ink.strike`) are inferred and typed, so a misspelt cue fails to compile. Cycles are rejected. A scene reaches another scene's moment only through a cue, never through another scene's beats or an exported `…Moments` object. Referencing a cue never changes a scene's duration.

**Landmarks** are cue-to-recording constraints: the final hit at least, at the current tolerance. They stay pending until a recording is bound. A mismatch throws and names both fixes: re-fit with `studio music fit --bars`, or change the timeline.

**Binding.** `bindTimeline(timeline, { ink: Ink, … })` in `video.tsx` maps exactly one component to each scene key and overrides no schedule. A finale that replays earlier scenes gets typed replay bindings, injected by `video.tsx`. The timeline declares the source cue, target cue and rate. Replay doesn't replay audio, and no scene imports a sibling.

**Scenes use resolved local clocks.** A scene receives its beats, lines and cues already resolved on its own clock. A cue from another scene may land before 0 or after the scene's end. Origin, nominal cut and visible interval stay distinct, so `cutIn`, centred crossfades and a ring-out after the last beat all work. Inside a scene, numeric animation is legal: spring durations, keyframe offsets, glyph clip keys.

**Moves.** A move is a start plus a duration, anchored at one end, not pinned between two scenes' moments. Code alone can't tell a deliberate stretch from bar 3's old dive, so the retime runner holds this behaviourally (check (e)) and the motion skill teaches it. `expect()` checks against resolved times. Previs retime still refuses to retime generated audio.

`studio clock <project>` prints the resolved timeline as JSON for Python and shell tools, so no tool writes a frame of its own.

---

## 4. Classifier

There is one declared tree, rooted at `.`.

**Positions:**
- `lib/models/*`, `lib/studio/*`, `lib/studio/api.ts`, `lib/engine/*`
- `cli`, `lab/*`, `brands/<kit>/brand.ts`
- in each project, the roles `timeline.ts`, `video.tsx`, `stills.tsx`, `brand.ts` and `capture.ts`, plus scene files and scene folders, **declared shared modules**, `sfx/`, `tools/`, `review/`, `generated/` and `out/`

**Mechanics the catalog doesn't have:**
- **Alias resolution before ownership.** `#studio` resolves to `lib/studio/api.ts`, and `#models/x` to `lib/models/x`. Both tiers call one function, reading package.json's `imports`, so a crossing can't pass by being spelled as an alias.
- **Re-exports keep their edges.** A barrel re-exporting a module passes that module's dependencies on to the importer. So `#studio` counts as importing rendering code, and that is why a timeline may not import it.
- **Erased type imports are not dependencies.** A runtime-purity check must separate an `import type`, which is erased, from an executable import. Flagging the first would force pointless type duplication.
- **Generated output inside a project:** `projects/*/out/` and `projects/*/generated/` are exempt, and so is `lint/`'s adversarial fixture tree.

**Undeclared, and therefore ungoverned:** `scratch/`, `node_modules/` and `skills/**`. The skills are covered by `doc-budgets`, not linted. Python and shell files are invisible to both lint tiers; check (d) and `studio clock` cover them.

---

## 5. Guardrails

### 5.1 Kept from the catalog

**Audit each reused rule against real studio code before enabling it.** A rule that misfires on legitimate animation code is fixed or dropped with a reason, never switched to advisory quietly.

| Guardrail | Setting | Blocks |
|---|---|---|
| `boundary/import-policy` (both tiers) | studio classifier and table (§2, §4) | yes |
| `health/file-size` | warn 300, fail 400. It is paired with scene ownership (b), so splitting a file can't launder a tangle into a sibling. A schedule genuinely over 400 lines gets a documented exception | yes |
| jscpd | over `lib cli lab projects brands`. Excludes generated output and adversarial fixtures. Intentional independent duplication gets a reviewed exception, never a forced cross-scene import or an artificial shared helper | yes |
| `health/no-long-comments` | standard: 60 words, 15 lines, 2× for a file header | yes |
| `health/*` complexity trio, `types/*`, `react/*`, `naming/no-vacant-symbol-names`, `boundary/no-test-imports`, `boundary/ambient-globals`, `testing/no-module-mocking` | standard, after the audit above | per the rule's header |
| `boundary/sdk-containment` | one owner each: playwright → `engine/capture`, ffmpeg/ffprobe → `engine/ffmpeg` (a binary table, read from `spawn`/`execFile` arguments), `@remotion/renderer` and `@remotion/bundler` → `engine/render` and `engine/bundle`, esbuild → `engine/bundle` | yes |
| `health/doc-budgets` | `CLAUDE.md`, `README.md`, `docs/directing.md`, `skills/*/SKILL.md` and skill references, excluding reference-reel analyses | yes |

### 5.2 Studio checks

| Check | What it holds | Blocks |
|---|---|---|
| **(a) Timing ownership** | Timing constructors (`defineTimeline`, its drivers, cues, speech cues, landmarks, replay declarations) are imported only in `projects/<p>/timeline.ts`. `bindTimeline` belongs to `video.tsx` and is not one | yes |
| **(b) Scene ownership** | A scene's helpers live in `bars/<id>/` or `scenes/<id>/`. A declared shared module never imports back into a scene. An **unclassified helper** that a scene reaches fails the check. A project-specific `x-model.ts` may sit beside its scene; it gets both this check and (c), and isn't moved into `lib/` just to satisfy placement | yes |
| **(c) Model purity** | A model (`lib/models/**`, and a project's `x-model.ts` and `timeline.ts`) loads in plain Node, its evaluator tests run against it, and a transitive scan finds no browser or I/O code. `timeline.ts` and models import `#models/*`, never `#studio` | yes |
| **(d) No scratch** | No tracked text file refers to `scratch/`: code, shell, Markdown or config | yes |
| **(e) Retime runner** | Every timed project registers with one shared retime runner. On a refitted or synthetic timeline, lengthening a bar moves every downstream cue and keeps each registered move's duration. On the unchanged recording, the landmark check refuses the same edit. The test script finds `projects/**/*.test.ts` explicitly; today `package.json` runs only `lib/**` | yes |
| **(f) One snapshot loader** | Every render writes an artifact-bound timeline snapshot beside it, including a partial render's frame origin. One loader reads snapshots, and nothing reads the mutable `out/check/timeline.json` for a render. Today `lab/review/server.ts:154` and `lab/manifest.ts:195` do | yes |
| Folder width | more than about 15 source files directly in one `lib/` folder | advisory |
| `no-history-comments` | a narrow phrase list ("previously", "formerly", "used to be", "was replaced") | advisory |
| `no-frame-cite` | `f\d{2,4}` or `frame \d+` in comments. It misses bare numbers. Evidence and reference-reel analyses are exempt, and `beats.md` is generated | advisory |
| Role names | a sound or asset under a project named with a 3+ digit trailing number. The showcase already complies after `f3115a5`, so this guards against regression | yes |
| Capability match | a project's declared capability (§6) matches the composition's actual bindings | yes |

### 5.3 How the ticket's ten rules land

| Ticket rule | Held by |
|---|---|
| 1. One timing source | the typed timeline (§3), plus checks (a) and (b) |
| 2. Frames only through the timeline, voice through words | named cues, local clocks and speech cues (§3). Local numerics are legal |
| 3. Music relation checked | landmarks at load (vid-41), plus check (e) |
| 4. A move anchored at one end | check (e)'s registered durations, plus the motion skill |
| 5. Tools read the code | `studio clock` and vid-38's commands, plus check (f) |
| 6. Name by role | the role-names check |
| 7. Notes cite beats or cues | check (f), plus vid-42 (a note keeps its bar and beat or its line and word), plus `no-frame-cite` (advisory) |
| 8. Small, single-purpose files | file size plus (b) and (c), the `lib/` layout rules, and `timeline.ts` owning only schedules |
| 9. One home per tool | (d), jscpd, vid-38's index |
| 10. Comment rules | `no-long-comments` (blocks) and `no-history-comments` (advisory) |

### 5.4 Dropped, with reasons

- **Opaque `Moment`.** The typed timeline with named cues holds the same fact with less ceremony, and legitimate local animation stays plain numbers.
- **`no-literal-moment`.** It misfires on legitimate literals and still misses `landAt + 3.2`.
- **three and p5 containment.** Their wrappers would become kitchen sinks.
- **Catalog rules with no subject here:** DB, server functions/TanStack, Effect and `style/*`. They aren't copied.

---

## 6. Project capabilities and `studio new`

A project declares one of four capabilities, and the capability-match check holds it to the composition's actual bindings.

| Capability | Scaffolded with |
|---|---|
| **music-led** | a bar table, one file per bar, named cues, a landmark, retime-runner registration |
| **voice-led** | scenes, speech cues, retime-runner registration |
| **still-only** | registration of its designs, presets and variants, plus a snapshot identity. **No** dummy timeline and **no** retime test |
| **mixed** | the union of what its parts need |

- **The scaffold writes no snapshot file.** It wires in the snapshot writer, and the normal render path writes artifact-bound metadata.
- **A test proves the scaffold.** It generates each supported kind in a temporary workspace, then runs the architecture check, typecheck and the registered tests. Each must pass with no manual repair.
- **New projects block automatically.** Older projects sit in the baseline and block as each migrates.

---

## 7. Documentation

- **CLAUDE.md** gets a rules section of at most 250 words:
  - the commands;
  - the three `lib/` positions and the subfolders-only rule;
  - a project's anatomy;
  - "timing lives in `timeline.ts`; a scene reaches another's moment by cue";
  - "start a project with `studio new`";
  - "lint and the hook enforce this".
- **`skills/video-motion`** teaches the timing contract, and moves as a start plus a duration. It also carries vid-38's "to know X, run Y" table.
- **`skills/video-kickoff`** starts music-led work from the bar table (vid-40).

---

## 8. Process

- **Worktrees.** Each committing agent works in its own git worktree. One integration owner merges the slices onto `main` and resolves conflicts, so a shared file isn't edited by two sessions at once.
- **No `git stash`** while other agents are live.
- **Known red:** `projects/2026-09-sale-only-view/audio/manifest.ts` lacks `pauseBefore`, which breaks `typecheck`. The baseline records it, and the sale-only-view migration clears it.
- **Verification is each command on its own:** `check:arch`, `typecheck`, `test`. A chained `&&` hides every failure after the first.

---

## 9. Slices

Each slice is ticket-sized and ends on an exit someone can verify. Order: vid-43 → vid-41 (then vid-41b) → the vid-38 slices and the lib split slices (in parallel, in separate worktrees) → the scaffold. The full pre-commit gate switches on with the scaffold, because by then every new project is compliant from its first commit.

| Slice | Delivers | Exit |
|---|---|---|
| **vid-43 Groundwork** | `lint/` with the catalog machinery. The studio classifier with alias resolution before ownership, re-export edges and type-import erasure. Checks (a), (b), (c) and (d). An explicit baseline of today's violations, so existing code reports without blocking | `check:arch` runs over the whole tree and prints the baseline. Each check's spec includes an adversarial case, and a deliberate violation added to a non-baselined file fails. The test script finds `projects/**/*.test.ts` |
| **vid-41 Timeline contract (41a)** | `defineTimeline` in `lib/models/timeline/`, with `beatSpan` and `fixedSpan`, owned cues, landmarks and local clocks. `bindTimeline` with replay bindings. `studio clock`. The shared retime runner, check (e), covering cue movement, move durations, replay alignment, audio placement and overlaps. A small voice adapter and a mixed fixture, proving the result fits voice. The new constructors added to check (a). The showcase onto it, with `bar-clock.ts` deleted. The motion skill's section | The showcase renders pixel-identical before and after. The retime runner passes on a synthetic or refitted timeline with a bar lengthened, and the landmark check refuses the same edit on the real recording. The showcase leaves the baseline and blocks. Its tools read `studio clock` |
| **vid-41b Voice driver** | The real `voiceSpan`, with the adapter retired. Speech cues. sale-only-view onto them | sale-only-view's `landAt + …` offsets are gone, and its timing leaves the baseline. The mixed fixture runs on the real driver |
| **vid-38a Frames in `studio look`** | `--frames`, `--video`, `--against` with a changed-pixel count, one decode per source, motion stats over a range or bar | Each deleted script's question (`render-diff.py`, `motion-stats.py`, the scratch sheet scripts) has a command answer, and those scripts are gone |
| **vid-38b Reading models without a render** | `look --graph` reading a piece's exported model, plus a HUD clearance check from `reelHudBoxes` | Positions for the bounce, needle and bar 8's camera print from code with no render. Clearance reports a margin per frame |
| **vid-38c Render slices and snapshots** | `studio render --frames=a:b` with a kept bundle. Check (f): the snapshot writer on every render path (a partial render records its frame origin) and one loader, with review and lab moved onto it. The "to know X, run Y" index | `render-bars.ts` is deleted. No reader of `out/check/timeline.json` is left for a render. A review opened on an old render reads that render's own snapshot |
| **Lib split 1: `models/`** | `lib/models/{timeline,motion,reel,…}`; the reel pieces' models extracted from their drawings (bounce, needle, glyph-field, column-field, capture-plane, hud) | (c) passes for every model, and each loads in plain Node. No reel piece file is over 400 lines |
| **Lib split 2: `studio/` subfolders** | `lib/studio/` reduced to subfolders plus `api.ts`, with projects importing `#studio` | No top-level module left in `lib/studio` except `api.ts`. No project imports `lib/studio` relatively |
| **Lib split 3: `engine/` and containment** | `lib/engine/{render,bundle,capture,ffmpeg,…}` and the four SDK owners; the top-level `lib/*.ts` redistributed; project captures on `#engine/capture` | `sdk-containment` passes with no baseline entries, and no `.ts` file is left directly in `lib/` |
| **Scaffold** | `studio new` for music-led, voice-led, still-only and mixed. The capability-match check. The generate-and-check test. The full pre-commit gate | The test generates each kind in a temporary workspace and passes `check:arch`, `typecheck` and its tests unrepaired. The gate goes red on a deliberate violation |

**Migrating the other projects** (the other voice projects' timing into `timeline.ts`, the oversized files that remain) is not in these slices. Each project leaves the baseline in its own ticket, once the contract it needs exists.

## Open questions

None. Graham's decisions answer the first draft's five questions:
- the dive and every move are a start plus a duration, held by the retime runner;
- new projects block from the start, and old ones as they migrate;
- the size limits are warn 300 and fail 400;
- a tool reads `studio clock` and the snapshot loader.
