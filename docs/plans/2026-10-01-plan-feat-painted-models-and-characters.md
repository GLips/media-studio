---
title: "feat: Painted models and characters: one skin in code, surface regions, light, a living face"
type: feat
status: draft
date: 2026-10-01
dependsOn: [vid-140 (planes and caches, painting-in removed) for phases 2 onward; vid-142 (one three/webgpu renderer, one camera description) for phases 2 onward's guide renders]
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
- three is pinned at 0.186.0. `manifold-3d` and SDF libraries aren't dependencies.
- The figure sources live in `lib/paint/animation/models/figure/`.
- vid-114's form helper is built. `stampRoundedForm` (`lib/paint/painting/models/stamp-form.ts`) takes an outline and
  a `StampFormLight { direction, elevation }`, and returns shade regions, core paths, lit edges and a Lambert term.

Relied on from tickets, not yet in the code:
- vid-140 (in progress) deletes painting-in and checkpoints, and caches each group's painted result by its marks
  key, so a live model group is a group whose marks key changes.
- vid-142 (open) brings one `three/webgpu` renderer, one camera description, and three.js maths allowed in `models/`.

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
- **A model is a source of shapes, never a shown picture.** Its renders (region IDs, normals, depth, light) only
  guide the painting, and the model enters a scene inside a painted plane, not as one of vid-140's three.js planes.
  *Why:* the look is painted. A model wired in as a 3D plane would bypass the brushes.
- **One light description and one camera description.** Painters read light zones from the scene's light list,
  whether a shape comes from a model or from `stampRoundedForm`. A model's view uses vid-142's camera description.
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
pixel of the exact lines, the same in any render order. What doesn't hold yet: the painted line boils as the rock
turns (its geometry holds, but its stamps are re-placed each drawing), a re-traced object costs about 270 ms a frame
because the whole painting reloads, and the frog's throat patch is the wrong shape (an authoring problem).

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
boils: its breaks, density and the flecks beside it land differently every drawing (critic: FAIL on line texture),
because a stroke's stamps are placed along its path from the path's start, and the path is new each drawing. The
fills' textures (the crystals strokes) re-place in the same way. On twos it reads like a drawn boil, not crawl, but
it isn't Graham's "lines stay painted at their width" yet.

**Gaps hand-crafted in the toy** (each is phase 2's to build or name):
1. The skins are baked into base64 modules (`models/*-glb.ts`, 3.7 MB), since a scene can't wait for WASM or load a
   .glb synchronously. The .glb writer and reader are written by hand, for the subset the toy writes.
2. three.js's `PerspectiveCamera` and `setViewOffset` are used directly (vid-142's camera description replaces them).
3. The lights are a list in camera terms (`model-stage.ts`), hand-converted to a `StampFormLight` for the
   ellipsoid. There is no scene light list yet.
4. The CPU rasteriser, the field tracing, the zone thresholds and route A are all in the project
   (`model-shapes.ts`, `model-lines.ts`). `cyclicRuns` is copied from `stamp-form.ts`, which doesn't export it.
5. The turning rock recompiles its whole painting per drawing in a `useMemo` keyed by a drawing index stepped on twos
   by hand (`floor(t × 24 / 2)`, on a 30 fps video, so holds are uneven).
6. The value scheme is hand-written in the project: a half-tone (lit masked out, the silhouette glazed), the shade, a
   core band and strokes along the terminator, and the rim kept by a mask in every passage after the lightest
   (`keepRim`). A style or technique should own it; `stampChargedForm` already takes faces with a facing.
7. Regions are authored as analytic fields over space, with no tool to place one on the surface.
8. To bundle `manifold-3d` for the browser, its `node:` imports are aliased to a stub. Remotion's webpack would need
   the same.

**Needs in `lib/paint` and the renderer (for vid-140; nothing built here):**
- **A group whose marks change each drawing without reloading the painting.** Today a new `CompiledStampPaint`
  reloads everything: on the rock, about 60 ms of load (57 ms of it the stamp bank) and 67 ms of draw each drawing.
  The whole render runs about 270 ms a frame in one tab against 42 ms for the held frog. vid-140's per-group cache by
  marks key is what this needs; the model group's key is its drawing.
- **Stamps that stay put on a line that moves a little.** Placing a stroke's stamps by arc length from a stable
  anchor (or by a surface parameter, which route A's chains carry) would keep breaks and density where they were.
  Fills need the same for their marks.
- **A live group whose deposit count can change.** Region pieces split and merge as the rock turns (the moss), so the
  written-group-re-placed rule (`stampLiveGroupProblem`) can't hold.
- **A region given as a sampled field** (a grid with an iso level), which areas and masks could read directly. The ID
  image already is one, so masks and `within` would skip tracing and keep sub-pixel edges.
- Later, the device-sharing question: whether guide renders can stay on the stamp renderer's device.

**New questions and follow-on spikes:**
- **Stable marks on moving lines:** stamps keyed to a surface parameter, on vid-140's live groups. The boil is the
  biggest gap to the look.
- **Region authoring:** a 2D shape projected from a chosen view onto the skin, distance on the surface from painted
  points, or fields. The throat bib is the test.
- **Value and contrast as style:** the zone thresholds, the core's darkness and the rim's strength. The critic's
  third gap is value.
- **Cheaper tracing:** typed-array contouring, or the GPU ID image (10 ms) feeding field regions.
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
- The frog's hand-written light and shifted masks are deleted here. The primitive figure stays until phase 3, because
  the live sac is still posed through it.

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
