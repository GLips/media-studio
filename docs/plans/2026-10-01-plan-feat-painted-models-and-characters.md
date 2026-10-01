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
