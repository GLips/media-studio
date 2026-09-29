---
name: video-canvas
description: Painted, drawn and generative layers in a video, chiefly stamp painting (StampPainting, drawn on the GPU in a private painting style). Use for a painted or hand-drawn look (a painted opening, an illustration painted in as the voice speaks, ink marks over a capture) or generative backgrounds, to find the styles you can paint in and what a drawn layer must obey.
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
often a helper module that paints the way its author does. Read both before painting. No folder there means no
painted look on this machine; say so, and offer what the studio's React code can do (SVG strokes, masks, three.js).
A style whose `brushes/` is missing must be imported first (`studio brushes import`, docs/private-styles.md); the
bundle refuses it, naming where the pack came from.

A project paints with a style once its `project.ts` names it (`styles: ['watercolor']`); then it imports
`#styles/<name>/…`. Work in `work/projects/2026-09-watercolor-paintings/` shows a character and a landscape end to end.

## Painting: a recipe, then `StampPainting`

Everything is from `#studio`.

- `stampPaintStyle<typeof style>('<name>')` is the bundled style: `brushes` (each a `StampBrush`), `palette`, `paper`.
- `stampPaintRecipe((paint) => …)` writes the painting: `paint.group(id, { composite: 'opaque' | 'glaze', opacity },
  (group) => group.pass(id, { clipped }, (pass) => pass.stroke(…) / pass.stamps(…)))`.
  - A **group** is one element. `opaque` covers what's under it; `glaze` tints it, like a transparent wash (a sky, a
    ground, a shadow).
  - A **pass** is one layer of paint inside it. `clipped: true` keeps it inside the last unclipped pass: texture and
    shading that can't leave the silhouette.
  - A **stroke** is a brush along a path; **stamps** are single placements (blooms, flowers). Each has `material`
    (`{ kind: 'flat', color }`), `diameter` px, `opacity`, `appliedAt` and `drawnOver` seconds.
  - `group.protect(regions, body)` keeps paper bare inside `regions` for what `body` lays: highlights, glints.
- `stampFillPath(region, diameter)` is one stroke that covers a region, the way a hand fills a shape;
  `stampSmoothRegion(points)` turns a few control points into a smooth silhouette; `stampFillBrush(brush)` untapers a
  brush for filling.
- `compileStampPaintRecipe(recipe)` once, at scene definition, never in render: a new painting each frame reloads it.
- Render `<StampPainting painting={painting} paper={style.paper} t={s.t} />` in a scene. `t` is the scene's time, which
  `appliedAt` counts on, so the painting paints itself in; hold a deposit's `appliedAt` to a cue from `timeline.ts`
  (`sceneCueSeconds(clock)`) to paint an element in on a word.

Paint in the order a painter would: background glazes first, then each element as an opaque group (a solid base, its
shading and ~30% texture clipped to it, blooms stamped inside), then lines. Separate groups give hard edges between
elements, which is what keeps objects from showing through each other.

Look at what you paint: `studio look` gives a sheet of chosen frames, mid-reveal and finished; compare the brushes
against the pack's `previews/`. What the renderer doesn't do yet is ticketed: varied washes, pooled and lost edges and bleeding (vid-81),
granulation, pigment mixing and true glazing (vid-83), the brush settings the importer drops (vid-84). Don't fake those
by stacking deposits: overlapping deposits build into dark blotches.

## The one rule: a frame is a function of its time

The rule is the `video-motion` skill's (What a scene can be). A canvas breaks it quietly: a layer that remembers
anything from the frame before comes out different depending on what its tab drew last, so it looks fine in the
Studio and then flickers in the render. `StampPainting` keeps it: every stamp is seeded by its deposit and index, and
each frame is redrawn from paper.

- In anything else drawn, **seed every random stream per element**, from a fixed key and the frame, with
  `seededRandom` (`#studio`). For values that mustn't wobble (positions, sizes), use `hashRandom(key, i)`.
- **Flush deferred drawing at the end of every layer**, so one frame's marks never turn up in the next.
- **Prove it:** `studio repeatable <p> <times>` renders chosen times fresh and again after other frames in one tab, and
  fails if any differ. Run it on every painted scene, at times mid-reveal and after.

## Drawn layers and the checks

The checks can't see inside a canvas. A painted loop around a price isn't a `Highlight`, so `expect` can't check it,
and the motion tracks list a painting as unmeasured. When a drawn mark carries a read, check it by eye with `--strip`,
and keep it clear of the caption band yourself.
