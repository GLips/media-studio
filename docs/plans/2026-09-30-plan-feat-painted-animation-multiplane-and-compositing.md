---
title: "feat: Painted animation, part 2: planes at depth, a camera, and compositing with 3D"
type: feat
status: active (2026-10-01: spike 1.0 done (vid-129); phases 2–4 reshaped against plan 1 as built and building in vid-136)
date: 2026-09-30
dependsOn: [docs/plans/2026-09-30-plan-feat-painted-animation-strokes-and-timing.md (phases 2–4 only; spike 1.0 stands alone and can start now)]
updated: 2026-10-01 (phases 2–4 reshaped against plan 1 as built, main aba3337)
relatesTo: [docs/plans/2026-09-30-plan-feat-painted-animation-painterly-3d.md, vid-129 (spike 1.0), vid-117, vid-125]
---

# Painted animation, part 2: planes at depth, a camera, and compositing with 3D

## Context

Plan 1 makes strokes move and gives them a timing layer, on one flat canvas. The PolyPaint Grease Pencil look Graham wants goes further. It's mostly hand-drawn strokes on painted planes at different depths under a moving camera (multiplane), with glow and depth of field over the result. Graham's collage idea also needs painted layers to sit beside three.js layers in one frame: a painted character over a 3D set, or a painted texture on a 3D object.

This is plan 2 of three. It was drafted thin (**seams, not features**); phases 2–4 were reshaped against plan 1 as built on 2026-10-01, in "Reshaped against plan 1 as built" below, which replaces the sketches. Plan 3 (painterly 3D) builds on this plan's device-sharing and paint-to-texture seam.

It uses plan 1's terms as written there: rest pose, channel, anchor, scoped style, bake, and the feature `paint/animation`. Research is in `~/research/2026-09-29-painted-animation/reading-3d-compositing.md` (plan 2 recommendations) and `~/research/2026-09-29-painting-in-3d-projection.md`.

**The load-bearing finding: painting and 3D use different graphics APIs today.** Checked against main on 2026-09-30, after vid-116, vid-117 and vid-125:
- The 3D stage (`lib/picture/film/studio/three-stage.tsx`) is `THREE.WebGLRenderer` with `UnrealBloomPass`, and so is previs's `blockout.tsx`.
- The stamp engine is WebGPU on a device it makes itself. `createStampPaintDevice` (`lib/paint/painting/studio/stamp-paint-gpu.ts`) asks for `texture-formats-tier2` and the adapter's whole `maxBufferSize`, and `stamp-paint-surface.ts` owns the device and the canvas it configures (`alphaMode: 'opaque'`), and disposes both.
- The installed three is 0.186.0. Its `WebGPUBackend` takes `parameters.device`, and it exports `ExternalTexture`.
- **Paint has two compositors now** (vid-83): `stamp-paint-compositor.ts` mixes flat colour, gamma-encoded and never decoded to linear light, as Photoshop does; `stamp-paint-pigment-compositor.ts` mixes pigments with Kubelka–Munk and holds the painting as reflectance in eight bands, shown through sRGB. Three's `WebGPURenderer` works in linear light, so each direction of the round trip converts, from either compositor's output.
- The compositors only mix paint: a deposit onto its group, a group onto the painting, the paper under it. Nothing stacks layers by depth or takes an outside layer; that is new work, the **layer stack**, a scene concept. The renderer's separable blur passes (wet edges, and vid-118's bloom) are the reusable piece for a layer blur.
- **There is no CPU renderer** (vid-116). The GPU is the only renderer, held by a GPU gate in pre-commit with golden fixtures under `harness/fixtures/stamp-paint/`. Any change to `paint/painting` this plan makes passes that gate unchanged.
- **First steps toward planes already exist.** vid-117's moving groups (`models/stamp-group-motion.ts`) paint a group in its own coordinates and resample it into place each frame, with checkpoints keeping still parts cached. vid-125's group paper (`paper: 'own'`, pigment only) makes a group a cut-out that carries its own paper. A plane is roughly a moving group, rendered to its own target, at a depth, under a camera.

So a zero-copy seam exists, but only under three's `WebGPURenderer`. It is not yet shown to work end to end: sharing the device, `ExternalTexture` wrapping a stamp target, determinism in a headless Remotion render, and three's device needs alongside `tier2` are all unverified.

### What this plan needs from plan 1

Spike 1.0 needs none of this; it runs on today's engine. Phases 2–4 do. Plan 1 is being rewritten against today's engine, so treat these as asks of the rewrite. The first four were in plan 1's seam list; the fifth is not:
- **Anchor is a field on grouping nodes.** This plan adds the value `plane` (a depth z, plus whether its paper and grain travel with the plane or stay fixed to the screen). Boil displaces in anchor space (plan 1, phase 3), so a moving plane carries its boil.
- **Strokes pass through a camera step**, which is the identity in plan 1. This plan fills it with a camera (position, lens, focus) that maps anchor space to screen, driven by plan 1's timing channels like any other animated value.
- **Nothing assumes one canvas-sized target per painting.** This plan renders each plane-anchored group to its own layer target and composites them.
- **Paper is read from the painting level until this plan makes it per layer** (plan 1, phase 2).
- **The stamp engine's device can be supplied from outside**, rather than always created by `createStampPaintDevice` and owned by the surface. This plan's spike 1.0 makes and proves this change, and it's kept if the spike succeeds.

### Out of scope

- Everything plan 3 covers:
  - strokes generated from three.js geometry (silhouettes, creases, surface fills);
  - surface-anchored strokes (the Meier model: stamps in triangle + barycentric coordinates);
  - hidden-line removal by an ID buffer;
  - projection painting (a TSL projector node with front-face and depth tests).

  This plan gives plan 3 the device sharing, the paint-to-texture seam and 3D layers in the layer stack. It does not give it the surface anchor.
- Moving the photoreal `three-stage.tsx` or previs off WebGL. Painted scenes use `WebGPURenderer`; the WebGL stage stays for scenes that don't paint, until maintaining both renderers causes a demonstrated problem or a video needs it.
- pmndrs/postprocessing. It's WebGL-first.
- Advected, motion-field tools in the Paperman style (dragging a hand-drawn 2D stroke along a 3D motion). They'd need the bake.
- Building the bake.

## Invariants

- **A frame stays a pure function of the compiled painting, `t`, cues and frame rates** (plan 1's invariant). This extends it to the camera, every layer and every post effect, three.js layers included. A three.js layer reads no state from the previous frame: no accumulation across frames, no temporal anti-aliasing or reprojection. *Why:* Remotion renders frames in parallel and out of order.
- **Every effect and paper declares its `space`, `screen` or `layer`.** Nothing is implicitly fixed to the screen. (`anchor` stays the geometry term: `canvas | plane | surface`. `canvas` means fixed screen coordinates at reference resolution, unaffected by the camera, so a canvas-anchored group acts like a title card; parallaxing content is plane-anchored.) *Why:* Spider-Verse tracked halftones to characters to stop them "swimming", and left them loose elsewhere. Klaus's grain "travels with the character". Which one is right is per effect, per scene.
- **Painted-only scenes don't depend on three.js.** Multiplane, per-layer blur, bloom and paper for painted layers run in the layer stack. three.js enters only when a scene has a 3D layer or a painted texture on 3D. *Why:* the frog-style scene should cost one renderer, and the renderer already has a gaussian pass to build a layer blur on.

## Phase 1.0: One device, a painting on a three.js plane (spike: tracer bullet)

### Goal

We know whether the stamp engine and three's `WebGPURenderer` can share one `GPUDevice` in a headless Remotion render, with a painting going into a three.js material and a three.js render coming back into the layer stack, deterministically, at a usable cost at 1080p.

### Questions

- Can three's `WebGPURenderer` take the device `createStampPaintDevice` makes (with `texture-formats-tier2`)? Or must three create it and the stamp engine accept it? Do three's required features and limits coexist with `tier2`?
- Can `ExternalTexture` wrap a stamp target (`rgba16float`) directly, or does it need a conversion pass to a format three samples? Which space does a mixed composite blend and take paper in, gamma sRGB or linear, and where do the conversions and premultiplication changes sit? Answer it for both compositors: flat (gamma-encoded colour) and pigment (eight-band reflectance, shown through sRGB).
- In the other direction, can a `WebGPURenderer` render target's `GPUTexture` feed the layer stack as a layer without a copy through a canvas?
- Does the round trip hold `studio repeatable`'s bar (cold, warm and multi-tab renders above 50 dB PSNR; the stamp engine alone isn't byte-identical), and does three add variance beyond the stamp engine's own? `WebGPURenderer` defaults to watch for: MSAA resolve, anything temporal, async shader compilation racing the first frame. Does Remotion's `delayRender` cover three's async init and pipeline compilation?
- Frame cost at 1080p: painting one revealing stroke, and one of vid-117's moving groups, rendering a rotating plane with it on, compositing the render back with a per-layer blur. How much is three's init and pipeline compile, paid once per tab, versus per frame?
- Does the headless browser Remotion renders with expose WebGPU with the features both need? The stamp engine already renders there, so this is mostly about three's needs.

### Approach

- The demonstration lives outside `lib/`, in one Remotion composition. The spike may make narrow, reviewable changes to `paint/painting` (accept a device, expose the target texture, take an external layer), since the device-taking path is private today; those changes are part of its deliverable. Other sessions are editing `paint/painting` (wet stages, per-frame cost, crayon, group paper), so keep the changes small, land them separately from the demonstration, rebase before landing, and pass the GPU gate with no golden moving.
- The texture seam's contracts are part of the findings: transparent paint output (today paper stores alpha one, `layPaper` in `stamp-paint-compositor.ts`, and the surface's canvas is configured `alphaMode: 'opaque'`) with paper presentation optional, texture lifetime, disposal of a borrowed device (today the surface makes the device and destroys it on dispose), submission ordering, and premultiplication across the colour conversion.
- Use the real stamp renderer and a real brush from an installed style, not a mock, because the colour and format questions are about actual paint.
- The round trip is the point: paint → three.js material on a rotating plane → rendered → back into the layer stack as a layer → blurred. Each hop is one of the seams plans 2 and 3 stand on.
- Check determinism with `studio repeatable`.
- Measure with the existing frame profiler in a headless render.

### Done when

- Every question is answered in `docs/plans/2026-09-30-painted-animation-spike-findings.md` (its own section; plan 1's spikes may add theirs later), with the render linked. New questions are answered or named as follow-on spikes.
- The findings name how the device is owned and passed (who creates it, what `paint/painting` must accept), and whether the seam is zero-copy or needs a conversion pass.

### Warnings

- Don't build multiplane, a camera or post here. Everything on the far side of the seam is sketched below for a reason.
- If sharing the device fails outright, stop and raise it before trying a fallback. A copy through a canvas each frame is a fallback, not the seam. It changes plan 3's cost too.

## Reshaped against plan 1 as built (vid-136, 2026-10-01)

Phases 2–4 were sketched before plan 1 existed. Plan 1 has landed (main aba3337): `paint/painting` draws a frame from
the compiled painting plus each group's frame state (lay, warp, marks, paint time, visibility), `paint/animation`
evaluates pins, clips, boil and holds into that state, and the frog scene runs on it. This section replaces the
sketches. What changed, in short:

- **A plane is not a renderer concept.** Every painted plane stays a group (or several) in one painting. The camera
  is evaluated in `paint/animation` and reaches the renderer as each group's lay. The renderer gains what any moving
  group needs: room past the frame's edge, a cached layer per group, a blur and a glow.
- **No transparent painted layers.** The sketch stacked a painting per plane, which needs pigment lifted off its
  paper (vid-129's follow-on 1, unsolved for Kubelka–Munk). One painting holding every plane keeps pigment mixing
  exact across planes, keeps one paper and needs no alpha. A 3D render enters the painting instead, as an outside
  layer in the group order.
- **Post lives in the renderer**, per group (blur, glow), not in a separate layer stack. three.js still enters only
  when a scene has a 3D layer.

### Coordinate spaces

Five spaces, each named once. Plan 1's composition order (rest → boil → deform and place per level → camera →
screen) runs through them in this order.

1. **Rest space.** A group's own pixels, where it's painted. Stamps, wet state, masks and the group's layer live
   here. Boil, pins, sway and placement map rest space onward (plan 1).
2. **Anchor space.** What rest coordinates are relative to, set on a motion node and inherited by its children:
   - `canvas`: the stage itself, untouched by the camera. A title card, or a scene with no camera.
   - `plane(depth)`: the plane's own 2D space, **as it appears through the camera at rest.** This is the multiplane
     stand's convention: each level is painted the size it looks, and its depth only says how it moves. A painting
     authored flat becomes multiplane by giving its groups depths, with no coordinate rewritten.
   - Plan 3 adds `surface(object)`.
3. **Stage.** The painting's pixel space: the frame plus a **margin** past each side, so a camera can bring in what
   lies just off the frame. Coordinates keep the frame's origin, so the margin is at negative coordinates and past
   the frame's width and height. Every target is the stage's size. Ground paper is fixed to the stage; a group on its
   own paper carries it.
4. **Layer bounds.** A group's painted box in rest space: what the renderer paints, caches and lays. Under a camera
   it is laid through the group's lay, and clipped to the stage.
5. **Screen.** The frame: the stage's window from (0, 0), the frame's size. The output pass reads that window, and
   glow is added there.

### The camera

A multiplane camera, as data on plan 1's clocks:
- **Pose:** `pan` (x, y px, measured at depth 1), `dolly` (toward the planes, in depth units), `zoom` (the lens, 1 at
  rest) and `roll` (radians), all eased between keys.
- **Projection:** a plane at depth `d` (from the camera's rest position) is laid onto the stage by a similarity about
  the frame's centre: scale `zoom · d / (d − dolly)`, shifted by `−pan · zoom / (d − dolly)`, turned by `−roll`. At
  rest it is the identity, so a plane shows as painted. A pan of 100 px moves a plane at depth 2 by 50 px and one
  at depth 0.5 by 200 px: parallax.
- **Focus:** a focus depth and an aperture, giving each plane a defocus blur (below). A thin lens's circle of
  confusion, `aperture · |1 − focus / distance|`, with distance `d − dolly`.
- **Where it composes:** after each group's own deform and placement and its ancestors' (plan 1's step 5, the
  identity until now). The camera's similarity folds into the group's lay, so a warped group keeps its warp under
  the move.
- **Timing:** the camera has its own clock, on ones by default: a camera move held on twos judders. Planes' drawings
  still change on twos.
- A `canvas` group ignores the camera. A group with no node is `canvas`.

### What the renderer adds

- **The stage margin.** The renderer's targets cover the frame plus the margin; the output pass shows the frame's
  window. At margin 0 every pixel is as before, so the gate's goldens can't move.
- **A cached layer per group.** Today a group drawn after a moving one repaints every frame (2a's note), so a camera
  move, which moves every plane, would repaint the whole painting. Instead each group whose lay varies keeps its
  painted layer (over its layer bounds) under its marks' key once its paint has settled, and a frame restores it and
  only lays it. A frame then costs the lays, not the painting. Bounded by a byte budget, least recently used given up.
- **Defocus (`defocus` in frame state):** a gaussian over the group's layer before it's laid, its sigma given in stage
  pixels and divided by the lay's scale into rest pixels. It blurs the paint film (coverage and pigment, or flat
  colour), not the light. For flat colour that is exactly a defocused layer; for pigment it is a defocused film laid
  over a sharp backdrop, which reads right and keeps mixing exact.
- **Glow (`glow` in frame state):** the light a group gives off. Its laid paint brighter than a threshold, in linear
  light, is blurred and added over the whole frame at the output, so it spills over what stands in front, as a bloom
  does. The amount, sigma and threshold are the group's; the light gathered by a frame is part of what a checkpoint
  holds.
- **Outside layers:** a slot in the group order whose pixels arrive each frame as a texture on the renderer's device
  (linear light, premultiplied), with a key naming its content. It takes the frame state a group takes (defocus, glow,
  visibility). The flat compositor lays it over. The pigment compositor first lifts its colour into the painting's
  bands by a basis worked out from the compositor's own display conversion, so the colour shown is the colour
  three.js rendered.

### Invariants this adds

- Every frame-state field is data with a key, so frames that agree share checkpoints and cached layers.
- At margin 0, with no defocus, glow or outside layer, the renderer draws exactly what it drew before.
- A cached layer is a pure function of its key: a frame restoring one draws what painting it afresh would have.

## Phase 2: Multiplane painted scenes

### Goal

A painted scene places groups on planes at depth under an animated camera, with parallax. Each plane's paint and boil
travel with it. No three.js.

### Approach

- **Engine (`paint/painting`):** the stage margin and the cached layer per group, each held by the GPU gate (a pan
  that brings the margin in; a layer restored from cache matching one painted afresh, in any frame order).
- **Motion (`paint/animation`):** `anchor` on motion nodes; the camera's keys and clock; the camera step folded into
  each group's lay; build-time checks (a plane behind the camera, a node anchoring inside an anchored parent, a pan
  that shows past the margin).
- Boil wobbles in rest space and placement follows, so a plane's boil travels with it (plan 1's order).

## Phase 3: Painted-layer post

### Goal

Painted layers take depth of field and glow, each set by the scene, its amounts available to scoped style.

### Approach

- Defocus and glow in the renderer, as above; the gate holds a blurred and a glowing group to their CPU twins.
- Depth of field is the camera's: `paint/animation` writes each plane's defocus from its focus distance.
- Glow is a node option (`glow: { amount, sigma, threshold }`), and any frame-state writer may animate it.
- **Deferred:** one paper over a mixed stack (paper over a 3D layer), and a rim light. Neither is asked for by the
  frog proof; each gets a ticket when a shot needs it.

## Phase 4: 3D layers in a painted scene

### Goal

A three.js layer sits in a painted scene, and a painting sits on a 3D object, on one shared device.

### Approach

- **The renderer's outside layer slot**, as above.
- **`paint/three-layers` (new, studio):** vid-129's round trip, lifted out of the spike project.
  - One device owned by the scene, lent to every stamp renderer and to three's `WebGPURenderer`.
  - A painting drawn into a texture three samples (sRGB decoded in the material, as the spike found).
  - A three.js scene rendered into the outside layer's texture, its camera following the multiplane camera, so a 3D
    layer at depth `d` moves like a plane there.
- **One depth per 3D layer** gives ordered cards, not mutual occlusion, as the sketch said.
- **Deferred:** three's own post (`RenderPipeline`, TSL bloom) inside a 3D layer, until a shot needs it. Our blur
  and glow apply to the 3D layer as to any group.

## The proof

A sibling of plan 1's frog scene, in the frog project, built as the PolyPaint tutorial's last steps are:
- background, midground and foreground planes, the foreground a dark silhouette of plants, as the reference's;
- a slow camera push and drift;
- the background and foreground out of focus, the frog sharp;
- a soft glow on the frog and the light;
- a painted 3D object among the planes.

It must be identical in any frame order and pass `studio repeatable`, with its frame time reported by `studio profile`.
