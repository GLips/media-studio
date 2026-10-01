# The brush engine

Stamp painting is split by body of knowledge: what paint is, what a brush is and how a hand lays it, how a painting
lands, what each app's brushes mean, the packs they come in, the styles that carry a pack into a project, how close a
painted brush comes to the app's own, the studies a person judges, and the gate that holds the renderer. Each is a
feature under `lib/paint/`, each importing only those below it:

```
animation          → painting
brush-fidelity     → brush-packs, photoshop-brushes, procreate-brushes, painting, brush
studies            → style, brush-packs, painting, materials, brush
gate               → brush-packs, painting, materials, brush
style              → brush-packs, painting, materials, brush
brush-packs        → photoshop-brushes, procreate-brushes, materials, brush, platform/zip
photoshop-brushes  → procreate-brushes, brush
procreate-brushes  → brush, platform/zip
painting           → materials, brush
materials
brush
```

**materials** is paint itself, and knows no brush: spectra and the screen's colours (`paint-spectrum.ts`),
Kubelka–Munk (`paint-kubelka-munk.ts`), pigments, the mixture a painter makes on the palette, the medium that carries
it, the paper it meets (`paint-paper.ts`), and a deposit's material, a colour or a mixture (`paint-material.ts`).

**brush** is what a brush is and how a hand lays it, and knows no app. `stamp-brush.ts` is the brush (`StampBrush`: a
tip, spacing, dynamics keyed by target and sensor, scatter, rotation, grain, dual, edges, accumulation). Its tip is an
image or a bristle tip (`stamp-bristle-tip.ts`), drawn at the diameter a deposit paints at: `bindStampBrushImages`
binds either at that diameter, and each renderer caches what it draws by key. `stamp-placement.ts` places its stamps
along a stroke by one rule (`buildStamp`), reading dynamics through `stamp-dynamics.ts` (each step's and stamp's
context, what each sensor reads from it, each response); a new sensor or target is an entry in `StampTargetSensors`,
its parameters (`StampSensorParams`) and its signal there. `stamp-stroke-hand.ts` is the hand: the pressure and speed
a painter moves along an authored stroke. `coverage-formulas.ts` is the one registry of every blend, grain
adjustment, pooling and accumulation, and their WGSL: a brush's modes and the maths they paint by are one table.

**painting** is the engine. `stamp-paint-recipe.ts` is the painting a scene writes, with its paper;
`stamp-deposit-compile.ts` prepares its deposits, `stamp-fill.ts` fills a region, and `stamp-region.ts` and
`stamp-blur-region.ts` mask one. `stamp-deposit-stages.ts` holds the plans a deposit's stages resolve in and which of
a brush's stages are active (`stampActiveLayers`). Rendering maths lives only in WGSL, generated from those tables
and brush's; the GPU is the one renderer. A function keeps a CPU twin only where the studio runs it off the GPU too
(Kubelka–Munk, `stampPaintFieldAt`, a region's distance and grid), and a dual mode declares `needsDual` rather than
having the CPU run its combine. The GPU's resolve order and mode switches are generated from the tables. How the GPU
lays a layer's stamps is a plan (`stampAccumulationPlan`): a fixed blend where stamp order can't change the build, and
otherwise, for a `buildToOpacity` whose opacity falls (Photoshop never lowers what's built), each pixel walks its
stamps in order and lays each by the table's `lay`. `studio/` is the WebGPU renderer, its uniform layout and the
compositors.

Wet paint is a wash, a pass painted wet (`group.wash`): its deposits paint, wet (`water`, `soften`, `bloom`) or lift,
and it can `wait` in painting time, which only its waits advance. `stamp-wetness.ts` works out, once as a painting
loads, how wet the paper is where each lands, on coarse grids; the pigment compositor's `landDeposit` lays it by the
laws in `stamp-wet-landing.ts` and `stamp-wet-lift.ts`, and `studio/stamp-wet-stages.ts` lists what then works over
the neighbourhood: the flow stage (`stamp-wet-flow.ts`), where a deposit's fresh paint feathers into water on the
paper and the workable paint its water stirs evens out, or paint runs back into a lift, and the drying rim
(`stamp-wet-rim.ts`) at each of a wash's dryings, a `wait('dry')` and its end. A graded material lays each pigment
of either end, its amount graded on the GPU. A plain pass lands as it always has. Flat colour has no washes.
`stamp-paint-events.ts` is the painting in painting order, each deposit with the time it's settled by.

**Media.** A painting in pigment has a mixing (a medium and the pigments its mixtures may name), and any group may
name its own (`mixing` in its options, a style's `mixing`): gouache butterflies in a watercolour. Paper stays the
painting's. `compileStampPigmentPaint` fits each group's palette in its group's medium, so one pigment id in gouache
and in watercolour is two pigments, each with its medium's masstone scatter, white and granulation. Whatever a medium
decides is per group: the pigment compositor writes its WGSL once per medium the painting holds, each pass reaching
its group's by a switch on `GROUP_MEDIA` (a painting in one medium has neither); drying, a stage's reach, spread, damp
and rewetting come from the landing's medium (`StampWetLanding`), a stamp's grain depth and a flood's water from its
group's. Where media meet there's no new law: washes share no water, so a gouache group laid over a watercolour wash,
wet or not, meets it set and stacks over it by Kubelka–Munk, a gouache film's scatter covering the dark under it as
body colour does. A flat painting refuses a group naming a mixing.

**Wet state.** The lattice holds the paper: per landing, its `wetness`, `workable` and `settled` (1 where the paper
has dried since it last took water, and at a wash's start), uploaded once for the renderer and every stage. The paint's
own history is in the group's layer: a group with a wash keeps, in its last channel, each pixel's open share, how
much of its paint hasn't set, mixed by amount as paint lands or moves. Every landing first sets it to none where the
paper has settled, over its whole box, which reaches two lattice cells past its window's points; so paint that dried
and is wetted again moves or lifts only by the medium's rewetting.
- Landing (`wetLand`): on dry, set paper as `layDeposit` lays, toward the stroke less what the paint there picks up;
  on wet paper adding; between, as workable as the paper is. A wash brush's water hardens its tip's coverage to an
  edge (`wetLandCover`, smoothstep 0.15–0.45) as far as the paper is drier than the brush.
- Each stage declares its static reach (`reach(deposit, medium)`); a deposit's landing window and its resolve box widen
  by the most of them, as a boil's epoch lands as its deposit as written does.

**The flow stage.** Two populations move: the deposit's fresh paint (what `landDeposit` laid, left in `fresh`),
freely, and the paint already there, as far as the deposit's water stirs it (workable and open, where its brush
touched). Each is a conserved diffusion of sigma = spread × diameter / 2 at full wetness, narrower as drier. Paper is as
wet as it was, or as the brush's water where it touched, so paint on dry paper keeps a hard edge. A water stroke's
brush drags paint along where it touches, however damp, so there paint moves as on flooded paper: a soften reaches
its sigma rather than its water's share of it.
- After a lift there's no fresh paint: the paint round it runs back in, as loose as the lift would find it, a pair
  trading only as far as the lift reached either of it, at sigma = spread × diameter / 3, at most 16 px.
- It works one array layer of the group at a time, so its scratch is the same for any palette: 100 bytes a pixel of
  the largest wash deposit's box (about 207 MB for a whole 1080p frame), reserved as the painting (or a boil's epoch)
  loads.
- What moved is open paint, and coverage grows by the share of a full film a pixel gained (the compositor's
  `washMoved`, which every stage uses).
- It runs on the shared transport (`stamp-wet-transport.ts`): passes at strides growing by about √2 (1, 2, 3, 4, 6,
  8, 11, …), x then y, each a three-tap exchange with the pixels a stride away. A pass adds variance of up to
  stride² / 2, and a pair takes the share of it its own sigma needs. Doubling strides left ripples a stride apart.
- Two pixels trade only as freely as the driest, least open pixel between them (a way, built per stride from the
  last's), so paint never jumps a reserve or a dry gap.
- What evens out, per pixel, is each pigment's whole amount (fresh and old) over the pixel's hold: how much of it the
  paper takes there against its mean, by the compositor's `washHold` (the paper's tooth, a pigment's granulation and
  clumps, as it lays paint). So moved paint settles into the tooth as laid paint does, a stroke's own texture holds
  still, and a seam finer than a stroke evens out. A pair trades through the lesser hold, each population as freely
  as it's stirred and holds of the pixel's paint, so a pixel never gives more than it holds.
- Moves are f32 and the layer takes them in one f16 store: this GPU truncates f16 stores, and a store per pass lost
  a tenth of a percent of the pigment.

**The transport.** Bloom and rim move what they move along the same ways, as a linear spread G (each pass
symmetric, so the passes in reverse order are exactly Gᵀ) and a normalised scatter: N = Gᵀ(receiver weight),
send = give / N, delivered = weight · G(send · paint). What's delivered totals what's given, per pigment, and goes only
where the paper lets it: a stage supplies the paper (wet, open), the bloom the deposit's wetness over its medium's damp
and where paint may land, the rim open wherever it isn't bare paper at the grain's scale.

**Frame state.** Everything about a group that varies with time reaches the renderer as data, per frame:
`renderer.draw(t, frame)`, and `StampPainting`'s `frame` prop, take a `StampPaintFrameState`
(`stamp-paint-frame-state.ts`). It holds each group's:
- placement about its pivot;
- warp, a rest-to-scene map with a key naming it, sampled on a lattice over the group's painted layer;
- boil epoch;
- visibility;
- for a **live** group, its marks compiled for this frame.

The compiled painting holds no functions of time, and a checkpoint is keyed by values and those keys, so equal keys
must mean equal maps and marks. A group's paint lives one of three ways:
- **Stuck:** its layer is carried, rigidly or bent by the warp. It's cheap, and blooms and edges ride along, but a
  bend magnifies what it carries.
- **Live:** it is re-placed from its posed geometry and drawn alone, everything before it restored from a checkpoint.
  Line width and grain stay true at any stretch. Its marks must be the written group re-placed
  (`stampLiveGroupProblem`).
- **Boiling:** its rest space is wobbled on a stepped epoch, under its warp.

A moved or bent layer is laid at four texels, then blended, so crayon keeps its tooth under sub-pixel motion. A
recipe's own `motion` and `boil` are evaluated into the same shape (`stamp-frame-plan.ts`).

**animation** writes that frame state, and the renderer never sees a scene, a pose or a clock.
- **Shape sources** (`models/figure/`): a posed primitive figure, a construction of circles and capsules, or SVG paths.
  Each gives named parts, a silhouette, interior lines and anchors as regions.
- **Motion** (`paint-motion.ts`, `paint-motion-compile.ts`): a node per moving group, built over the compiled
  painting, which gives each group's painted box and reveal end. A node has pins and how its marks live; a live node
  registers a poser, and motion keeps its posed marks by key. Plays of clips (`paint-motion-clips.ts`: poses,
  breathe, sway, flutter, place) run through clocks written as parts (`paint-clock.ts`: at, rate, loop, hold,
  freeze, until, on a 24 fps animation clock), compiled to steps in one order.
- **Deformation as data** (`paint-deform.ts`): each bend a node's paint goes through in a frame is a value with every
  spatial parameter and its rounded amount; its map and its key are both read from it. A point goes through its own
  bend and placement, then its parent's, as a rig nests.
- **Checks:** the build checks the tree, the groups, the clocks, the boil's wobble, one writer per lane
  (`paint-channels.ts`), and every frame's emitted warp for folds on the renderer's own lattice.
  `paintMotionFrameAt(motion, t)` is pure in `t`, and writes each group's state through one function
  (`paint-group-frame-state.ts`).

**procreate-brushes** reads a Procreate brush's settings into a `StampBrush` (`procreate-brush.ts`, by the constants
of `procreate-reading.ts`), and the stroke Procreate draws its previews along. Its `engine/` reads binary plists and
`.procreate` canvases.

**photoshop-brushes** reads Photoshop's: the preset schema in Photoshop's own units (`photoshop-preset.ts`), the
`.abr` reader and descriptor codec, the normalizer (`photoshop-brush.ts`, by `photoshop-reading.ts`, which resolves every source of pressure,
the brush's, the options bar's and a lingering pose's, into the brush's dynamics by one precedence), computed round
tips, and the capture rig that has Photoshop paint probes and references (docs/photoshop-capture.md). It imports
procreate-brushes only for the S-curve its references are painted along, Procreate's preview stroke.

**brush-packs** is a pack on disk: the manifest (`stamp-paint-pack.ts`), the files an importer writes under
`work/styles/<style>/brushes/<pack>/`, the three importers, and the URLs a browser page finds a served pack's files
at (`stamp-paint-pack-urls.ts`, read back by `readServedStampPaintPack`). It is its own feature because a pack and its
importer read both apps' brushes; inside either app's feature, that app would import the other back.

**style** is a style in a project: `StampPaintStyle` (`style.ts`), the styles a project names, checked before a bundle
(`project-styles.ts`), the bundle's styles module (`@stamp-paint-styles`) and `StampPainting`, a painting in a scene.

**brush-fidelity** holds a painted brush against its target, a Procreate preview or a Photoshop reference capture
(`brush-fidelity-target.ts`): one measure (`stroke-measure.ts`), one scorer (`brush-fidelity-score.ts`) that the
sheet, the fit, the diagnostic and the guard all use, one versioned report of a sheet (`brush-fidelity-report.ts`,
naming the source, reading and scorer it was drawn under) that the fit's baselines and the guard read, and each app's
reading registered for fitting (`brush-readings.ts`). `npm run brushes:sheet`, `brushes:fit` and `brushes:diagnose` run it (docs/private-styles.md).

**studies** are passages painted for a person to judge, not scored: the wet and dry passage sheets
(`npm run wet:passages`, `dry:passages`), the fill sheet and the stroke hand sheet (`brushes:fills`,
`brushes:hand`), each a Node side over a browser page.

**gate** holds the GPU renderer to accepted output (`npm run stamp:gate -- run`): every rendering formula over a grid,
each runtime twin against its CPU side, synthetic paintings that walk every path the renderer takes, and a traced
resolve against its frame; `media/mixed` holds each group of a three-medium painting to itself painted alone in its
own medium (max 0), and gouache glazed over a dark watercolour wash to covering it. Pre-commit runs it on the staged tree when a path it covers changes; no adapter, a timeout
or a difference fails the commit. Public baselines live in `harness/fixtures/stamp-paint/`, a pack's brushes' in
`work/validation/stamp-paint/` (`stamp:gate -- private run`). A baseline changes only by `update <ids> --reason …`,
which writes candidates with their differences, then `accept <ids>`.

`lib/platform/zip/` reads the zips packs come in; `lib/platform/browser/` runs the fidelity, study and gate pages.
`lint/policy/studio-tree.ts` declares the areas; check:arch holds each feature to its roles and refuses a cycle
between features.
