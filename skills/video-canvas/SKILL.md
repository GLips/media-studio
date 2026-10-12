---
name: video-canvas
description: Painting for a video or a still, in watercolour, gouache or crayon, from a painting document (`*.painting.ts`) shown by `<PaintedShot>`; also hand-drawn or generative canvas layers. Use to paint a picture or a painted shot, to animate one, when a wash or a painted render looks wrong, or to find the styles you can paint in.
---

# Painting

The studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read and Edit. Each
verb explains itself in `studio <verb> --help`; each `#studio` export in `studio api <Name>`. A painting lives in a
project there, wherever the request came from: `studio new <slug> --capability still-only` for a painted still, a
timed capability for a shot.

Hand drawing (painting a picture, posing, tuning a look by eye) to a subagent on Sonnet (`model: "sonnet"`): it's
many short look-and-respond turns, and faster turns buy more of them. Design and review stay on the default model.

## The model

A **painting source** is a `*.painting.ts` module: a pure factory from property values to a `PaintingDocument`, a
paper, a medium and layers of washes of applications (paint, water or a lift through a brush). Paint behaves as
paint: every application on a **sheet** lands in the sheet's order, into whatever water is still there, each when its
`on` (`wet`, `damp`, `dry`) holds; layers glaze, and within a layer paint mixes. Plan the lights before the first wash:
watercolour's only white is the paper.

A scene shows finished paint through `<PaintedShot>`: a camera and planes, each a depth and a selection of layers.
Moving, fading, revealing and posing finished paint costs a frame; a new property value re-solves paint on the GPU. So
**what moves continuously is presented, and what only a new painting can show is a property.**

## Workflow

1. **Find a style.** `ls "$(studio home)/work/styles/"` (folders spell a style `watercolor`), then read its
   `<name>.md`. Done when the project's
   `project.ts` names it in `styles`, or you've told the user there's no painted look on this machine
   ([styles.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/styles.md)).
2. **Plan colour and light**: which lights are reserved paper, what mixes in one layer, what glazes over what, which
   washes later work waits on. Done when each light and each wet-in-wet moment has its application written down
   ([techniques.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/techniques.md)).
3. **Write the source** in the scene's folder. A first painting:
   [first-painting.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/first-painting.md); how water, `on`,
   layers and sheets behave: [painting-model.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-model.md).
4. **Check, solve, look.** `studio paint check <source>` until clean; `--solve` until every landing time is the one
   you planned; `studio paint still` and read the PNG at delivery size. Done when all three agree with the plan. When
   it looks wrong: [troubleshooting.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/troubleshooting.md).
   A painted still for delivery: `paint still --out assets/<name>.png` in the project, imported into `stills.tsx` as
   an image `{ src, w, h }` (the `stills` skill).
5. **Put it in a scene and move it.** Planes, camera, lays, keyed values, motion and costs:
   [shots.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/shots.md). Washes painted on screen, reveals,
   properties moving through a shot, rigs:
   [painting-over-time.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-over-time.md). Paint worn by
   three.js, wrapped labels, 3D lighting:
   [three-and-wrapping.md](${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/three-and-wrapping.md). Done when
   `studio paint check <project>` is clean, every motion warning is fixed or meant, and a `studio look` sheet at the
   storyboard's moments reads right.
6. **Prove and hand over.** `studio repeatable <project> <times>` at times mid-fade and after each move; then put
   the stills and a look sheet up for review (the `studio-review` skill). Done when `repeatable` passes and the
   review is open.

## Rules a drawn layer obeys

- **A frame is a pure function of time** (video-motion). `<PaintedShot>` keeps it. In anything else you draw into a
  canvas, flush deferred drawing at the end of every layer, so one frame's marks never turn up in the next.
- **Judge by eye at delivery size.** The painting engine is in flux: renders shift a little between runs and
  commits. Accept a moved look when it looks right, and chase only differences a viewer would notice.
- **The checks can't see inside a canvas.** A painted loop round a price isn't a `Highlight`, so `expect` can't check
  it, and motion tracks list a painting as unmeasured. Check a drawn mark that carries a read by eye with
  `studio look --strip`, and keep it clear of the caption band yourself.
- **Paintings draw with WebGPU**, which the render browser and `studio preview` have; without it they fail loudly.
- **Imports**: scenes take `painting`, `layersOf`, `PaintedShot`, `paintKeyed`, `paintingInTime`, `dissolve`,
  `sceneSecondsOf` and `WATERCOLOUR_PIGMENTS` from `#studio`. The stage, camera plays, depth, rig-pose and reveal
  helpers aren't in `#studio`: each reference names its `#lib/paint/…` module. A source loads in plain Node and imports
  models only.

Older projects paint through `stampPaintRecipe` and `<StampPainting>`; write new work as painting documents.
