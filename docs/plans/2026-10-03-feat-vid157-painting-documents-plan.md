---
title: "feat: Paintings as TS documents, solved per wash, composed in a PaintedShot (vid-157)"
type: feat
status: draft
date: 2026-10-03
---

# Plan: painting sources, documents and composition (vid-157)

## Context

Authoring a painting today means driving a catalogue of fixed techniques (passages, waits, knockouts, recipes) through
a builder. Agents guess at what a technique will do, the same idea is spelt several ways, and anything the catalogue
lacks needs engine work. vid-157 replaces the authoring surface: a painting is a pure TS factory that returns a
`PaintingDocument`, mostly data, with helpers as ordinary code. The engine validates the document, schedules its
applications forward against real wet state, solves it per wash, and the scene composes the result on main's
existing planes, camera, motion and rig.

The design lives in `~/research/2026-10-02-vid-157/v6/`:

- `AUTHOR.md`: the author page. It becomes `docs/painting-authoring.md` in phase 1.
- `ENGINE.md`: the engine contract (validation, scheduling, the wash as cache unit, sheets, composition, tests).
- `OPEN-QUESTIONS.md`: Graham's decisions (binding, at the top) and provisional defaults for taste calls.
- `types/`: the reconciled document and source-module types; `examples/minimal/` a worked example.
- `../impl-prep/renderer-map.md` (the renderer's extraction seams and landmines) and `../impl-prep/main-delta.md`
  (what vid-149 and vid-150 changed under the spec).

It came from 21 rounds with Codex, two rounds of example paintings, and cold-author tests in four media. The design is
not yet approved: this branch builds it so Graham can review the design and a working build together. Nothing lands
on main until he does.

## Decisions that hold in every phase

- **A source is TS, mostly data.** Techniques are throwaway per-picture functions; nothing subject-specific enters the
  format. There is no standalone JSON authoring.
- **A sheet is one painting**: one paper, one grain, one cut edge, one wet history. An element on its own sheet is a
  cut-out whose grain travels with it. An element on a shared sheet is painted into that sheet's painting at its
  current pose, so its grain stays still, and it mingles or glazes by the ordinary wet vocabulary. Layer and group
  boundaries don't dry a sheet: its applications run as one sheet program with one wet field, each layer keeping
  its own film.
- **Posing is group poses from the scene.** On an own sheet a pose moves finished paint; on a shared sheet it moves
  the group's deposits before the sheet re-solves. Parts, `brushSpace` and part-subtree targets don't exist.
- **Scheduling is forward.** Applications run in authored order, each at the earliest time its `on:` holds over its
  effective core, read from the actual simulated state. No global solver, no waits.
- **Drying runs from instant to never** per wash: `clock {origin, dryingScale}`, `"instant"`, `"never"`.
- **No migration yet.** Existing workspace projects keep the old builder, renderer and `StampPainting` untouched.
  The new path is built beside them; shared GPU stages are extracted into modules both paths call, never copied.
  `PaintedShot` sits beside `StampPainting` and the sources renderer, on `stamp-lens-source-layers.ts`.
- **Reuse main.** Planes (including vid-149's picture source), camera, motion, pins, rig cuts and skin as they are
  (cels skinned across layers, bends, cel and view swaps), clocks, channels, boil, three sources. The drawn-cut
  resolver stays in the paint session.
- **The engine is in flux.** Judge renders by eye at delivery size; repeatability tests use `studio repeatable`.

## Phase 1: Documents and checks (near-term)

### Goal
A painting source can be written, typechecked, evaluated and checked without the GPU, and the author page ships as
`docs/painting-authoring.md`.

### Motivation
Every later phase, and every demo author, consumes the document types and their checks. Demo paintings can be written
against this phase while the solver is built.

### Key decisions
- A new `lib/paint/document` feature (models role) holds the types, `painting()`, property checks, validation and
  the problem record; declare it in `lint/policy/studio-tree.ts` at the layer the spec's composition needs.
- Validation reports owner key, field and footprint for every rule in ENGINE §2.
- `studio paint check <source>` evaluates a source at its default (or given) property values and prints problems.
- The sheet-order model (entries, order times, group chains, the program's clock) is a pure model here, so the
  solver consumes it rather than inventing it.
- The evaluation diff and `studio paint diff` belong here too: what changed between two evaluations, and which
  sheet entries downstream of it must re-solve.
- The worked example in `docs/painting-authoring.md` is a real, checked source.

### Affected surface area
`lib/paint/` (new feature), `lint/policy/studio-tree.ts`, the studio CLI (`cli/`), `docs/`.

### Non-obvious context
The spec's types import main's camera, clock, warp and rig types; keep those imports rather than re-declaring them.

### Acceptance criteria
- ENGINE tests 1 (a table of broken documents, each to its exact problem) and 2 (the evaluation diff).
- The worked example and the four cold-author paintings' sources check clean or fail only on what they really got
  wrong.

## Phase 2: Compiler and wash solver (near-term)

### Goal
A checked document renders: compiled to deposits and masks, solved as a sheet program on the GPU with forward
scheduling against real wet state, on the root sheet, including one shared-sheet wet-contact case.

### Motivation
This is the engine half of the language and the critical path: everything visible depends on it.

### Key decisions
- The compiler emits the renderer's existing deposit and mask forms (`CompiledStampDeposit`, `CompiledStampMask`)
  under its own document form, not `CompiledStampPaint`, whose wash schedule carries waits.
- The solver is a new module beside `stamp-paint-renderer.ts`, calling the stages the extract slice already pulled
  out of it (deposit drawing and its `wash`, deposit bank, region and brushed-mask textures, the wash ledger, the
  uniform arena, box copies, the compositor choice, scratch reserve). The old renderer calls the same modules.
- The scheduler reads wetness over each application's effective core with overflow-safe hierarchical GPU
  reductions (two-word totals), replacing the closed-form wait estimate for the new path only.
- Cache identity is a chain of application-state keys, each layer's pigment-slot schema entering at its first
  entry. Schedule decisions are cached by the physical inputs they read; a changed pose or reseed schedules again.
- A device-wide solve lease serialises solves on shared scratch; no encoder stays unsubmitted across an await.
- Rim ownership is causal on the new path: an application's own wet edges are decided at landing, so a later
  application never changes an earlier checkpoint. The old path keeps its rule.

### Affected surface area
`lib/paint/painting/studio/` (renderer, wet stages, compositors), `lib/paint/painting/models/` (wetness, stage,
frame plan), `lib/platform/gpu/`, the stamp gate.

### Non-obvious context (from the renderer map)
- Targets come from the device owner and are shared by every painting on the device. An async solve that waits on a
  readback can have its film, wet paper, rim and clip overwritten meanwhile: a solve owns its targets, or solves are
  serialised.
- Work inside `owner.checked` must never await; readbacks happen outside it, as `trace` does.
- Flow, bloom, transport and rim write uniforms when encoded: a plan encoded twice in one submit keeps only its last
  write. Scratch growth during planning destroys textures; reserve scratch at solve start.
- Each land overwrites the landing, prepare and dried clear the rim, clip clears for every unclipped pass: the core
  sampling pass needs its own target.
- New shaders sample with explicit gradients from the vertex (`textureSampleGrad`, vid-158); reductions use integer
  atomics only; decided schedules are cached by the inputs they read, since each Remotion tab decides its own.
- Every extraction is checked against `npm run stamp:gate`, judged by eye.

### Considered but deferred
Several papers in one renderer (phase 4): paper grain is bound once per renderer and paper colour is baked into the
compositor today.

### Acceptance criteria
- ENGINE test 3 (`schedule/forward`, render accepted by eye, append-only checkpoints) and the reduction test.
- The old path's gate cases still pass, judged by eye if anything moved.
- The worked example renders through `studio paint` (or the phase's still command).

## Phase 3: Clocks and prefixes (mid-term)

### Goal
Clocked washes, fixed `at` times, `instant` and `never`, timed prefixes and optional checkpoints, finishing on a copy.

### Key decisions
Prefix renders never mutate resumable state; checkpoints keep all persistent state or aren't used. ENGINE test 4.

## Phase 4: Sheets (mid-term)

### Goal
Several papers in one renderer, own-sheet edges, nested sheets, elements entering a shared sheet's program at their
pose, and posing before painting on shared
sheets with its cache. vid-151's done-when: the heron in each paper mode, a nested case, grain visibly still on the
scene's sheet (ENGINE test 6).

## Phase 5: PaintedShot and occurrences (mid-term)

### Goal
`PaintedShot` and its canvases beside `StampPainting`: occurrences, motion over occurrences, rigs drawn as pieces on
own sheets (a `lib/paint/shot` bridge from films to the rig's three meshes), the camera build over occurrences, and
painted textures for three.js objects.

## Phase 6: Presentation additions (mid-term)

### Goal
Dissolve and `bracket`, masks (path and `alphaOf`), instanced planes, pin and cover lays with the DOM adapter,
visibility, the cost report. ENGINE test 5 through `studio repeatable`.

## Phase 7: Test scenes (far-term)

Six demos, each a project in work/ that shows off a part of the design and is worth watching on its own:

1. **Rainy street corner.** Rain through parallax planes, landing into the wet street as timed applications and
   blooming there; puddle reflections; a walking umbrella figure in both paper looks (cut-out, and on the street's
   sheet). Instances, timed landings, drying scale, sheets, posing.
2. **Heron wading at dusk.** A watercolour heron on the scene's sheet with one wing on its own, bending through the
   rig, leaving rings in a still lake, with a boil on the outline and the sky shifting by held levels and a dissolve.
3. **Ink city on the beat.** An ink skyline draws itself stroke by stroke to a beat, then a wash floods in on the
   downbeat and bleeds up to the lines. Path masks, timed applications, held solves.
4. **Lake, dawn to dusk.** One landscape with light as a TS setting: shadows lengthen, the sky warms through held
   solves and dissolves, reflections follow.
5. **Gouache title over a live UI.** A painted title card between HTML elements, pinned to a measured DOM point,
   lettering revealed along its paths, a crayon-burnished highlight, sliding away into the app.
6. **Painted ceramic turntable.** A gouache-patterned mug spinning under soft light, petals blooming onto it on a
   beat. Painted textures on a three.js object, paper that wraps.

---

## Considered but deferred

- Migrating chosen workspace projects, then deleting the builder, passages, waits, `StampPainting`, the sources
  renderer and the old gate cases in one step. Graham picks which projects migrate first.
- Advected paper (grain following per-pixel motion); it lands with vid-141.

## Dependencies

vid-149 (picture plane source) and vid-150 (posed rig on the GPU) have landed and are reused. vid-151 is absorbed.
vid-141 owns advected paper.
