# The brush engine

Stamp painting is split by body of knowledge: what a brush is and how it paints, what each app's brushes mean, the
styles that carry a pack into a project, and how close a painted brush comes to the app's own. Each is a feature under
`lib/picture/`, each importing only those below it:

```
brush-fidelity     → stamp-styles, photoshop-brushes, procreate-brushes, stamp-paint
stamp-paint-gate   → stamp-styles, stamp-paint, paint
stamp-styles       → photoshop-brushes, procreate-brushes, stamp-paint, platform/zip
photoshop-brushes  → procreate-brushes, stamp-paint
procreate-brushes  → stamp-paint, platform/zip
stamp-paint
```

**stamp-paint** is the engine, and knows no app. `models/stamp-brush.ts` is the brush (`StampBrush`: a tip, spacing,
dynamics keyed by target and sensor, scatter, rotation, grain, dual, edges, accumulation). Its tip is an image or a
bristle tip (`stamp-bristle-tip.ts`), drawn at the diameter a deposit paints at: `bindStampBrushImages` binds either
at that diameter, and each renderer caches what it draws by key. `stamp-placement.ts`
places its stamps along a stroke by one rule (`buildStamp`), reading dynamics through `stamp-dynamics.ts` (each
step's and stamp's context, what each sensor reads from it, each response); a new sensor or target is an entry in
`StampTargetSensors`, its parameters (`StampSensorParams`) and its signal there. `coverage-formulas.ts` and
`stamp-deposit-stages.ts` are the one registry of every blend, grain adjustment, pooling and accumulation, the plans a
deposit's stages resolve in, and which of a brush's stages are active (`stampActiveLayers`). Rendering maths lives
only in WGSL, generated from those tables; the GPU is the one renderer. A function keeps a CPU twin only where the
studio runs it off the GPU too (Kubelka–Munk, `stampPaintFieldAt`, a region's distance and grid), and a dual mode
declares `needsDual` rather than having the CPU run its combine. The GPU's resolve order and mode switches are generated from the tables. How the GPU lays a
layer's stamps is a plan (`stampAccumulationPlan`): a fixed blend where stamp order can't change the build, and
otherwise, for a `buildToOpacity` whose opacity falls (Photoshop never lowers what's built), each pixel walks its
stamps in order and lays each by the table's `lay`. `stamp-paint-recipe.ts` is the painting a scene writes, with its
paper. `studio/` is the WebGPU renderer, its uniform layout and the compositor.

Wet paint is a wash, a pass painted wet (`group.wash`): its deposits paint, wet (`water`, `soften`, `bloom`) or lift,
and it can `wait` in painting time, which only its waits advance. `stamp-wetness.ts` works out, once as a painting
loads, how wet the paper is where each lands, on coarse grids; the pigment compositor's `landDeposit` lays it by the
laws in `stamp-wet-landing.ts` and `stamp-wet-lift.ts`, and `studio/stamp-wet-stages.ts` lists what then works over
the neighbourhood: the flow stage (`stamp-wet-flow.ts`), where a deposit's fresh paint feathers into water on the
paper and the workable paint its water stirs evens out, and a lift's run-back. A graded material lays each pigment
of either end, its amount graded on the GPU. A plain pass lands as it always has. Flat colour has no washes.
`stamp-paint-events.ts` is the painting in painting order, each deposit with the time it's settled by.

**The flow stage.** Two populations move: the deposit's fresh paint (what `landDeposit` laid, left in `fresh`),
freely, and the paint already there, as far as the deposit's water stirs it (workable, not `dried`, where its brush
touched). Each is a conserved diffusion of sigma = flow × diameter / 2 at full wetness, narrower as drier. Paper is as
wet as it was, or as the brush's water where it touched, so paint on dry paper keeps a hard edge.
- It runs as passes at strides growing by about √2 (1, 2, 3, 4, 6, 8, 11, …), x then y, each a three-tap exchange
  with the pixels a stride away. A pass adds variance of up to stride² / 2, and a pair takes the share of it its own
  sigma needs. Doubling strides left ripples a stride apart.
- Two pixels trade only as freely as the driest, least open pixel between them (a way, built per stride from the
  last's), so paint never jumps a reserve or a dry gap.
- What diffuses is each population's potential, its amounts averaged over 8 × 8 pixels, so granulation neither drives
  paint nor is smoothed away. The layer takes the potential's net move, so texture stays where paint stays. A pixel
  gives as its paint fills its potential, so never more than it holds.
- Moves are f32 and the layer takes them in one f16 store: this GPU truncates f16 stores, and a store per pass lost
  a tenth of a percent of the pigment.

**procreate-brushes** reads a Procreate brush's settings into a `StampBrush` (`procreate-brush.ts`, by the constants
of `procreate-reading.ts`), and the stroke Procreate draws its previews along. Its `engine/` reads binary plists and
`.procreate` canvases.

**photoshop-brushes** reads Photoshop's: the preset schema in Photoshop's own units (`photoshop-preset.ts`), the
`.abr` reader and descriptor codec, the normalizer (`photoshop-brush.ts`, by `photoshop-reading.ts`, which resolves every source of pressure,
the brush's, the options bar's and a lingering pose's, into the brush's dynamics by one precedence), computed round
tips, and the capture rig that has Photoshop paint probes and references (docs/photoshop-capture.md). It imports
procreate-brushes only for the S-curve its references are painted along, Procreate's preview stroke.

**stamp-styles** is a pack on disk and a style in a project: the manifest (`stamp-paint-pack.ts`), `StampPaintStyle`,
the importers, the bundle's styles and `StampPainting`. It is its own feature because a pack and its importer read
both apps' brushes; inside either app's feature, that app would import the other back.

**brush-fidelity** holds a painted brush against its target, a Procreate preview or a Photoshop reference capture
(`brush-fidelity-target.ts`): one measure (`stroke-measure.ts`), one scorer (`brush-fidelity-score.ts`) that the
sheet, the fit, the diagnostic and the guard all use, one versioned report of a sheet (`brush-fidelity-report.ts`,
naming the source, reading and scorer it was drawn under) that the fit's baselines and the guard read, and each app's
reading registered for fitting (`brush-readings.ts`). `npm run brushes:sheet`, `brushes:fit` and `brushes:diagnose` run it (docs/private-styles.md).

**stamp-paint-gate** holds the GPU renderer to accepted output (`npm run stamp:gate -- run`): every rendering
formula over a grid, each runtime twin against its CPU side, synthetic paintings that walk every path the renderer
takes, and a traced resolve against its frame. Pre-commit runs it on the staged tree when a path it covers changes;
no adapter, a timeout or a difference fails the commit. Public baselines live in `harness/fixtures/stamp-paint/`, a
pack's brushes' in `work/validation/stamp-paint/` (`stamp:gate -- private run`). A baseline changes only by
`update <ids> --reason …`, which writes candidates with their differences, then `accept <ids>`.

`lib/platform/zip/` reads the zips packs come in. `lint/policy/studio-tree.ts` declares the areas; check:arch holds
each feature to its roles and refuses a cycle between features.
