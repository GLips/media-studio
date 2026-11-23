# Cut paper

Cards that read as cut paper: own sheets lit by the shot's `light`, folds and flips, pop-ups in three. The look is
**depth by layering**: a stack of cards each lifted a little off the last, lit by one key from above.

## The look

- **Layers part by tone.** Each card 10–13% lighter than the one under it, or a step round the hue wheel. Cards of
  equal tone melt into one.
- **Lift by depth.** A card's shadow grows with its `lift`: lift the near ones further. A close stack keeps the
  default.
- **Never edge-on.** A lone card stays within ~14° of facing the camera; a flip crosses edge-on inside a frame.
- **Cut, don't trace.** Corners rounded ≥3 px, a cut wandering 0.5–1% of its length, nothing under 2–3% of its piece.
- **Paper moves like paper.** Upright in 0.2–0.3 s with a `latch`, staggered 0.3 s across a piece; folds turn only
  about creases. Idle sway 0.5–2.5° at under 1 Hz.
- **The paper is the texture.** Edges meet what's behind with the cut line alone, no halo; matte paper, no gloss; no
  filter or noise over the frame.
- **One card, one thing.** A bridge is planks, a crowd is figures: a card standing for many reads as a sticker.

## 2D cards

An own sheet is a card by default. `card: {shadow?, rim?, lift?}` turns either off or lifts it further (`lift` px,
0.7: the shadow's length and softness); `card: 'flat'` lays it flat, for a card meant to melt into what's behind.

**Folds.** `fold {angle, crease?}` on a card's group node turns it about a crease through its pivot (`crease`
radians, level by default; positive tips the side below away), narrowing by cos(angle), shaded by the `light`. Past
π/2 its blank paper shows (a flip is a fold of π); π/2 draws nothing, and a lingering sliver warns. Nested folds
multiply in the plane, not in true 3D. A rig part folds the same way: `crease` on its hinge, `fold` in its pose,
`back` for a cel drawn on its reverse (rigs: painting-over-time.md).

## Pop-ups in three

`paperPopUpPlane` (`#studio`) returns `{plane, paintedTextures}`: a three plane of sheets standing on a base tipped
back `pitch` radians, and each sheet's painting as its texture. Pass both to `PaintedShot`.

```ts
const { plane, paintedTextures } = paperPopUpPlane({ id: 'popup', depth: 1, popUp: {
  at: { x: 960, y: 700 }, pitch: 0.85, scale: 0.6,
  base: { source: layersOf(ground, ['ground']), widthPx: 1400, heightPx: 900, root: { outline: GROUND } },
  sheets: [{ id: 'house', source: layersOf(house, ['house']), widthPx: 400, heightPx: 560,
    root: { outline: HOUSE, hinge: { from: { x: 0, y: 500 }, to: { x: 400, y: 500 } } },
    folds: [{ id: 'tab', outline: TAB, hinge: { from: { x: 40, y: 500 }, to: { x: 360, y: 500 } }, angle: 0.85 - Math.PI }],
    at: { x: 600, y: 520 }, angle: paintKeyed([{ at: 0, value: 0 }, { at: 0.6, value: 0.85 }]) }],
} });
```

- A sheet's faces (points or SVG paths, `holes` for windows) lie in its print's px: a `root`, and `folds` hinged
  `on` a parent face, turning by `angle` (positive toward the front; the tab folds back under). A card has no folds.
  Folds and the root's `hinge` get no cut edge.
- `angle` stands a sheet up on its root's `hinge`; at `pitch` it faces the camera. `on: { sheet, face? }` stands it
  on another sheet's face.
- A print shows at most 1.05× as painted: the light never relights paint. Backs show kraft.
- `createPaintedThreeSheet`, `paintedThreePaperMaterial` and `createPaintedThreePaperLights` build sheets by hand.

## Check

On a `studio look` sheet at delivery size, done when: every pair of touching layers parts by tone; every shadow falls
away from the light and reads warm; lips sit only on edges facing it; no card lingers edge-on.
