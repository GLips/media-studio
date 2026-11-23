# Cut paper

Cut paper is printed card, folded and stood up, seen as a miniature. Build it as a **diorama**: folded sheets on a
painted ground in one three plane, a high oblique camera, tilt-shift, a low warm light. Flat cards suit a title, not a world.

## Paint every print

The prints are the look. Each piece's print is a painting document: gouache or watercolour washes, a pattern
(scalloped tiles, leaf motifs, brick, flower dots), an ink line over shapes and details, and a pale cut border
(~10 px, cream) painted just inside every cut. Paint colour 5–10 px past each cut. Export each print's size and cut
outlines from a `-model.ts` beside it, which the painting and the 3D side both read.

## The diorama

`paperPopUpPlane` (`#studio`) returns `{plane, paintedTextures}` for `PaintedShot`. Sheets name a print by key.

```ts
const { plane, paintedTextures } = paperPopUpPlane({ id: 'village', depth: 1, popUp: {
  at: { x: 900, y: 420 }, pitch: PAPER_DIORAMA_PITCH, scale: 0.8, thicknessPx: 3,
  prints: { ground: { source: groundPrint, widthPx: 3300, heightPx: 2600 }, walls: …, roof: …, pine: … },
  base: { print: 'ground', root: { outline: GROUND_OUTLINE } },
  sheets: [
    ...paperBoxHouse({ ...HOUSE, rise })({ id: 'house', at, yaw: 1.05, scale: 0.5, print: { walls: 'walls', roof: 'roof' } }),
    ...paperXTree({ ...PINE, rise })({ id: 'pine-1', at, yaw, scale: 0.45, print: 'pine' }),
  ],
}, look: { back: 'mirrored', leak: light.leak, lights: light.lights } });
```

- **The kit** (`#studio`): `paperStandUp` (a card on a fold-back tab), `paperXTree` (two cards slotted crosswise),
  `paperTent` and `paperBoxHouse` (walls folded from one net, a tent roof on top; `paperBoxHouseNet` lays its print
  out). Each takes a `rise` (0 flat, 1 standing; key it with a `latch`) and returns a placer: `id`, `at` (ground print
  px), `yaw`, `scale`, `tint`.
- **The ground runs past the frame**, at the plane's `scale`, through every camera move; keep `turn` small. A board
  edge in shot makes a model on a table.
- **Pieces are small on it**: a sheet's `scale` stands its print smaller. Vary size and yaw across copies.
- **Thin card.** `thicknessPx` 2–4: the printed border carries the edge, not a white side.
- **Never edge-on.** A card within ~14° of the camera's line reads as a pole. Turn X trees about 45° off the line
  *at their spot*, since the line swings across the frame.
- **Scatter.** `seededScatter` places pieces clear of paths and sites; clump small things, never in rows.
- **Light and lens.** `paperDioramaLight(pitch)` gives a low warm sun with `{light, leak, lights}`, and
  `paperDioramaFocus({ focus, aperture })` leans the focus plane onto the ground: the band of sharp focus that sells
  scale. An aperture of 20 or more makes the band narrow.
- **Life.** `glow` names an emission print (black where nothing glows), and `glowStrength` keys it: lit windows bloom.
- **Motion.** Pieces rise from flat back to front, 0.1–0.3 s apart; the camera drifts.

A sheet's faces (points or SVG paths, `holes` for windows) lie in its print's px: a `root` and `folds` hinged `on` a
parent face, turning by `angle`. `on: { sheet, face? }` stands a sheet on another's face. Builders for sheets by hand:
`createPaintedThreeSheet`, `paintedThreePaperMaterial`.

## 2D cards

An own sheet is a card by default. `card: {shadow?, rim?, lift?}` turns either off or lifts it further; `card: 'flat'`
lays it flat. A stack reads by layering: each card 10–13% lighter than the one under it, lifted a little more.
`fold {angle, crease?}` on a card's group turns it about a crease, narrowing by cos(angle); past π/2 its blank back
shows. Nested folds multiply in the plane, not in 3D: use the diorama for real folding.

## Check

On a `studio look` sheet at delivery size, done when: no board edge in shot; every print reads painted at its size;
no card edge-on; shadows fall away from the light and read warm; a band of sharp focus crosses the subject.
