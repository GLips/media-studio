# Authoring paintings

Everything an agent needs to paint and animate with painting sources: the model, a worked example, the document's
shape, how water behaves, units, media, time, costs, recipes, composition, a reference for the engine's shapes, and
checking. The types are the contract: `lib/paint/document/models/painting-document.ts` (the document),
`lib/paint/document/models/painting-properties.ts` (a source's property schema) and
`lib/paint/shot/models/shot-props.ts` (a scene's shot). docs/brush-engine.md is the engine underneath.

## What's built

Built: sources and `painting()`; property schemas and values; every check made without solving (Checking); a
document's tree, its sheets and each sheet's order (`painting-tree.ts`, `painting-sheet-program.ts`); the evaluation
diff; `layersOf`, `bracket` and `dissolve`, and the problems a shot's load reports in a plane's selection
(`paintedSourceProblems`); the shot's types; `studio paint check` and `studio paint diff`; and the solver, for
every sheet of a document, clocked washes and their prefixes included, each own sheet laid as a cut-out of its paper,
seen through `studio paint still` and `studio paint check --solve`, each at a scene second with `--at`; posing before
painting by a similarity (a place, a turn, a scale), the marks mapped and their fields, ragged edges and noise read
where they were planned; a document that wraps across x, down y or both (`wrap: 'x' | 'y' | 'xy'`); and a layer's film read back through a
selection's prefix, its coverage or its picture (`paintingFilmCoverage`, `paintingFilmPicture`).

`<PaintedShot>` and `<PaintedShotCanvas>` draw a shot in a scene: painted, picture and three planes far to near
under the camera and its lens, on one canvas or several among HTML, a clear back over HTML behind the first; pin and
cover lays (`shot-placement.ts`), the page read as each frame draws (`shot-dom-points.ts`); occurrences and
their motion (nodes hang from their nearest enclosing node, a paintless group's included, clocks chaining);
visibility, a group's fading all it holds as one; rigs (Composition), a cel swap re-solving nothing; and per-plane
`clock` and `sourceClock` holds. Built as models, checked but not yet drawn, so a shot naming them is refused as it
loads: dissolves between their ends, path and `alphaOf` masks (`shot-masks.ts`), instanced planes
(`shot-instances.ts`), `warm` (`shot-warm.ts`) and the cost report (`shot-cost-report.ts`). Painted textures for
three.js objects are compiled and drawn for a three source (`compileShotPaintedTextures`, `createShotPaintedTextures`)
but not yet handed one by a shot, so a shot naming `paintedTextures` is refused too. **NEW** marks behaviour the brush
engine (the recipe path, docs/brush-engine.md) lacks too; unmarked behaviour is how it already paints.

## The model

1. A painting source is a `*.painting.ts` module: a pure factory returning a `PaintingDocument`, and a property schema
   if it takes values.
2. A document is a paper, a medium and a tree of layers; a layer holds washes; a wash holds applications, each one
   mark or run of marks (paint, water or a lift) through one tip. Papers, brushes and mixes are values written where
   they're used; share them as TS constants.
3. A sheet is one wet history: every application painted on it, whichever layer it's in, lands in the sheet's order
   (unclocked work first, in document order; then clocked work by its times), each at the earliest moment its `on`
   holds. **NEW**
4. Layers on one sheet share its water: a layer's paint lands into whatever is still wet there, and its water moves
   their open paint. Layer and group boundaries dry nothing. A later wash of a layer meets that layer's earlier washes
   set. Each layer keeps its own film, so colours of two layers glaze rather than mix. Separate sheets are separate
   paintings. **NEW**
5. A painting has no clock unless a wash declares one; a sheet keeps one, running at the sheet's `dryingScale`;
   unclocked work is always shown finished.
6. Scenes own clocks: they choose property values and sample times, and put finished layers on planes under a camera.
7. A sheet is one painting: a layer posed (place, pins, sway, flutter, rig) on a sheet it doesn't own is repainted
   into it at each distinct pose, its applications scheduled again where the pose puts them. Everything else a scene
   does (a plane's lay, the camera, visibility, a cut-out's moves, masks, dissolves) never re-solves paint; a property
   change does, and so does boil `reseed`.
8. The engine validates the document, solves each sheet's history once per distinct input, resuming from the first
   application that changed, and reports problems by key and path.

## Worked example

A watercolour sky floods wet, a treeline is charged into it while it still shines, and a hill is laid over it in a
later wash of the same layer. A pale cloud sits in a layer of its own. The scene shows it on one plane under a slow
push, raises the hill on sixes, and drifts the cloud.

The source is `lib/paint/document/models/meadow.painting.ts`; read it whole before writing your own. Its spec checks
it clean, `node cli/studio.ts paint check lib/paint/document/models/meadow.painting.ts` prints its summary, and
`node cli/studio.ts paint still lib/paint/document/models/meadow.painting.ts` paints it to `meadow.png`. It
exports `properties`, one quantised number (`hillTopPx`, 150..260 px on a 10 px step), and a default factory
`meadow({ hillTopPx })` returning a 640 × 360 px watercolour document on a cotton paper (`vvds-watercolor-canvas-3`
grain, absorbency 0.5) with two layers:

- `landscape`: wash `sky` holds `sky-flood` (a fill of the sky's box, run 30 px past the paper's edges, at water
  0.85 through the even `detail` brush) and `treeline` (a swelling stroke `on: 'wet'` through the `charge` round,
  clipped to the sky, at water 0.6); wash `hill` holds `hill-flood`, a fill through the `wash` brush of a swell peaking
  at `hillTopPx`, closed past the paper's sides and bottom.
- `cloud`: wash `cloud-wash` holds one feathered ellipse at strength 0.15.

The scene, as a project would write it (`scenes/meadow.tsx`, with its source in `scenes/meadow/`):

```tsx
// meadow.tsx: the meadow under a slow push. The hill rises 260 → 180 px over seconds 1–4, redrawn every 6 frames;
// each height is one evaluation, re-solving the root's sheet from the hill on. The cloud drifts there and back every
// 8 s, repainted into the root's paper at each new place. `warm` solves seconds 0–8 first.

import { paintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import { paintMotionPlay } from '#lib/paint/animation/models/paint-motion-compile.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { layersOf, painting, type OccurrenceMotionNode, type PaintedShotProps } from '#studio';
import * as meadow from './meadow/meadow.painting.ts';

/** The hill's top at scene second `t`, px, snapped to the source's 10 px step. */
function hillTopAt(t: number): number {
  const k = Math.min(1, Math.max(0, (t - 1) / 3));
  return Math.round((260 - 80 * k) / 10) * 10;
}

const landscapeAt = (hillTopPx: number) => layersOf(painting(meadow, { hillTopPx }), ['landscape', 'cloud']);

/** The cloud's occurrence on plane `meadow`: its motion node turns about the cloud's centre, held on sixes. */
const cloud: OccurrenceMotionNode = { id: 'meadow/cloud', pivot: { x: 200, y: 80 }, clock: { hold: 6 } };

export const meadowShot: PaintedShotProps = {
  camera: {
    // A back plane is checked as reaching everywhere: the stage needs a margin, 2 px or more, even.
    stage: stampStage({ width: 640, height: 360 }, 2),
    fov: 30,
    lens: { bloom: 0, shutter: 1 / 48 },
    // Ease sits on the key it eases into.
    plays: [paintCameraPlay({ kind: 'move', keys: [{ at: 0 }, { at: 5, dolly: 0.08, ease: 'inOut' }] }, { clock: { at: 0 }, origin: 'push' })],
  },
  // The source reads its own held moment: the hill steps on sixes while anything the plane moves keeps the frame's.
  planes: [{ id: 'meadow', depth: 1, sourceClock: { hold: 6 }, source: (moment) => landscapeAt(hillTopAt(moment.at)) }],
  motion: {
    nodes: [cloud],
    plays: [paintMotionPlay(cloud, { kind: 'place', keys: [{ at: 0, x: 0, y: 0 }, { at: 4, x: 60, y: -4, ease: 'inOut' }] }, {
      clock: { at: 0, loop: { period: 4, mode: 'pingpong' } }, origin: 'cloud drift',
    })],
  },
  warm: { from: 0, to: 8 },
};
```

The scene component is `({ t }: { t: number }) => <PaintedShot shot={meadowShot} t={t} />`, wrapped as a project's
other scenes are; the shot needs only `t`, in scene seconds. A shot refuses `warm` as it loads until warming is drawn
(What's built): leave it out to see this scene today.

What lands, and why it looks as it does:

| Application | Lands at (model s) | Why then | What you see |
|---|---|---|---|
| `sky-flood` | 0 | first, no `on` | flat blue wash, walled by its crisp outline, wetness 0.85 wherever the even `detail` brush touched |
| `treeline` | 0 | `on: 'wet'` holds at once: its core lies on the flood's full contact, all of it above watercolour's shiny 0.7 | earth paint feathers into the wet sky, about 0.5 × 26 ÷ 2 = 6.5 px sigma: a soft treeline. Its water 0.6 leaves the sky's 0.85 as it was |
| `hill-flood` | 203.901 | a later wash of `landscape` starts on the first 1 ms step once the layer's earlier washes have set: the sky's 0.85 water at watercolour's 240 s a full wash, absorbency 0.5, set by 203.9 s | earth fill with a crisp edge; where it crosses the sky it lands by watercolour's layering law (below) |
| the cloud's fill | 203.901 | next in the root sheet's order, at its predecessor's time: a layer boundary dries nothing, but the sky under it has set and the hill's wet flood lies below it | a pale feathered ellipse, its own film glazed over the sky |

Within one layer, a later wash over set paint lands by the medium's layering law. Watercolour mixes with pickup 0.5:
where the sky covers fully, the hill keeps half the sky's films and replaces half. That reads as a blend, not an
optical glaze. For films that stack (the sky showing through a transparent hill), put the hill in a layer of its own
with `on: 'dry'` on its flood (recipe 12): a layer boundary dries nothing, so without it the hill would land at 0 into
the wet sky and mingle with it. Changing `hillTopPx` re-solves from the hill on: `sky` comes earlier in the root
sheet's order and keeps its solve, and the cloud, after the hill, is painted again. `studio paint diff` says so before
anything solves (Checking).

The cloud lies on the root's sheet, which it doesn't own, so the scene's drift repaints it into that paper at each
new place: its grain stays still and its edges shift a little from solve to solve. Each place schedules the cloud
again where it lies; with no `on`, it lands at the same time wherever it is. Its node's hold of 6 sets how many
places, and so how many solves, a second, and `warm` solves them before the first frame. Given `sheet:
{kind: 'own', paper}` it would instead be a cut-out carrying its own paper and grain, moved without a solve.

## The document

```
PaintingDocument {widthPx, heightPx, paper, medium, dryingScale?, wrap?, layers}
└─ layers: LayerNode[]            back to front
   ├─ LayerGroup {key, sheet?, medium?, children: LayerNode[]}
   └─ Layer {key, sheet?, medium?, washes: Wash[]}
      └─ Wash {key, clipTo?, prewet?, rim?, clock? | wetHistory: false, applications}
         └─ Application {stroke | stamps | fill and its geometry, brush, diameterPx, seed, charge,
                         key?, on?, at?, effect?, clips?, reserves?, resists?}
```

| Field | Type | Notes |
|---|---|---|
| `widthPx`, `heightPx` | px | Any size; (0, 0) is the top-left corner. Paint outside the rectangle is clipped away. |
| `paper` | `Paper` | The root's own sheet: `{color, image?, grain?: {image, scale, depth}, absorbency}`. |
| `medium` | `'watercolour' \| 'gouache' \| 'crayon'` | Default for every layer; a layer or group may override. Not per wash. |
| `dryingScale` | `number \| 'instant' \| 'never'` | The root sheet's: scene seconds per model second once a clocked wet wash starts its clock (Time). 1 when left out. An own sheet states its own. |
| `wrap` | `'x' \| 'y' \| 'xy'` | **NEW**: on every sheet `'x'` meets the left edge to the right, as round a cylinder; `'y'` the top to the bottom; `'xy'` both, a tile (Wrapping). Left out, nothing wraps. |
| `layers` | `LayerNode[]` | Back to front. |
| an application's `brush` | `{style, brush}` | A style's own brush name (Reference). The style is spelt `'watercolor'`, the medium `'watercolour'`. |
| a paint charge's `mix` | `Mix \| Field<Mix>` | `{parts: [{pigment, amount}], strength}`; a pigment is an appearance from `WATERCOLOUR_PIGMENTS` or a hex. |

Keys name the tree: layers, groups, washes, and any application you want named. They're unique across the document
and hold no `/`, `|` or whitespace. Problems name an unkeyed application `<wash>.applications[i]`. Keys never reach a
solve. Marks that land together are consecutive applications, the later ones without `on`.

Seeds are separate strings. Equal seeds draw equal randomness: two applications with one seed repeat each other's
marks, and noise fields with one seed share one pattern. Give each application its own unless you want that.

Geometry: points are `{x, y}` (`StampPoint`) in paper px, x right, y down; angles are radians, positive turning
clockwise on screen. A `Region` is an ellipse or a polygon of `rings` read even-odd: a ring inside another is a hole,
one inside a hole an island, rings side by side a union. Rings never cross: compute an overlap's union in TS, or
write separate applications (**NEW**: the engine holds one ring per region today). A stroke has `subpaths`: pen-ups
between them lay nothing, and the hand's profile counts the gap. To close a stroke's loop, repeat its first point
last; a ring never repeats it.

A module may import sibling TS modules, hold module-level constants and pure memos, and export anything else it
likes; its factory reads nothing but its values and imports. For seeded randomness use `seededRandom(seed)` from
`#lib/picture/motion/models/random.ts`. A source imports its types from `#lib/paint/document/models/painting-document.ts`
and `#lib/paint/document/models/painting-properties.ts`, and pigments from
`#lib/paint/materials/models/paint-watercolour-pigments.ts`; a scene imports `painting`, `layersOf`, `bracket`,
`dissolve` and the shot's types from `#studio`. A test, or a shot built in a `*-model.ts`, runs in plain Node, which
can't load `#studio`: it imports `painting` and `checkPaintingSource` from
`#lib/paint/document/models/painting-source.ts`, `layersOf` from `#lib/paint/document/models/painting-selection.ts`,
and `bracket`, `dissolve` and `paintedSourceProblems` from `#lib/paint/shot/models/shot-selection.ts`. A source one scene uses sits in that scene's folder
(`scenes/meadow/meadow.painting.ts`); one several scenes share is listed in `project.ts`'s `shared`, and the styles its
brushes name in its `styles` (docs/private-styles.md). Lint lets any `*.painting.ts` default-export its factory, and
holds it to a model's imports (no `#studio`, no I/O), since `studio paint check` loads it in plain Node. A helper
module it imports is a model too, so it is named `*-model.ts` (`scenes/meadow/hill-routes-model.ts`); a plain helper
is a scene helper, which a model can't import.

### Wrapping

`wrap` (**NEW**) joins a document's opposite edges on every sheet: `'x'` its left edge to its right, as round a
cylinder (a label, a lamp shade, a panorama a camera turns in); `'y'` its top to its bottom; `'xy'` both, a tile
that repeats each way, as a wallpaper or a floor. A stroke or flood running off one wrapped edge comes back on the
other, its water and wet stages (a bloom, a rim, a flood's spread) carrying across, and the paper's tooth, grain and
a pigment's clumps run on unbroken. On `'xy'` a mark by a corner lands by all four. Write marks past the edge in
plain px: a band from x 170 to 342 on a 256 px document runs across the seam, its last 86 px landing from x 0; a
bloom dropped at x 252 opens on both sides. A mark lands where it lies and a width either side, so nothing needs
painting twice.

The paper's grain tiles mirrored, and a mirrored tile meets itself only after its mirror, so on each wrapped axis it's
fitted in whole pairs: the tile is laid (width ÷ 2n) × (height ÷ 2m), each side the nearest to what it asks. Across x a
grain `scale` is laid at the nearest of 1 ÷ 2n of the width (0.5, 0.25, 0.167, …): scale 1, the styles' own, is laid at
0.5, half as wide; pick one of those values, and the check warns when the grain is laid more than a tenth off its scale.
Down y the tile's height, its width times its image's aspect, is fitted to the height the same way, so it's laid
anywhere from three quarters of what it asks to half as large again, and one asking more than half the height is laid at
half. On `'y'` alone the width follows: the grain keeps its aspect, not its scale. On `'xy'` each side is fitted on its
own, so the grain keeps its aspect only when the document's aspect is the image's times a small whole ratio: a square
grain at 0.5 on a 1920 × 1080 tile is laid 960 × 540, squashed to 16:9. At 0.1 it's laid 192 × 180, near enough. `studio
paint check --solve` and `studio paint still`, which load the image, warn when the height is laid more than a tenth off.

A wrapped sheet is painted with a margin past each side, wide enough for its widest mark and the water it carries,
rounded up to a power of two, and that width is part of its solve's key. So an edit that widens a brush or adds water
a little keeps every earlier wash's solve; one that carries the widest reach past the next power of two re-solves the
whole sheet, and `studio paint diff` says so.

What doesn't wrap: an axis `wrap` doesn't name, whose edges clip as ever, though the margin is laid past them too, so
water runs off them as off a larger sheet; a paper `image` (a photograph), laid as it is, so it meets itself at each
seam unless it tiles that way (the check warns); a deposit wider or taller than the document, whose fields (a fill's
load, a ragged edge's noise) jump where the one wrap round its middle ends; and a long chain of wet-in-wet washes across
a seam, whose water the margin holds one wash at a time, so a faint seam may show after several. The check warns of a
grain laid off its scale across x; down y the fit goes by the grain image's aspect, which only a solve reads, so
`--solve` warns of it. Wrapping is for a painting shown on a three.js surface as a painted texture (Composition); on a
flat plane it paints as any other, its seams at its edges.

## Water

### How it lands and dries

- Every charge lays through its brush's tip at `diameterPx`: paint, water and lifts alike.
- An application raises the paper's wetness toward its own `water`, as far as it touched:
  `now + contact × (max(now, water) − now)`. It never lowers it: water 0.6 over a 0.85 flood leaves 0.85. Overlaps
  take the wetter, never the sum.
- So a flood's wetness follows its contact: full up to a crisp or feathered wall, falling across a feather's or
  bleed's ramp, and lower in grain holes a textured brush skips. Gate later work on floods laid with an even brush
  (watercolour's `detail`, laid big); a textured one (`wash`, `filler`) lands its water in flecks, a third of the
  meadow's sky below shiny under `wash`, so an `on: 'wet'` into it can't hold.
- A lift soaks it up at once: `now × (1 − contact × strength)`. An `on` after a lift reads the paper drier.
- Between applications wetness only falls, at (0.5 + absorbency) ÷ drying per model second, by the medium of the
  sheet the water is on (the node that declared the sheet: the document's medium for the root). A 0.85 watercolour
  flood on absorbency 0.5 (rate 1/240) reaches damp 0.35 at 120 model s and dry at 204 model s: its damp window is 84
  model s.
- Water never spreads past where its brush touched. Every layer on a sheet shares that sheet's water (**NEW**); water
  never crosses sheets.
- Open paint of any layer on the sheet walks in water by itself: on flooded paper, sigma = medium spread × diameter ÷
  2, less as the paper is less wet, stopping at walls and dry gaps. Set paint never flows, however wet again; only a
  lift reaches it, by the medium's rewetting.

### `on`: what an application waits for

Judged once, before the application lands, where the frame's pose puts it, over its core: the document's paper it
touches with contact 0.5 or more after its resists, clips and reserves, fringe excluded, each texel weighted by its
contact. Thresholds are the sheen of the sheet's medium, whose water it reads. A core texel the sheet's water never
reached counts against `wet` and `damp`.

| `on` | Holds when | Watercolour | Gouache | Use for |
|---|---|---|---|---|
| `wet` | 95% of the core is wetter than `shiny` | > 0.7 | > 0.4 | charging, wet-in-wet. Wetness only falls, so it holds now or never |
| `damp` | 95% of the core is at or below `damp` and above 0, at one time | ≤ 0.35 | ≤ 0.35 | blooms, backruns, soft lifts |
| `dry` | no core texel holds water or open paint | 0 | 0 | glazing within the wash, dry lifts, rewetting |
| left out | always | | | lands at its predecessor's time in the sheet's order, into whatever is still open |

The 95% share is provisional (**NEW**, as is the per-texel judge). An `on` that can't hold is an error: the solve
fails, naming the application (Checking). A flood laid at the medium's default water (0.7, 0.4) is never `wet`: flood
at 0.85 or more in watercolour, 0.5 or more in gouache, for anything to charge into it. A core whose wetness spans
more than the damp band at once (a stroke along a wet and a drying passage) may never be `damp` over 95%: split it.
Between `damp` and `shiny` (satin) has no word: reach it with a fixed `at`. Crayon has no wet history, so `on` is
refused there. The sheet's water is every layer's: `wet` can hold over another layer's flood (**NEW**). On a moving
element `on` is judged again at every pose; leave it out and fix `at` where timing shouldn't depend on place.

### Techniques are applications

There's no effect object: every technique is applications with a charge. One label exists: `effect: 'bloom'` on a
water application, which the engine fails if it certainly can't bloom.

| Technique | Write | `on` | Acts only if | What you see |
|---|---|---|---|---|
| charge | paint, water 0.5–0.8 | `wet` | the paper is shiny under it (clear prewet water counts) | colour feathers in, sigma ≤ spread × diameter ÷ 2 |
| bloom | water stamps, water 0.9–1, `effect: 'bloom'` | `damp` | surplus water − wetness > 0.08 over open paint on workable paper; spread > 0; sigma ≥ 0.5 px | cauliflower edge; full from surplus 0.35; sigma = 1.5 × spread × diameter × surplus ≤ 24 px |
| backrun | one water stroke along a junction, water 1, `effect: 'bloom'` | `damp` (`wet` for softer) | as bloom | lobed edge pushed back along the stroke |
| soften | water stroke, water 0.3, along an edge | `wet` or `damp` | open paint under it | the edge evens out without flooding |
| wet lift | lift, strength 0.5–1 | `wet` (runs back) or `damp` (crisper) | open paint under it | soft light area; on shiny paper paint runs back up to min(16, spread × diameter ÷ 3) px, less on damp |
| dry lift (scrub) | lift, strength 1 | `dry` | the medium lifts | takes strength × rewetting of set paint (0.35 / 0.9 / an eraser's all), less the stain |
| rewet | water, 0.5–1 | `dry` | the medium takes water | wets the sheet's paper for later applications; set paint doesn't move |
| clear-water ground | the wash's `prewet` | — | — | an even soak at the wash's start, before its first `on` is judged; no brush texture |

Under `never` the paper never falls to damp, so a bloom there is `on: 'wet'` (or no `on`) with water 1 over a flood
at 0.85–0.9: surplus 0.1–0.15, a small bloom. An unlabelled application that can't act does nothing. A lift takes
strength × contact, so pressure changes it only through what the brush binds to pressure.

### Reserve, resist, lift

| | Reserve (masking fluid) | Resist (wax) | Lift |
|---|---|---|---|
| Written | `reserves: [footprint, …]` on an application or a wash's `prewet` | `resists: [{footprints, amount}]` on an application, each footprint marks (a stroke or stamps through a tip): the brush's grain is what catches the peaks, and a region has none | a lift application |
| Acts on | that application (or prewet): paint, water or lift | that application's contact on the paper's peaks | its own layer's paint under it, and the sheet's water |
| Effect | excludes this application's deposition and transport: nothing of it lands there, its paint doesn't walk in, its core leaves it out. It does not remove water or paint already present | it keeps 1 − `amount` of contact on peaks; valleys still take paint; `on` judges the contact left | takes up to `strength` of what's liftable |
| Paint already there | untouched by this application; other applications' water still moves it | untouched | removed, leaving a stain |
| Edge | the footprint's: a region's crisp or feathered edge, or brushed tip and grain | broken by the grain | the brush's |
| Posed | with its layer; `anchor: 'paper'` keeps it still on the sheet | as a reserve | with its layer |
| Other applications | ignore it | ignore it | — |
| Leaves | bare paper, or whatever was painted before: a dry gap, with no rim | speckled paper | stain: films × pigment staining (watercolour, gouache); 4% pressed wax (crayon) |

To mask a whole wash, give each of its applications and its prewet the same footprints, a TS constant. A reserve
never erases. The recipe path's keyed reserve targets (a reserve binding other applications by key) have no form
here.

## Washes, layers and paper

| Unit | Holds | Shares with siblings | Meets what came before |
|---|---|---|---|
| Application | one deposit at one painting time | its sheet's water and its layer's film | as wet as the sheet is then |
| Wash | a run of applications in its sheet's history, `prewet`, `rim`, an optional clock | its layer's film and its sheet's water | earlier washes of its layer set; lands by the medium's layering law |
| Layer | one film in one medium | its sheet and the sheet's water | the sheet as it is: its paint mingles with other layers' open paint in shared water (**NEW**); its film glazes over what's behind (Kubelka–Munk) |
| Group | children; a sheet and medium they inherit; a motion parent | nothing physical | its children, in order; dries nothing |
| Sheet | a paper: colour, image, grain, absorbency; one water, one order, one clock | every layer on it (one grain per sheet) | — |

Layering law within a layer: watercolour and gouache mix (an application moves the pixel toward its own paint, keeping
pickup × coverage of what's there: 0.5 and 0.2); crayon stacks wax in the tooth, trading for older wax past 4/3 full
loads and filling the valleys only 60% there, so paper shows through several layers (about five fill it). A
transparent glaze over dry paint belongs in its own layer, its first application `on: 'dry'`. To hide what's behind
under fresh paper, put the layer on an own sheet (recipe 13).

Clips: an application's `clips` are regions it may land and its own paint walk in, each with its edges; several
intersect. A clip binds only its own application: a later unclipped water stroke still moves open paint across it,
so clip that stroke too, or reserve the area. Share a clip as a TS constant. `clipTo` names an earlier wash of the
same layer whose paint coverage, graded, clips this wash (texture inside a silhouette). A clip's or area's
`boundaries` give a stretch of its outline an edge of its own: every point within 1 px of one ring (or the traced
ellipse), either direction; two stretches along each other with different edges are refused.

Edges: `crisp` is a wall paint and water stop at, where a drying wash gathers its rim. `feather(widthPx)` keeps that
wall and rim, ramping coverage to nothing over `widthPx` inside the line; a feather wider than half a shape never
reaches full coverage. `bleed(reachPx)` removes the wall: a ramp `reachPx` wide past the line where paint and water
land fading and dry with no rim. Past the ramp, paint walks only into water already there; for a wetter loss, lay a
water stroke along the edge first. Two floods of one wash whose ramps overlap both land there, the later into the
earlier's water. So a silhouette that melts into wet paint is `bleed` on that stretch; a feather still walls it. Any
edge may be ragged: `roughness: {amountPx, featurePx, seed}`. `maxSpreadPx` on a paint charge caps how far that
application's own paint walks (**NEW**); like a clip, it binds nothing else. Bleed is refused on reserve and resist
footprints and in washes without wet history.

### Sheets

A sheet is one painting: one paper (colour, grain, absorbency), one cut edge, and everything lying on it painted into
it, on its real tooth.

| `sheet` | Lies on | Posed by a scene | Hides what's behind | Use |
|---|---|---|---|---|
| left out | its parent's sheet (the root's, at the top) | repainted into that sheet at each distinct pose (**NEW**): the grain stays still, edges shift a little from solve to solve, and its water meets the sheet's | no: it glazes | almost everything; an element crossing or touching a painted scene |
| `{kind: 'own', paper, dryingScale?}` | a new sheet of `paper`, which its layers lie on, drying at its own `dryingScale` (1), never another sheet's | the cut-out moves whole, paper and paint, with no solve; its layers posed apart from it are repainted into it | as far as its layers' paint landed, by its paper: a lift lightens paint and leaves the card whole | collage, a cut-out that slides, turns or bends |
| `{kind: 'scene'}` | the root's sheet, past any enclosing own sheet, at the root's `dryingScale` | as left out, on the root's paper | no: it glazes | a shadow under a cut-out, falling on the scene's paper. A shadow on a card it's glued to is a layer of the card beside it |

Posing is a node's place, pins, sway, flutter or rig. On a sheet the occurrence owns, it moves finished paint.
Otherwise (**NEW**) it moves the marks before painting: strokes, stamps and fills are planned at rest, then each mark
goes where the pose puts it, scaled and turned with it, with its clips, reserves and resists, and the sheet's history
re-solves from its first application, on the paper there. Fields, ragged edges and boil wobble go with the marks; only
the grain stays still. Each pose schedules its applications again where they lie: an untimed `on` may land a step
apart from rest, and a fixed `at` whose `on` fails at a pose is an error at that frame. A clip, reserve or resist
with `anchor: 'paper'` stays on the paper, so a moving element passes behind it (recipe 31). Boil wobble always moves
finished paint. A node's or plane's hold sets how many poses, and so solves, a second; each distinct pose is cached.
A plane's `lay` moves the whole document, paper and all, without a solve. Shared-sheet paint stays within the
document rectangle: an element that leaves it needs a wider document or an own sheet.

The root is an own sheet of `paper` covering the document. An own sheet lies as far as its layers' paint does, one cut
edge round all of it, and its layers go with their owner onto one plane. **NEW**: everything on one sheet is one
history. Unclocked work is painted first, in document order (layer back to front, then wash, then application);
clocked work follows by time, a tie going to document order. Each layer keeps its film, but they share the water: a
rigged foot on the root's sheet charged into wet shallows mingles with them, and meets them dry once they've set
(recipe 32). Its water's work in the shallows stays when the foot is hidden, masked or faded: fade a group holding
both, or make the foot's presence a property. Paint meant to mix as one pigment shares a layer; two layers' colours
glaze. A plane paints what it selects: the same sheet's layers selected on two planes are two paintings. Separate
sheets are separate paintings: an own sheet's layers never touch the root's water. A sheet belongs to one document:
to paint an element from another source into a scene's paper, build its layers into the scene's document with that
source's TS functions. Advected paper (grain carried by a flow) is reserved for vid-141 and refused.

A sheet's grain is baked where its paint lies. Paint on a nearer plane, or on an instanced item, keeps the grain it
was painted on over the back plane's paper, which the camera moves differently. For grain that stays still under a
moving element, keep the element on the back plane's document.

`paintingTree(document)` (`painting-tree.ts`) gives a document's sheets, each `{owner, paper, edge, water,
dryingScale}` (`water` the medium its water dries by; `owner` null for the root's), and each node's sheet;
`paintingSheetOrders` (`painting-sheet-program.ts`) gives each sheet's order, its layers with their films' pigment
slots, and its clock, the one order the checks, the diff and the solver read. A sheet's clock runs at its
`dryingScale` from the earliest start among its clocked washes, a direct one's too, and only once a clocked wet wash
paints it.

## Units

| Quantity | Unit | Range | Default |
|---|---|---|---|
| lengths, `diameterPx`, `reachPx`, `widthPx`, `maxSpreadPx`, `featurePx`, `amountPx` | paper px | > 0 | — |
| angles: `rotation`, `direction`, `bend` | radians, positive clockwise on screen | — | 0 |
| `water` (paint or water charge) | the wetness the brush raises paper toward; 1 is flooded | 0..1 | medium's `defaultWater`: 0.7 / 0.4 / none |
| mix `strength` | share of a full load | 0..1 | — |
| mix part `amount` | relative amount | ≥ 0, one positive | — |
| a full load | the medium's `body` in unit films (1 unit film = a full watercolour wash) | 1 / 20 / 15 | — |
| fill `load` | share of coverage laid | 0..1 (field allowed) | 1 |
| `opacityCap` (paint charges) | the most coverage an application's stamps build to, across its subpaths; it clamps what `load` lays | 0..1 | 1 |
| lift `strength` | share of liftable paint taken | 0..1 | — |
| resist `amount` | share of contact removed on peaks | 0..1 | — |
| `rim` | drying-line strength | 0..2 | 1 |
| `absorbency` | drinks water: a flooded wash dries in drying ÷ (0.5 + absorbency) model s | 0..1 | — |
| grain `scale`, `depth` | grain width ÷ document width; tooth depth | > 0; 0..1 | — |
| stroke `pressure`, point `scale` | share; share of the diameter | 0..1; > 0 | 1 |
| hand `fullProfileAt`, wobble `position` | brush diameters | ≥ 0 | 12; 0 |
| medium `spread` | brush diameters | — | 0.5 / 0.1 / 0 |
| medium `drying` | model s for a flooded wash at absorbency 0.5 | — | 240 / 120 / 1 |
| painting time | model seconds, from 0 at its sheet's start | ≥ 0 | — |
| clock `origin`, application `at`, `layersOf` `at`, `PaintMoment.at`, `warm` | scene seconds (`origin` may be `'set'`) | — | — |
| `dryingScale` (the document's, an own sheet's) | scene seconds per model second | > 0, `instant`, `never` | 1 |
| holds, boil `every` | animation frames at `camera.animationFps` | whole ≥ 1 | 24 fps |
| place `x`, `y`; rig pose `x`, `y`; boil `amount`, `scale` | document px | — | 0; 2.2, 45 |
| camera `pan` | `{x, y}` px as seen at depth 1 | — | 0 |
| plane `depth` | depth units, larger farther; 1 is where a pan is measured | > 0 | — |
| `lay` `{placement: {x, y, rotation, scale}, pivot}` | frame px, radians, factor; pivot in document px | — | identity |
| camera `fov`, lens `bloom`, `shutter` | vertical degrees; frame px sigma; seconds open | — | — |
| property `step` | the property's unit, a grid from `min` | > 0 | none |

## Media

| | Watercolour | Gouache | Crayon |
|---|---|---|---|
| Body (unit films per full load) | 1 | 20 | 15 |
| Lightens with | water (strength < 1 thins) | white (strength < 1 adds titanium white) | white wax |
| Paper contact | valleys; a dry brush skips below 0.85 of the tooth | valleys | peaks (tooth 0.85); burnish reaches valleys |
| Layering in one layer | mixes, pickup 0.5 | mixes, pickup 0.2 | stacks: trades past 4/3 loads, filling the valleys 60% there |
| Spread / drying / rewetting | 0.5 d / 240 s / 0.35 | 0.1 d / 120 s / 0.9 | 0 / — / 1 (an eraser) |
| Sheen shiny / damp | 0.7 / 0.35 | 0.4 / 0.35 | — |
| `on`, water, prewet, rim | yes | yes | refused |
| Lift | wet: free paint; dry: × 0.35; stain stays | dry: × 0.9; stain stays | eraser: all but 4% pressed |

- **Watercolour**: transparent; granulating pigments (ultramarine 0.9, burnt umber 0.8, cerulean 0.8) settle into
  the grain by load and the paper's depth. Staining pigments (phthalos 0.9, quinacridone rose 0.8) resist lifting.
- **Gouache**: opaque body colour; light over dark works. Weak mixes are tints with white, not thin washes, so fade
  gouache by `opacityCap` (coverage), not strength. It barely travels (spread 0.1) and redissolves when lifted dry
  (0.9). A gouache layer over set watercolour covers by scatter.
- **Crayon**: no water and no wet history: every crayon wash says `wetHistory: false`. `burnish: true` on a paint
  charge presses wax into every valley. Crossing layers stack in the tooth. An eraser is a lift. Wax resists a later
  watercolour wash only where written: give that wash's applications `resists` with the crayon strokes as footprints.
  Unwritten, the wash glazes over the wax.
- **Ink**: no ink medium. Waterproof ink is line work in a direct wash (`wetHistory: false`, in any medium), a dark
  mix at strength 1, a fine brush; nothing later moves or lifts it. Put it in a layer below transparent washes, which
  glaze over it, and above opaque body colour, which would hide it. Ink that bleeds when rewet can't be written; fresh
  ink walking into a wet wash is a wet paint application on that sheet, landing while the wash is open.
- **Hex parts**: a hex is fitted as a pigment of its own, with no habits: a full load over white reads that colour in
  watercolour, and it is the masstone in gouache and crayon.

Any brush paints in any medium. A dry-media brush lands by the dry law even in a wet wash and refuses stated water;
crayon refuses water whatever the brush, and a direct wash takes none by type. One sheet has one grain: a picture
mixing media on one paper picks one tooth. One sheet has one water too (**NEW**): it dries by the medium of the node
that declared the sheet (the document's, for the root), and `on` reads that medium's sheen. A gouache layer on the
root's watercolour sheet lands into watercolour water, while its own paint walks by gouache's spread. A wet wash on a
sheet a crayon node declared is refused: crayon keeps no wet history.

## Time

| Clock | Unit | Owner | Read by |
|---|---|---|---|
| painting time | model seconds, 0 at its sheet's start | the sheet | `on`, drying, workability |
| scene time | scene seconds | the scene | clocks, `at`, plays, `PaintMoment.at` |
| animation grid | frames at `camera.animationFps` (24) | the scene | holds, boil, plays' holds |

- **Unclocked wash**: scheduled in painting time like any other, so its `on`s hold as they would; `at` is refused by
  type. A sheet's unclocked work is painted before any clock starts, in document order. Always shown finished; a
  sample time changes nothing.
- **Clocked wash** (**NEW**): `clock: {origin}`. Its sheet keeps one clock, running at the sheet's `dryingScale`: the
  document's for the root, an own sheet's for that sheet, 1 when left out. An own sheet never takes another sheet's
  scale, and a `scene` sheet is the root's, scale and all. No wash sets a scale, so every clocked wash on a sheet
  runs at one rate. The clock starts with the sheet's clocked wet work, at the earliest `origin`, the moment its
  unclocked work is painted; from there a model second takes `dryingScale` scene seconds. A scale alone times
  nothing: a wash without `clock` is unclocked on any sheet, and a sheet with no clocked wet wash dries in model time
  whatever its scale. A wash's `origin` is the earliest its first application lands: if earlier work on the sheet
  waits past it, the wash starts then, and its scene times say so. Nothing of the wash shows before its first
  application's scene time. Its prewet lands at its start, before its first application's `on` is judged.
  - `dryingScale` = scene seconds wanted ÷ model seconds needed. Model seconds to dry from w0 to w1 =
    (w0 − w1) × drying ÷ (0.5 + absorbency). A 0.85 flood to damp, watercolour, absorbency 0.5: 120 model s; to see
    that in 3 scene s, give the sheet `dryingScale: 0.025`, and its damp window runs from scene 3 s to 5.1 s.
  - A shown step is finished, so the scale doesn't change how a step looks. It changes when each application lands
    in scene time, which gates hold, the wetness each landing meets (how far a charge walks, a bloom's reach, the rim)
    and when the wash shows set.
  - A negative `origin` ages the sheet: −age × dryingScale opens the shot `age` model s in, and whatever landed before
    scene 0 shows finished from the first frame. A 0.9 flood on a sheet at 0.025 with origin −3.25 s is 130 model s
    old at scene 0, and damp from scene 0.05 s.
  - `origin: 'set'` starts the wash when every earlier clocked wash of its layer has set, found at solve and printed
    by `studio paint check --solve`. A fixed `at` stays an absolute scene second, checked at solve.
  - `dryingScale: 'instant'`: the first application lands at the start, each untimed one at its predecessor's scene
    time. Each application runs wet within itself, then the whole sheet sets before the next lands, so `on: 'dry'`
    holds at once and `wet`, `damp` and blooms over earlier paint are unreachable. A wash's prewet sets before its
    first application too. A wash sets at its last application's scene time.
  - `dryingScale: 'never'`: nothing on the sheet dries. Wetness stays where applications leave it: `wet` holds where
    it's above shiny, `damp` where it's at or below damp and above 0, `dry` only where no water landed. Paint stays
    open (Techniques: blooms). That includes the sheet's unclocked work, so on such a sheet no layer can start a wash
    after a wet one.
  - Under `instant` and `never`, `at` sets the scene time only.
- **Fixed `at`** (clocked washes only): never moves; must not precede its predecessor or the wash's start; its `on`,
  if any, must hold there, at whatever pose the frame gives. Two applications may share one `at`: they land in
  document order.
- **Direct washes** (`wetHistory: false`, crayon's only kind) may take `clock: {origin}`, so a drawing appears stroke
  by stroke at fixed `at`s; `on` is refused. A direct application neither reads nor writes water, so the sheet's
  scale never changes how it looks, and a direct wash can't choose it. On a numeric clock, the time between its
  strokes still dries the water already on the sheet.
- **Scheduling** is forward: applications in the sheet's order, each at the earliest time at or after its predecessor
  where its `on` holds, judged against the simulated field. Earlier decisions are never revisited. The step is 1 ms
  of model time and the field is read per paper px (**NEW**). The sheet is one painter: an application waiting on
  `on` holds back everything after it in the order; to let other work land meanwhile, fix the waiting application's
  `at`, which orders it by that time.
- **Washes in one layer**: an unclocked wash may come before a clocked one, which meets it set. After a clocked wash,
  a wash must be clocked and start once it has set (`origin: 'set'` does that), building on the whole earlier wash.
  On a sheet whose clock is `never`, no wash can start after a wet wash of its layer.
- **Across layers** (**NEW**): layers on one sheet share its order and water. Their clocked washes interleave by
  time: a later layer's application at 2 s lands before an earlier layer's at 3 s, into whatever is wet. To have a
  layer meet another dry, start it once the other has set (`studio paint check --solve` prints set times) or give
  its first application `on: 'dry'`. A layer boundary dries nothing.
- **Showing a wash partway**: a selection's `at` shows its sheet's clocked applications scheduled at or before it,
  every layer's film finished there: `layersOf(p, ['landscape'], { at: moment.at })`. Each step shows dry while the
  next still lands into the wet history. Each distinct prefix is one solve; a plane's `sourceClock: { hold }` bounds how many.
  A held moment floors to its hold's grid: on threes, frames 0, 1 and 2 all show frame 0.
- **Warming**: `warm: {from, to}` on the shot solves the films of the render frames from `from` to `to` (at the
  composition's fps), and of the moments they sample, before the first frame: prefixes, poses, property values,
  dissolve levels. It reports what it solved and kept, and promises no residency: a span whose films outgrow the
  cache's budget evicts its beginning, and those frames solve again. Warm spans that fit.
- **A drop landing in a wash** at a scene second: a timed water application on that wash's sheet with `at` (a bloom,
  if wanted), in the wash or a clocked layer of its own on that sheet, then its paint as the next application without
  `on`, so the bloom's label still checks water alone. A bloom rewets its footprint, so a later `damp` landing
  overlapping it waits or fails.

### Cues and painting time

A document's times (`origin`, `at`) are the seconds its selections' `at` counts: scene seconds when a plane passes
`moment.at`. Tying a painting to the video's timeline is one of two things, and they do different work.

**Land paint on a cue.** Fix the application's `at` from the project's timeline. `timeline.ts` resolves every
scene's cues, and `sceneCueSeconds` gives one scene's in seconds of its `t`. A painting source imports it from
models, not `#studio`, so it still loads in plain Node for `studio paint check`. A timed version of the meadow's sky
(its constants as in `meadow.painting.ts`), its treeline charging in on the scene's `trees` cue:

```ts
import { sceneCueSeconds } from '#lib/timing/timeline/models/scene-cue-seconds.ts';
import { timeline } from '../timeline.ts';

/** The meadow scene's cues, in seconds of its `t`. */
const CUE = sceneCueSeconds(timeline.clock('meadow'));

/** On the root's sheet, which the document gives `dryingScale: 0.1`: the flood shines until scene 3.6 s. */
const SKY_WASH: Wash = {
  key: 'sky',
  clock: { origin: 0 },
  applications: [
    {
      key: 'sky-flood', kind: 'fill', area: { region: { kind: 'polygon', rings: [SKY] } },
      brush: EVEN, diameterPx: 90, seed: 'sky-flood', charge: { kind: 'paint', mix: SKY_BLUE, water: 0.85 },
    },
    {
      key: 'treeline', at: CUE.trees, on: 'wet', kind: 'stroke', subpaths: [TREELINE], clips: [IN_SKY],
      brush: CHARGE, diameterPx: 26, seed: 'treeline', charge: { kind: 'paint', mix: EARTH, water: 0.6 },
    },
  ],
};
```

Moving the cue in `timeline.ts` moves the treeline's landing, and so what it meets: a later cue finds the sky less
wet, or, past 3.6 s, refuses `on: 'wet'` at solve. `studio paint check <source> --solve` prints every landing's
scene time, so a scene can check it against its cues.

**Play a painting at another pace.** The selection's `at` is the painting's own time, so a scene maps its time into
it: `layersOf(p, ['landscape'], { at: (moment.at - CUE.paint) * 2 })` starts the painting on the `paint` cue and shows
it twice as fast. That retimes playback only: every prefix is the same solve, with the same wet interactions, shown at
another moment. To change what the water does (a charge meeting the sky wetter or drier), change the document's
times or its `dryingScale`, which re-solves.

## What changes, what runs, what it costs

| You change | Mechanism | Cost |
|---|---|---|
| a property value | factory runs; each sheet re-solves from its first changed application | evaluation, plus a solve from there through the end of that sheet's order |
| one wash's applications or mixes | its sheet re-solves from the first changed application | earlier applications on the sheet and other sheets hit the cache |
| a pigment new to a layer | the layer's film layout changes | its layer's history and everything after it on the sheet re-solve |
| a layer's `sheet` or `medium` | the sheets it leaves and joins re-solve from its first application | solves |
| `layersOf` `at` crossing an application | a new prefix of the sheet's clocked work | one solve per prefix, cached |
| a plane's `lay`, depth, camera, lens, an occurrence's visibility | composite only | per frame, no solve |
| motion plays, pins, sway, flutter, rig pose on a sheet the occurrence owns | the finished film warps or bends | per frame, no solve |
| the same on a sheet it doesn't own | its marks move; its sheet re-solves from its first application, scheduling again there | a solve per distinct pose of it and everything after it on the sheet, cached; holds set the rate |
| marks `boil` (wobble) | warp by a displacement map per epoch | per frame, no solve |
| marks `boil` with `reseed` | re-placed and repainted | a solve per epoch |
| `dissolve` `k` | two cached films blended | per frame, no solve |
| a path mask's `revealPx` | mask only | per frame, no solve |
| instance count or poses | draws of shared films | per frame, no solve |
| a hold | fewer distinct moments | divides all of the above per second |

A solve is the expensive step: placing stamps and running a sheet's wet stages on the GPU. Its cost grows with the
stamps laid; nothing caps the marks in an application. A moving element repaints everything after it in its sheet's
order at each pose: put moving elements late in the document (in front), or on own sheets. Quantise properties with
`step` and hold planes so each distinct value is reused, and warm the span a scene plays. A hundred timed
applications are a hundred prefixes if a scene shows each: hold the plane, or show fewer steps. `studio paint diff`
shows what a property step re-solves; the cost report counts what each frame and warmed span solved:
`studio profile <project> --frames a:b --costs` tables it frame by frame, a run of frames costing alike as one line.

## Recipes

| # | Look | Write | Watch for |
|---|---|---|---|
| 1 | graded sky | a flood whose `mix` is a field: `{kind: 'linear', from: {x, y, value: ZENITH}, to: {x, y, value: HORIZON}}` | grades pigment amounts, never colour; more stops are more applications |
| 2 | wet-in-wet charge | flood at water 0.85+ with an even brush (watercolour's `detail`), then an application `on: 'wet'` of paint strokes | its core on the flood's full contact |
| 3 | bloom | after the flood, `{effect: 'bloom', on: 'damp'}` water stamps, water 1 | needs surplus > 0.08 over open paint; under `never`, `on: 'wet'` |
| 4 | backrun | `{effect: 'bloom', on: 'damp'}`: one water stroke along the junction | both sides must be damp at once; `on: 'wet'` gives softer scallops |
| 5 | soften one edge | a water stroke, water 0.3, along the edge, `on: 'wet'` | write it before anything waits for `dry` |
| 6 | lost edge | the fill's area `edge: {kind: 'bleed', reachPx: 40}` | past the ramp it needs water already there |
| 7 | crisp top, lost bottom | area with `boundaries: [{path, edge: {kind: 'bleed', reachPx: 30}}]`; a water stroke along it first for a wetter loss | every path point within 1 px of the outline |
| 8 | lifted clouds | lift stamps, strength 0.8, over the sky flood: `on: 'wet'` soft and running back, `on: 'damp'` crisper | staining pigments leave a ghost |
| 9 | scrubbed highlight | a lift application `on: 'dry'` | watercolour takes 35% of set paint per pass; gouache 90% |
| 10 | white sparkles | `reserves: SPARKLES` (stamp footprints) on each of the sea's applications | on a cut-out, a reserve holes the card to what's behind where no paint of the sheet landed |
| 11 | wax resist | crayon layer, then `resists: [{footprints: SAME_STROKES, amount: 0.8}]` on the wash's applications | white candle: the resist alone, no crayon layer |
| 12 | true glaze | the glaze in its own layer after the base layer, its first application `on: 'dry'` | without `on: 'dry'` it lands into the base's water and mingles; within one layer it mixes instead |
| 13 | body colour hiding a wash | a gouache layer on `sheet: {kind: 'own', paper: SAME_PAPER}` | weak gouache mixes are tints |
| 14 | dry brush | a style's dry brush (`{style: 'watercolor', brush: 'dry'}`) in a watercolour layer | dry brushes refuse stated water |
| 15 | granulation | ultramarine or burnt umber, a strong load, paper grain depth ≥ 0.3 | settle follows pigment, load and depth |
| 16 | soaked ground | wash `prewet: {region, water: 0.9}` then paint | laid at the wash's start; no texture; `reserves` keep it off |
| 17 | pen and wash | ink layer first, a direct wash, a fine brush, dark mix strength 1; washes in a later layer | the ink never moves |
| 18 | crayon pressed hard | paint charge `burnish: true` | crayon layers only |
| 19 | hill hiding a far range | the far range's applications take `reserves: [NEAR_HILL]` | inset the shape by the overlap you want |
| 20 | sponge-out through what's behind | a lift wash added to the layer behind | lifts never cross layers |
| 21 | wash painted on screen | clocked wash on a sheet at a `dryingScale`; plane source `(m) => layersOf(p, keys, {at: m.at})`; `sourceClock: {hold: 2}`; `warm: {from, to}` | each step shows dry; dissolve between prefixes to smooth the jump |
| 22 | a raindrop joining a puddle | on the puddle's sheet (its wash, or a clocked layer of the drop's own, at the sheet's one `dryingScale`), the drop's water stamp `at` its landing, then its paint with no `on` | a falling drop on another plane never joins by overlap |
| 23 | falling rain | an instanced plane: drop variants, `instances(m)` placing each under a lasting key | finished paint moving: no wet interaction; each drop blurs along its own fall |
| 24 | collage cut-out sliding | the layer with `sheet: {kind: 'own', paper}`; motion on its occurrence | its grain travels with it, as paper does |
| 25 | paint drifting over still paper | the layer left on its parent's sheet; motion on its occurrence, held | a solve per distinct pose, from its first application on |
| 26 | handwriting reveal | `masks: [{kind: 'path', subpaths, widthPx: 14, revealPx: (m) => …}]` | `widthPx` is the band's full width; pen-ups add no length; the ground stays; a cut-out's paper follows its masked paint |
| 27 | animated property, smooth | `bracket(v, LEVELS)` → `dissolve(layersOf(lower), layersOf(upper), k)` | ghosting where edges move between levels |
| 28 | one painting, two places | two planes selecting the same evaluation and layers | each is its own occurrence |
| 29 | a drawing appearing stroke by stroke | a direct wash with `clock: {origin}` and an `at` per application, on any sheet: a direct wash has no say in its drying | or a path mask over the finished drawing |
| 30 | an element fading | `visibility: {'plane/layer': (m) => …}` on the shot | a group's visibility fades it as one |
| 31 | an element passing behind a ridge on shared paper | its applications' `clips: [{region: ABOVE_RIDGE, anchor: 'paper'}]`; motion on its occurrence | the clip stays on the paper while the element moves |
| 32 | an element mingling with a wet wash as it moves | its layer on the wash's sheet (left out, or `scene` under an own sheet), posed by motion or a rig; its charge timed while the wash is wet (`at`, or `on: 'wet'`), later work `at` once it has set | a solve per pose from its first application; hiding it leaves its water's work in the wash: fade a group holding both |
| 33 | a figure that bends | its parts as layers (or groups) under one group; `rigs: {'plane/figure': {parts, pose}}` | on an own sheet the paint bends; on shared paper it's repainted per pose, into the sheet's water |

Recipe 27 in full, as a plane of the worked example's scene (imports as there, plus `bracket`, `dissolve` and
`type PlaneProps` from `#studio`):

```tsx
/** Solved levels, px: five solves, then every frame is a blend of two of them. */
const LEVELS = [180, 200, 220, 240, 260];
const hillTopSmooth = (t: number) => 260 - 80 * Math.min(1, Math.max(0, (t - 1) / 3));
const smoothPlane: PlaneProps = {
  id: 'meadow',
  depth: 1,
  source: (moment) => {
    const { lower, upper, k } = bracket(hillTopSmooth(moment.at), LEVELS);
    return dissolve(landscapeAt(lower), landscapeAt(upper), k);
  },
};
```

## Composition

The camera's stage frame is the canvas's pixels. `<PaintedShot>` is an element the frame's size, one CSS px a frame
px, scaled to fill `box` (composition px; the whole composition when left out); its HTML children are laid out in
frame px. At rest, a plane's document px are frame px at any depth; depth only tells as the camera moves
(Reference). A stage px is measured from the frame's top-left; the margin lies at negative px and past the frame. A
plane's paint must cover what the camera shows of it: the camera build reports any shortfall.

| Concept | How | Notes |
|---|---|---|
| plane | `PlaneProps {id, depth, source, lay?, clock?, sourceClock?, masks?, canvas?}` | farther first; equal depths keep written order |
| back and nearer planes | the farthest non-instanced plane is the back, fixed at load: painted on paper, or a picture held everywhere; over HTML, a clear back (below). Nearer painted planes are clear film; picture and three planes lay premultiplied over what's behind | across painted planes: the white/black approximation `C + T × behind`, so a strong coloured glaze over coloured paint reads light. Nearer paint keeps its own grain (Sheets) |
| ground | a selection's `ground`: paper on the back, transparent elsewhere, when left out | the back is opaque, hiding HTML before the first canvas; on paper, a back smaller than the frame still covers it, the paper running on past the document, mirrored. With HTML behind the first canvas inside the `<PaintedShot>` (text, a laid-out element, or a background on a wrapper holding the canvas), the back may be clear (**NEW**): a transparent ground, a picture held less than everywhere, or a three plane, any size, laid as a nearer plane is, its canvas handing the browser premultiplied RGBA as a later one does. A transparent back without HTML behind is refused. The page is read again as each frame draws, so the HTML behind a clear back stays mounted while the shot draws: a frame with none behind it fails |
| selection | `layersOf(evaluation, keys, {ground?, at?})` | layer or group keys; groups include their descendants; composed in document order; an own sheet's layers with their owner, on one plane |
| occurrence | `<plane id>/<layer or group key>`, at any depth of the tree | the same layer on two planes is two occurrences; a plane's occurrences are fixed by its first evaluation and checked each frame |
| motion | `motion {nodes, plays}`: `OccurrenceMotionNode`s and the animation feature's plays; node ids are occurrence keys | a node's parent is its enclosing group's node, else its plane. A group's node takes all a layer's does, with one phase, seed and map for everything it holds |
| visibility | `visibility: {[occurrence]: 0..1 or (m) => …}` | multiplies the occurrence's composite; a group's fades all it holds, its own sheet's paper included, as one. A layer's fades its own film: what its water did to other layers' paint on the sheet stays (Sheets). Inside a rig drawn as pieces, a layer or group shows (1) or doesn't (0): fade the rigged group whole |
| glow, boil, pins, sway, flutter, place | node fields and plays (Reference) | move finished paint on a sheet the occurrence owns, its marks before painting otherwise (Sheets); boil wobble moves finished paint either way. Boil wobble and sway phase follow the occurrence key |
| rig | `rigs: {[group occurrence]: {parts, pose}}` (Reference) | a rigged node takes place, clock, glow and boil, not pins, sway or flutter. On a sheet the group or a cel owns, paint, paper and edge bend as pieces (**NEW** in shots); otherwise the cels' marks are posed before painting (**NEW**) |
| moving lay | `lay: (m) => …`, `reach?` (the stage box it stays in) | without `reach` the camera checks it as reaching everywhere |
| pin to HTML | `lay: {kind: 'pin', points: [{sourcePx, element: 'title'}], at?}`, one point or two, on a painted plane; the element is the one inside the `<PaintedShot>` with `data-pin="title"` | one moves the plane; two also scale and turn it. A name, not a ref, so a pinned shot stays a module constant. Each element's centre is measured in frame px as each frame draws, once fonts and layout are settled, and again when a pinned element resizes; the camera's reach check runs there (**NEW**). A frame whose element isn't mounted, or whose name two elements carry, fails. An element moved without a re-render or a resize (a sibling's image loading) is seen at the next frame |
| cover the frame | `lay: {kind: 'cover', box, at?}`, on a painted plane | centres the box where the frame's centre lies and scales it about its centre, unturned, until it holds the frame's corners, through the shot's own camera at `at` (**NEW**). A rolled camera grows the box to hold its turned frame. Laid once as the shot loads, and checked there as a pin is each frame |
| hold | plane `clock: {hold: n}` holds its presentation and motion: its lay, visibility and rig poses, and its nodes' plays; `sourceClock: {hold: n}` holds what `source` reads (its prefix, property values, dissolve weights) | each callback reads its clock's held moment, floored to the hold's grid. Both start from the frame's moment; neither holds the other's. The camera still moves through the shutter |
| masks | `path` (a band `widthPx` wide in all, round ends, `softPx` 0 or a ramp that far inside its edge; `revealPx` 0 shows nothing, `shotPathInkedLength(subpaths)` all of it), `alphaOf` (another drawable's coverage, partial alpha included, where it lies this frame: a plane by id, any kind, or a painted plane's occurrence; an instanced plane's items are read through their plane) | both **NEW**, on painted planes only. They cut the plane's paint and the own-sheet paper it shapes; the ground stays whole. To leave a layer unmasked, put it on a second plane at the same depth. No mask reads its own plane, through any chain |
| instances | `{kind: 'instanced', depths: {near, far}, variants, instances(m), reach?}` | each item lays its variant as a plane at its depth (`lay` from the variant's document px; clear outside its paint), depth-sorted with every drawable, planes first on ties, all nearer than the back. A key is one item's lifetime: the same key at the shutter's two ends blurs the item along its own travel; a key missing at either end draws it unblurred; a recycled item takes a new key. Items take no motion nodes (**NEW**) |
| dissolve | `dissolve(a, b, k)`, nestable | blends the two pictures in the plane's own form (the back's opaque colour, a nearer plane's colour and transmittance, premultiplied RGBA on a later canvas), never their pigment; its occurrences are both sides', moved alike; no rigs inside (**NEW**) |
| three.js | `{kind: 'three', build}`; `paintedTextures: [{id, source, widthPx, heightPx}]` on the shot | the three-layers feature's: posed at each moment (once at 0 as it loads), and may draw offscreen passes (a reflection, a ground) before its scene; it reads painted textures by id (Painted textures) |
| picture | `{kind: 'picture', extent, pictureAt}` | a `StampPlaneSource`'s: premultiplied, its `box` in stage texels (the margin included), never mutated once handed over; return the same object while it's still |
| HTML among canvases | `<PaintedShot>` children: HTML and `<PaintedShotCanvas name="…"/>`, stacked in DOM order | one device shared; every canvas is the whole frame, clear where nothing is painted, taking no pointer events. When any exists, every plane names one and several may share one; the back's is the first, and a later canvas holds only planes nearer than an earlier's (**NEW**). A canvas is positioned, so it paints over HTML that isn't, whatever their order: position HTML meant to lie over a canvas (`AbsoluteFill`, `position: 'relative'`). Canvases are fixed to the shot's element, so one nested in positioned wrappers still fills the frame; a transformed, filtered or contained wrapper between them (a transform that changes nothing yet included) is refused as the shot loads and at any frame it appears. A later canvas's paint over HTML is a glaze with α = 1 − luminance(T): exact within the canvas, a coloured glaze over HTML darkening toward grey |

`PaintedShot` loads when its `shot` prop's identity changes: keep `PaintedShotProps` a module constant or memoised.
Rules that keep it cheap and correct: presentation never adds paint; warps of finished paint can't reveal paint that
was never laid; paint on separate sheets or planes never joins another's wet history by overlapping it, while layers
on one sheet share it; presentation of one layer acts on its own film, never on what its water did to others.

### Painted textures

A three.js object wears a painting through the shot's `paintedTextures`: each `{id, source, widthPx, heightPx}`,
its `source` any plane's painted source (`layersOf`, `bracket`, `dissolve`, or a callback of the moment). A texture
is the selection laid on its paintings' paper at their document size, then resampled to `widthPx` × `heightPx`;
match the two unless the object shows it smaller. It is opaque, so its selections stay on paper (no `ground:
'transparent'`). A dissolve blends opaque colour in linear light, as a back plane's does. A build reads one by id:

```ts
build: ({ plane, textures }) => {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = paintedThreeColorNode(textures.get('label')!);
  …
}
```

`paintedThreeColorNode` (`#lib/paint/three-layers/studio/painted-three-material.ts`) decodes the texture, which is
gamma-encoded, to the linear colour three.js lights and outputs. Its u runs along the document's x and its v up the
mesh, so uv (0, 0) is the painting's bottom left. A texture repeats along each axis its paintings wrap (Wrapping):
`'x'` across u, so on a `CylinderGeometry`, whose u runs once round, no seam shows; `'y'` along v; `'xy'` both, so a
`PlaneGeometry` whose uv run past 1 shows it tiled with no seam. Every painting a texture blends wraps alike. A
texture is drawn again only when its selections or their weights change, so a still selection costs one solve. It
has no mipmaps: an object showing it far smaller than its size shimmers as it moves.

## Reference

The engine's shapes the types import, with their units and defaults.

**Pigments** (`WATERCOLOUR_PIGMENTS`, any medium; granulation g, flocculation f, staining s, 0..1): `ultramarine` g 0.9
f 0.35; `phthaloBlue` s 0.9; `cerulean` g 0.8 f 0.2; `phthaloGreen` s 0.9; `hansaYellow` s 0.5; `yellowOchre` g 0.3;
`quinacridoneRose` s 0.8; `cadmiumRed` g 0.15; `burntSienna` g 0.4 s 0.3; `burntUmber` g 0.8 f 0.25 s 0.3.
`TITANIUM_WHITE` (`#lib/paint/materials/models/paint-medium.ts`) mixes as a pigment too.

**Brushes**, by style. Wet brushes lay by the wet law in a wet wash; dry ones by the dry law anywhere. "Pressure"
is what a stroke point's pressure moves (crayon's medium also decides how pressure meets the tooth).

| Style | Brush | Lays | For | Pressure |
|---|---|---|---|---|
| `watercolor` | `wash` | wet | a lightly textured body with soft ends: floods nothing waits on, as its texture lands water in flecks | size, opacity, flow |
| | `filler` | wet | a big, open, mottled glaze that keeps paper showing | size, opacity, flow |
| | `wet` | wet | cloudy wet-in-wet with soft edges; sky bands melting together | size, opacity, flow |
| | `blend` | wet | a soft, feathered wash | size, opacity, flow |
| | `roughEdge` | wet | a dense body with a broken, granulated edge: hair, a pine | size, opacity, flow |
| | `shadow`, `charge` | wet | a round wash pooling at its rim; the round tip for a disc; touches dropped into a wet wash | size, flow |
| | `dry` | dry | bristle streaks following the stroke | size, opacity, flow |
| | `pigment` | wet | granulating veins, a texture pass near the base colour | size, opacity, flow |
| | `crystals` | wet | salt crystallisation as a band, for a pass clipped to a shape | size |
| | `stains` | wet | a bloom with a dark pooled edge | size, opacity, flow |
| | `blotch` | wet | a cauliflower bloom with a dense heart, as placed stamps | size, opacity, flow |
| | `splashes` | wet | clean round drops of mixed size | size, opacity, flow |
| | `pencil` | dry | a grainy, broken line | size, flow |
| | `ink` | wet | a crisp, opaque, tapered line: dark accents, birds | size, flow |
| | `detail` | wet | a smooth tapered line holding at 4–12 px; laid big, the even flood later work waits on | size, opacity, flow |
| `gouache` | `wash` | wet | a smooth body for floods: a toned ground, each element's flat block | size |
| | `flat` | wet | a broad flat over a block: shade, cloth lights | size |
| | `thick` | wet | dense and opaque, a crisp edge | size, flow |
| | `round` | wet | shadows, folds, the core | size, flow |
| | `bristly` | wet | bristle marks inside the stroke | size |
| | `dab` | wet | a short round dab: small lights, glints | size |
| | `dry` | dry | breaks over paper and paint: a scumble | — |
| | `detail` | wet | a fine opaque line: stems, lip lights | size, opacity, flow |
| `crayon` | `stick` | dry | a hard stick's point: hatching, crisp grainy marks | size |
| | `side` | dry | a stick on its side: broad grainy zigzags, a first layer | size, flow |
| | `tooth` | dry | a soft stick leaving the tooth bare: a scumbled ground | size, opacity, flow |
| | `conte` | dry | waxy and dense: small solid darks | — |
| | `chalk` | dry | a rough, broken chalky mark for texture | size, opacity, flow |
| | `pencil` | dry | a grainy graphite outline | size, flow |
| | `eraser` | dry | a lift rubbing a soft light back toward the paper | size, flow |

**Papers**: each of those styles' `vvds` pack holds `papers/vvds-watercolor-canvas-1.png` … `-4.png`, each with a
`.grain.png`; name them `{style, pack: 'vvds', file}`. The styles paint on canvas-3: grain depth 0.35 (watercolor),
0.2 (gouache), 1 (crayon). `image` is a photograph laid under the painting; `grain` is the tooth. A cut-out's scale
scales its paper's grain with it.

**Fields** (`Field<T>`, document px): `{kind: 'constant', value}`; `{kind: 'linear', from: {x, y, value}, to: {x, y,
value}}`, held at its ends past them; `{kind: 'radial', center, radius, inner, outer}`, linear in distance from
`inner` at the centre to `outer` at `radius` and beyond; `{kind: 'noise', scale, seed, a, b}`, features about `scale`
px across, reaching nearly both ends. A field of mixes grades each pigment's amount (share × strength): its ends may
name different pigments in any order, a missing one being 0, and an amount may be 0.

**Hand** (`StampStrokeHand`): `profile`: `'taper'` (light, firm, light), `'pressFlick'` (pressed, then flicked off),
`'swell'` (thin, full, thin), `'drag'` (steady, lifting over its last fifth), or a curve `(u) => pressure` over the
application's whole length, gaps included; left out, flat at full pressure, so each point's own pressure shapes the
stroke. `fullProfileAt` diameters before a stroke gets its profile's full depth (12); `curvature` 0..1, how much a
long straight run lightens; `wobble: {pressure 0..1, position diameters}`. A stroke's paint spans about
`diameterPx` × `scale`, times the size its brush binds to pressure, edge to edge; a textured tip is ragged inside
that, and wobble `position` moves the line by up to that many diameters. A curve is the document's one function: the
diff compares it by identity, so define it once at module level.

**Stamps** (`{kind: 'stamps', placements}`, each a `StampPlacement`): `{x, y, diameter?, rotation?, pressure?}`,
`diameter` px (the application's when left out), `rotation` turning the tip's shape.

**Fills**: a wet brush floods in strokes `diameterPx` wide round the outline and in rows across, so the diameter sets
how far its paint walks, the rim's band, the cost, and the narrowest part it reaches into; a dry one lays `strokes`.
`laying: {kind: 'flood', reach?}` or `{kind: 'strokes', pattern, spacing?, variation?, hand?, reach?}`. `pattern` is an
object: `{kind: 'backAndForth' | 'zigzag' | 'shading', turns?: 'eased' | 'pressed'}` (how it turns back), `{kind:
'hatch'}`, `{kind: 'crossHatch'}`, `{kind: 'scribble'}`, `{kind: 'contour'}`, or `{kind: 'guided', guides: [{id,
path}]}`. `spacing` diameters between rows (the pattern's own); `variation` 0..1 (0.3); `reach`: `'inside'` (marks'
edges meet the outline; the default) or `{past: n}` diameters beyond it, for a clip to trim. A flood's tip breaks
along its outline, leaving a few bare specks rimmed with paint: a wash meant to reach the paper's edge runs its outline
past it (the meadow's, 30 px), so they fall off the paper.

**Lay**: a point p of the document lands at `pivot + (x, y) + R(rotation) · scale · (p − pivot)` frame px, then the
camera shows its plane. No mirror: scale is positive. A box (`reach`, `cover`) is `{x0, y0, x1, y1}`.

**Camera** (`PaintCameraOptions` without `planes`): `stage: stampStage(frame, margin)`, margin whole and even; at least
2, more for defocus or a moving lay's reach. `fov` vertical degrees. `lens: {bloom, shutter}`: bloom sigma frame px,
shutter seconds open. `animationFps` (24). `plays` is required: `[]` for a still camera, else
`[paintCameraPlay(clip, {clock, origin})]`, `origin` naming the play in errors. A `move` clip's keys `{at, pan?,
dolly?, zoom?, roll?, ease?}`: `at` clip s; `pan` `{x, y}` px as seen at depth 1; `dolly` depth units toward the planes;
`zoom` 1 at rest; `roll` radians; a field left out is at rest; `ease` (`'linear'`, `'in'`, `'out'`, `'inOut'`) on the
key it eases into. A `focus` clip's keys `{at, focus, aperture, ease?}`: `focus` the depth held sharp; `aperture`
frame px of blur sigma at infinite depth. A plane at depth d shows scaled zoom · d ÷ (d − dolly) about the frame
centre, shifted by −pan · zoom ÷ (d − dolly), turned by −roll. A pan moves a far plane less: give it a document wider
than the frame by the pan ÷ d it travels, placed with `lay`.

**Motion nodes** (`OccurrenceMotionNode`: `PaintMotionNode` without `parent` or `live` marks): `{id, pivot?, pins?,
marks?, clock?, glow?}`. `pivot` document px (the origin); `marks`: `'stuck'` (default), `{boil: {every, amount?,
scale?, reseed?}}` (every n frames; wobble `amount` px (2.2) at feature `scale` px (45), document px; no pivot
needed); `clock`: `{hold: n}` frames or `{freeze: s}`, inside its plane's; `glow: {amount, threshold}` (emission ×
amount where laid paint is brighter than threshold, linear light). Pins: `PaintPinRig`. Marks laid anew at each pose:
pose the layer on a sheet it doesn't own.

**Plays** (`paintMotionPlay(node, clip, {clock, origin})`): clock `{at, rate?, loop?: {period, mode?: 'repeat' |
'pingpong', times?}, hold?, until?}` or `{at, freeze}`; `at` scene s, the rest clip s or frames. Clips: `place`
`{keys: [{at, x, y, rotation?, scale?, ease?}]}` (rigid, about the node's pivot, x and y document px); `poses` `{keys:
[{at, pose: {pin: {x?, y?, rotation?, scale?}}, ease?}]}`; `breathe {pin, amount, period}`; `sway {root, direction,
length, amount, period}` (direction radians, −π/2 up; length px to the tip; amount px of tip travel; period s);
`flutter {at, direction, least, period}`.

**Rigs** (`OccurrenceRig`, on a group occurrence): `parts`, each a `PaintRigCutDeclaration` with its `cels`: `{id, z,
parent: null, cels}`, `{id, z, parent, joint: 'skin', pivot, blend, cels}` or `{id, z, parent, joint: 'hinge', pivot,
cels}`. Every layer under the group lies in exactly one part's cels; a cel is a layer, or a group (a line and its wash
as one part). Paint each part whole on its cels, running under its neighbours where a joint turns: a texel shows the
cel giving it most colour. Parts draw by `z`, document order breaking ties. Across a skin joint the two parts' moves
blend over `blend` px, so the joint bends as an arc keeping the limb's width; a hinge turns rigidly. Chains nest to
any depth. `pose` names parts by id: `{x?, y?, rotation?, bend?, cel?}`, a move in document px and a turn in radians
in its parent's frame about its pivot (a root's, the group node's pivot); `bend` curls the part along the line from
its pivot to its farthest paint at rest; `cel` shows another of its cels. Parts left out rest on their first cel.
Views (whole-body drawings a joint can't reach) are groups switched by `visibility`. Every cel and view is painted,
shown or not, into its sheet's water: one painted while another is wet mingles with it, and stays mingled when that
one is hidden. To paint each apart, give each later cel's or view's first application `on: 'dry'`. A hidden cel
stays in its sheet's program, only not laid, so a swap re-solves nothing. The pose is read at the node's held
moment (its own hold, else its plane's). Boil wobbles finished paint: on an own sheet, the rest picture before the
rig bends it; on shared paper, the posed film. No mirrors.

## Checking and diagnostics

`studio paint check <source> [--set name=value,…]` evaluates a source at its defaults, or at the values `--set`
gives, each held to its schema like any other (an off-step value is an error), and prints every problem it finds
without the GPU, one a line: `<owner>.<field>: <message> [x0,y0 → x1,y1]`, the box (document px) of the geometry the
problem is about, grown by half its brush, and `warning: ` before a warning. Brushes and paper assets are checked
against the styles in `work/styles/`. A clean source prints its summary; any error fails the run:

```
$ node cli/studio.ts paint check lib/paint/document/models/meadow.painting.ts
meadow (hillTopPx 200): 640 × 360 px, watercolour, on #f4f2ed paper
  landscape: layer, watercolour, on the root's sheet: sky (2 applications), hill (1 application)
  cloud: layer, watercolour, on the root's sheet: cloud-wash (1 application)
paint check: 0 errors, 0 warnings
```

`studio paint diff <source> [<edited copy>] [--set name=value,…] [--to name=value,…]` compares two evaluations: the
source at `--set` against itself at `--set` with `--to` on top, or against an edited copy. It prints the document
fields that differ (paper colour among them, which re-solves nothing), then each wash in its sheet's order: `same`,
`content` (it changed itself, at the first path that differs), or `upstream` (something earlier on its sheet changed).
A pigment a later wash brings changes its layer's film, so it reads at the layer's first application
(`water.slots.palette`). On a wrapped document a change moving a sheet's margin past its power of two (Wrapping)
re-solves the sheet from its first wash, each reading `upstream`; the diff reads the brushes for that, as a still
does. Keys never count. So you see what a property step re-solves before warming it:

```
$ node cli/studio.ts paint diff lib/paint/document/models/meadow.painting.ts --to hillTopPx=210
landscape/sky: same
landscape/hill: content, first at hill-flood.area.region.rings[0][0].y
cloud/cloud-wash: upstream, after hill-flood
```

In a test, `checkPaintingSource(source, values?, styles?)` (`#lib/paint/document/models/painting-source.ts`) returns
the same problems as records
`{severity, owner, field, path, message, footprint?}`, and calls the factory twice to name one that isn't pure.
`painting(source, values)` throws every error as one, naming its source; errors thrown inside a factory keep their TS
stack. `paintingEvaluationDiff(a, b)` (`lib/paint/document/models/painting-evaluation-diff.ts`) is the diff as data.
To see a scene, `studio look <project> --sheet 0,2,4` renders its frames from the composition.

What the check says today, and what to do:

| Message | When | Do |
|---|---|---|
| `treeline.on: on 'wet' follows only applications at or below shiny 0.7: it can never hold` (warning) | nothing before it on its sheet states water above shiny; its own layer's earlier washes have set and don't count | flood wetter |
| `drop.on: on 'damp' follows no water on the root's sheet: it can never hold` / `on 'wet' on the root's sheet, whose clock is instant: everything before it has set when it lands: it can never hold` (warnings) | nothing could be wet under it | lay water first, or drop the `on` |
| `hill-flood.at: fixed at 3.2 s precedes its predecessor at 3.5 s` / `fixed at 1 s precedes its wash's start 2 s` / `at needs a clocked wash` | an `at` breaks its wash's order | move the `at`, or clock the wash |
| `hill.clock: starts at 2 s, before sky's application at 3 s` / `starts when earlier washes set, and landscape has none before it` / `follows sky, which is clocked: a wash after a clocked wash is clocked too` | a layer's washes out of order | `origin: 'set'`, or clock differently |
| `hill.clock: follows sky on the root's sheet, which never dries` | a wash after a wet one on a sheet whose clock is `never` | give the later wash a layer or sheet of its own, or another `dryingScale` |
| `document.dryingScale: 0 isn't above 0, 'instant' or 'never'` / `card.sheet.dryingScale: …` | a bad scale | a scene second per model second above 0, `instant` or `never` |
| `heron.sheet.dryingScale: sheet is the scene's: its dryingScale is the document's` | a `scene` sheet stating a scale (from JS) | set the document's, or give the node an own sheet |
| `document.dryingScale: the root's sheet's dryingScale 0.025 times nothing: no clocked wet wash paints it` (warning) | a scale on a sheet no clocked wet wash paints: it dries in model time | give a wash `clock`, or drop the scale |
| `sky-wash.applications: lays water on card's own sheet, whose medium crayon keeps no wet history` | a wet wash on a crayon-declared sheet | a watercolour or gouache sheet |
| `lines.wetHistory: needs wetHistory: false: crayon keeps no wet history` / `a.charge.water: needs 'water', which crayon doesn't declare` / `a.charge.water: water needs a wet history: its wash says wetHistory: false` | a capability the medium or wash lacks | change medium or technique |
| `drop.effect: lays paint; a bloom is water` / `drop.effect: won't bloom: gouache spreads 0.1 d, so its largest bloom is 0.3 px` | `effect: 'bloom'` that certainly can't act | a water charge, a bigger tip, or no label |
| `sky.key: is used twice, by a layer and a wash` / `hill.clipTo: names sky, which isn't an earlier wash of landscape` / `hill.clipTo: names sky, which lays nothing, so nothing of this wash would land` | bad keys | fix keys |
| `hill.applications[0].area.boundaries[0].path: a boundary strays more than 1 px from its outline` | a boundary off its outline | snap the path |
| `a.charge.mix: its strength 1.2 isn't within 0..1` / `b.charge.mix: it names ultramarine twice` | a bad mix | fix the mix |
| `landscape.washes: mixes 13 pigments; a layer holds 12: split it into two layers` | too many pigments in one film | split the layer |
| `a.brush.brush: watercolor has no brush mop: its brushes are wash, filler, …` | a brush or paper asset the style lacks | name one it has |
| `property hillTopPx.value: hillTopPx = 205 is off its step 10` | an unquantised value | quantise in the scene |
| `document.layers[0]…: meadow isn't pure: two calls differ at layers[0]…` | the factory reads something besides its values | make it pure |
| `document.wrap: "z" isn't a wrap: 'x' meets the left edge to the right, …` / `document.paper.image: is a photograph on a wrapped document: its opposite edges meet at the seams, …` / `document.paper.grain.scale: is laid at 0.5 on a document wrapping across x: its mirrored tiles fit the width in whole pairs, …` / `document.paper.grain.scale: is laid 960 × 540 px on a document wrapping down y, not the 960 × 960 its 512 × 512 image asks: …` (warnings, the last from `--solve` and `paint still`) | a wrap that isn't `'x'`, `'y'` or `'xy'`; a photograph on a document that wraps; a grain whose scale is far from 1 ÷ 2n on one wrapping across x; a grain whose height, by its image's aspect, is laid far off on one wrapping down y | `'x'`, `'y'`, `'xy'` or none; a photograph that tiles each way it wraps, or grain alone; a grain scale of 0.5, 0.25, …; a smaller scale, or a document whose sides are the image's in a small whole ratio |
| `back/stem: lies on flower's own sheet: select flower, or all its sheet's layers, on one plane` / `back.source.layers[0]: names hil, which is unknown in meadow` / `back/neck: is selected twice, through heron and neck` / `back.source.k: 1.5 isn't within 0..1` | a plane's source, as the shot's load reports it (`paintedSourceProblems`) | select it whole; fix keys |
| `meadow.masks[0].drawable: reads rain, whose mask reads meadow/sky` / `front.masks[1].drawable: names rain/drop, but rain's items aren't occurrences: read rain` / `photo.masks: masks cut painted films, and a picture plane has none` / `title.masks[0].widthPx: 0; a band's width is above 0` | a plane's masks, as the shot's load reports them (`shotMaskCheck`) | break the chain; read the plane; mask a painted plane |
| `rain.depths.far: 2.5 isn't nearer than the back, street at depth 2` / `rain: two items are called a at 2.04 s` | an instanced plane at load and its items each frame (`shotInstancedPlaneProblems`, `shotInstanceProblems`) | keep items nearer than the back; one key an item |
| `label.lay.points: both pin 40, 40: two points set a scale and turn only apart` / `label.lay.points[0].element: isn't mounted: …` / `label.lay.points[0].element: names title, the data-pin of 2 elements in the shot: a pin names one` / `label.lay: plane label's picture must hold what the camera shows of it, … widen the stage's margin` / `photo.lay: is a picture plane, which lies where its source puts it: …` | a pin or cover at load (`shotPlacementProblems`), a cover laid as the shot loads and a pin each frame where it's measured (`shotPinnedPlanes`); a lay on a picture or three plane | pin points apart; mount the element, one with its `data-pin`; keep within the stage's margin; move a picture plane by its node |
| `meadow/hil.visibility: names no plane or occurrence of this shot` / `rain/drop-3.visibility: fades an item of rain, which isn't an occurrence: …` / `meadow/sky.visibility: 1.2 at 3 s; visibility is within 0..1` / `shot.warm: 2..1 isn't a span of scene seconds: …` | the shot's `visibility` (`shotVisibilityProblems` at load, `shotVisibilityProblem` each frame) and `warm` (`shotWarmProblems`) | name an occurrence; fade an item by its own `visibility` |
| `label.id: names two painted textures: an id names one` / `label.widthPx: is 0: a painted texture is whole px above 0` / `label.source: selects on a transparent ground: a painted texture is opaque, …` / `label.source: blends paintings that wrap otherwise: …` | the shot's painted textures at load (`compileShotPaintedTextures`, each source at moment 0) and a callback's again each frame (`compiledPaintedTextureSourceAt`, which also refuses one wrapping otherwise than at 0) | one id a texture; leave `ground` out; wrap every painting a texture blends alike |

`studio paint check <source> --solve [--at <s>] [--out <dir>]` then solves every sheet on the GPU (run it under the
GPU lock) and prints what only a solve can warn of, reading the images (a grain laid off its height on a document
wrapping down y), then, in each sheet's order (under the sheet's name when there are several), each wash's start and
when what it wetted had set, and each application's landing time with the `on` it waited for: model seconds in the
unclocked run, scene seconds with model time beside once the clock runs. `--at` solves the prefix shown at that scene
second, as a selection's `at` does, finished. It writes the painting to `<dir>/painting.png` and each layer's film on
its sheet's paper and edge (`paintingFilmPicture`: the root's paper, or an own sheet's card, clear past it) to
`<dir>/films/<layer>.png` (`<dir>` is `<source>.solve` by default). `studio paint still <source> [--set …] [--at <s>]
[--out <file>]` checks and solves the same way, warning alike, and writes only the painting, the document's size (`<source>.png`).
Both end on what the solve cost: solves, entries run, decisions made and reused (a decision is remembered by its
prefix's key), films and checkpoints found or not, films' pictures read back or kept from an earlier read, and
readbacks.

```
$ node cli/studio.ts paint check lib/paint/document/models/meadow.painting.ts --solve
…
sky (landscape): starts at 0 s
  sky-flood: lands at 0 s
  treeline: lands at 0 s (on 'wet')
  sky: set by 203.9 s
hill (landscape): starts at 203.901 s
  hill-flood: lands at 203.901 s
  hill: set by 323.842 s
cloud-wash (cloud): starts at 203.901 s
  cloud-wash.applications[0]: lands at 203.901 s
  cloud-wash: set by 356.501 s
costs: 1 solves, 4 entries run, 4 decisions made, 4 film hits, 2 film misses, 2 film readback misses, 10 readbacks
```

A pond clocked from 0 s on a sheet at `dryingScale: 0.02`, reeds charged in `on: 'wet'`, a glint lifted `on: 'dry'` at
6 s, then ripples at `origin: 'set'`:

```
pond (water): starts at scene 0 s (model 0 s)
  pond-flood: lands at scene 0 s (model 0 s)
  reeds: lands at scene 0 s (model 0 s) (on 'wet')
  glint: lands at scene 6 s (model 300 s) (on 'dry')
  pond: set by scene 4.078 s (model 203.9 s)
ripples (water): starts at scene 6 s (model 300 s)
  ripple: lands at scene 6 s (model 300 s)
  ripples: set by scene 8.399 s (model 419.941 s)
```

The ripples wait for the glint before them in the order, not only for the pond to set. A wet wash on a sheet whose
clock is `never` ends `never sets`.

A refusal prints alone, after the check's summary, and fails the run. What the solve says, and what to do:

| Message | When | Do |
|---|---|---|
| `treeline: unreachable from this committed prefix: on 'wet' held over at most 59% of its core (needs 95%), at model 0 s [0,197 → 640,261]; not shiny at its predecessor's time. Unscheduled after it: hill-flood, cloud-wash.applications[0]` (the meadow's sky flooded through `wash`) | its `on` never holds over 95% of its core from its predecessor's time on. The boxes, in 32 px cells, are where it failed; `never wetted on this sheet` when its core met no water, `sets before the rest turns matte` for a `damp` that can't hold. It fails the solve | flood wetter or with an even brush, move the application onto the flood, or drop the `on` |
| `sky.applications[3] won't bloom: no open paint on workable paper under its core` | a bloom with nothing to act on where it lands; fails the solve | bloom over a wash still open, or drop `effect` |
| `drop: its core is empty: nothing of it reaches paper` (warning) | its clips, resists or reserves leave none of it on paper; it lands at its predecessor's time | widen its clips, or drop it |
| `treeline: decided within rounding of on 'wet'; another GPU may place it a step apart` (warning) | its `on` holds by a hair | wetter or drier, by a little |
| `glint: unreachable … settled before it (\`instant\`)` / `bloom: unreachable … nothing dries (\`never\`)` | under `instant` the sheet has set before each clocked application, so `wet` and `damp` over earlier paint can't hold; under `never` it stays as it landed, judged at the predecessor's time alone | drop the `on`, or give the sheet a numeric `dryingScale` |
| `hill starts at 2 s while sky is still wet until 5.1 s` | a numeric `origin` before its layer's earlier washes have set | a later `origin`, or `'set'` |
| `glaze: fixed at 1 s precedes its predecessor at 3.448 s` | the application before it waited on its `on` past this one's `at` | a later `at`, or an earlier wait |
| `glaze: at 6 s, on 'dry' holds over 80% of its core there` | a fixed `at` whose `on` doesn't hold then (for `damp`, an upper bound) | move the `at`, or drop the `on` |
| `painting: glint lifts in a wash without wet history, and the solver lifts only in a wet wash so far` | what this solver doesn't paint yet | lift in a wet wash, or check it without `--solve` |

`<PaintedShot>` refuses, as it loads, every problem at once: its sources' (as above), a bad rig (`meadow/heron is
rigged: it takes no pins, sway or flutter`, `meadow/eye lies under rigged meadow/heron and in no part's cels`), the
camera build's problems and `paintChannelConflicts`' channel conflicts, a transparent back with no HTML behind
(`back.source.ground: is the back, laid on its paper wherever the frame shows: its ground is transparent only over HTML
before the first canvas`), and a canvas that doesn't fill its shot (`shot.canvas: PaintedShotCanvas paint lies in a
<div> with transform: matrix(1, 0, 0, 1, 0, 0), which holds a fixed canvas in its own box: …`). A frame fails on a
source callback's selection with a problem, or one whose occurrences differ from its first (`shot: plane meadow's
source at 2 s shows meadow/landscape, and its first showed meadow/landscape, meadow/cloud: …`); on its page, read as
it draws: a canvas that no longer fills its shot, a clear back with no HTML behind it (`back.source: is a clear back,
and no HTML lies before the first canvas at this frame: …`), or a pinned element unmounted, named twice, or laying
paint past the stage. The cost report, per frame and warmed
span (evaluations, cache hits and misses, solves by sheet from the first application re-run, decisions reused,
uploads, bytes kept, and warnings such as a pose folding paint), comes with warming (What's built).
