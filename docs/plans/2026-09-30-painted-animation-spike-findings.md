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
  pipeline is in `scenes/round-trip/round-trip-frame.tsx`.
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
