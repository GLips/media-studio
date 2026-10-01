---
name: video-canvas
description: Painted, drawn and generative layers in a video, chiefly stamp painting (StampPainting, drawn on the GPU with WebGPU in a private painting style). Use for a painted or hand-drawn look (a painted opening, an illustration painted in as the voice speaks, ink marks over a capture) or generative backgrounds, to find the styles you can paint in and what a drawn layer must obey.
---

# Drawn layers

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

## Finding a style

A painted look comes from a **private style**: `work/styles/<name>/`, a pack of brushes someone bought, its palette and
paper. Styles live only in the workspace, so look before promising one:

```
ls work/styles/
```

Each has `<name>.md`, how to paint in it (which brushes do what, the pack's workflow, what didn't carry over), and
often a helper module that paints the way its author does. Read both before painting. Its `fidelity-grades.json` grades
each brush close, rough or off against its Procreate preview (a score from the brush fidelity sheet), and its
`fidelity.ts` notes how each differs; prefer close brushes, and read the note before leaning on a rough one's look. No folder there means no
painted look on this machine; say so, and offer what the studio's React code can do (SVG strokes, masks, three.js).
A style whose `brushes/` is missing must be imported first (`studio brushes import`, from a Procreate `.brushset` or a
Photoshop `.abr` or `.tpl`, docs/private-styles.md); the
bundle refuses it, naming where the pack came from.

A project paints with a style once its `project.ts` names it (`styles: ['watercolor']`); then it imports
`#styles/<name>/…`. Work in `work/projects/2026-09-watercolor-paintings/` shows a character and a landscape end to end.

## Painting: a recipe, then `StampPainting`

Everything is from `#studio`.

- `stampPaintStyle<typeof style>('<name>')` is the bundled style: `brushes` (each a `StampBrush`), `palette`, `paper`.
- `stampPaintRecipe((paint) => …)` writes the painting: `paint.group(id, { composite: 'opaque' | 'glaze', opacity },
  (group) => group.pass(id, { clipped, within }, (pass) => pass.fill(…) / pass.stroke(…) / pass.stamps(…)))`.
  - A **group** is one element. `opaque` covers what's under it; `glaze` tints it, like a transparent wash (a sky, a
    ground, a shadow).
  - A **pass** is one layer of paint inside it. `clipped: true` keeps it inside the last unclipped pass: texture and
    shading that can't leave the silhouette. `within: { region, edge?, inset? }` keeps it inside an area (a
    reflection in its water): `edge` as masking fluid's, a ragged one breaking the cut line of a padded wash
    (seeded by the pass's ID; keep its amount under the brush's radius); `inset` px moves the edge inward.
  - A **fill** covers a `region`, reaching its outline, laid by its `application`:
    - `{ kind: 'flood' }`: solid inside, the brush's own edge at the outline, however small a spike. Outside a wash its
      paper is dry, so wet paint stops there hard, keeping the tip's broken outline (a dry-media brush keeps its tip's
      edge); for a soft edge, flood it in a wash into wetted paper (`preparation`), or in flat colour, which has no
      washes, fill with strokes. It costs what its edge does, not its area.
    - `{ kind: 'strokes', pattern, spacing?, variation?, hand?, reach? }`: real strokes of the brush, the marks
      and the paper between them showing. `pattern` is an object by `kind`: `'shading'`, `'zigzag'`, `'backAndForth'`,
      `'hatch'`, `'crossHatch'`, `'scribble'`, `'contour'` or `'guided'`; `spacing` is diameters between rows (over 1
      leaves paper); `variation` (0..1, 0.3) is how unevenly a hand lays them. A pattern that turns back (shading,
      zigzag, back and forth) eases nearly to lifting at each turn (`{ kind: 'shading', turns: 'eased' }`, the
      default, as a crayon shades); `turns: 'pressed'` keeps the brush down, for body colour covering a shape to its
      outline. It costs what its strokes do.
    - `{ kind: 'contour' }` rings the shape in closed loops, outline first, each `spacing` inside the last.
      `{ kind: 'guided', guides }` lays marks that wrap round a form, as cross-contour hatching does: `guides` are a
      few curves across the shape, in order, all running the same way, each starting and ending outside it; marks
      are blended between each guide and the next. Crossing or branching guides aren't matched: split the passage.
    - Its marks stay inside the outline. `reach: { past }` runs them past it: their centres may lie up to `past`
      diameters outside (rows run out across and along the shape, guided marks' ends run on, a contour's first ring
      lies out there). `{ past: 0 }` takes their middles to the outline, a texture in a `clipped` pass over its
      silhouette; `{ past: 1 }` or so puts each mark's taper and lift outside, so the edge stays crisp and full. The
      marks then cross the outline: clip them, the pass `clipped` or it or its wash `within` the same region.
    - `stampFillMarks(region, diameter, direction, strokes, seed)` gives the marks themselves (each keyed), for when
      you need them outside a fill.
    - Left out, the brush's media decides: a wet brush washes, a dry one (pencil, crayon) shades. Override it for a
      hatched shadow in watercolour, or a wash of a brush whose media no style declares.
    - `direction` (radians) is the way its rows run, and it reveals across them as `drawnOver` runs; `load` grades how
      much paint it lays (`{ kind: 'linear', from, to }`), or mottles it (`{ kind: 'noise', scale, a, b }`).
  - A **stroke** is a brush along a path; **stamps** are single placements (blooms, flowers). Each has `material`
    (`{ kind: 'color', color }`), `diameter` px, `opacity`, `appliedAt` and `drawnOver` seconds.
  - **Mottled colour** (a sky, water, a distant mass): `material: { kind: 'noise', scale: 60, seed: 'sky', a, b }`
    lays a broad, uneven passage between two mixtures, `scale` px its patches' size. Deposits sharing a `seed` share
    one continuous passage; left out, each deposit mottles on its own. The same field mottles a fill's `load` and a
    wash preparation's `wetness`. Mottle by purpose (a warm lit plane against a cool one), not over everything.
  - **A wash's dried edge**: `group.wash(id, { rim })` sets how strongly its edges gather pigment as it dries (0..2,
    1 the medium's), and `wash.wait('dry', { rim })` sets it for that one drying. `rim: 0` dries soft-edged; 2 rims
    harder, though only where the paint was wet enough to rim at all.
  - Give every stroke a **`hand`**, or it paints at constant pressure, the way a mouse does, and the brush's taper,
    swell and pressure-driven size and opacity never show. `hand: { profile, curvature, wobble }`:
    - `profile` is pressure along the stroke: `'taper'` (light, firm, light) for most marks, `'pressFlick'` (heavy,
      fading fast) for hair, grass and hatching, `'swell'` (thin, full, thin) for leaves and petals, `'drag'` (steady,
      lifting at the end) for washes and fills, or a curve `(along) => pressure`, which can build on
      `STAMP_PRESSURE_PROFILES`. A stroke shorter than `fullProfileAt` diameters (12) gets a shallower profile.
    - `curvature` (0..1, try 0.3) presses harder where the path turns tightly and lightens straight runs by up to that
      share, as a hand does when it slows into a corner.
    - `wobble: { pressure: 0.1, position: 0.1 }` adds seeded unsteadiness (a share of the pressure; diameters sideways),
      so strokes along one path differ. It's seeded by the deposit's ID, so a frame still depends only on its time.
    - Every `hand` stroke also gets a speed: it eases in and slows through turns, and `drawnOver` reveals it at that
      pace rather than an even one. A point's own `pressure` (and `speed`) still counts, multiplied in.
    - `npm run brushes:hand -- --style <style> --pack <pack> --brush <name> --out <dir>` paints one path under each profile, with and without curvature and wobble, beside constant pressure: see how a
      brush answers before choosing.
  - **Masking fluid**: `mask(id, { region, edge, inset })` on the painting, a group or a pass keeps paper bare there
    for everything declared after it in that scope, until the scope ends; `unmask(id, { region, edge, inset, amount })`
    lifts all or part of it. `edge`: `{ soft: px }` or `{ ragged: { amount, scale } }`, else a clean antialiased
    line; `inset` (px) moves it inward. Paint already there stays: a mask is for highlights, glints and reserves, not
    erasing.
  - **A near shape in front of far paint** (hills before a range): give the near group `standsBefore: { groups:
    ['far-range'], shape: hills, overlap: 3 }`. The named groups, which must paint before it, land as if under fluid
    over `shape` inset by `overlap` px, past any unmask of theirs and their water too; the near group paints its own
    shape over the seam, so no paper line opens. Say the shape: it isn't read from the near group's paint.
  - **A moving light out of a still sky** (a cloud drifting over a wash): make the cloud its own group with
    `motion`, and declare first `group.knockout(id, { preparation? }, (k) => …)`. It takes out of everything painted
    before the group, and travels with it. Then paint the cloud's own passes over it.
    - A **reserve**: `k.mask(…)`, then `k.water(…)` across it, as the sky's wash went over the fluid. The result is crisp,
      pure paper.
    - A **lift**: `k.lift(…)`, blotting the paint behind by the lift law. Its edge is soft, and it leaves a ghost as
      strong as the pigments there stain (phthalo stays, ultramarine comes clean). `preparation` is how wet that paint
      still is; without it, the paint has set and lifts only a little. Blot more than once, a little offset each time,
      with a soft brush flooded over each puff: one blot of an exact ellipse reads as a sticker.
  - **`paper: 'own'`** on a moving group is a collage's piece of paper. Its grain moves with it rather than sliding
    through it. Leave it out for paint on the painting's paper; a moving granulating shape's slight shimmer is usually
    fine.
  - **A wash** (`group.wash`) is a pass painted wet: its paint carries water, and it can `water`, `lift`, `soften`,
    `bloom`, `charge`, `backrun` and `wait`. Wait for a state of the paper's sheen: `wait('shiny')` (the standing
    shine has gone, water dropped in starts to push), `wait('damp')` (the shine has gone), judged under the next thing
    you paint after it by default (`{ under: 'wash' }` for the whole wash's wettest paper, `{ under: { region } }`
    for a region); `wait('dry')` lets the whole wash dry and rims its edges. `wait({ seconds })` is for drying a set
    time further, no state in mind; if the whole wash has set by then, it rims just as `wait('dry')` would.
  - **Colour charged into a wet wash**: `wash.charge(id, { placement, touches, mixtures, brush, diameter: [min, max],
    length: [min, max], angle?, water?, when?, appliedAt, drawnOver })` lays `touches` short swelling strokes, each
    loaded from `mixtures`, a weighted set (`{ kind: 'set', entries: [{ id, material, weight }] }`), so neighbours
    differ. `placement` is `{ kind: 'along', path, spread }` (down a slope, a shadow side, a colour passage) or
    `{ kind: 'area', region, weight? }`; prefer a path or a weighted area to an even scatter, which reads as
    ornament. `when: 'damp'` waits once, until the paper under the touches has lost its shine. In the watercolor
    style, `brush` is `brushes.charge`.
  - **A backrun on purpose**: `wash.backrun(id, { along, brush, diameter, appliedAt })` lays clean water along a
    junction you choose once the paper under it is damp. Both passages must be in the same wash: washes share no water.
  - **Marks**: a `StampMark` (`{ key, brush, diameter, geometry }`) paints with `pass.mark` / `wash.mark`, placed from
    its key, so every use lands the same stamps. `stampScatterMarks(placement, { count, length, diameter, key })`
    lays out candidates; asking for more keeps the first ones where they were.
  - **Will the bloom bloom?** `stampWetReport(painting, compileStampWetness(painting, mediumOf, paper, size))`
    (`mediumOf(group)`: the style's `mixing.medium`, or a group's own `mixing`'s) gives each wait's paper before and
    after, and each bloom, backrun and damp charge's verdict, with why one won't act (the paint had set, the paper
    still shone).
    `assertStampWetEffects(report)` in the project's test throws on any that certainly won't. Eligible isn't visible:
    look at the render.
  - **`mixing: otherStyle.mixing`** paints a group in another style's medium and pigments, gouache butterflies in a
    watercolour, with that style's brushes. The painting keeps its own paper. Its paint meets the groups under it
    set and lies over them as that medium does: gouache covers a dark, a watercolour glazes it.
- `stampSmoothRegion(points)` turns a few control points into a smooth silhouette; `stampRegionOutline(region)` traces
  its edge.
- **A rounded form** (an apple, a stone, a cheek): `stampRoundedForm({ outline, light: { direction, elevation },
  ellipse?, terminator? })` assumes an ellipsoid over the outline (fitted to it unless you give one) and returns
  `shade` (regions, to glaze), `core` (paths along the shade's inner edge, for the darkest, firmest marks), `lit`
  (outline stretches facing the light, to soften or lose) and `light(x, y)`, 0..1. `direction` points toward the
  light in the picture (y down); `elevation` is how far it comes from the viewer (π/2 is frontal and leaves no
  shade). The ellipsoid is an assumption: check the shade reads right on a form that isn't egg-shaped.
- `compileStampPaintRecipe(recipe)` at scene definition when the painting doesn't change. Where its shapes do (a
  cloud drifting through a wash, a shape morphing), compile it in render: deposits whose shape, brush, size and seed
  are unchanged reuse their marks, so a rebuilt frame pays for what changed plus a reload of a few ms. It also loses
  the checkpoints a still painting draws from, so prefer `motion` or keyed materials where they can express the change.
- **Colour that changes over the scene** (a sunset's sky): key the material rather than recompiling, as `motion` keys
  a group: `material: { kind: 'keys', keys: [{ at: 0.3, material: afternoon }, { at: 3.7, material: dusk }] }`, in
  scene seconds. Between keys each pigment's amount eases (flat colour, its channels); a graded field's ends are each
  keyed. Marks, water and texture stay put. A recolouring group is repainted each frame, so a wash group costs its
  whole draw.
- Render `<StampPainting painting={painting} style={style} t={s.t} />` in a scene. It draws with WebGPU, which
  the render browser and `studio preview`'s Chrome have; a browser without it fails loudly rather than drawing blank. `t` is the scene's time, which
  `appliedAt` counts on, so the painting paints itself in; hold a deposit's `appliedAt` to a cue from `timeline.ts`
  (`sceneCueSeconds(clock)`) to paint an element in on a word.

Paint in the order a painter would: background glazes first, then each element as an opaque group (a solid base, its
shading and ~30% texture clipped to it, blooms stamped inside), then lines. Separate groups give hard edges between
elements, which is what keeps objects from showing through each other.

### Animating a painting (a character that moves)

`work/projects/2026-10-frog/` is the worked example.

1. **Get the shapes from a figure, never typed coordinates.** `posedPrimitiveFigure` gives named 3D parts on
   joints, and `posedFigureShapes(figure, pose, view)` gives their regions, silhouette, interior lines and anchors.
   A pose is a few numbers (the frog's throat is one). `constructedFigureShapes` builds a figure from circles and
   capsules; `svgFigureShapes` reads SVG paths.
2. **Make every part that moves its own group**, painted from those shapes.
3. **Decide how each part's marks live** (`PaintMarks`):
   - `'stuck'` (the default): the painted layer is moved or bent. Use it for nearly rigid motion: sway, breath, a
     limb.
   - `{ live: (pose) => group }`: the group is re-painted at each pose of its own pins. Use it for a part that
     changes shape, like a throat puffing; bending would thicken and soften its lines. The poser compiles only that
     group, with the written group's id, passes and deposit ids, from `pose.pins` (a pin at rest is left out). Motion
     keeps each pose's marks by key, and at rest the group draws as written. A parent's bend reaches a live part
     as its warp, so a breathing body carries its live throat.
   - `{ boil: { every: 2 } }`: the lines wobble on twos once the group's last stroke is drawn, and the texture
     stays put. A group boils as one: strokes that should boil apart need groups of their own.
4. **Write the motion as data, over the compiled painting.**
   - `buildPaintMotion(painting, { nodes, plays, foldCheck })` takes one `PaintMotionNode` per moving group, its
     `id` the group's, with `parent` for parts that follow another (ink and throat under the body), `clock:
     { hold: 2 }`, and `pins`: `{ at, reach }` radial, or `{ part }` owning a region. Each group's painted box and
     reveal end come from the painting.
   - Each play is `paintMotionPlay(node, clip, { clock, origin })`. Clips are `poses` (keyed pin moves), `breathe`,
     `sway`, `flutter` and `place`. A clock is parts: `{ at: cue, rate?, loop?: { period, mode?, times? }, hold?,
     until? }`, or `{ at, freeze }`. Start every play at a cue from `timeline.ts`. A finished clip holds its last
     drawing.
   - It returns `{ ok: false, problems }` naming two writers on one pin, a node that isn't a group, a hold that
     isn't whole frames, a boil or pose that folds; throw them.
   - A point goes through its own bend and placement, then its parent's, and so up, as a rig nests.
5. **Each frame,** `paintMotionFrameAt(motion, s.t)` gives the frame state, live marks included:
   `<StampPainting painting={painting} style={style} t={s.t} frame={paintMotionFrameAt(motion, s.t)} />`.

**Planes and the camera (multiplane).** Give a root node `anchor: { plane: depth }` to stand its tree on a plane
that far from the camera (1 is where a pan's pixels are measured; nearer is under 1). Paint each plane the size it
should look before the camera moves: at rest nothing changes. Pass `camera: { stage: stampStage({ width, height },
margin), plays }` to `buildPaintMotion`, and the same margin to `<StampPainting margin>`: the renderer paints that far
past the frame, so a camera move brings in paint, not paper's edge. Plays are
`paintCameraPlay({ kind: 'move', keys: [{ at, pan?: { x, y }, dolly?, zoom?, roll?, ease? }] }, { clock, origin })`,
and `{ kind: 'focus', keys: [{ at, focus, aperture }] }` for depth of field: `focus` is the depth held sharp,
`aperture` the blur (px sigma) a far plane gets. A pan of 100 moves a plane at depth 2 by 50 and one at 0.5 by 200;
a dolly grows near planes more than far ones. Keep the camera on ones: held on twos it judders. Mark the
background `backdrop: true` and the build fails if the camera would show past it; give the frog `glow: { amount,
radius, threshold }` for a soft light. Untouched groups and `anchor: 'canvas'` (titles) never move with the camera.

**3D layers in a painting.** `<PaintedThreeScene painting style t frame camera three={{ fov, layers, paintedTextures }}>`
lays a three.js scene into the painting's group order, `beneath` a group, on the painting's own GPU device; its camera
follows the paint camera, so a layer at `depth` moves as a plane there, and takes its defocus. A layer's `build` gets
the world (`paintPlaneWorldPoint(world, px, depth)` places a mesh; a px on a plane at depth d is d units) and the
painted textures, each a painting drawn every frame for a material (`paintedThreeColorNode`). Memoise `three`: a new
array reloads the device. The frog project's `frogDepth` and the round-trip project are worked examples.

Hold motion on twos (`clock: { hold: 2 }` on the node, at `PAINT_ANIMATION_FPS`) and let the paint-in run on ones: a
node's hold never reaches its reveal. Run `studio repeatable`
inside a hold and across one.

Look at what you paint: `studio look` gives a sheet of chosen frames, mid-reveal and finished; compare the brushes
against the pack's `previews/`, or for a Photoshop pack its `reference/`, Photoshop's own strokes, which
`npm run photoshop -- references` captures (docs/photoshop-capture.md). What the renderer doesn't do yet is ticketed: varied washes, pooled and lost edges and bleeding (vid-81),
granulation, pigment mixing and true glazing (vid-83), the brush settings the importer drops (vid-84). Don't fake those
by stacking deposits: overlapping deposits build into dark blotches. docs/brush-engine.md says where the engine,
each app's reading, the styles and the fidelity sheet live, for a change to how a brush paints.

## The one rule: a frame is a function of its time

The rule is the `video-motion` skill's (What a scene can be). A canvas breaks it quietly: a layer that remembers
anything from the frame before comes out different depending on what its tab drew last, so it looks fine in the
Studio and then flickers in the render. `StampPainting` keeps it: every stamp is seeded by its deposit and index, and
each frame is redrawn from paper.

- In anything else drawn, **seed every random stream per element**, from a fixed key and the frame, with
  `seededRandom` (`#studio`). For values that mustn't wobble (positions, sizes), use `hashRandom(key, i)`.
- **Flush deferred drawing at the end of every layer**, so one frame's marks never turn up in the next.
- **Prove it:** `studio repeatable <p> <times>` renders chosen times fresh, again after other frames in one tab, and
  again beside other frames in several tabs, and fails if any differ. Run it on every painted scene, at times
  mid-reveal and after. A painting passes over 50 dB like any GPU scene; a few pixels a level apart is rounding, not a bug (docs/private-styles.md, "Same pixels").
- **Time it:** `studio profile <p> --frames a:b` says what a painting's draw costs a frame and what the whole render
  does. A dense 1080p landscape paints in about 67 ms a frame on an M1 Max.

## Drawn layers and the checks

The checks can't see inside a canvas. A painted loop around a price isn't a `Highlight`, so `expect` can't check it,
and the motion tracks list a painting as unmeasured. When a drawn mark carries a read, check it by eye with `--strip`,
and keep it clear of the caption band yourself.
