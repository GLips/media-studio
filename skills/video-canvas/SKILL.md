---
name: video-canvas
description: Painted, drawn and generative layers in a video, made with p5 and p5.brush inside Remotion. Use for a painted or hand-drawn look (a watercolour opening, ink marks over a capture, a brush-wipe transition), generative backgrounds, or adding a new drawn style.
---

# Drawn layers

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

Captures show the real product. Drawn layers add what a screenshot can't: a painted opening, a transition with
texture, a hand-drawn loop around the thing the voice names. They're full-frame canvases that sit in a scene like any
other layer, so they crossfade, cut and time to words the same way.

Everything the `video-motion` skill says about timing (reads, one at a time, lead the eye, the tells of generated
motion) applies here unchanged. This skill covers what's specific to drawing.

## How it works

- `lib/paint/P5Canvas.tsx` hosts any p5 sketch as a layer. A **style** (`P5Style`) names its setup (brushes,
  textures); a **kit** is that style's drawing helpers, bound to one frame. Each style has one WebGL canvas per
  browser tab, shared by its layers one at a time and copied onto each layer's own canvas.
- `lib/paint/watercolor.tsx` is the first style: p5.brush washes, watercolour fills, hatching and tapered ink on paper.
  Read [references/watercolor.md](references/watercolor.md) before painting in watercolour.
- In a scene: `<Watercolor t={s.t} paint={(w) => { w.paper(); w.paint(…); }} />`. Anchor to words exactly as
  elsewhere: `seg(s.t, s.line('ring').word('price').start - 0.4, …)`.
- Renders run the browser on the GPU, so drawn layers are cheap enough to use freely.
- Before calling `brush.*` directly, writing a style, or reading p5.brush's own docs, read
  [references/p5-brush.md](references/p5-brush.md): where those docs are wrong for us, and what the kit doesn't wrap
  (vector fields, dry-media fills, custom brush tips).

## The one rule: a frame is a function of its time

Remotion renders frames out of order, several tabs at once, and any frame alone. A layer that remembers anything
from the frame before comes out different depending on what its tab drew last. It looks fine in the Studio and then
flickers in the render.

- Compute everything from `t` in closed form: no counters, no `Math.random()`, no physics stepped frame by frame.
- **Seed every random stream the library uses, per element.** Watercolour's `w.boilSeed(key)` re-seeds both p5 and
  p5.brush from a fixed key and the boil frame (p5.brush's own docs get this wrong; see the reference below).
- **Flush deferred drawing at the end of every layer.** p5.brush holds strokes back and composites them later; left
  alone, one frame's ink turns up in the next frame the tab paints. `Watercolor` flushes for you.
- For values that mustn't wobble (positions, sizes), use `hash(i)`, not the seeded stream.
- **Prove it:** `studio repeatable <p> <times>` renders chosen times fresh and again after other frames in one tab, and fails
  if any differ. Run it whenever a drawn layer flickers.

## Layers over captures

p5.brush mixes paint like pigment with whatever it lands on, so a transparent layer breaks thin strokes. Watercolour
layers say what they're painted on:

| `on` | For | How |
|---|---|---|
| `"paper"` (default) | A whole painting | Opaque, starts with `w.paper()`, grain multiplied over it |
| `"page"` | Ink and paint on a capture: loops, underlines, arrows | Painted on white and multiplied onto the page, like marking up a printout. It can't cover dark content |
| `"clear"` | Solid washes that must cover the page (a brush wipe) | Transparent. Flat washes survive it; thin lines don't |

A scene can stack them: the capture, then a `"page"` layer for the ink loop, then a `"clear"` layer for the wipe.

## Drawn styles and the checks

The checks can't see inside a canvas. A drawn loop around a price isn't a `Highlight`, so `expect` can't check it,
and the motion tracks list a painted canvas as unmeasured. When a drawn mark carries a read, check it by eye with
`--strip`, and keep it clear of the caption band yourself.

## Adding a style

A style is a whole medium with its own rules (what marks it makes, its palette, what it never does), not a filter.

1. Add its library (exact version; this repo waits 7 days for new releases), and type what you call in
   `lib/paint/p5-modules.d.ts`.
2. Write `lib/paint/<style>.tsx`: a `P5Style` with `attach` and `setup`, a kit bound to `(p, t)` that seeds per
   element and flushes at the end, and a component like `Watercolor`.
3. Write `references/<style>.md`: the medium's rules, its helpers, its quirks and its tells.
4. Build one shot in a test project, look at a `--sheet` and a `--strip`, and pass `studio repeatable`.

Character animation (walk cycles, acting) isn't ported; ClaudeAnimationBase's `ANIMATION_GUIDE.md`
(github.com/JohnHeibel/ClaudeAnimationBase) is the place to start.
