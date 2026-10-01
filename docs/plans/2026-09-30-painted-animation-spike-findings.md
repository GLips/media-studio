---
title: "Painted animation: spike findings"
date: 2026-09-30
relatesTo: [docs/plans/2026-09-30-plan-feat-painted-animation-multiplane-and-compositing.md, vid-129]
---

# Painted animation: spike findings

Each spike in the painted-animation plans answers its questions here, in its own section. Plan 1's spikes may add
theirs later.

## Plan 2, spike 1.0: one device, a painting on a three.js plane and back (vid-129)

**Short answer: it works, with no copies, and it repeats exactly.** Stamp paint and three's `WebGPURenderer` share
one `GPUDevice` in a headless Remotion render. A watercolour painting is the material of a turning three.js card.
Three renders straight into a texture of ours, and that render comes back as a layer, blurred and laid over a
flat-colour painting. It is byte-identical across cold, warm, reordered and multi-tab renders, and costs a few
milliseconds a frame at 1080p.

- **The render:** `~/research/2026-09-30-vid-129/round-trip.mp4` (6 s, 1920×1080), on a page at
  `~/research/2026-09-30-vid-129/index.html`.
- **The demonstration:** the project `work/projects/2026-09-paint-on-3d-round-trip/`, scene `roundTrip`; the
  pipeline is in `scenes/round-trip/round-trip-gpu.ts`.
- **The `stamp-paint` change:** `createStampPaintRendererOnDevice` in `stamp-paint-renderer.ts`. It borrows a device,
  draws each frame into a texture it's handed, and on dispose frees only what it made.

Everything below was measured on an M1 Max (Metal), Chrome headless as Remotion runs it, three r186.

### How the device is owned and passed

**The scene owns the device.** It makes the device with `createStampPaintDevice`, because stamp paint's needs are
the stricter: `texture-formats-tier2` and the adapter's whole `maxBufferSize` (4 GiB here). It lends the device to:

- each stamp renderer, through `createStampPaintRendererOnDevice(device, frameTexture, …)`;
- three, through `new WebGPURenderer({ device })`.

It destroys the device last, after everything it lent the device to has been disposed.

Three needs nothing the stamp device lacks. With a device passed in, three checks for `core-features-and-limits`,
which the device has, so it doesn't run in compatibility mode. Three's dispose leaves a passed device alone
(`WebGPUBackend.dispose` destroys only a device it made itself).

**What three loses on our device.** Left to make its own device, three asks for every feature the adapter has.
Ours asks only for tier2. On this adapter, three goes without:

- `float32-filterable` and `float32-blendable`;
- the BC, ASTC and ETC2 texture compression formats;
- `timestamp-query`, `shader-f16`, `depth32float-stencil8`, `dual-source-blending`, `clip-distances` and
  `subgroups`.

None of these matters for a lit card. They will matter for compressed textures (KTX2) or for linear filtering of
32-bit float textures. Follow-on below.

**Contracts a lent device carries:**

- **Three takes the device's error handler.** It sets `device.onuncapturederror`, replacing whatever was there, and
  routes every uncaught error on the device to its own `onError`, which logs it. Stamp paint uses error scopes, so it
  isn't affected. But an error outside any scope surfaces through three's handler even when it isn't three's. The
  spike's first WGSL typo did exactly that.
- **Both listen to `device.lost`.** Neither treats `reason: 'destroyed'` as an error, so the owner may destroy the
  device.
- **Each step lets its error checks finish before the next starts.** Error scopes are one stack per device. A stamp
  renderer's load and each draw push three scopes, await, then pop them, so anything else that pushes scopes on the
  device meanwhile catches its errors or has its own popped. The spike's own first version loaded both paintings at
  once, which risked exactly that. So:
  - the renderer now pops its scopes together, and leaves none behind when one reports an error. On a lent device, a
    load that throws before its check pops whatever it left open on release;
  - the scene loads its paintings one after the other;
  - frames run through one queue, which teardown drains before anything is disposed.

  Popping together doesn't by itself keep two loads that overlap apart: the layer stack owns that ordering.

### Painting to three: zero-copy, the conversion in the material

**`ExternalTexture` wraps a stamp target (`rgba16float`) directly.** Three binds the `GPUTexture` as a sampled,
filterable `texture_2d<f32>`. There is no copy and no conversion pass. Measured: a texel written as
(0.5, 0.25, 0.75) samples as exactly that.

**Three ignores the colour space on an `ExternalTexture`.** Its WebGPU backend never decodes in the shader
(`needsToWorkingColorSpace` is false). It relies on `-srgb` texture formats, and a stamp target isn't one. Setting
`colorSpace = SRGBColorSpace` changes nothing. So the material decodes sRGB itself. The spike's card writes it out
in TSL (`mix(pow((c + 0.055) / 1.055, 2.4), c / 12.92, step(c, 0.04045))`). `@types/three` types three's own
`sRGBTransferEOTF` as returning a bare `Node`, which `colorNode` refuses. Measured: (0.5, 0.25, 0.75) decodes to (0.2140, 0.0509, 0.5225), which is exact at half
precision.

**What the stamp renderer hands over** is what the canvas has always got: its output pass (`screenColor`, then a
fixed ordered dither of half a byte step), opaque, on its paper. The stamp texture is that pass's target in place of
the canvas, so the existing pass already does the conversion from each compositor's working space:

- **Flat compositor:** mixes gamma-encoded colour and hands it on as is.
- **Pigment compositor:** holds eight-band reflectance, converts it to linear sRGB and encodes it.

Both arrive gamma-encoded, and the material decodes both the same way. The output pass dithers only into an 8-bit
target. Into half floats it doesn't, so a painted layer isn't dithered twice when the stack dithers its result into
the canvas. The canvas path's shader is unchanged.

**Which space a mixed composite blends in:** linear light, premultiplied, which is three's working space. Within a
painting, each compositor keeps its own space: flat in gamma, pigment in reflectance, as before. A painted layer
enters the layer stack gamma-encoded and is decoded on the way in. The stack's result is encoded once, on the way
out. The spike's layer stack (`scenes/round-trip/layer-stack.ts`) does exactly this.

**Paper** stays inside each painting today. The card carries its own paper, so the card's surface *is* its paper.
One paper rule over a mixed stack (the plan's phase 3) is not answered here.

### Three back to us: zero-copy, into a texture we own

**Three renders straight into a `GPUTexture` of ours.** Its WebGPU backend's `setXRRenderTargetTextures(target,
texture)` registers our texture as a render target's colour. Our texture then outlives three's render target:
three's `destroyTexture` skips a texture marked external. The layer stack reads it where it is, with no copy through
a canvas.

The alternative is reading three's own render-target texture through its backend's private map
(`backend.get(texture).texture`). That is zero-copy too, but three owns the texture's lifetime, and a resize
recreates it.

- **Warning:** `setXRRenderTargetTextures` was built for WebXR, and `@types/three` leaves it out. The spike reaches
  it through a checked accessor (`ownColourTarget`), so a three upgrade that drops it fails the load rather than a
  frame. Pin and re-check it on every three upgrade.

**Three's render comes back linear and premultiplied.** It applies no tone mapping and no output colour space when
rendering to a render target: 0.5 in, 0.5 out. Cleared to transparent black, an opaque material writes alpha 1, and
a transparent one (straight alpha, `NormalBlending`) blends to premultiplied colour. Three writes alpha 1 for any
material that isn't transparent, has normal blending and no alpha-to-coverage, whatever its opacity
(`NodeMaterial`'s opaque rule). The contract: a 3D layer's materials are opaque, or transparent with
`NormalBlending`. Custom blending or output nodes would have to keep the result premultiplied themselves.

**MSAA works into our texture.** A `samples: 4` render target resolves into it: in a probe, 396 edge pixels had
partial alpha, against 0 without MSAA. The card uses 4×.

### Repeatability

`studio repeatable` at 0.2, 0.4, 1.5, 3, 5.2 and 5.9 s: **identical at every time** (infinite PSNR, both with and
without MSAA). The check covers:

- each frame rendered cold, on its own;
- frames replayed in reverse and scrambled orders, after runs of the frames before them;
- frames rendered in several tabs at once.

Three adds no variance on top of the stamp engine:

- **MSAA:** resolves the same each time.
- **Temporal effects:** none by default.
- **Pipeline compilation:** done with `compileAsync` while the frame is held at load (`delayRender` covers
  `init()` and the compile). Three's `render()` builds any missing pipeline synchronously anyway, so nothing races
  the first frame.

This frame is a pure function of `t`. Every target is cleared or wholly redrawn, and nothing reads the previous
frame.

### Cost at 1080p

From `studio profile` over frames 60–99, while the stroke is drawn and the sun moves (one of vid-117's moving
groups). Times are per frame, waited for on the GPU, in one tab:

| Step | Median | p90 |
|---|---|---|
| Stamp card (1024×768 watercolour: a revealing stroke, a moving group, washes) | 7.5 ms | 8.6 ms |
| Stamp backdrop (1920×1080 flat colour) | 0.8 ms | 1.0 ms |
| Three renders the turning card (lit, 4× MSAA, into our texture) | 1.0 ms | 1.2 ms |
| Layer stack (gaussian blur of the 3D layer, sigma up to 9 px, two passes, then composite) | 1.1 ms | 1.3 ms |

**Once per tab:**

- **Stamp load (both paintings, one after the other):** 184–305 ms across runs.
- **Three's `init()` and pipeline compile:** 26–32 ms.

**Whole render, steady state:** 38–42 ms a frame in one tab and 16–19 ms in three tabs, so 180 frames render in about
13 s. Three and the layer stack together add about 2 ms a frame. The painting stays the cost.

### Headless WebGPU

Remotion's headless Chrome (ANGLE on Metal here) exposes WebGPU with every feature both need. Three needs nothing
beyond core.

### Seam contracts

- **Transparent paint output:** not built. The spike paints on opaque paper, which is right for a painted card.
  Paint with no paper under it is a different question for each compositor:
  - *Flat:* paper stores alpha 1 (`layPaper`). With paper at alpha 0, normal-blended paint would come out
    premultiplied over nothing. A multiply glaze or a colour-burn rim has no backdrop to work on, though.
  - *Pigment:* a Kubelka–Munk film's colour depends on what's under it, so paint can't be lifted off its paper as
    an alpha layer exactly.

  Follow-on spike below.
- **Texture lifetime:** the scene makes every texture it lends and destroys them after their users let go:
  - the stamp renderer keeps the frame texture it's handed and never destroys it;
  - three's `ExternalTexture` and the registered render-target colour are both marked external, so three never
    destroys them;
  - three's own MSAA and depth attachments go with `target.dispose()`.
- **Disposing a borrowed device:** neither stamp paint nor three destroys a lent device. The stamp renderer frees the
  buffers and textures it made on the device (`lentStampPaintDevice`, a proxy that records them). Three's `dispose()`
  is async, so the scene awaits it, last made first, before destroying the device. The proxy keeps a reference to
  every resource until dispose, even one already destroyed (a boil epoch's evicted buffers). That is harmless for a
  scene's length, but `StampPaintScope` should drop what's destroyed. A cache keyed by device
  (`stampWetTransportPipelines`' `WeakMap`) sees each renderer's proxy as a new device, so renderers sharing a device
  don't share those pipelines. That costs a little load time, and the scope fixes it too.
- **Submission order:** one queue, so work runs in the order it was submitted. The stamp renderer's `draw` submits
  synchronously before it awaits its checks; three's `render` submits as it returns. The scene steps in order: card,
  backdrop, three, layer stack.
- **Premultiplication across the colour conversion:** stamp paint hands over opaque colour (alpha 1), so decoding
  needs no un-premultiply. Three's layer is premultiplied and linear, and the stack lays it over the decoded
  backdrop as `over + under × (1 − over.a)`. Paint that is transparent and gamma-encoded would need un-premultiplying
  before decoding (the follow-on).

### What `stamp-paint` must accept

- **A device it's lent and a texture to draw into:** `createStampPaintRendererOnDevice`. It refuses a texture its
  output pass can't fill as promised: an `-srgb` format (which would encode twice), an integer format, layers or
  multisampling. The canvas path,
  `createStampPaintRenderer`, is unchanged; the GPU gate passed with no golden moving.
- **Not yet:** an outside layer. The layer stack is a scene concept and lives outside the stamp renderer, so the spike
  didn't need one. The blur reused no stamp code: a 30-line separable gaussian was simpler than exposing the
  renderer's blur, whose bindings serve its masks.
- **When vid-123's shared surface lands** (`stamp-paint-surface.ts`, which owns the device and canvas), the borrowed
  path moves into it: the surface's output is a canvas (a device of its own) or a lent device plus a texture.
  `lentStampPaintDevice` is replaced by its `StampPaintScope`, which already keeps a painting's buffers and textures
  to free together.

### Follow-ons

1. **Transparent painted layers** (spike): paint without paper as a premultiplied layer, for a painted character over
   a 3D set.
   - *Flat:* paper at alpha 0, with a decision on what multiply and burn blends do over nothing.
   - *Pigment:* paint on white paper and multiply, or carry the film (K, S, thickness) into the stack and lay it over
     whatever is below in reflectance.

   Plan 2's phase 4 and plan 3 need it.
2. **The scene's device asks for what three would use.** `createStampPaintDevice` could also ask for the adapter's
   other features when it has them: float32 filtering, texture compression, timestamps. This is a small decision
   rather than a spike. Make it when a 3D layer first needs one.
3. **One paper over a mixed stack:** plan 2's phase 3, unchanged.
4. **Other GPUs:** measured only on Apple Metal. Byte-identity across machines was never claimed, and a Linux or
   Vulkan render machine is unverified.
5. **The back seam's API:** if three drops or renames `setXRRenderTargetTextures`, fall back to its own render
   target's texture through the backend, with three owning its lifetime.

## Plan 1, phase 1.1: authoring the frog (vid-130)

**Short answer:** write anatomy as vid-114's groups and passages, and motion as plays aimed at the typed handles the
anatomy returns. Poses are pins. Shapes come from a source that names parts and anchors, so no scene types a
coordinate. In a cold test, fresh agents wrote both scenes in the chosen form from the stub types' docs alone, with no
compile errors.

- **The code:** stub types, both candidate forms, the chosen form, the frog and a ported watercolor-paintings
  character in each, mistake probes, cold-writer logs and the shape sources. They live in
  `~/research/2026-10-01-vid-130/authoring/code/` (spike branch `vid130-authoring`, ffcb50b; not landed).
- **The page:** `~/research/2026-10-01-vid-130/authoring/index.html`, with every shape source's renders.
- **What was tested:** text only, typechecked against stubs. Nothing was rendered in paint.

### The chosen form

```ts
const frogGroup = s.group('frog', {
  composite: 'opaque',
  reveal: { at: cues.frog, over: 3 },
  pins: { sac: { part: frog.parts.sac, at: frog.anchors.chin }, chest: { at: frog.anchors.back, reach: 220 } },
}, (g) => {
  g.passage('body', { area: frog.silhouette.region, weight: 2, defaults: { ...g.look.roles.body, well: g.look.wells.skin } }, (p) => { … });
  g.passage('ink', { marks: boil(), defaults: { ...g.look.roles.outline, well: g.look.wells.ink } }, (p) => {
    p.stroke('silhouette', { path: frog.silhouette.outline, weight: 3 });
  });
});
s.play(frogGroup, puff, { at: frogGroup.revealed(), loop: 3 });
s.play(frogGroup, breathe({ pin: 'chest', amount: 0.02, period: 3 }), { at: frogGroup.revealed() });
```

### Answers

- **Where timing is written:** in plays, `s.play(handle, clip, { at, until, loop, rate, hold })`, aimed at typed
  handles. `at` is a cue, or another handle's `.revealed()` or `.end`.
  - How marks live (stuck, boil, live) is an option on the node. It describes the marks, not a track.
  - Reveal stays vid-114's, on passages.
  - Options-on-nodes (form A) was as short. But a cold writer used the outer scope inside an `apply`, and nothing
    caught it, so the boil missed its strokes. String paths (`revealed('frog/ikn')`) fail only at run time.
- **How a pose is written:** pins, of two kinds.
  - Radial: `{ at, reach }`.
  - Owned by a part: `{ part, at?, feather? }`. It was added because every cold writer guessed at reaches, and a
    radial pin on the wing hinge squashed the body.

  No lattice: the puff needs a box and six control moves in px, where a pin needs one `scale`. No ARAP for the frog.
- **Stuck, boil or live:** `stuck` by default, `boil()` (every 2 animation frames, a small amount) and `live` opt-in per
  node. The frog's body is stuck, its outline and the grass boil, and the grass blades are live.
- **Reveal pacing:** vid-114's `{ at, over }` or `{ at, secondsPerWeight }`. Every cold writer reached for a reveal on a
  group, split across its passages by weight. That is the one request to vid-114.
- **Holds:** on the 24 fps clock, motion holds on twos and reveal runs on ones by default. A play can override it, in
  frames.
- **The timing contract changed.** The spike found that a part-level clock with a loop, in front of the reveal lookup,
  un-draws and redraws the part on every loop, and repeats its boil epochs. So clocks belong to writers (plays). A
  part carries only holds and freezes. Phase 3's contract is amended to match.
- **References:** typed handles. A misspelt handle is a compile error; a misspelt path isn't.
- **Shapes:** every source returns the same value: named parts, a silhouette, lines and anchors (`FigureShapes`).

  | Source | What it gave | Verdict |
  |---|---|---|
  | Posed 3D primitives (three.js, rasterised to a label buffer, traced) | Part names, anchors, any view, posable; 4 poses in 1.5 s | First choice. Plan 3 reuses it |
  | Named construction (2D signed-distance smooth union) | Part names and anchors, side view only; 3 poses in 1.1 s | Second |
  | Font glyphs (Noto Emoji) | Outlines with no part names | Lettering only |
  | Tracing a public-domain plate | Failed on a busy background; a nameless blob even when clean | No |
  | An image model's frog, traced | Not tried: it needs Graham's key | Open |
- **Scoped style:** a project-level look contract (roles and colour names), bound once per style and overridden per
  group (`look: gouacheLook`).
  - A second look must bind every colour, and the compiler checks it.
  - Colour variety comes from a material-set well.
  - Mixing styles in one painting works only for the pigment media (watercolour, gouache, crayon), which share a
    compositor; a flat style needs plan 2's layers. Unverified in paint.
- **Porting:** the watercolor-paintings character reads about as well, and its timing reads better as weights. It is
  5.9–6.3k characters against 6.8k plus a 4.0k helper, but most of that saving is coordinates moved into the art,
  which vid-114 rightly doesn't count. Lost in the port:
  - the texture pattern's options, which should take vid-114's pattern object;
  - the blotches' rotations;
  - sizes from an element's box.

### The cold test

Fresh agents wrote each scene from the stubs' docs alone. The table gives errors on first compile.

| Form | Frog | Character |
|---|---|---|
| A (options on nodes) | 1 (a stub defect) | 0, plus the uncaught outer-scope bug |
| B (tracks on handles) | 0 | 0 |
| Chosen | 0 | 0 |

Every cold writer guessed at the same things:
- pin reaches;
- the hinge;
- units;
- what a place key means;
- whether media can mix;
- the missing group reveal.

The chosen stubs state the units, and the part-owned pin answers the hinge.

**Checks the compile step must add** (types can't): a hold given in seconds, a loop of 0, two writers on one pin
(`paintChannelConflicts`), pose keys out of order, and chaining onto an open loop's `.end`. **Caught by nothing yet:**
the outer scope used inside an `apply` (a lint rule), a pin reach that swallows the figure, and a rig nobody plays.

### Ownership with vid-114

- **vid-114:** groups, passages, applications, techniques, wells, sizes, waits, reveal allocation and painting time.
- **The project's timeline:** cues.
- **Plan 1:** place, deform, boil and marks, colour, the clocks on plays, looks and scoped style, and shape sources.
  It adds only node options (`look`, `anchor`, `pins`, `marks`) to vid-114's tree, and handles returned from its
  builders.

## Plan 1, phase 1.0: deforming painted strokes (vid-130)

**Short answer: both, by part, and no stamp carrying.**
- **Near-rigid motion bends the group's painted layer:** limbs, sway, small squash, and the boil.
- **Parts that change shape are re-painted every frame (live):** the throat's puff, big squash and stretch, growth.
- **Carrying placed stamps through the warp (the old "stuck") isn't built.** It costs as much as live, and it frays
  under stretch. Paper, grain and bloom noise stay on the screen, so its texture swims anyway.

Each candidate was rendered side by side through one shared warp, in watercolour and crayon, at 1080p and 24 fps. A
frog of about 210k stamps had a throat puffing 1.9× every 3 s, an arm raising 70° and six grass blades swaying.
- **The renders:** `~/research/2026-10-01-vid-130/deform/index.html` (all candidates) and
  `~/research/2026-10-01-vid-130/layer-warp/index.html` (the layer warp alone, and its stretch measurements).
- **The code:**
  - spike branches `vid130-layerwarp` (studio da5f1c9, 77edfc6, d4bb438, 0d088b0) and `vid130-deform` (fast-forwarded
    to it);
  - the projects `2026-10-layer-warp-spike` and `2026-10-deform-spike` in the workspace.

### Warp the layer or the stamps?

- **The layer warp.** The group is painted once in its rest space. Each frame a lattice (16 px cells, at most 64 a
  side), sampled from a rest-to-scene map, is rasterised at its scene positions. Each pixel learns its rest point, so
  the field is inverted for free.
  - Rigid placement became its one-cell case. Cells are drawn least moved first, and a fold's bare margin is discarded
    so it can't punch holes in the paint.
  - Paint, wetness, rims, blooms, masks, clips and reserves all ride along exactly as laid.
  - It costs 2.3–4.1 ms a frame in the layer-warp spike's scenes, and 12.5–28 ms for the whole 210k-stamp frog.
  - **It breaks under magnification.** Grain, tooth and line width all scale with the stretch. At the 1.9× puff the
    outline is twice as wide and soft, it is soft past about 1.5×, and by 3× texture is streaks.
- **Stamps carried** (each stamp's centre through the map, its footprint through the local Jacobian, one frame per
  stamp). Lines run across the stretch fatten to 3× wide, and a wash's edge goes woolly from about 1.5×.
  - Worse, it isn't stuck. Grain is sampled in screen pixels, `grainOffset` is per deposit, and bloom lobes, rim noise
    and ragged mask edges are hashed on screen pixels. So consecutive frames of the stabilised sac differ about as
    much as live's do: 5.3 against 5.5 grey levels in watercolour, against the layer's 4.1.
  - A carried painting is a new painting, so its wet state is re-derived, never carried.
- **Live** re-places the bent pose every frame. It keeps lines at their painted width, edges crisp and paper as paper,
  at every stretch up to 3×. At frog scale it reads as a hand redrawing, not as noise. This is the look Graham
  preferred in vid-121.

### Filtering, and crayon's tooth

- **Crayon's tooth filled in under any sub-pixel resample.** Films were interpolated before the nonlinear lay, so
  vid-117's rigid motion already had this bug. Now a moved group is laid at each of the four texels around its rest
  point, and the laid results are blended (0d088b0).
  - Crayon at a 0.5 px shift keeps 13.2% bare-paper specks, against 15.1% still (it was 4.7%), with its mean light
    within 0.4.
  - A new gate check, `animation/half-pixel`, fails the old renderer and passes now. No golden moved (stamp gate
    102/102).
- **Watercolour bilinear** keeps within 0.1 of a CPU bilinear. Lanczos would win back 20–25% of the gradient, but most
  of the loss is the magnification itself.

### Weights follow parts

A falloff across one group's painted paint tears it: a watercolour sleeve's bleed was pulled into streaks. A limb is a
group of its own, and its weight runs only along the limb. So a figure's parts (phase 1.1's shape sources) are groups.

### Live, and a crawl dial

- **A bounded crawl rate is not a useful dial.** Re-placing on twos with the warp carrying between them looks the same
  as live, and it costs the most.
- **The useful dial is the pose's step.** Live on twos reads as stepped Grease Pencil animation.

### Boil as displacement

- **A stepped noise displacement of the rest path** (2.2 px at a 45 px scale, epochs as `paintStrokeBoilEpoch`, on
  twos) reads like Grease Pencil's noise boil. Across a step, lines and edges change by 1.95–2.55 grey levels, and the
  texture stays: 0.11 between steps.
- **Today's group boil re-rolls every mark** instead.
- **It should run as a layer warp** (the part's map composed with the displacement) rather than a repaint.

### Cost per frame at 1080p (M1 Max, under load from other sessions; medians, ms)

| Watercolour frog, 210k stamps (43k moving) | CPU | Load | Draw |
|---|---|---|---|
| still | 0 | 0 | 1.4 |
| layer warp | 0 | 0 | 27.6 |
| today's group boil | 0 | 0 | 65 |
| stamps carried | 36 | 72 | 236 |
| live | 56 | 77 | 238 |

**The draw dominates, and it is a full repaint.** Every candidate that hands the renderer a new painting loses its
checkpoints and redraws everything. Live is affordable only through a seam:
- place, upload and draw only the groups that change;
- restore everything painted before them from a checkpoint.

The layer warp already restores its moving group painted but not laid (`#painted`). Draw cost then scales with the
moving share: a fifth of the stamps in watercolour, a twentieth in crayon.

### Frame order

- **Node:** every candidate's evaluated painting printed identically forwards, reversed and shuffled across every boil
  and hold step, in both media.
- **GPU:** `studio repeatable` passed at 12 times, covering a boil step, the layer warp, odd frames on twos and group
  boil. The worst was 110 dB, and several were identical.

### What plan 1 takes from this

- **The deform channel yields, per part per frame, either a warp of its layer or a new pose of its geometry.** The
  warp is a lattice sampled from a rest-to-scene map. The new pose is re-placed and re-painted (live).
- **The scene chooses per part, never globally.** By eye the line falls near 1.3–1.5× local stretch; a stretch sweep
  could set it.
- **How marks live becomes:**
  - `stuck`: the layer carried;
  - `boil`: a stepped displacement carried as a layer warp, or today's re-seed;
  - `live`: re-placed every evaluated frame.
- **Warps reach the renderer as each frame's data,** with a key for checkpoints, not as a time function inside the
  compiled painting.
- **Follow-ons:**
  - the live seam (re-draw only the groups that change);
  - a stretch sweep to place the line between layer and live;
  - whether a puffing part reads better on its own paper or the ground's;
  - a bloom isn't re-simulated into paper a layer warp newly uncovers.
