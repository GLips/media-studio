---
title: "feat: Painted animation, part 3: painterly 3D"
type: feat
status: draft
date: 2026-09-30
dependsOn: [docs/plans/2026-09-30-plan-feat-painted-animation-strokes-and-timing.md (phases 2–3; this plan's spike 1.0 needs only plan 1's spike 1.0 findings), docs/plans/2026-09-30-plan-feat-painted-animation-multiplane-and-compositing.md (the paint-to-texture and shared-device seam; projection painting and 3D layers only)]
relatesTo: [vid-44, vid-55]
---

# Painted animation, part 3: painterly 3D

## Context

Plan 1 makes painted strokes move on a flat canvas. Plan 2 puts painted layers at depth under a camera and shares the brush engine's GPU device with three.js. This plan lets the painting follow real 3D geometry. The target is the look Graham loves in Arcane: 3D sets and characters that still read as painted. The other target is the collage case: one scratchy-pen character in an otherwise painted scene, or a scene per style, each drawn from the same models.

There are two routes, and they share nothing below the anchor layer:

- **Strokes from geometry.** A three.js mesh is a *source*: silhouettes, creases and hatching become rest strokes. Surface-anchored strokes (Meier 1996) are placed once in surface coordinates and re-evaluated on the posed mesh each frame. Hidden lines are removed with an ID reference buffer (Kalnins et al., WYSIWYG NPR 2002). Silhouettes come from the zero set of interpolated n·v (Hertzmann & Zorin 2000). The strokes then go through plan 1's hand, brush and timing unchanged. Brush, hand and timing never learn where a path came from.
- **Projection painting.** A painting made from one camera view is projected onto the model, and the render camera stays near the projector. The painting comes from the brush engine (painting strokes derived from the geometry) or from an image model conditioned on a depth render. It reaches three.js through plan 2's paint-to-texture seam.

Verified against the code and sources:
- three is pinned at 0.186.0. The repo's 3D stage (`lib/picture/film/studio/three-stage.tsx`) is WebGL. The stamp engine runs WebGPU on its own device.

Assumed, not verified: plan 2 recommends `WebGPURenderer` on the shared device, and this plan's ID buffer and projector node assume that. Plan 2's spike 1.0 settles it; if it goes the other way, both move renderer.
- Meier's model is pure per frame: particles are scattered once per triangle, each keeps its seed, and each frame reads attributes from reference renders. Nothing is carried from the previous frame. That fits plan 1's first invariant as it stands.
- Image generation exists (`lib/footage/generation/engine/generated-image.ts`) and runs Node-side, before rendering.

The reading notes (`~/research/2026-09-29-painted-animation/reading-3d-compositing.md`) correct several claims in the two research reports (`~/research/2026-09-29-strokes-from-3d-geometry.md`, `~/research/2026-09-29-painting-in-3d-projection.md`). Where they disagree, the reading notes win. In particular, Paperman's Meander advects 2D strokes through motion fields rather than binding them to surfaces, so it is not the model to copy.

This plan is deliberately thin. Graham asked for seams, not features. Only the first spike is written out. The rest waits until a video actually needs 3D.

### What this plan needs from plan 1

All four are now in plan 1's seam list (the per-frame source and the visibility slot as evaluation boundaries only):

- **`surface(object)` is a legitimate anchor value.** Plan 1 builds only `canvas`, but the anchor field must not assume a 2D rest space. A rest position may be a point on a mesh (triangle and barycentric coordinates), and "anchor space" for boil displacement may be a surface's tangent space.
- **A source may produce rest strokes from geometry**, not only from authored paths and shapes. Plan 1's shape sources (polygon, ellipse, SVG path, and what spike 1.1 adds) are one kind of source. A mesh's silhouettes are another, and they produce different strokes each frame.
- **Visibility is a per-frame input to a stroke, and a pure function of t.** Plan 1's reveal runs on the rest stroke. Visibility is separate from reveal: it masks parts of a revealed stroke because they are occluded at this frame's pose and camera. The model needs a place for that mask that doesn't write the reveal channel.
- **Stamp identity keys on rest-stroke position** (plan 1's second invariant). For surface strokes the rest position is on the mesh. For silhouettes there is no stable rest stroke, which is what this plan's spike 1.0 tests.

### Out of scope

- Temporal coherence for silhouettes that needs frame history (Kalnins 2003's parameterization propagation, Bénard's Active Strokes). Both are stateful. They could enter only as a bake, and only if this plan's spike 1.0 shows position-seeded silhouettes are unusable.
- Motion-field advection of hand-drawn 2D strokes over renders (Paperman's motion pasting). Same reason.
- Suggestive contours (DeCarlo 2003). They'd be an optional line type once H&Z silhouettes and creases work.
- Photoreal 3D scenes on the WebGL stage. They stay as they are.
- Rigging and skinning tools. The spike uses a mesh that three.js already animates.
- Generating 3D models. Where a scene's mesh comes from is a scene's problem.

## Invariants

- **A 3D-sourced stroke is a pure function of the mesh's pose and the camera at t.** Surface particles are placed once from the rest mesh. Silhouettes, creases and visibility are recomputed each frame from that frame's posed geometry. Nothing reads the previous frame's silhouettes at render time; history enters only as a bake keyed by its inputs (plan 1's rule). *Why:* this is plan 1's frame invariant carried into 3D. The natural implementation (track silhouettes frame to frame) quietly breaks it, and the stateful coherence methods in the literature invite it.
- **Visibility masks strokes that exist; it never removes or reorders them.** Whether a silhouette stroke exists is decided by that frame's geometry: a silhouette source creates and retires strokes as the mesh turns. Hiding a stroke that exists goes through the visibility mask only, and it keeps its ID, seeds and place in paint order. Skipping GPU work for a fully hidden stroke is fine when it changes neither. Back-facing surface strokes fade near the terminator instead of being culled. *Why:* culling pops (Meier), and removing strokes would shift anything keyed by order.

## Phase 1.0: Silhouettes from a turning mesh (spike: toy experiment)

### Goal

We know whether silhouette strokes extracted each frame from a three.js mesh, tested for visibility with an ID buffer and painted through the stamp brush, hold together well enough as the mesh turns, what that costs at 1080p, and what plan 1's seams must carry for it.

### Questions

- **Coherence:** a mesh turns for a few seconds. Silhouettes are seeded by surface position along the silhouette (the nearest point on the mesh), not by silhouette index or arc length. Do their stamps hold, or does the texture crawl as silhouettes lengthen, split and merge? Is what remains readable as boil, and does holding on twos help?
- **Seeding:** the hypothesis is reference-mesh coordinates: a stamp's randomness comes from noise evaluated at its point on the rest mesh, or from keyed samples fixed on the mesh. Raw float-position hashes, quantised positions and view-axis angle aren't tried: the first jumps abruptly, the second adds seams, and the third doesn't name a material point. Silhouette extraction is its own source category (per-frame), so does it fit plan 1's model as such, or are silhouettes the case where re-placing each frame is the default?
- **Visibility:** does the ID-buffer test, sampled along each stroke's base path, give clean hidden-line removal on a mesh that occludes itself? Does a stylised stroke's width need a tolerance band at silhouettes (a stroke that touches its own silhouette in the buffer)?
- **Segmentation:** does splitting at cusps and at crossings with other lines give segments with constant visibility, so a test per segment is enough? Or is a per-sample mask needed?
- **Creases:** does adding creases by dihedral threshold, with the same visibility test, work without new machinery?
- **Surface strokes (if the above lands early):** do Meier particles in barycentric coordinates, painted through the stamp engine, stick through rotation without swimming?
- **Cost at 1080p:** per-frame silhouette extraction on CPU vs GPU, the ID render, visibility sampling, and painting. Which dominates?
- **Seams:** what did the spike need from plan 1's model that it didn't have? Candidates: the surface anchor, a source that returns different strokes each frame, a visibility mask separate from reveal.

### Approach

- A toy experiment outside `lib/`, painting with the real stamp renderer and a real brush from an installed style. Crawl and pop show only in motion, so compare clips, not stills, and show Graham the clips.
- One mesh that three.js already has, turning under a fixed camera. A torus knot or a sculpted head is enough; a skinned character only if the rest lands early.
- The ID buffer and the mesh render come from three.js on the device shared with the stamp renderer. If plan 2's device-sharing spike hasn't landed yet, read the ID buffer back to the CPU and say so in the findings rather than building the sharing here.
- Silhouettes follow Hertzmann & Zorin (interpolated normals, clean polylines across faces). Skip the dual-surface acceleration, which only helps static meshes.
- The spike's scene is also a frame-purity check: render the same frame twice, and out of order, and compare.

### Warnings

- Seeding by silhouette index or by arc length along a silhouette is the natural first implementation, and it crawls, because silhouettes change count and length every frame. Seed by where on the mesh a stamp lands.
- `three-edge-projection` looks like a ready-made hidden-line tool, but it projects along one axis, runs asynchronously and is built for static CAD drawings. It is useful as a reference, not per frame.
- Don't spend the spike on hatching, projection or a pretty mesh. The question is whether 3D-sourced lines hold together.

### Done when

- Every question above is answered in `docs/plans/2026-09-30-painterly-3d-spike-findings.md`, with clips linked. The surface-strokes question may instead be named as follow-on spike 1.1, and phase 2's surface-stroke half then waits on it. New questions are answered or named as follow-on spikes.
- The findings say whether plan 1's seeding invariant (randomness keyed by rest position, re-placing per frame only as an opt-in) holds for silhouettes. If it doesn't, that's flagged as a change to plan 1, not recorded as a seam note.
- The findings list the changes plan 1's anchor, source and visibility seams need, if any, so plan 1's phase 2–3 reshaping (or a revision after it) can take them.

## Phase 2: Strokes from geometry (moved)

Moved to `docs/plans/2026-10-01-plan-feat-painted-models-and-characters.md`. It paints a model built in code from its
regions, light zones and outlines, still objects first and then characters. That plan's spike 2.0 asks whether
outlines hold as an object turns. This plan's spike 1.0 above (silhouettes from a turning mesh, seeding, visibility)
stays the deeper test, and whichever runs first answers for both. Hatching that keeps its tone across sizes (Kalnins)
and one model drawn in several styles aren't in either plan yet.

## Phase 3: Projection painting (sketched)

### Goal

A 3D set can be painted once from a camera view, projected onto its geometry, and filmed with a modest camera move that still reads as one painting.

### Approach

- A projector node (projector view-projection to UV, a front-facing test and a depth test against the projector's depth) on the renderer plan 2 chose. `three-projected-material` is WebGL-only and has no occlusion handling.
- The painting arrives through plan 2's paint-to-texture seam when the brush engine paints it. When an image model paints it from a depth render, it arrives as a generated image made before rendering.
- The render camera's allowed distance from the projector is something a scene declares. A benchmark spike opening this phase (3.0), written when a video needs projection, measures how far it can go before stretching and revealed gaps show. Spike 1.0 answers nothing about projection.
- Painted strokes (plan 1's model, or the models plan's painted objects) may sit over a projected set, which is the Arcane layering: projected backgrounds, painted characters, drawn FX.
- Not covered yet: painted textures on **characters**, Arcane's other half, where a hand-painted texture rides a moving character. Graham counts it key to the look. It needs its own phase once a projected set works.
