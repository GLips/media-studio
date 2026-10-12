# Techniques: getting a look

How to plan a painting's colour and light and write the look you want, as applications. Field units and defaults are
in the document types' JSDoc; the water and `on` rules these build on are in `${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-model.md`.

## Plan colour and light first

Paint is pigment in films on paper, not colour stacked by alpha. Decide the lights, what mixes and what stays clean
before writing a wash.

- **Light is the paper.** A light colour over a darker watercolour wash barely shows. Reserve every light (a sun, a
  lit rim, a lamp's reflection) on each darker application crossing it, one footprint shared as a TS constant. A lift
  leaves a stain. Only `TITANIUM_WHITE` in a mix covers, as body colour.
- **One layer is one mixing film.** An application mixes into the paint there: a blue heart on yellow petals goes
  olive. In a later layer, gouache covers and watercolour glazes (recipe 12).
- **A field grades pigment amounts, never colours**: ultramarine to rose passes through violet, blue to orange
  through grey (the check warns). Grade one mix's strength, change hue across layers, or charge the second colour
  into the wet flood (recipe 2).
- **Gouache lightens with white**, and dries 3–6 L* paler than written. Pale gouache laid as light reads chalky,
  pasted on: for glow, reserve the paper; for a veil, cap the film (`opacityCap`, Thin films); for a near-black, a
  hex part at strength 1 (`'#10171f'` dries to L* 10).
- **A big soft light on a dark ground** (a lit bank, a pool of lamplight): watercolour only darkens, and a reserve
  out of a dark wash shows its edge as strips or a cut-out. Lay the light as gouache underpaint, its edge feathered or
  bled, then glaze watercolour over it and its dark surround in a later layer.
- **Write layers in a painter's order**: far before near, each element its own layer, its washes from flood to
  detail; ink lines below transparent washes and above body colour. Separate layers keep elements from mixing into
  each other.
- **Haze is paint; glow is light.** A haze is a veil graded by a radial `load` on its fill
  (`{kind: 'radial', center, radius, inner: 0.6, outer: 0}`): no edge anywhere. Light that gives off light is its
  emitter's `glow` and the lens's bloom (`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/shots.md`): rings or discs painted round it read as rings or discs.

## Techniques are applications

There's no effect object: every technique is applications with a charge. The one label, `effect: 'bloom'` on a water
application, makes the engine fail one that certainly can't bloom.

| Technique | Write | `on` | Acts only if | What you see |
|---|---|---|---|---|
| charge | paint, water 0.5–0.8 | `wet` | the paper is shiny under it | colour feathering in |
| bloom | water stamps, water 0.9–1, `effect: 'bloom'` | `damp` | surplus water over damp > 0.08, over open paint | a cauliflower edge, full from surplus 0.35 |
| backrun | one water stroke along a junction, water 1, `effect: 'bloom'` | `damp` (`wet` softer) | as bloom; both sides in one wash | a lobed edge pushed back along the stroke |
| soften | water stroke, water 0.3, along an edge | `wet` or `damp` | open paint under it | the edge evens out |
| wet lift | lift, strength 0.5–1 | `wet` (runs back) or `damp` (crisper) | open paint under it | a soft light area |
| dry lift (scrub) | lift, strength 1 | `dry` | the medium lifts | 35% of set watercolour a pass, 90% of gouache, less the stain |
| rewet | water 0.5–1 | `dry` | — | wets the paper for later applications; set paint stays |
| clear-water ground | the wash's `prewet: {region, water}` | — | — | an even soak at the wash's start, no brush texture |

`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/bloom-rims.png` is the bloom chart: drops 0.1, 0.2 and 0.35 over damp, left to right, in washes of
`rim` 0.5, 1 and 2, top to bottom. A bloom under 0.2 surplus barely shows; `rim` darkens its edge as it darkens the
flood's. A
bloom rewets its footprint, so a later `damp` landing overlapping it waits or fails. Under `dryingScale: 'never'`
nothing reaches damp: bloom `on: 'wet'` with water 1 over a flood at 0.85–0.9.

## Reserve, resist, lift

- **Reserve** (masking fluid): `reserves: [footprint, …]` on an application or a wash's `prewet`, each a region
  (crisp or feathered) or marks through a tip. It keeps *that application* off the paper there, leaving bare paper or
  whatever was painted before. It never erases, and binds nothing else: to mask a whole wash, give each of its
  applications and its prewet the same footprints, a TS constant.
- **Resist** (wax): `resists: [{footprints, amount}]`, footprints as marks (the brush's grain catches the peaks; a
  region has none). It keeps 1 − `amount` of contact on the peaks; valleys still take paint.
- **Lift**: a lift application takes up to `strength` of its own layer's open paint and the sheet's water, leaving a
  stain by the pigment's staining. Because it spends water too, a `wet` or `damp` charge over a lift since the last
  drying can't hold: **charge first, lift last** in the wash. Light added into a dark ground (a lit window's
  reflection in a wet road) is gouache over the dark, not a lift and a charge.
- `anchor: 'paper'` on a clip, reserve or resist keeps it still on the sheet while the layer is posed.

## Edges and clips

- `clips` are regions an application may land and its paint walk in; several intersect. A clip binds only its own
  application: a later unclipped water stroke still moves open paint across it, so clip that too or reserve the area.
- `clipTo` names an earlier wash of the same layer whose coverage clips this wash: texture inside a silhouette.
- `crisp` is a wall paint and water stop at, where a drying wash gathers its rim. `feather(widthPx)` keeps the wall,
  ramping coverage inside the line. `bleed(reachPx)` removes the wall: paint and water land fading past the line and
  dry with no rim; that's a lost edge.
- A ramp reads narrower than written: for an edge that reads W px wide give watercolour about 1.6 W, gouache about
  3.3 W, and draw a bleeding gouache shape's line inside where its edge should read.
- Past the ramp, paint walks only into water already there: for a wetter loss, lay a water stroke along the edge
  first. A clip's or area's `boundaries` give a stretch of the outline its own edge (every path point within 1 px of
  it). Any edge may be ragged: `roughness: {amountPx, featurePx, seed}`.
- `maxSpreadPx` on a paint charge caps how far that application's paint walks.
- A flood's tip breaks along its outline, leaving bare specks: run a wash meant to reach the paper's edge 30 px or so
  past it.

## Thin films

A capped film (`opacityCap`, or a flood's `load`) is thin paint over whatever lies under it.

- **A dark colour lightens toward its tint**, which can read as another hue: `#3b3fb4` capped at 0.2 over cream reads
  a vivid cerulean. Pick a capped colour by looking at it capped over its ground. For a shadow, grey the hex until it
  falls darker, not bluer, than what it lies on.
- **A cap is per application, per texel**; overlapping applications add up (n caps of c build about n × c). Plan a
  veil of many marks by their sum: fourteen discs at 0.035 lay half a full load. A film meant to stay even is one
  application; stacked capped discs show their rings, where one fill with a radial `load` has no edge.
- **Gouache at strength 0 is titanium white**, not nothing (crayon alike, with wax white). Fade gouache toward no
  paint by the fill's `load` or `opacityCap`, keeping the mix's strength.
- Gouache under a cap shows what's under about half at 0.1 of a full load, a fifth at 0.25, a tenth at 0.5. A cap
  thins the paint, not the brush's edge: a hard brush capped is a fainter hard line.

## Recipes

| # | Look | Write | Watch for |
|---|---|---|---|
| 1 | graded sky | a flood whose `mix` is a linear field from zenith to horizon | grades amounts, not colour: more stops are more applications |
| 2 | wet-in-wet charge | flood at water 0.85+ with an even brush, then paint `on: 'wet'` | its core on the flood's full contact, inset from the rim |
| 3 | bloom | after the flood, water stamps at water 1, `effect: 'bloom', on: 'damp'` | needs open paint under it |
| 4 | backrun | one water stroke along the junction, `effect: 'bloom', on: 'damp'` | both sides damp at once; `wet` gives softer scallops |
| 5 | soften one edge | a water stroke at 0.3 along it, `on: 'wet'` | write it before anything waits for `dry` |
| 6 | lost edge | the fill's area `edge: {kind: 'bleed', reachPx: 40}` | past the ramp it needs water already there |
| 7 | crisp top, lost bottom | `boundaries: [{path, edge: bleed}]` on the area; a water stroke along it first for a wetter loss | path within 1 px of the outline |
| 8 | lifted clouds | lift stamps at 0.8 over the sky flood, `on: 'wet'` (soft) or `'damp'` (crisper) | staining pigments leave a ghost |
| 9 | scrubbed highlight | a lift `on: 'dry'` | watercolour gives up 35% a pass |
| 10 | white sparkles | `reserves: SPARKLES` (stamp footprints) on each of the sea's applications | on a cut-out, a reserve holes the card |
| 11 | wax resist | a crayon layer, then `resists: [{footprints: SAME_STROKES, amount: 0.8}]` on the wash | a white candle is the resist alone |
| 12 | true glaze | the glaze in its own layer after the base, its first application `on: 'dry'` | without it, it mingles with the base's water; in one layer it mixes |
| 13 | body colour hiding a wash | a gouache layer on `sheet: {kind: 'own', paper: SAME_PAPER}` | weak gouache mixes are tints |
| 14 | dry brush | the style's dry brush in a watercolour layer | dry brushes refuse stated water |
| 15 | granulation | ultramarine or burnt umber, a strong load, paper grain depth ≥ 0.3 | settle follows pigment, load and depth |
| 16 | soaked ground | `prewet: {region, water: 0.9}`, then paint | `reserves` keep it off |
| 17 | pen and wash | an ink layer first, a direct wash, fine brush, dark mix at strength 1; washes in a later layer | the ink never moves |
| 18 | crayon pressed hard | `burnish: true` on the charge | crayon layers only |
| 19 | hill hiding a far range | the far range's applications take `reserves: [NEAR_HILL]` | inset the shape by the overlap you want |
| 20 | sponge-out through what's behind | a lift wash added to the layer behind | lifts never cross layers |
| 44 | a soft halo, a pool of light | one fill, its `load` a radial field `{inner: 0.6, outer: 0}` | stacked capped discs show their rings |

## Pigments

`WATERCOLOUR_PIGMENTS`, in any medium. Over white is a full watercolour load on white paper (and crayon's masstone);
Gouache is a full gouache load dried on white. L* is lightness, 0 black to 100 white; habits 0..1.

| Pigment | Over white | L* | Gouache | L* | Granulation | Flocculation | Staining |
|---|---|---|---|---|---|---|---|
| `ultramarine` | `#2b3994` | 28 | `#363fc2` | 35 | 0.9 | 0.35 | 0.1 |
| `phthaloBlue` | `#1c4383` | 29 | `#244cad` | 35 | 0 | 0 | 0.9 |
| `cerulean` | `#3986bc` | 54 | `#4693ce` | 59 | 0.8 | 0.2 | 0.1 |
| `phthaloGreen` | `#095d51` | 35 | `#0a6b5e` | 40 | 0 | 0 | 0.9 |
| `hansaYellow` | `#f4c419` | 81 | `#fbcd2e` | 84 | 0 | 0 | 0.5 |
| `yellowOchre` | `#c89742` | 66 | `#d3a34f` | 70 | 0.3 | 0.1 | 0.2 |
| `quinacridoneRose` | `#c42c62` | 45 | `#da3670` | 50 | 0 | 0 | 0.8 |
| `cadmiumRed` | `#d12e22` | 46 | `#e4392a` | 51 | 0.15 | 0 | 0.2 |
| `burntSienna` | `#9c4d26` | 42 | `#b3582e` | 48 | 0.4 | 0.1 | 0.3 |
| `burntUmber` | `#5c412f` | 30 | `#6e4b37` | 35 | 0.8 | 0.25 | 0.3 |

None is near black: a gouache mix of them dries no darker than about L* 29, crayon's about 25, so a near-black is a
hex part. A mix part takes the pigment's object (`WATERCOLOUR_PIGMENTS.ultramarine`), not its name.

## Brushes and papers

What each brush is for, in the studio's three pigment styles (if they're on this machine). How far pressure moves
each one's size, opacity and flow, its visible width and the finest diameter it plans differ brush to brush and live
only on your machine: `studio brushes describe --style <style>`.

| Style | Brush | For |
|---|---|---|
| `watercolor` | `wash` | a lightly textured body, for floods nothing waits on |
| | `filler` | a big, open, mottled glaze keeping paper showing |
| | `wet`, `blend` | cloudy wet-in-wet; a soft feathered wash |
| | `roughEdge` | a dense body with a broken edge: hair, a pine |
| | `shadow`, `charge` | a round wash pooling at its rim; touches dropped into a wet wash |
| | `dry` | bristle streaks catching the paper's peaks (dry) |
| | `pigment`, `crystals` | granulating veins near the base colour; salt crystals clipped to a shape |
| | `stains`, `blotch`, `splashes` | blooms with a dark pooled edge; cauliflower blooms as stamps; round drops |
| | `pencil`, `ink` | a grainy broken line (dry); a crisp opaque tapered line for dark accents |
| | `detail` | a smooth line at 4–12 px; laid big, **the even flood later work waits on** |
| `gouache` | `wash`, `flat` | floods and flat blocks; a broad flat over a block |
| | `thick`, `round` | dense opaque crisp edges; shadows, folds, the core |
| | `bristly` | bristle marks, parting into a dry run-out under falling pressure |
| | `dab`, `detail` | small lights and glints; fine opaque lines |
| | `dry` | a scumble catching the peaks over a block, a broken edge |
| `crayon` | `stick`, `side`, `tooth` | hatching; broad grainy zigzags; a scumbled ground |
| | `conte`, `chalk`, `pencil` | small solid darks; rough texture; a graphite outline |
| | `eraser` | a lift rubbing back toward the paper |

A fill plans its strokes by its brush's measured profile, so its `diameterPx` must lie in the range the profile
holds; the check names the range, or the import that measures a brush with none.

**Hand.** Give every stroke a `hand`, or it paints at constant pressure and the brush's taper never shows:
`'taper'` for most marks, `'pressFlick'` for hair, grass and hatching, `'swell'` for leaves and petals, `'drag'` for
washes and fills. A stroke shorter than `fullProfileAt` diameters (12) gets only that share of the profile's depth:
for a short blade, petal or wing, set it to about the stroke's length in diameters. `curvature` lightens straight
runs; `wobble` makes strokes along one path differ. A curve `(u) => pressure` is compared by identity: define it once
at module level.

**Papers.** The pigment styles' `vvds` pack holds `papers/vvds-watercolor-canvas-1.png` … `-4.png`, each with a
`.grain.png`, named `{style, pack: 'vvds', file}`; the styles paint on canvas-3 at grain depth 0.35 (watercolor), 0.2
(gouache), 1 (crayon). `image` is a photograph under the painting; `grain` is the tooth.

**Fields** (`Field<T>`, document px): `constant`, `linear` (held past its ends), `radial` (from `inner` at the centre
to `outer` at `radius`), `noise` (features about `scale` px, named by `seed`). Mottle by purpose (a warm lit plane
against a cool one), not over everything.
