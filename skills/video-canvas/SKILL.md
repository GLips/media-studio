---
name: video-canvas
description: Painted, drawn and generative layers in a video. The painting stack is being rebuilt as stamp painting and has no style yet. Use for a painted or hand-drawn look (a painted opening, ink marks over a capture, a brush-wipe transition) or generative backgrounds, to learn what's possible today and what a drawn layer must obey.
---

# Drawn layers

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

**Drawn layers are being rebuilt.** The studio has no painting style right now: stamp painting, drawn on the GPU,
is on its way to replace the old one. Until it lands, a painted look isn't available; say so, and offer what
`lib/studio` can do instead (SVG strokes, masks, three.js) or hold the shot for the new style.

## The one rule: a frame is a function of its time

The rule is the `video-motion` skill's (What a scene can be). A canvas breaks it quietly: a layer that remembers
anything from the frame before comes out different depending on what its tab drew last, so it looks fine in the
Studio and then flickers in the render.

- **Seed every random stream per element**, from a fixed key and the frame, with `seededRandom` (`#studio`).
- **Flush deferred drawing at the end of every layer**, so one frame's marks never turn up in the next frame the tab
  paints.
- For values that mustn't wobble (positions, sizes), use `hashRandom(key, i)` (`#studio`), not the seeded stream.
- **Prove it:** `studio repeatable <p> <times>` renders chosen times fresh and again after other frames in one tab, and fails
  if any differ. Run it whenever a drawn layer flickers.

## Drawn layers and the checks

The checks can't see inside a canvas. A drawn loop around a price isn't a `Highlight`, so `expect` can't check it,
and the motion tracks list a painted canvas as unmeasured. When a drawn mark carries a read, check it by eye with
`--strip`, and keep it clear of the caption band yourself.
