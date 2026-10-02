---
title: "feat: Painted models and characters: one skin in code, surface regions, light, a living face"
type: feat
status: draft
date: 2026-10-01
dependsOn: [vid-140 (landed: planes, live banks, buildPaintCamera); vid-142 (one three/webgpu renderer) for phases 2 onward's guide renders on the GPU]
relatesTo: [docs/brainstorms/2026-10-01-painted-characters-brainstorm.md, docs/plans/2026-09-30-plan-feat-painted-animation-strokes-and-timing.md (plan 1), docs/plans/2026-09-30-plan-feat-painted-animation-painterly-3d.md (plan 3)]
---

# Painted models and characters

## Context

vid-130 (plan 1) built the primitives for painted animation and proved them on a frog: frame state, live groups,
typed timing, motion over the compiled painting, a medium per group. The frog was a proof, not a pattern, and its
naive parts are this plan's starting list:
- `posed-primitive-figure.ts` traces separate ellipsoids and capsules, so parts never merge into one skin, and the
  throat sac reads as a ball stuck under the chin.
- There are no surface markings. The reference's pale throat runs from the jaw down the chest, with a red dot by the
  cheek.
- The eyes are static discs.
- The light is a hand-written vector with shade masks shifted toward it (`frog-painting.ts`), though
  `stampRoundedForm` already existed.
- The rock isn't a model at all.

This plan builds tools for painting from 3D models, still first, then characters:
- an object is one skin built in code and saved as glTF;
- its markings are regions of the surface;
- light is a scene value that every painter reads;
- outlines come from the silhouette and the regions' edges;
- a character adds blend shapes and a hybrid face: 2D painted eyes and mouth pinned to the 3D surface.

The tools are the product. The frog and its reference (the first 7 s of the Grease Pencil tutorial, private) stay the
test bench, and the output should still look good.

**How the plan is worked.**
- Every pass renders frames beside the reference and a written checklist, and a fresh critic agent judges them.
- Graham checks in at phase ends.
- Findings amend this plan, not just the code, and they go in a findings section under each spike.
- vid-130 never compared the frog with the reference, so no part was judged on whether it read as alive.

Prior art (scout, 2026-10-01; see the brainstorm):
- `manifold-3d`'s `levelSet` turns smoothly blended shapes (SDFs) into one closed mesh.
- Region IDs work like Blender Line Art's material borders and Kalnins' ID buffer.
- Light as guide layers follows Klaus's lighting layers; brushes reading reference renders follows Meier 1996.
- The face follows Spider-Verse's split between acting lines and form lines, and Live2D's and Rive's pose blending.
- Bénard & Hertzmann's 2019 tutorial is the reference for lines from 3D.

Verified against the code:
- three is pinned at 0.186.0. `manifold-3d` (3.5.3) is a dependency since vid-144's spike.
- The figure sources live in `lib/paint/animation/models/figure/`.
- vid-114's form helper is built. `stampRoundedForm` (`lib/paint/painting/models/stamp-form.ts`) takes an outline and
  a `StampFormLight { direction, elevation }`, and returns shade regions, core paths, lit edges and a Lambert term.

- vid-140 has landed. Painting-in and checkpoints are gone, a live group reloads only its own bank, keyed by its marks
  key, and a scene is planes (`{back, nearer}`). There is one camera description, `buildPaintCamera`
  (`lib/paint/animation/models/paint-camera-build.ts`). A three plane is only for 3D content shown as 3D.

Relied on from tickets, not yet in the code:
- vid-142 (open) brings one `three/webgpu` renderer on the shared GPU owner, and three.js maths allowed in `models/`.

### Out of scope

- Projected and painted textures on meshes (plan 3's phase 3), image-to-3D models, skin weights and IK, multiplane
  and the scene camera (plan 2, vid-140), lens effects (vid-141).
- Fire and other flickering lights. The light list allows them, but no phase builds one.
- Blender via MCP. glTF keeps the door open if modelling in code stalls.

## Invariants

These bind the shaped and sketched phases. A toy spike may hand-craft in its own project and use three.js's camera
directly, provided it lists every gap it hand-crafted in its findings.

- **A scene declares; it never works around.** When writing a scene hits a missing affordance, the work stops and
  builds the affordance in `lib/`, or records it in the findings. It never hand-crafts the gap in the scene. *Why:*
  the tools are the product. vid-130's light, masks and sac were scene workarounds no other scene can reuse.
- **Models render through the shared renderer.** This plan's painted look comes from the stamp painter reading its
  guides. *Why:* one renderer serves every way of drawing a model, so a graphic material needs no tier of its own.
- **One light description and one camera description.** Models and painters use the shared camera
  (`buildPaintCamera`'s camera description) and the scene's lights. Each style owns how light maps to painted values.
  *Why:* two ways to say "lit from the upper left" or a fifth camera model would split every later tool.

## Phase 2.0: One skin and its regions, to the painter (spike: toy experiment)

### Goal

We know how an object built in code becomes one skin with surface regions, and how its regions, light zones and
outlines reach the stamp painter well enough to paint a rock and the frog's body at rest.

### Questions

- Do smoothly blended shapes meshed by `manifold-3d` give a clean single skin for the frog's head, throat and chest,
  and for a rock? How big are the meshes, and how long do they take in Node and in the browser?
- How are regions written? For example, "the throat patch" as a field over the surface, assigned per face. Are their
  edges clean enough to paint and to draw as lines?
- How do regions and light zones reach the painter: the mesh projected on the CPU, or an ID image traced into shapes?
  Which handles self-occlusion, stays the same across render orders, and holds still as the object turns?
- Do light zones read from guide renders (lit, shade, core, rim per light) beat `stampRoundedForm` on the frog's body?
- Do outlines from the silhouette and region edges hold together as the object turns, or crawl?

### Approach

- A toy in a work project. No changes to the renderer or `lib/paint`, so it runs before vid-140. Reading back to the
  CPU is fine.
- The output is painted through today's painting API as ordinary groups: a turning rock and the frog's body at rest,
  in watercolour.
- Clips and frames beside the reference, with numbers.

### Warnings

- Don't spend the spike on beauty or a full frog. The question is whether the pipeline holds.

### Done when

- Every question above is answered in this phase's findings section, with clips linked. New questions are answered or
  named as follow-on spikes.
- The findings choose how regions reach the painter, so phase 2 can be shaped.

### Findings (vid-144, 2026-10-01)

The toy is `work/projects/2026-10-model-spike/` (workspace branch vid144); clips, frames beside the reference and
numbers are at `~/research/2026-10-01-vid-144/index.html`. Studio branch vid144 adds only `manifold-3d`. Numbers are
from an M1 Max under a shared load.

**Short answer.** The pipeline holds. Blended shapes mesh into one closed skin. Regions written as fields trace
smooth edges, and an ID image traced on the CPU gives the painter fills, light zones and lines within a third of a
pixel of the exact lines, the same in any render order. A second pass looked at the three gaps the first one left. None
of them needs a spike:
- **The boil** is mostly the outline's real change of shape as the rock turns, plus folds that pop in and out.
- **The throat** was a field written as a half-space. An oval field fixes it, and that fix is on the branch.
- **The flat values** come from tuning constants.

What does cost is time: a new drawing still takes about 590 ms at 1080p, most of it compiling the moving groups' flood
placement.

**1. One skin; size and time.** Yes. `Manifold.levelSet` over a smooth union gives one closed mesh (genus 0) for the
rock and the frog's body. The critic found no crease where the throat meets the chin. The seam it saw is the throat
region's straight edge, not the skin.

| skin | edge | verts / tris | Node | browser | .glb |
| --- | --- | --- | --- | --- | --- |
| rock | 0.045 | 16,001 / 31,998 | about 490 ms | 318 ms | 814 KB |
| frog body | 0.06 | 16,595 / 33,186 | 290 ms | — | — |
| frog body | 0.04 | 37,581 / 75,158 | 0.9–1.2 s | 611 ms | 2.0 MB |

The WASM loads in 10–35 ms. The time goes on the JS distance callback, which the browser runs faster than Node.
Meshing is a build step, not a per-frame cost. A rough rock wants two normals: light read across the form
(`formScale`, the gradient over 0.22 units), else noise breaks the light into islands, and the mesh's own normals for
contours, else the contour misses the bumps by several px.

**2. Regions.** A region is a field over space sampled at each vertex, so its edge is the field's zero set
interpolated across the triangles. Per-face IDs (a region per triangle, as a Blender material would assign it) were
also traced to compare. The field edges are clean enough to paint and to draw: 0.15 px mean from the exact edge on the
mesh, moving p95 0.20 px between drawings 0.05° apart. Face-ID edges zigzag: 1.0 px mean, p95 4 px off,
moving p95 0.9 px and up to 4 px, which can't be drawn as a line (route overlay). So regions are fields; face IDs exist only for
glTF's materials (the .glb carries both, the fields as `_REGION_<NAME>` vertex attributes). Writing a good region as
a field is hard: the throat's "front of the body and below the jaw" came out as a rectangle with a vertical edge
down the flank, where the reference has a curved bib (the critic's second gap).

**3. How regions and zones reach the painter: route B, the ID image traced.** It's chosen for phase 2.
- **Route B** z-buffers the skin into an ID image (front triangle, normal, eye vector and region fields per sample,
  2 px cells, on the CPU through three.js's camera) and contours each field with marching squares
  (`stampGridContours`, the figure sources' `tracePaintFigurePieces`). Self-occlusion falls out of the z-buffer.
  Every fill, zone and line comes from it.
- **Route A** chains the zero crossings of N·V (the smooth contour) and of each region field through the mesh's
  edges, projects them, and keeps what the ID image's depth shows. It gives lines only: a region's visible fill would
  need hidden-surface removal by polygon booleans each frame, which is route B again.
- **Agreement:** B's silhouette lies 0.29 px mean (p95 0.6) from A's on the rock over a half turn and on the frog.
- **Holding still:** at 0.05° a drawing, B's silhouette moves p95 0.36 px, A's contour p95 0.13 px.
- **Same in any order:** the shapes hash the same computed forward and backward, and `studio repeatable` passes
  at 2.0, 4.5, 7.0 and 13.5 s (identical, or 116 dB PSNR).
- **Cost** a drawing at cell 2 is about 70 ms in Node and in the browser alike: the raster 14–30 ms, the tracing
  50–60 ms (Map-based marching squares and polygon distances, unoptimised). Cell 4 takes 20 ms and cell 1 270 ms.
  Route A takes 20–30 ms.
- **On the GPU,** three.js renders the same ID image at 1080p into a float target and reads it back in 10 ms. The
  CPU tracing would remain.

**4. Light zones against `stampRoundedForm`.** The model's zones win on the frog. Its Lambert term differs from the
ellipsoid's by 0.21 on average, and 15.5% of the body is lit by one and in shade by the other: under the chin, round
the haunch and along the flank. Painted side by side, the critic found the model's frog "clearly rounder", with a lit
oval on the belly, shade under the chin and a band round the base, while the ellipsoid's reads "as a cutout". Both
frogs were too low in contrast: the core is barely darker than the shade, and the rim is faint (a value choice, not a
pipeline one). The zones are written once as the key light and a rim light in the camera's terms (left, up, toward
the viewer) and turned into world space, so a turning rock turns under still light. The same key, read as a
`StampFormLight`, lit the ellipsoid. Zones (cell 2): lit above 0.55 Lambert, shade below 0, a core band from -0.22
to 0.11, and a rim where the rim light's term is over 0.15 and N·V under 0.42.

**5. Outlines as the rock turns.** Their geometry holds, measured above and confirmed by the critic. The painted line
boils (critic: FAIL on line texture). The second pass measured it in an outline lab (`scenes/outline-lab.tsx`, 5 s,
lossless frames, 11 drawing pairs, `tools/boil-measure.ts`), with each pair's ink compared both in place and forgiving
motion within 4 px:

| outline | line moves (px) | in place: mean / pixels flickering | forgiven: mean / pixels flickering |
| --- | --- | --- | --- |
| turning, π/72 a drawing | 0.90 | 0.183 / 31.7% | 0.043 / 6.0% |
| still rock, re-drawn (0.05°) | 0.04 | 0.018 / 2.4% | 0.004 / 0.1% |
| plan 1's re-seed boil | 0.07 | 0.045 / 6.2% | 0.009 / 0.0% |
| plan 1's wobble boil | 0.23 | 0.111 / 15.7% | 0.010 / 0.0% |
| runs cut by fixed sectors | 0.85 | 0.174 / 30.3% | 0.040 / 5.6% |
| an even line on the same geometry | — | 0.353 / 44.0% | 0.037 / 4.7% |

Seed jitter alone is small. Most of the turning rock's change survives the 4 px forgiveness, and an even line drawn on
the same geometry boils as much, so it is the outline's own shape:
- The silhouette is re-traced and really changes as the rock's bumps turn past the edge (`model-shapes.ts:173`).
- Folds come and go at a threshold with no hysteresis (`model-shapes.ts:196`).
- Placing stamps by step from the run's start (`stamp-placement.ts:180–219`) adds a little. Runs cut at fixed sectors,
  which hold the stamps' start, gained nothing.

In the full rock scene, drawings 24 to 25 flicker on 1.8% of outline pixels (forgiven). This is a small fix in the
project: steady the folds or drop them, and pick the turn rate. Stamps keyed to the surface aren't needed for it.

**Gaps hand-crafted in the toy** (each is phase 2's to build or name):
1. The skins are baked into base64 modules (`models/*-glb.ts`, 3.7 MB), since a scene can't wait for WASM or load a
   .glb synchronously. The .glb writer and reader are written by hand, for the subset the toy writes.
2. three.js's `PerspectiveCamera` and `setViewOffset` are used directly (`buildPaintCamera`'s camera description replaces them).
3. The lights are a list in camera terms (`model-stage.ts`), hand-converted to a `StampFormLight` for the
   ellipsoid. There is no scene light list yet.
4. The CPU rasteriser, the field tracing, the zone thresholds and route A are all in the project
   (`model-shapes.ts`, `model-lines.ts`). `cyclicRuns` is copied from `stamp-form.ts`, which doesn't export it.
5. The turning rock compiles its written painting once and hands its moving groups (`rock`, `rock-ink`) in each
   drawing as live marks through frame state, keyed by a drawing index stepped on twos by hand (`floor(t × 24 / 2)`,
   on a 30 fps video, so holds are uneven). Live marks need a fixed deposit count, so every traced kind has a fixed
   number of slots (`ROCK_SLOTS`), and a spare slot is a tiny piece off the frame.
6. The value scheme is hand-written in the project: a half-tone (lit masked out, the silhouette glazed), the shade, a
   core band and strokes along the terminator, and the rim kept by a mask in every passage after the lightest
   (`keepRim`). A style or technique should own it; `stampChargedForm` already takes faces with a facing.
7. Regions are authored as analytic fields over space, with no tool to place one on the surface.
8. To bundle `manifold-3d` for the browser, its `node:` imports are aliased to a stub. Remotion's webpack would need
   the same.

**Needs in `lib/paint` and the renderer (for vid-140; nothing built here):**
- **Live marks work and help less than hoped.** The rock's moving groups were moved to live marks. The table gives
  1080p in one tab, from file-write gaps (`tools/frame-times.ts`):

  | | new drawings: median / p90 | held frames: median |
  | --- | --- | --- |
  | whole painting rebuilt | 664 / 815 ms | 47 ms |
  | live marks | 588 / 683 ms | 46 ms |

  - A back-to-back run under a heavier load gave 716 / 892 against 584 / 653 ms.
  - Each live group reloads in about 22 ms against 59 ms for the whole painting.
  - What remains is compiling the moving groups, about 390 ms. Of that, 65% is `placeStampFlood`, mostly
    `stampDistanceGrid` (`stamp-region.ts:69`), and tracing is about 80 ms.
- **Cheaper flood placement** is the need this exposes. A re-traced object can't hold 30 fps while it compiles its
  regions' floods each drawing.
- **A live group whose deposit count can change.** Region pieces split and merge as the rock turns (the moss), so the
  written-group-re-placed rule (`stampLiveGroupProblem`) can't hold. The toy fixes the count with spare slots (none
  ran out over 72 drawings). vid-140 notes that letting it vary is local to `loadBank`.
- **A region given as a sampled field** (a grid with an iso level), which areas and masks could read directly. The ID
  image already is one, so masks and `within` would skip tracing and keep sub-pixel edges.
- Later, the device-sharing question: whether guide renders can stay on the stamp renderer's device.

**The throat and the values (second pass).**
- **The throat** was `min(x − (0.02 + 0.6(z/0.9)²), 1.98 − headY)`. That is a half-space cut by a parabola, so its
  edge ran straight down the flank. It is now an oval bib narrowing toward the chin (`frog-body-model.ts`, `throat`),
  re-baked into `frog-body-glb.ts`. It is a small authoring fix, on the workspace branch. Writing regions as fields
  holds up, so region authoring isn't a spike.
- **The values.** The body's lightness (CIE L*) was measured against a hand-traced outline of the reference's frog
  (`tools/value-sheet.ts`):

  | | body L* p5 / p25 / median / p75 / p95 | ground median |
  | --- | --- | --- |
  | model frog | 55 / 67 / 73 / 85 / 92 | 45 |
  | reference | 31 / 44 / 66 / 76 / 96 | 21 |

  The model's range is 37 against the reference's 64. The ink reaches L* 18–33, so the darks are there to use. The
  constants that set this are in `model-painting.ts`:
  - the ground wash (radial inner 0.45, line 116)
  - the half-tone at opacity 0.3 (165), the shade at 0.7 (169) and the core at 0.45 (172)
  - the frog's green, mostly yellow (229)
  - the shade mix at 0.68 (251)

  It is a tuning fix, not applied. Whether a style or a technique owns these values (gap 6) is still open.

**Look notes, for later (Graham):** the lighting model, and how transparent some fills read, the frog's green
especially.

**New questions and follow-ons:**
- **Steady folds:** hysteresis on the fold threshold, or no folds while turning, and the turn rate. This is the
  boil's small fix.
- **Values:** the style owns zone thresholds, core darkness and rim strength.
- **Stable marks:** test rest-surface attachment for fills, and silhouette coherence, separately. This and plan 3's
  silhouette spike are one experiment.
- **Cheaper tracing:** measure GPU readback plus today's tracing. Optimise the tracing first; consider field-native
  regions only if cost or quality demands it.
- **Mesh density:** field regions don't need the finest mesh (face IDs did), so edge 0.06 halves the frog's build;
  check its silhouette.
- **A .glb in a scene:** a loader and `delayRender` in the bundle, or a build step that writes a module, as this toy's
  bake does.

## Phase 2: Still objects painted from a model (sketched)

### Goal

A scene paints a still object from a model built in code: its regions as fills, its light zones from the scene's
light list (key and rim), its outlines from the silhouette and region edges. The frog scene's rock and the frog's
body at rest are painted this way, and the scene file only declares them.

### Approach

- Building a model (blended shapes to mesh, regions, glTF out) is a shared feature outside paint, because previs and
  the film stage can use code-built models too. Painting from a model lives in paint.
- The light list is the one light affordance. `StampFormLight` folds into it, and `stampRoundedForm` becomes its
  source for a flat outline.
- The shared renderer makes GPU guides. The stamp painter's adapter traces the read-back fields into polygon regions
  and extracts curves for strokes.
- The mesh keeps rest positions and topology, and the guide carries rest position for marks attached to the surface.
- The frog's hand-written light and shifted masks are deleted here. The primitive figure stays until phase 3, because
  the live sac is still posed through it.

### Done when

- The same frog also renders with one simple graphic material, from the same geometry, pose, camera and lights.

## Phase 3.0: Change of form as blend shapes (spike: toy experiment)

### Goal

We know how a model keeps one set of vertices across a change of form (the throat puff, the breath), so the
markings stretch with the skin and glTF morph targets can carry it.

### Questions

- Rebuild the changed shape and pull the rest mesh's vertices onto it, or deform a fixed mesh: which keeps the throat
  reading as skin at the reference's full puff (the sac at about twice its rest size, `scale: { sac: 1.9 }` in plan
  1's frog)?
- Does the throat patch stretch convincingly, and do the outlines stay painted at their width (plan 1's live look)?
- What does a re-posed model cost per frame at 1080p, against plan 1's live sac on the same machine?

### Approach

- A toy on phase 2's model and painting source; it may extend them on its own branch. A puff and a breath on the frog
  only, in watercolour, beside the reference.
- Blend shapes keep the rest mesh's topology and its surface correspondence.

### Done when

- Every question above is answered in this phase's findings section, with clips and frame costs, so phase 3 can be
  shaped.

## Phase 3: A character's body changes form (sketched)

### Goal

The frog's throat puffs as skin swelling out of the chin and chest, the patch stretching with it, and the body
breathes. Both are named blend shapes played on plan 1's timing layer. `posed-primitive-figure.ts` is deleted.

## Phase 4.0: A face written in code (spike: toy experiment)

### Goal

We know whether face parts written in code (an eye open, half and closed, its gaze; a mouth) and pinned to a point
and direction on the surface can read as alive beside the reference.

### Questions

- Are poses written in code good enough, or does a face need drawing by hand?
- Do blends between poses (a blink, a glance) hold as matched paths?
- Does a pinned face part turn and foreshorten convincingly with the head?

### Approach

- A toy on phase 3's frog; it may hand-craft face poses in its own project. One eye and the mouth, a blink and a
  glance, beside the reference, judged by the critic and by Graham.

### Done when

- Every question above is answered in this phase's findings section, with clips, so phase 4 can be shaped.

## Phase 4: The frog comes alive (sketched)

### Goal

The frog's eyes blink, glance and catch the light, beside the 3D body. Named face and body poses form an expression
library, and a scene flows between expressions by name.
