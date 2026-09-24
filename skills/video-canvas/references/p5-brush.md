# p5.brush

The full API is p5.brush's own [llms.txt](https://github.com/acamposuribe/p5.brush/blob/main/llms.txt). It follows
`main`; we pin 2.2.2, the **p5 build** in **instance mode**. Read it for signatures. This file covers where it's
wrong for us, and what it offers that the watercolour kit doesn't wrap yet.

Inside a watercolour layer, call it directly: `import * as brush from 'p5.brush'`. Drawing goes to the layer's
canvas. Call `w.boilSeed(key)` first, as for any element.

## Where llms.txt is wrong for us

- **Seeding.** It says `randomSeed()` / `noiseSeed()` seed the brush in the p5 build and that `brush.seed` doesn't
  exist there. In instance mode, fills ignore `p.randomSeed`, and `brush.seed` / `brush.noiseSeed` exist and are what
  make them repeat. `boilSeed` calls both. A style of your own must too.
- **Flushing.** It says the p5 build flushes automatically. It flushes when the next thing needs the canvas, which
  can be the next frame's layer. `Watercolor` flushes after `paint`, direct calls included; a new style's layer must
  flush the same way.
- **Transparent backgrounds.** Its examples paint on `background(...)`. On a cleared canvas, fills and thin strokes
  mix with transparent black, and thin ink can vanish entirely. See the `on` modes in SKILL.md.

## Not wrapped by the kit yet

Each is a function of the frame's time only if you make it one:

- **Vector fields** (`brush.field(name)`, `brush.wiggle(k)`, `brush.addField`): strokes and `flowLine`s follow a flow
  field. Call `brush.refreshField(t)` with the **scene's time**, never a frame counter, so wind or water moves
  repeatably. Turn it off with `noField()` before drawing things that shouldn't bend.
- **`brush.mass(brushName, color, options)`**: a dry-media fill, hand-scribbled like crayon or pastel. A different
  look from watercolour fills; good for a chalky or kids'-drawing style.
- **`brush.circle(x, y, r, irregularity)`**: the kit builds ellipses from points; this is the library's own
  hand-drawn circle, with fill and hatch.
- **`brush.flowLine(x, y, length, dir)`**: a stroke that follows the active field (grass, hair, rain).
- **`brush.clip([x1, y1, x2, y2])`**: clips strokes to a rectangle, e.g. paint that stays inside a panel.
- **Custom brushes** (`brush.add(name, { type: 'custom', tip })`): any stamp shape. The
  [Brush Maker](https://acamposuribe.github.io/p5.brush/tools/brush-maker.html) designs them. Add brushes in the
  style's `setup`. Image tips return a Promise, which `setup` can await.
- **`fillBleed(k, 'in' | 'out')`** and **`fillTexture(tex, border, scatter)`**: `scatter: false` gives a cleaner edge
  without the speckle.

## Speed

Group fills by colour and opacity: the library caches per fill state.
