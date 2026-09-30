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
    shading that can't leave the silhouette. `within: region` keeps it inside a region (a reflection in its water).
  - A **fill** covers a `region`, reaching its outline, laid by its `application`:
    - `{ kind: 'wash' }`: solid inside, the brush's own edge at the outline, however small a spike. It costs what its
      edge does, not its area.
    - `{ kind: 'strokes', pattern, spacing?, variation?, hand? }`: real strokes of the brush, the marks and the paper
      between them showing. `pattern` is `'zigzag'`, `'backAndForth'`, `'hatch'`, `'crossHatch'` or `'scribble'`;
      `spacing` is diameters between rows (over 1 leaves paper); `variation` (0..1, 0.3) is how unevenly a hand lays
      them. It costs what its strokes do.
    - Left out, the brush's media decides: a wet brush washes, a dry one (pencil, crayon) zigzags. Override it for a
      hatched shadow in watercolour, or a wash of a brush whose media no style declares.
    - `direction` (radians) is the way its rows run, and it reveals across them as `drawnOver` runs; `load` grades how
      much paint it lays (`{ kind: 'linear', from, to }`).
  - A **stroke** is a brush along a path; **stamps** are single placements (blooms, flowers). Each has `material`
    (`{ kind: 'color', color }`), `diameter` px, `opacity`, `appliedAt` and `drawnOver` seconds.
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
  - **Masking fluid**: `mask(id, { region, edge })` on the painting, a group or a pass keeps paper bare there for
    everything declared after it in that scope, until the scope ends; `unmask(id, { region, amount })` lifts all or
    part of it. `edge`: `{ soft: px }` or `{ ragged: { amount, scale } }`, else a clean antialiased line. Paint
    already there stays: a mask is for highlights, glints and reserves, not erasing.
- `stampSmoothRegion(points)` turns a few control points into a smooth silhouette; `stampRegionOutline(region)` traces
  its edge.
- `compileStampPaintRecipe(recipe)` once, at scene definition, never in render: a new painting each frame reloads it.
- Render `<StampPainting painting={painting} paper={style.paper} t={s.t} />` in a scene. It draws with WebGPU, which
  the render browser and `studio preview`'s Chrome have; a browser without it fails loudly rather than drawing blank. `t` is the scene's time, which
  `appliedAt` counts on, so the painting paints itself in; hold a deposit's `appliedAt` to a cue from `timeline.ts`
  (`sceneCueSeconds(clock)`) to paint an element in on a word.

Paint in the order a painter would: background glazes first, then each element as an opaque group (a solid base, its
shading and ~30% texture clipped to it, blooms stamped inside), then lines. Separate groups give hard edges between
elements, which is what keeps objects from showing through each other.

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
