---
date: 2026-10-01
topic: painted-characters
---

# Painted characters: one skin, a living face, tools first

## What We're Building

Tools for authoring painted characters that read as alive: a character is one 3D surface built in code, with
markings painted as regions of that surface, blend shapes for changes of form, a hybrid face (2D painted eyes and
mouth pinned to the 3D surface), and light that comes from the model rather than from the scene. They're for Graham and
the agents that write scenes for him. The value is characters that look alive and painted, made with tools that make the
next character faster, not with workarounds written into one scene.

It follows vid-130 (plan 1), which built the primitives (frame state, the live seam, typed timing, motion over the
compiled painting, a medium per group) and proved them on a frog. The frog is a proof, not a pattern. Its naive parts
are this plan's starting list:
- The primitive figure never merges its parts into one skin, so the throat sac reads as a ball stuck under the chin.
- The figure has no surface markings, though the reference's pale throat runs from the jaw down the chest, with a red
  dot by the cheek.
- The eyes are static discs, with no lid, blink or gaze.
- The light is a hand-written vector with shade masks shifted toward it.
- The deform spike's 2D frog was drawn from typed pixel coordinates, its arm a rigid rotation.

The same frog and reference (the first 7 s of the Grease Pencil tutorial, private) stay the test bench.

## Requirements

- **R1 (must): one skin.** A character is a single surface built in TypeScript from smoothly blended shapes, saved as
  glTF · works when the throat swells out of the chin and chest with no crease, and the model opens in Blender.
- **R2 (must): markings are regions of the surface** · works when the pale throat and the cheek dot follow the body as it
  turns and puffs, and their edges can be drawn as lines.
- **R3 (must): blend shapes for changes of form** (the puff, the breath) · works when the puff reads as skin stretching
  and the throat marking stretches with it.
- **R4 (must): a hybrid face.** The eyes and mouth are 2D painted drawings pinned to the surface, with poses to swap or
  blend between, a blink and a gaze among them · works when the eyes read as alive beside the reference.
- **R5 (must): light as an engine affordance.** Key, rim and form shading come from guide renders of the model ·
  works when moving the light restyles the character with no scene edits.
- **R6 (must): the tools are the product** · works when the frog's scene file is short and declarative, and the
  findings list each affordance built because writing the scene needed it.
- **R7 (nice): an expression library.** Named face and body poses, and authoring that flows between them by name.

## Scope

- **In:** R1–R7 on the frog. Moving last night's naive parts into the right plans. Plan 3 is slimmed (its phase 2,
  strokes from a mesh, moves here) and gains a note that painted textures on characters (Arcane's other half) aren't
  covered yet. Plan 2 (vid-136) already holds the coordinate-space notes.
- **Out:**
  - Projected textures (plan 3's phase 3, sets).
  - Image-to-3D and generated models (at most a reference shape).
  - Full skeletal rigging, meaning skin weights and IK (a few joints plus blend shapes instead).
  - Multiplane and camera (plan 2).
  - Blender via MCP (glTF keeps the door open; add it if code modelling stalls).

## Why This Approach

- **Model in code, with glTF as the hub.** It grows out of today's primitive figure, is repeatable and easy for an agent
  to write. glTF gives the ecosystem: three.js loads and exports it with morph targets, materials and joints, and Blender
  can open it to check or touch up. Prior art (scout, 2026-10-01): SDF smooth union meshed by `manifold-3d`'s
  `levelSet`, or `sdf-csg`. Matching vertices across blend shapes after re-meshing is unverified and the likely hard part.
- **Markings as per-face region IDs.** three.js renders an ID image, and regions and their boundaries become stroke
  sources. This is how Blender's Line Art draws material borders, and Kalnins' ID buffer.
- **A hybrid face.** It follows Spider-Verse's split between acting lines (authored per expression) and form lines
  (from geometry), and Live2D's and Rive's pose blending. It's the direct cure for dead eyes.
- **Light as guide layers** (key, rim, ambient occlusion), as Klaus's lighting tool did for drawn characters. It's read
  by the brush, as in Meier 1996. Bénard & Hertzmann's 2019 tutorial is the reference for lines from 3D.

## Key Decisions

- **The first proof is one character that reads as alive.** Depth on one subject before breadth; expressions follow.
- **The face is hybrid** (Graham's pick): 2D drawings pinned to the 3D body.
- **The model comes from code, as one skin**, with glTF as the format.
- **Tools over output.** A missing affordance is built in the engine or recorded, never worked around in the scene.
  The output should still be good, and the reference keeps it honest.
- **The quality loop:** every pass renders beside the reference and a written checklist (one skin, markings, eyes with
  light and gaze, blink, anticipation and follow-through), and a fresh critic agent judges it. Graham checks in now
  and then.
- **The plan is a living document.** Some affordances are designed up front, others are found while building. Findings
  amend the plan, and spikes explore where the shape is unclear.
- **A new plan, "painted characters".** It takes plan 3's phase 2; plan 3 keeps its silhouette spike and projection
  painting.

## Left open

- Whether blend shapes come from SDF parameters re-meshed onto matching vertices, or from a fixed mesh deformed
  (an early spike decides).
- How the face's 2D drawings are authored (paths, a small pose editor, or poses written in code) and how they're pinned
  (surface anchors as plan 3's `surface(object)`).
- Whether guide renders read back to the CPU or share the stamp engine's GPU device (plan 2's device-sharing spike).
- Whether the colour-channel work paused in worktree `media-studio-vid130-colour` belongs here or stands alone. The
  frog-look worktree (`media-studio-vid130-look`) is superseded by this plan.
