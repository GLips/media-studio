---
title: "feat: Painted animation, part 2: planes at depth, a camera, and compositing with 3D"
type: feat
status: draft
date: 2026-09-30
dependsOn: [docs/plans/2026-09-30-plan-feat-painted-animation-strokes-and-timing.md (phases 2–4 only; spike 1.0 stands alone and can start now)]
updated: 2026-09-30 (against main after vid-116, vid-117 and vid-125)
relatesTo: [docs/plans/2026-09-30-plan-feat-painted-animation-painterly-3d.md, vid-129 (spike 1.0), vid-117, vid-125]
---

# Painted animation, part 2: planes at depth, a camera, and compositing with 3D

## Context

Plan 1 makes strokes move and gives them a timing layer, on one flat canvas. The PolyPaint Grease Pencil look Graham wants goes further. It's mostly hand-drawn strokes on painted planes at different depths under a moving camera (multiplane), with glow and depth of field over the result. Graham's collage idea also needs painted layers to sit beside three.js layers in one frame: a painted character over a 3D set, or a painted texture on a 3D object.

This is plan 2 of three, and it is deliberately thin: **seams, not features.** It names what it needs from plan 1's seams, runs one tracer spike across the riskiest seam, and sketches the rest. The sketched phases get reshaped when a video actually calls for multiplane or 3D compositing. Plan 3 (painterly 3D) builds on this plan's device-sharing and paint-to-texture seam.

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

## Phase 2: Multiplane painted scenes (sketched)

Waits on plan 1's phases 2–3 and a video that needs multiplane, not on spike 1.0.

### Goal

A painted scene places groups on planes at depth under an animated camera, and gets parallax from the camera's moves. The frog scene from plan 1 gains its background, midground and foreground planes and a slow camera drift, with no three.js involved.

### Approach

- Start from vid-117's moving groups, which already paint a group in its own coordinates and resample it into place, and vid-125's cut-out groups, which carry their own paper. A plane adds a depth, its own target, and a camera's projection in place of the group's 2D placement.
- Add the `plane` anchor value and fill in plan 1's camera step. Camera values are channels on plan 1's timing layer.
- Each plane renders to its own layer target, and the layer stack orders them by depth.
- Stamps and the hand stay computed at rest in anchor space (plan 1's invariant). The camera projects each plane's carried stamps to screen and they're re-rasterised each frame, so paint stays sharp on a dolly or zoom and texture doesn't crawl. Caching a plane as a raster is an optimisation, valid only while its reveal, deformation, sampling and effects are all still; it isn't part of the plane contract.
- Paper and grain become per layer, in `space: layer` or `space: screen` by the plane's setting.

## Phase 3: Painted-layer post (sketched)

Waits on phase 2, not on spike 1.0.

### Goal

Painted layers get depth of field, bloom and a shared paper look from the layer stack, each effect in `space: screen` or `space: layer`, with amounts set by the scoped style and the scene.

### Approach

- Depth of field on painted planes is a per-layer blur by distance from focus. It builds on the renderer's separable gaussian pass (the wet-edge mask blur), run full-frame per layer.
- Bloom is threshold-and-blur over the composite.
- One paper rule over every layer type, three.js layers included, so a mixed scene sits on one paper. The candidate is WYSIWYG NPR's paper transfer (a height field remapping alpha), or the engine's own paper model generalised.
- Amounts come from the scoped style; whether an effect is on, and when it changes, is the scene's call (plan 1: a style never introduces motion).

## Phase 4: 3D layers in a painted scene (sketched)

### Goal

A scene mixes painted layers with three.js layers in one frame, in both directions: a painted texture on a 3D object, and a 3D render as a layer between painted planes. 3D layers use three's own post.

### Approach

- The device ownership and texture seam are as spike 1.0 settled them.
- A 3D layer is a layer-stack entry with one depth, like a painted plane, and its camera follows the scene's camera. One depth per layer gives ordered cards, not mutual occlusion: a painted plane passing through a 3D object needs depth-aware composition or split layers, added when a shot needs it.
- 3D layers adopt three's WebGPU `RenderPipeline` with TSL `BloomNode`, gaussian blur and DOF, rather than reimplementing them.
- The WebGL `three-stage.tsx` stays as it is until maintaining both renderers causes a demonstrated problem or a video needs it.
