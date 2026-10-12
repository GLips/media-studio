# three.js in a painting, and wrapped paintings

A painting worn by a 3D object (a label round a mug, a floor receding to a horizon), a three.js scene as a plane, and
paintings whose edges meet. Planes and the camera are in `${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/shots.md`.

## A three plane

A three.js scene is a plane of its own, `{id, depth, source: {kind: 'three', build}}`, drawn on the painting's GPU
device. `build({plane, textures, frame})` returns `{scene, poseAt(moment), dispose, offscreen?, shadows?}`:

- `plane.point(px)` places a mesh and `plane.length(px)` sizes it, both at the plane's depth. World units are px at
  depth 1.
- `poseAt` sets the scene for each moment (the shutter reads it at both ends, so it blurs the move).
- Its render is laid between the planes nearer and farther than it, defocused texel by texel at each texel's own
  depth. Keep materials opaque, or transparent with normal blending, so the render stays premultiplied.
- A three plane's `depth` holds still: move what its scene shows. Points on a receding ground lie where the scene's
  own camera puts them, not where the depth helpers say.

## Painted textures

The shot's `paintedTextures: [{id, source, widthPx, heightPx}]` paint a texture each frame its source changes;
a material reads it with `paintedThreeColorNode(textures.get(id)!)` (`#studio`), which decodes it to linear colour.

- `source` is a selection, a dissolve or a callback of the moment, never a painting in time. It's opaque: no
  `ground: 'transparent'`.
- Match `widthPx` × `heightPx` to the document, or go smaller when the object never comes near that size.
- u runs along the document's x and v up the mesh, so uv (0, 0) is the painting's bottom left.
- Each lay builds the texture's mip chain, read trilinearly with anisotropy 8: a texture far smaller than its size,
  or edge on, holds steady instead of shimmering, a little softer.
- A texture is laid again only when its selection changes, so a still selection costs one solve, and the frames
  between two landings show one lay. `warm` solves textures with planes.
- To land paint on the part of a turning label facing the camera, share the turn as a model both the label's source
  and the scene read (`scenes/mug/mug-turn-model.ts`): each timed application's `x` is the column facing the camera at
  its `at`, so retiming the turn moves every mark with it.

## Wrapping

`wrap` on the document joins opposite edges on every sheet: `'x'` left to right, as round a cylinder (a label, a lamp
shade, a panorama the camera turns in); `'y'` top to bottom; `'xy'` both, a tile. A painted texture repeats along each
axis its painting wraps, so a `CylinderGeometry` (u once round) shows no seam.

- Write marks past an edge in plain px: they come back on the other side with their water and wet stages, and the
  grain runs on unbroken. Nothing needs painting twice.
- What a source computes in TS wraps only if written to: a value varying along a wrapped axis repeats in whole cycles
  (`Math.sin(2π · n · x ÷ width + phase)`, whole n), or it jumps at the seam. A band right round runs past both edges
  by about its taper, from x −m to width + m, so no joint shows.
- The grain tiles mirrored, fitted in whole pairs on each wrapped axis: across x pick a grain `scale` of 0.5, 0.25,
  0.167, …; down y the fit follows the grain image's aspect. The check (and `--solve` for y) warns when it's laid more
  than a tenth off.
- Doesn't wrap: a paper `image` (a photograph), a deposit wider than the document, a long chain of wet-in-wet washes
  across a seam (a faint seam may show after several), and a **field reveal**, which reads each texel's own px: a mark
  crossing the seam arrives in two halves. Reveal it by strokes, which wrap.
- A wrapped sheet solves with a margin rounded up to a power of two; an edit carrying the widest reach past the next
  power re-solves the whole sheet (`studio paint diff` says so).

## Lighting a three scene

The scene lights itself with three.js lights. Its renderer is shared by every three plane, so lighting choices hold
for its own renders only.

- **Focus** is a depth, and a three plane blurs each texel at its own. One depth unit is the lens's focal length,
  frameH ÷ (2 tan(fov ÷ 2)) px (2015 px for 1080 at fov 30), so a point o world units nearer than a plane at depth d
  lies at d − o ÷ focal: to hold a face sharp, focus *there*, not on its plane. A mug's face 344 world units in front
  of its plane at depth 1 lies at 0.83; focused at 1 with aperture 11 it blurs by 11 × |1 − 1 ÷ 0.83| ≈ 2.3 px.
- **Shadows**: return `shadows: {softness}` (degrees of the light's angular radius, 0–20). Lights with `castShadow`
  cast from meshes with `castShadow` onto `receiveShadow`. Fit each shadow camera tight round what casts and receives,
  and its `near` close to the nearest caster: a far `near` spreads the soft search thin and small casters' shadows come
  out hard. A point light casts hard at any distance.
- **Offscreen passes**: `offscreen: [{scene, camera, target, follow?}]`, drawn in order before the scene; `follow`
  gets the camera the scene is about to draw through, posed for the exposure. A pass's camera sees layer 0 alone
  unless told otherwise, so a mesh on layer 1 shows in the scene and not in the pass.

**A planar reflection** (a glossy floor): render the mirror into a target the size of `frame`, set its camera with
`setThreeMirrorCamera(mirror, camera, plane)` (`#studio`), and read it at `screenUV.flipX()` down its mip chain for
roughness:

```ts
const target = new RenderTarget(frame.width, frame.height, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
const levels = Math.floor(Math.log2(Math.max(frame.width, frame.height)));
material.emissiveNode = texture(target.texture, screenUV.flipX()).level(float(ROUGHNESS * levels)).rgb.mul(1 - ROUGHNESS);
floor.layers.set(1); // the scene's camera sees it, the mirror's doesn't: the floor never reflects itself
const mirror = new PerspectiveCamera(), surface = new Plane(new Vector3(0, 1, 0), -centre.y);
return { scene, poseAt: () => {}, shadows: { softness: 4 }, dispose,
  offscreen: [{ scene, camera: mirror, target, follow: (camera) => setThreeMirrorCamera(mirror, camera, surface) }] };
```

The reflection adds to the floor's own lit colour; a shadow darkens the floor and leaves the reflection be. A mip
level is a fair stand-in for a rough surface's spread, not a measured one: set `ROUGHNESS` by eye at delivery size.
