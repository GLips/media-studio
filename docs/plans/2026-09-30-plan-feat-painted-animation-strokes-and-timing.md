---
title: "feat: Painted animation, part 1: strokes that deform, and the timing layer"
type: feat
status: active (2026-10-01: phases 1.0, 1.1, 2a, 3 and 4 done, reviewed by Codex and Claude; 2b waits for vid-114's step 5)
date: 2026-09-30
revised: 2026-09-30 (after vid-112, vid-116, vid-117 and vid-125; folds in vid-126)
dependsOn: [the paint-engine tickets in flight (vid-118, vid-123, vid-124, vid-127) landing first; the spikes don't wait]
relatesTo: [vid-44, vid-45, vid-55, vid-114, vid-121, vid-123]
---

# Painted animation, part 1: strokes that deform, and the timing layer

## Context

Graham wants Grease-Pencil-style painted animation, as in the PolyPaint frog video. Strokes paint themselves in on a cue, outlines boil, parts tween between poses, and everything holds on twos. Later the same engine should serve a scene per style (a collage video) or one character per style (a scratchy pen figure among painterly ones).

This is plan 1 of three. Plan 2 (multiplane and compositing) and plan 3 (painterly 3D) depend on this plan's seams.

**Already built, since this plan was drafted.** This plan doesn't redo any of it:
- **Frame purity.** A frame is a function of the painting and `t`, identical in any order. Checkpoints restore the layer alone (vid-117, `studio/stamp-paint-checkpoints.ts`).
- **Stable randomness.** Randomness is keyed to hierarchical ids. Boil re-seeds a group per epoch: `StampGroupBoil { every }` and `stampBoilSeed(id, epoch)`.
- **Rigid group motion with stuck texture** (`models/stamp-group-motion.ts`): keys `{at, x, y, rotation?, scale?}` about a pivot. The group is painted once in its own coordinates and resampled into place. It lies on the ground's paper, or on its own as a cut-out (vid-125, `StampGroupPaper`).
- **Fills supplied as patterns.** A fill is a flood or strokes (zigzag, hatch and the rest), by the brush's media (vid-112, `stamp-fill.ts`). Clipping to a region (`within`) and masking fluid with soft or ragged edges are vid-112's too.
- **Pigment and wet paint.** Pigment mixing (vid-83), washes, wetness over painting time, lifting (vid-117), and blooms and rims (vid-118).
- **Two clocks.** Painting time sets wetness; scene time only reveals (vid-117).
- **One renderer.** The GPU is the only renderer, held by a gate of goldens (vid-116).

**What's missing, and what this plan builds:**
- **Deformation.** Groups move only rigidly. Nothing bends, puffs or raises an arm. `stamp-group-motion.ts` names the gap: "Deforming one … would warp its layer by a field".
- **A timing layer.** Motion keys are linear and in seconds. Boil counts render frames. There are no holds, loops, retimes, easing, poses or cue-relative timing, and "on twos" changes meaning with the output frame rate.
- **Scoped style.** A scene names brushes directly. It can't say "outline role, palette colour 3" and let the style answer, or override settings per part.
- **Shape sources.** Every shape is typed by hand as coordinates.
- **An authoring API an agent writes well,** proven on a real scene.

Research is in `~/research/2026-09-29-painted-animation/`: `reading-timing.md`, `reading-tweening.md`, `api-synthesis.md` (five model-authored API designs, reconciled) and `design-notes-shapes-fills.md`. vid-121's clips and their findings are at `~/research/2026-09-30-evening-showcase/` (clips 2, 3 and 5).

**Re-placing is a first-class choice, not a defect.** The draft treated re-placing stamps each frame as an opt-in for crawl. In vid-121, Graham's favourite clips were the ones repainted every frame: the clouds' texture lives and changes. So a moving part has three settings, all first-class:
- **stuck:** placed once at rest and carried;
- **boil:** re-seeded every n animation frames;
- **live:** re-placed every frame, texture crawling with the motion.

The scene picks one per part. The style supplies only amounts. vid-123 makes a recompile per frame cheap, which `live` needs.

What plans 2 and 3 need from this plan:
- **Anchor is a field on grouping nodes.** Only `canvas` is built here. Plan 2 adds `plane`; plan 3 adds `surface(object)`, so the field mustn't assume a 2D rest space.
- **Strokes pass through a camera step.** It's the identity here; plan 2 fills it in.
- **Stamp identity is assigned once at rest,** keyed by rest position (today the placement ordinal on the rest stroke). Plan 3 reuses it with rest positions on a mesh.
- **A source is evaluated at `t` and may return different strokes each frame** (plan 3's silhouettes). A stroke a source creates after its part's reveal has finished starts fully revealed.
- **Visibility is a per-frame mask, separate from reveal,** fully visible by default. Only the slot is built here.
- **The engine doesn't own its GPU device or assume one canvas-sized target.** Plan 2 shares the device with three.js's WebGPU renderer and renders groups to their own layers. *Status, 2026-10-01:* the device half holds on main. `stamp-paint-surface.ts` takes a lent device and draws into a handed texture (vid-129, then vid-123). Rendering a group to a layer target of its own is plan 2's work.

### Out of scope
- Planes at depth, a camera, post and three.js compositing: plan 2.
- 3D sources, surface anchors and projection: plan 3.
- Building the bake. Only its invariant is kept (below).
- Tweening between separately redrawn poses (correspondence by stroke id, cross-fades), unless spike 1.1 shows the frog needs it.
- Realistic reveals (sketch, block-in, layers): vid-128. This plan keeps reveal as it is and makes it a timing channel.
- vid-44 (onion skins and trails), vid-45 (squash and stretch) and vid-55 (shape morphs) stay their own tickets. Each is a later timing or deform operation on this model.

## Invariants

- **A frame is a pure function of the compiled painting, `t`, and the scene's cues and frame rates.** This is vid-117's rule, extended to deformation and timing. History-dependent inputs (tracking, simulation) enter only as an immutable input computed before rendering, keyed by a hash of its inputs.
- **Randomness is keyed by hierarchical id, by each stamp's rest identity, or by the boil epoch; never by this frame's order or geometry, except under `live`.** Stamps, and the hand's pressure and speed, are computed once on the rest stroke and carried by every deformation in `stuck` and `boil`. *Why:* adding a stroke reseeds nothing else, and a stuck part neither crawls nor flickers. `live` re-places by choice, still as a pure function of `t`.
- **Clips, masks and reserves follow the geometry they're attached to.** A deforming throat's `within` region and masking fluid deform with it, as vid-125 carries a cut-out's lifts and reserves. *Why:* otherwise a spike "succeeds" with a moving throat under a stationary mask.
- **Wet state deforms with its paint.** A wash's wetness lattice and its rims and blooms live in the group's rest space and are warped with it, never recomputed in screen space. *Why:* a raised arm keeps its blooms.
- **Timing is typed data, evaluated by registered pure operations on named channels.** A closure is allowed only through an explicit escape hatch that opts out of compile-time checks, and never out of frame purity. *Why:* data can be validated before rendering (a missing cue, two writers on one channel) and hashed as a checkpoint or bake key.
- **A style never introduces motion.** Whether anything boils, deforms or reveals is the scene's call; the style supplies only how much and how fast. *Why:* restyling a finished still scene mustn't set it moving.

## New concepts

- **`lib/paint/animation/`**, a new feature above `paint/style` and `paint/painting`. It holds the painting tree a scene writes, timing channels, scoped style resolution, deformation, and the component that draws it. The name is still a working one; "shot" collides with capture's shots. `paint/painting` stays unaware of scenes, poses and channels: it takes a painting as it stands at a moment, plus group placements, warps, boil epochs and visibility. Brush fidelity and the gate keep using it directly.
- **A deformation** comes in two kinds per part, chosen by the scene (spike 1.0's verdict):
  - a **layer warp**: a coarse lattice in rest space, sampled from a rest-to-scene map, which carries the group's painted layer, rigid placement being its one-cell case;
  - **live**: the part's geometry posed anew and re-painted.

  A warp reaches the renderer as each frame's data, keyed into the checkpoint key.

## Phase 1.0: Deforming painted strokes (spike: toy experiment)

**Done, 2026-10-01.** Findings: the spike findings doc, "Plan 1, phase 1.0".
- **Verdict:** near-rigid parts (limbs, sway, small squash, boil) bend the group's layer. Parts that change shape (the
  puff) are live. Stamps aren't carried.
- **Kept from the spike:** the layer warp in the renderer, and the four-texel lay that fixes crayon under sub-pixel
  motion. They land in phase 2, with the warp as each frame's data.

### Goal
We know how a deformation should carry paint (stamps, wet state, masks) under stuck, boil and live, what it costs per frame, and where it breaks.

### Questions
- **Warp the layer or the stamps?** Two candidates:
  - resample the group's painted layer through the warp, which extends today's rigid resample and keeps wet stages untouched;
  - carry stamp centres and footprints through the warp and repaint, which keeps strokes sharp under stretch.

  Which reads right at the size of a throat puff, a grass sway and a raised arm? At what local stretch does each break (blurred texture vs gaps and pile-ups)?
- **What a stamp carries:** under stamp warping, how do footprint, rotation, scatter and grain coordinates transform: a local frame per stamp, or per stroke?
- **Wet state:** does warping vid-117's lattice and vid-118's rims and blooms with the paint read right? Does anything computed once per deposit assume the deposit never deforms, such as `grainOffset`, the dual brush or flow scratch?
- **Live under deformation:** with every frame re-placed (vid-121's favourite), does a deforming part read as lively or as noise? Is a bounded crawl rate useful as a dial?
- **Boil as a stepped displacement of the rest path,** with stamps carried: does it read like Grease Pencil's noise boil, the line wobbling while the texture stays?
- **Cost per frame at 1080p** for a frog-scale painting (several thousand stamps, a handful deforming), on top of vid-123's numbers. Which dominates: warp, upload, wet stages or draw?

### Approach
- Throwaway code outside `lib/`, painting with the real renderer and real brushes from an installed style, in pigment watercolour and in crayon.
- Compare clips side by side, since crawl and shimmer only show in motion. Show Graham the clips on a page.
- Check frame order: render forwards, reversed and shuffled around boil and hold boundaries. The evaluated data must match exactly, and GPU images meet `studio repeatable`'s bar.

### Done when
- Every question is answered in `docs/plans/2026-09-30-painted-animation-spike-findings.md`, with clips linked. New questions are answered or named as follow-on spikes.
- The warp choice (layer, stamps or both) is recommended with evidence.

## Phase 1.1: Authoring the frog (spike: toy experiment)

**Done, 2026-10-01.** Findings: the spike findings doc, "Plan 1, phase 1.1".
- **Chosen form:** anatomy as vid-114's groups and passages; motion as plays on typed handles; pins, radial or owned
  by a part; how marks live as a node option.
- **Shapes:** from sources naming parts and anchors, built in `paint/animation/models/figure/`.
- **Graham's sign-off is pending.** Engine work that doesn't hang on the form goes ahead.

### Goal
We know what the scene-level API should look like for an AI agent writing painted animation, and where a frog's shapes come from, well enough to reshape phases 2–4.

### Questions
- **Where timing is written:** as options on nodes, or as tracks aimed at named parts (`play(target, clip, {at})`)? Both compile to the same channels.
- **How a pose is written:** pins with falloff, or named controls on a small lattice? ARAP only if big bends collapse.
- **Stuck, boil or live:** where does a scene say which, and what's the default per role?
- **How a reveal is paced:** fit to a fixed `over`, or sequenced child durations?
- **Holds:** which channels hold on twos by default, on the 24 fps animation clock?
- **References:** typed handles from the builder, or string ids? What does writing the scene get wrong with each?
- **Shapes:** where does an organic shape come from? Try at least two candidates beyond hand-typed coordinates: SVG path data from a traced image (an image model's frog, for one), font glyph outlines, a posed simple 3D model's silhouette.
- **Scoped style:** does naming a role and a palette colour, with overrides per part, cover the frog? Does it help vid-114's colour-variety question (a fill drawing from a set of mixtures)?
- **Porting:** does a ported watercolor-paintings scene read as well or better in the new form?

### Approach
- Write the frog scene, and one ported watercolor scene, in two candidate forms, typechecked against stub types. The measure is the scene text: its length, what was mistyped or misremembered, and which mistakes a compile-time check would catch. Rendering isn't required.
- The frog scene is the whole target: painted in stroke by stroke from a cue, outline boiling once drawn, throat puffing on a loop, grass swaying, held on twos, one part in a different style.
- Start from `api-synthesis.md` §3's sketch and its "let the spike decide" list. Don't reopen the seams it marks "decide now".

### Done when
- The findings give the chosen form for each question, with the frog scene and the ported scene written in it, and the shape sources tried with what each produced.
- Graham has signed off on the chosen form before phase 2 is reshaped.

### Warnings
- Every design in the research typed the frog's coordinates by hand. That is the weak case Graham flagged, not a template.

## Phase 2: One painting model replaces the recipe (sketched)

### Goal
Scenes paint through the new model only. The recipe's authoring API is gone, the watercolor-paintings and vid-121 scenes are ported, and still paintings look as they did.

### Reshaped after the spikes (2026-10-01)

Phase 2 splits in two, because vid-114 builds the passage layer that the authoring half stands on.

**2a, the engine's frame seam.** Engine-side, building now; independent of vid-114's cut-over. `paint/painting`'s
renderer draws a frame from the compiled painting plus each group's state for that frame, given as data:
- its placement;
- its warp: a lattice sampled from a rest-to-scene map, with a key naming it;
- its boil epoch;
- its visibility;
- for a **live** group, its marks compiled for this frame.

The compiled painting holds no functions of time.
- The layer warp and the four-texel lay come from spike 1.0.
- **The live seam:** a live group's marks are placed, uploaded and drawn alone each frame. What is painted before it
  is restored from a checkpoint, so a frame costs its moving share and not a full repaint.
- Group `motion` and `boil` stay as recipe fields until 2b replaces them. Internally they become frame state, so the
  renderer reads one shape whichever writes it.

*2a done (vid-130, 0ac1c40 and 426c35d, merged 7ec3157).*
- **Engine:** `StampPaintFrameState` (`stamp-paint-frame-state.ts`) feeds `draw(t, frame?)`. A live group's marks
  must be the written group re-placed (`stampLiveGroupProblem`).
- **Motion:** `paint/animation` evaluates pins, clips and the rest-space boil into frame state (`buildPaintMotion`,
  `paintMotionFrameAt`).
- **Frog at 1080p, watercolour:** a live frame takes 46 ms to draw and 92.6 ms whole, against 235 and 351 ms for a
  full reload. The layer warp takes 27 ms.
- **Gate:** the new animation/live check passes at max 0.
- **Not built:** a layer cache per group. A group drawn after a varying one repaints each frame; plan 2's planes are
  where layers get cached.

**2b, the authoring model.** Waits for vid-114's step 5. Plan 1's additions go on vid-114's tree, per spike 1.1:
- plays on typed handles;
- pins;
- `marks: stuck | boil | live`;
- looks (scoped style);
- `anchor`;
- figure shapes.

Ported scenes, and the deletions below, follow.

### Approach
- **`paint/painting` keeps one contract:** a painting as it stands at one moment (groups, passes and deposits with their placed stamps, washes and masks), plus per-group placement, warp, boil epoch and visibility. `paint/animation` and brush fidelity feed it. Scenes never write it, and `#studio` exports only the new model for painting.
- **The recipe's compile work stays in `paint/painting` as time-free deposit preparation:** id validation, hierarchical seeding, fills and masks, with hand evaluation and main and dual placement called from `paint/brush`. Both `paint/animation` and brush fidelity call it; brush fidelity never imports animation.
- **The renderer separates assets from frame-varying data.** Brush images, tips and paper load once per painting; placements, warps and live stamps upload per frame. vid-123 builds most of this. This phase finishes it for warps and live parts.
- **Delete:**
  - `stampPaintRecipe` and `compileStampPaintRecipe` as scene-facing API;
  - group `motion` and `boil` as recipe fields (they become channels);
  - the deposit reveal fields, replaced by the reveal channel;
  - `stampFillPath`, `stampRegionOutline` and the like as scene-facing exports (they become shape constructors);
  - the watercolor style's `paintWatercolorElement` helper. Its stroke generation becomes the style's fill choices, its composition a reusable part builder, and its timing moves to the scene.
- **Shapes are values.** One named shape serves fill, `within`, masking fluid and reserves. Sources are polygon, ellipse, smooth closed curve and SVG path data, plus whatever spike 1.1 adds.
- **Style is scoped:** painting, group, part, with the nearest setting winning field by field. It carries:
  - roles (brush, mixture, diameter, hand);
  - a palette of pigment mixtures;
  - paper and medium;
  - fill application per role;
  - stuck/boil/live amounts;
  - role muting (a style can drop outlines).

  Scenes name a role and a palette colour. Naming a brush directly is the escape hatch. The private `StampPaintStyle` in `work/styles/<name>/style.ts` grows these fields.
- **Anchor is a field on grouping nodes**, and only `canvas` is built.
- **"Look as they did" is measured by the GPU gate's goldens and the fidelity sheets,** which must not move. Ported scenes may reseed where their ids change: compare them side by side and report drift.

## Phase 3: The timing layer (sketched)

*Built (vid-130), as amended below after review:*
- **Clocks and channels:** `lib/paint/animation/models/paint-clock.ts` (play clocks written as parts, node clocks,
  branded scene, clip and frame times) and `paint-channels.ts`.
- **Deformation as data:** `paint-deform.ts`, from which each map, key and fold check derive.
- **Motion over the compiled painting:** `paint-motion.ts` and `paint-motion-compile.ts`, evaluated purely by
  `paint-motion-frame.ts`.
- **Not built:** the colour channel. A recipe's material keys still recolour.

### Goal
Reveal, placement, deformation, boil, holds and colour run as pure timing channels on the new model, each a registered operation.

### Approach
- **Channels:**
  - `reveal`: how much of each stroke is drawn, measured on the rest stroke.
  - `place`: a group's rigid placement (today's motion keys, with easing).
  - `deform`: a target's warp. One writer per target per time interval: a pose or tween, or a procedural generator (sway, breathe).
  - `boil`: the stuck/boil/live choice and the boil rate, in animation frames.
  - `color`: a mixture's pigments over time, for sunsets. It recolours without recompiling, through vid-123's path.
  - `clock`: retime, hold and loop, composed as nested clock transforms, so `hold(loop(…))` is well defined.
- **Deformation composes down the hierarchy:** a target's own warp first, then its ancestors'. A throat that puffs inside a body that sways is two writers on two targets, not a conflict.
- **Conflicts are judged after selections expand to concrete targets, per overlapping interval.** A finished clip's held pose persists until the next clip on that target starts.
- **The timing contract is written before implementation:** clock nesting, each stroke's local boil phase, behaviour at interval endpoints, and overlap detection.
- **A separate animation clock** at 24 fps by default, apart from the render rate. "On twos" means 2/24 s at any output rate, and `StampGroupBoil.every` moves onto it.
- **Boil** is a stepped displacement of rest space, under `deform` (spike 1.0 and phase 2a). A group boils only after its own reveal finishes.

### The timing contract (written 2026-10-01, before implementation)

**Times.**
- Scene time `t` is in seconds, from the scene's clock (`s.t`).
- Cues are numbers in scene seconds. The project resolves them from its timeline and passes them in, so neither imports the other (vid-114's rule).
- The animation clock counts frames at `animationFps`, 24 unless the scene says otherwise. A time's animation frame is `⌊t · animationFps + 1e-6⌋`; the epsilon is there so that 2/24 s lands on frame 2, not 1.
- Render fps never enters timing. A 30 or 60 fps render samples the same held drawings.

**Who owns what.**
- vid-114's score owns reveal allocation: which interval each deposit reveals over, from weights and cues. It resolves to scene seconds.
- Plan 1 adds channels beside the lookup. Reveal stays `progress(deposit, t)` on scene time. Plan 1 never re-allocates the score.

*Amended after review (2026-10-01):* a part's holds and freezes no longer reach its reveal. Wet paint's order is the painting's, so one held group can't reveal on a time of its own while its neighbours settle on scene time. A part's clock governs its writers and its boil.

**Clocks belong to writers.** Each play (a pose clip, a sway, a placement, a boil) has a clock: a chain of transforms from scene time to the clip's own local time `τ`. A part, a group or the painting carries only `hold` and `freeze`, which every writer under it reads through. *Why (spike 1.1):* a looping chain in front of the reveal lookup would un-draw and redraw the part on every loop, and repeat its boil epochs. Each transform is data, `{ kind, …params }`, evaluated by a registered pure function. *Amended after review:* a play's clock is written from parts (`{ at, rate?, loop?, hold? }`) and compiled to the chain, so its order can't be wrong. The interval it writes over is derived from those parts exactly, and a finished clip holds its final clip value. `hold(loop(clip))` placed at a cue is the chain `[hold(2), at(cue), loop(…)]`, outermost first. The hold sees the parent's time, the `at` makes the clip's own time, and the loop wraps it (`paint/animation/models/paint-clock.ts`).

| Kind | Maps input time `τ` to | Notes |
|---|---|---|
| `at(start)` | `τ − start` | Places a clip; `start` is a cue plus an offset. |
| `rate(r)` | `τ · r`, with `r > 0` | Slow-motion or speed-up. |
| `loop(period, 'repeat' \| 'pingpong')` | `τ mod period` (positive modulo), or reflected on odd cycles | Below 0 it reads 0; it never runs backwards into negative time. |
| `hold(n)` | `⌊F(τ) / n⌋ · n / animationFps`, where `F` is the animation frame of its input | Holds on `n`s. |
| `freeze(τ0)` | `τ0` | A held drawing, Grease Pencil's Fixed Frame. |

**How a hold quantises.** A hold quantises the time *it is given*, on that time's own frame grid:
- Outermost on a part, as `hold(…)` usually is, it steps on the scene's global animation grid. Everything held on twos changes on the same frame, as cels do.
- A cue off the grid shows its first held drawing at the next grid step at or after the cue, up to `n/24` s late. This is intended: it's what drawing on twos means.
- Inside a `rate(0.5)`, a `hold(2)` steps every 4 scene frames. That is what was asked, and it's written that way.

**Interval endpoints.** Every timed thing has the half-open interval `[start, end)`:
- At `start`, its progress is 0. From `end` on, it is 1, and its final value holds.
- Before `start`, it reads its value at 0: a pose clip shows its first key, and a reveal shows nothing drawn.
- A loop's interval is `[start, ∞)` unless it says `times`.

**Channels and conflicts.**
- A writer is a (channel, concrete target, interval). Selections (a role, a subtree) expand to concrete targets at compile.
- Two writers on one channel and one target whose intervals overlap are a compile error that names both.
- A finished clip's final value persists until the next writer on that target starts, and that isn't an overlap.
- Different targets never conflict, ancestors included: deformation composes.

**Composition per frame, for one stroke:**
1. rest geometry in anchor space;
2. `boil` displacement, in rest space, so the wobble travels with the part rather than swimming as it moves;
3. its part's `deform`, then its part's `place`;
4. each ancestor's `deform` then `place`, nearest first;
5. the camera step (the identity in plan 1);
6. screen.

*Amended after review:* every deform was applied before every placement. Per level is how a rigger composes: a child
moved inside a deforming parent gets the parent's deform where the child is, not at its rest point.

*Amended in phase 2a:* boil was after `place`. In rest space it rides any plane plan 2 adds, too.

Reveal is measured on the rest stroke (step 1), so no later step changes how much has been drawn.

**Boil, per group.** *Amended after review:* the wobble is a warp of the group's layer, so a group boils as one, from the last reveal end of its deposits. A scene wanting strokes to boil apart gives them separate groups.
- A group's epoch is 0 (its rest seed, as written) while it's drawn. After its reveal ends at `end`, it is `⌊F(τ)/every⌋ − ⌊F(end)/every⌋`. So it stays as drawn until the next grid step, rather than popping to a new seed on the frame it finishes, and then steps on the global grid, so every boiling stroke in a part changes on the same frame.
- A re-seeding boil's seed is `hash(restId, epoch)`. A given epoch, 0 included, replaces the recipe's boil, and a recipe boil counts animation frames.
- `stuck` is always epoch 0. `live` re-places every evaluated frame: under a hold, every held frame, never between them.

**Purity and keys.** A frame is a pure function of (compiled painting, `t`, cues, `animationFps`). Everything that varies goes into the checkpoint key: each part's time after its holds, each writer's clock value, its warp, its epoch and its placement. Two frames inside one hold step share a key, which is what makes holds cheap. *Amended after review:* a key is the canonical form of the deformation's data (every spatial parameter and its quantised amount), from which the map and the fold check also derive. A checkpoint is shared wherever the lay keys are unchanged, whoever wrote them.

## Phase 4: The frog scene (sketched)

### Goal
A frog-style painted scene renders in a real project: painted in on a cue, then boiling, breathing and swaying, held on twos, with one part in a second style and one part live. The docs and the video-canvas skill teach the new model.

### Approach
- A new project from `studio new`.
- `docs/brush-engine.md` and `skills/video-canvas/SKILL.md` describe the new model and nothing of the recipe.

*Built (vid-130, workspace `projects/2026-10-frog`, f6711f0; studio 32146d1).*
- **Shapes:** every frog shape comes from the posed figure, and the set is placed from its rest silhouette.
- **Groups:** each moving part is its own group.
- **Paint-in:** it runs on the timeline's cues, on ones.
- **From cue `alive`:** the body breathes with its ink as a child node, the ink boils in rest space, the tufts sway,
  and the butterflies flutter and drift.
- **The sac is live:** compiled alone from the figure posed at each held scale, and kept by pose key.
- **Frame rate:** held on twos at 24 fps.
- **Repeatability:** `studio repeatable` is identical at 8 times.
- **Cost, 1080p:** draw median 33 ms, whole frame 62.5 ms.
- **Not done:** the authoring surface (2b) waits for vid-114, so the scene uses today's recipe plus frame state.
  vid-114's step 5 moves it.
