# The painting model

How paint behaves in a painting document: what to understand before writing a wash, and what explains one that came
out wrong. The types are the contract, each field's unit and default in its JSDoc:
`$(studio home)/lib/paint/document/models/painting-document.ts` (the document) and `painting-properties.ts` beside it
(a source's property schema).

## Sources, documents, sheets

1. A painting source is a `*.painting.ts` module: a pure factory returning a `PaintingDocument`, plus a property
   schema if it takes values. Same values in, same document out; the check calls it twice to prove it.
2. A document is a paper, a medium and a tree of layers; a layer holds washes; a wash holds applications, each one
   mark or run of marks (paint, water or a lift) through one tip. Papers, brushes and mixes are values written where
   they're used: share them as TS constants.
3. A **sheet** is one wet history, one painter. Every application on it, whichever layer it's in, lands in the sheet's
   order (unclocked work first, in document order: layer back to front, then wash, then application; then clocked
   work by its times), each at the earliest moment its `on` holds. Earlier decisions are never revisited.
4. Layers on one sheet share its water: a layer's paint lands into whatever is still wet there, and its water moves
   their open paint. Layer and group boundaries dry nothing. Each layer keeps its own film, so two layers' colours
   glaze rather than mix. Separate sheets are separate paintings and never share water.
5. A painting has no clock unless a wash declares one; unclocked work is always shown finished.
6. Scenes own time: they choose property values and sample times, and show finished layers on planes under a camera.
   Only a property change, a pose of a layer on a sheet it doesn't own, and boil `reseed` re-solve paint; everything
   else a scene does (lays, the camera, visibility, masks, reveals, dissolves) moves or cuts finished paint.
7. The engine solves each sheet once per distinct input, resuming from the first application that changed.

```
PaintingDocument {widthPx, heightPx, paper, medium, dryingScale?, wrap?, layers}
└─ layers: LayerNode[]            back to front
   ├─ LayerGroup {key, sheet?, medium?, reveal?, children}
   └─ Layer {key, sheet?, medium?, reveal?, washes}
      └─ Wash {key, clipTo?, prewet?, rim?, clock? | wetHistory: false, applications}
         └─ Application {stroke | stamps | fill, brush, diameterPx, seed, charge,
                         key?, on?, at?, effect?, clips?, reserves?, resists?}
```

`medium` is `'watercolour' | 'gouache' | 'crayon'`, set on the document and overridable per layer or group, never per
wash. A brush is `{style, brush}`, the style's own name for it: the style is spelt `'watercolor'`, the medium
`'watercolour'`. Any brush paints in any medium.

**Keys** name the tree and are unique across the whole document (`hill` the layer, `hill-wash`, `hill-flood`), with no
`/`, `|` or whitespace and no leading `#`. A deposit is named `<layer>/<wash>/<application>` (`#i` for an unkeyed one)
and that name seeds its colour and water: adding or dropping a layer repaints no other, renaming one repaints its
deposits, and a group's key repaints nothing. A TS function building an element twice takes a key prefix.

**Seeds** are strings, and equal seeds draw equal randomness: two applications sharing one repeat each other's marks,
and noise fields sharing one share a pattern. Give each application its own unless you want that.

**Geometry**: points `{x, y}` in paper px, y down; angles in radians, positive clockwise on screen; (0, 0) the
top-left, paint outside the rectangle clipped away. A polygon's `rings` read even-odd (a ring inside another is a
hole, rings side by side a union) and never cross: compute an overlap's union in TS, or write separate applications.
A fill of several outer rings is one application and one deposit under one charge and timing; a tree in its own
colour or moment is its own application. A stroke's `subpaths` are pen-downs; the hand's profile counts the gaps. To
close a stroke's loop, repeat its first point last; a ring never repeats it.

## Water

- Every charge lays through its brush's tip at `diameterPx`: paint, water and lifts alike.
- An application raises the paper's wetness toward its own `water` as far as it touched, never lowers it: water 0.6
  over a 0.85 flood leaves 0.85. Overlaps take the wetter, never the sum.
- So a flood's wetness follows its contact. A textured brush (watercolour's `wash`, `filler`) lands its water in
  flecks, a third of them below shiny, so nothing can wait `wet` on it. **Flood with an even brush** (watercolour's
  `detail`, laid big) wherever later work waits on the flood.
- A lift soaks water up as well as paint: an `on` after a lift reads the paper drier.
- Between applications wetness only falls, at (0.5 + absorbency) ÷ drying per model second, by the medium of the
  node that declared the sheet. Water never spreads past where its brush touched.
- Open paint walks in water by itself (sigma = medium spread × diameter ÷ 2 on flooded paper, less as it dries),
  stopping at walls and dry gaps. Set paint never flows, however wet again; only a lift reaches it.

Model seconds from water landing on dry paper (`studio paint check --solve` prints the real windows):

| Medium, water | absorbency 0.3 | 0.5 (default) | 0.7 |
|---|---|---|---|
| watercolour 0.7 (its default) | never shiny, damp from 105, dry at 210 | never shiny, damp from 84, dry at 168 | never shiny, damp from 70, dry at 140 |
| watercolour 0.85 (a flood) | shiny to 45, damp from 150, dry at 255 | shiny to 36, damp from 120, dry at 204 | shiny to 30, damp from 100, dry at 170 |
| watercolour 1 (a bloom's drop) | shiny to 90, damp from 195, dry at 300 | shiny to 72, damp from 156, dry at 240 | shiny to 60, damp from 130, dry at 200 |
| gouache 0.4 (its default) | never shiny, damp from 7.5, dry at 60 | never shiny, damp from 6, dry at 48 | never shiny, damp from 5, dry at 40 |
| gouache 0.5 (a flood) | shiny to 15, damp from 22.5, dry at 75 | shiny to 12, damp from 18, dry at 60 | shiny to 10, damp from 15, dry at 50 |

Water landing on wet paper leaves it at the wetter of the two and dries from there.

## `on`: what an application waits for

Judged once, before it lands, over its **core**: the paper it touches with contact 0.5 or more after its resists,
clips and reserves, each texel weighted by contact, against the sheen of the sheet's medium.

| `on` | Holds when | Watercolour | Gouache | Use for |
|---|---|---|---|---|
| `wet` | 95% of the core is wetter than shiny | > 0.7 | > 0.4 | charging, wet-in-wet |
| `damp` | 95% of the core is at or below damp and above 0, at one time | ≤ 0.35 | ≤ 0.35 | blooms, backruns, soft lifts |
| `dry` | no core texel holds water or open paint | 0 | 0 | a glaze within the wash, dry lifts, rewetting |
| left out | always | | | lands at its predecessor's time, into whatever is open |

- An `on` that can't hold fails the solve, naming the application and the fix.
- `wet` never delays: it lands at its predecessor's time (or its `at`) and holds there or fails. A flood at the
  medium's default water (0.7, 0.4) is never `wet`: flood at 0.85+ in watercolour, 0.5+ in gouache.
- A core spanning more than the damp band at once (a stroke along a wet passage and a drying one) may never be
  `damp` over 95%: split it.
- Satin, between damp and shiny, has no word: reach it with a fixed `at`. Crayon refuses `on`.
- `dry` waits on the sheet, not its layer: it lands after everything before it in the sheet's order, once no water
  lies under its core, and **everything after it waits too**. Layers meant to run on their own go on their own
  sheets, or leave out `on` and land in order or at a fixed `at`.
- On a moving element `on` is judged again at every pose; fix `at` where timing shouldn't depend on place.

## Layers, washes, sheets

| Unit | Holds | Meets what came before |
|---|---|---|
| Application | one deposit at one painting time | as wet as the sheet is then |
| Wash | a run of applications, `prewet`, `rim`, an optional clock | earlier washes of its layer set, by the medium's layering law |
| Layer | one film in one medium (12 pigments at most) | the sheet as it is: mingles with open paint in shared water; glazes over what's behind |
| Group | children, a sheet and medium they inherit, a motion parent | nothing physical; dries nothing |
| Sheet | a paper (colour, image, grain, absorbency), one water, one order, one clock | — |

**Layering law within a layer**: watercolour and gouache mix (keeping pickup × coverage of what's there: 0.5 and
0.2), so a blue heart on yellow petals goes olive; crayon stacks wax in the tooth, about five layers filling it. A
transparent glaze over dry paint is its own layer, its first application `on: 'dry'`. A layer with no washes is clear,
taken as meant: a rig's clear cel, or a bare-paper back.

**Sheets**:

| `sheet` | Lies on | Posed by a scene | Use |
|---|---|---|---|
| left out | its parent's sheet (the root's at the top) | repainted into that sheet at each distinct pose: grain still, edges shifting a little solve to solve, its water meeting the sheet's | almost everything; an element touching a painted scene |
| `{kind: 'own', paper, dryingScale?}` | a new sheet of `paper`, a cut-out hiding what's behind as far as its paint lies | moves whole, paper and paint, with no solve | collage; a cut-out that slides, turns or bends |
| `{kind: 'scene'}` | the root's sheet, past any enclosing own sheet | as left out | a shadow under a cut-out, on the scene's paper |

- An own sheet's card is its paper cut round its paint at twice the paint's gain, so a `feather` or `bleed` outline
  shows a rim of paper past the paint. Keep a card's outline crisp, tint its paper where it should read as paint
  alone, and paint an edge meant to melt into what's behind on the parent's sheet.
- Posing on shared paper re-solves from the element's first application at each distinct pose; a node's hold sets
  how many poses a second. Shared-sheet paint stays inside the document rectangle: an element leaving it needs a wider
  document or an own sheet.
- Hiding, masking or fading an element on a shared sheet leaves its water's work in its neighbours: fade a group
  holding both, or make its presence a property.
- A sheet's grain is baked where its paint lies: paint on a nearer plane keeps the grain it was painted on while the
  camera moves the back's differently. For grain that stays still under a moving element, keep it on the back's
  document.
- To paint an element from another source into a scene's paper, build its layers into the scene's document with that
  source's TS functions: a sheet belongs to one document.

## Media

| | Watercolour | Gouache | Crayon |
|---|---|---|---|
| Body (unit films per full load) | 1 | 20 | 15 |
| Lightens with | water | titanium white | wax white |
| Paper contact | valleys; a dry brush catches peaks | valleys; a dry brush catches peaks | peaks; `burnish` reaches valleys |
| Layering in one layer | mixes, pickup 0.5 | mixes, pickup 0.2 | stacks |
| Spread / drying / rewetting | 0.5 d / 240 s / 0.35 | 0.1 d / 120 s / 0.9 | 0 / — / 1 (an eraser) |
| Sheen shiny / damp | 0.7 / 0.35 | 0.4 / 0.35 | — |
| `on`, water, prewet, rim | yes | yes | refused: every wash `wetHistory: false` |

- **Watercolour** is transparent: light is the paper. Granulating pigments settle into the grain; staining ones
  resist lifting. Over HTML or a later canvas it glazes per channel, keeping its hue.
- **Gouache** is body colour: light over dark works, and a weak mix is a tint with white, still opaque. It barely
  travels and redissolves when lifted dry. It dries 3–6 L* paler than it is wet.
- **Crayon** stacks in the tooth. Wax resists a later watercolour wash only where written (`resists` on that wash's
  applications, the crayon strokes as footprints).
- **Ink** has no medium of its own: waterproof ink is line work in a direct wash (`wetHistory: false`), a dark mix at
  strength 1, a fine brush. Put it below transparent washes, which glaze over it, and above body colour, which would
  hide it. Fresh ink walking into a wet wash is a wet paint application landing while the wash is open.
- **Hex parts** are fitted as pigments with no habits. In gouache a hex is its wet colour, so write one a shade darker.
- One sheet has one grain and one water, drying by the medium of the node that declared it: a gouache layer on the
  root's watercolour sheet lands into watercolour water while its own paint walks by gouache's spread.
