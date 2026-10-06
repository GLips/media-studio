# The brush engine

Stamp painting is split by body of knowledge: what paint is, what a brush is and how a hand lays it, how a painting
lands, what each app's brushes mean, the packs they come in, the styles that carry a pack into a project, how close a
painted brush comes to the app's own, the studies a person judges, and the gate that holds the renderer. Each is a
feature under `lib/paint/`, each importing only those below it:

```
shot               → document, animation, rig, three-layers, style, painting, brush, picture/lens, picture/profiling
document           → style, painting, materials, brush
animation          → painting
rig                → painting
brush-fidelity     → brush-packs, photoshop-brushes, procreate-brushes, painting, brush
studies            → style, brush-packs, painting, materials, brush
gate               → shot, document, brush-packs, painting, materials, brush
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

**painting** is the engine. `stamp-paint-recipe.ts` writes the painting a scene paints against its environment (its
paper and mixing; a resolved style is one): groups, each of passages, each a tree of applications
(`stamp-paint-passage.ts`: `p.apply`, `p.each`, the techniques `defineStampTechnique` makes, the wet touches in
`stamp-wet-techniques.ts` and the catalogue in `stamp-technique-catalogue.ts`) over the operations that write
deposits. A technique's handle carries its footprint (the regions, paths and places its deposits went, as
written); its defaults layer the style's (`StampPaintEnvironment.techniques`) over its own over its passage's. Every operation is checked against its medium's capabilities as it's written, so a recipe a
medium can't paint never compiles. A painting is always drawn finished: nothing paints in over time. A scene that
wants a part to appear shows its group by `visibility`.
`stamp-paint-recipe-types.ts` holds what it writes, and `stamp-paint-recipe-compile.ts` checks it and places its
stamps. `stamp-deposit-compile.ts` prepares its deposits, `stamp-fill.ts` fills a region, and `stamp-region.ts` and
`stamp-blur-region.ts` mask one. `stamp-deposit-stages.ts` holds the plans a deposit's stages resolve in and which of
a brush's stages are active (`stampActiveLayers`). Rendering maths lives only in WGSL, generated from those tables
and brush's; the GPU is the one renderer. A function keeps a CPU twin only where the studio runs it off the GPU too
(Kubelka–Munk, `stampPaintFieldAt`, a region's distance and grid, an area's coverage), and a dual mode declares
`needsDual` rather than having the CPU run its combine. The GPU's resolve order and mode switches are generated from
the tables. How the GPU lays a layer's stamps is a plan (`stampAccumulationPlan`): a fixed blend where stamp order can't change the build, and
otherwise, for a `buildToOpacity` whose opacity falls (Photoshop never lowers what's built), each pixel walks its
stamps in order and lays each by the table's `lay`. `studio/` is the WebGPU renderer, its uniform layout and the
compositors. The renderer's stages stand apart for any driver to call: a bank loads deposits and binds their brushes
(`stamp-deposit-bank.ts`), and the deposit drawing (`stamp-deposit-drawing.ts`, its WGSL in
`stamp-deposit-stamp-wgsl.ts` and `stamp-deposit-resolve-wgsl.ts`) lays one, given its landing, stages, tooth and
regions each draw; on the same targets it loads a wash's stages, starts the wash and closes each drying (its `wash`).

**Fills and forms.** A fill floods its region (`stamp-fill.ts`) or lays it in strokes (`stamp-fill-strokes.ts`): a
pattern (`StampFillPattern`, each an object by `kind`) makes marks, `stampFillMarks`, each with a key and the patch a
hand lays it in, and `stampFillStrokePath` joins them, lifting between, into one stroke deposit. Rows (hatch, back and
forth, zigzag, shading, scribble) share one hand's random walk, so their keys are their order; a `contour`'s rings
(inset level sets of the region's distance grid, closed) and a `guided` fill's marks (blended by arc length between
consecutive authored cross-sections, keyed by the pair's guide IDs) draw from their own keys, so adding a guide
anywhere leaves the other pairs' marks where they were. A flood (`placeStampFlood`) is its brush's strokes round the
outline and in rows across it, landing within a barrier its `edge` (`StampFloodEdge`) makes: `barrier`, the default,
the outline itself, a wall its paint and water stop at and its drying rim gathers against; `lost`, a ramp out over
`reach` px past it (its line `ragged` as an area's may be), so the wash bleeds into wet paper and dries without a
line. A lost edge's strokes are planned over the outline grown as far as its barrier lets paint through
(`stampFloodLaidPast`), so the ramp grades paint that's there rather than the paper past where the strokes would stop.
A lost edge and a document's bleed are one soft edge (`stampLostEdge`). Only a barrier is a wall
(`stampDepositWalled`), in the wet field's held wetness and the rim's walls alike. A flood's `reach` lays the region
grown by its distance grid (`stampGrownPolygon`), not scaled. Every mark ends where its edge meets the outline unless its `reach` runs it past (`{ past }`, diameters
its centres may lie outside: rows run out across and along the shape, guided marks' ends on past the outline, a
contour's first ring out there), which only a clip (`clipTo`, `within`) trims. `stamp-form.ts` is a rounded form's
guides (`stampRoundedForm`): over an ellipsoid, given or fitted to the outline by its moments (an artistic assumption, its depth the shorter radius), Lambert's law gives the shade's
regions (contoured on a grid with the outline), the core (the shade's edge inside the form) and the lit stretches of
the outline. They're geometry: a style decides how to paint them.

**Areas.** A passage's `within`, an application's, masking fluid and an unmask act over a `StampArea` (`stamp-area.ts`): a region, its
edge (soft, ragged) and an inset. Its coverage is the region's signed distance less the inset, moved by the edge's
noise, ramped over its width, so an inset moves the edge without offsetting the polygon (a narrow feature can vanish).
The renderer works out each state of the fluid, each `within` and each wash's preparation once, as cropped textures
(`stamp-region-textures.ts`; `stampAreaCoverageAt` is their coverage's CPU twin). A group's `standsBefore` compiles into one more mask over the fluid of each deposit of the groups it names,
last, so it joins their fluid by max and none of their unmasks lifts it; a knockout's fluid is left alone.
A `within` may treat named stretches of its outline (`StampWithin.boundaries`, `stamp-area-boundaries.ts`): `keep`,
`feather` (coverage falls from full `reach` px inside to none at the outline) or `merge` (the edge opens `reach` px
outward, and the technique laying the shape lays water along it in the same history). A treatment holds where a
point's nearest piece of outline lies on its stretch and fades over its reach past the stretch's ends, so stretches
meet at a point without a notch; two running along each other treated differently are refused. Each `within` is
intersected with its ancestors', so a child's merge never opens an ancestor's cut. `boundaryShift` is the WGSL twin of
`stampBoundaryShift`, held by the gate's `areaCoverage boundaries` grid.

**Brushed masks.** Fluid can be brushed on, `mask(id, { marks })`, and a group can lay wax, `resist(id, { marks,
amount })` (`stamp-brushed-mask.ts`). A mark is placed from its key by the one path paint is (`placeStampDeposit`),
so the same mark painted elsewhere lands the same footprint. The renderer draws each brushed mask once as it loads
(`encodeStampBrushedMasks`, `stamp-brushed-mask-textures.ts`):
each mark's stamps resolved as a deposit's coverage is (builds, grain, dual, pooling), never pigment, joined by max
into a texture a step of the fluid reads, and the wet field reads it per pixel, so water lands only where a sparse
brush left paper open. Wax keeps only what catches the paper's peaks (`paintDryContact`, at the paper's depth)
× `amount`; it lies over every deposit of its group declared after it, past every unmask and passage, and ends with
the group. A knockout ignores it, as it does `standsBefore`. Live marks bringing a brushed mask of their own are
refused. Cost at 1080p: about 0.3 ms of load a mark, and a frame reads it as it reads an area's.

Wet paint is a wash, a passage with a wetness history (`group.passage` in a medium with `'wet-history'`, unless it
says `wetHistory: false`): its deposits paint, wet (`water`, `stampSoften`, `stampBloom`) or lift, and it can `wait`
in painting time, which only its waits advance. `compileStampWetness` (`stamp-wash-waits.ts`) works out, once as a
painting loads, when each lands and how long each wait lasts, in closed form by the laws in `stamp-wetness.ts`; each
wash's ledger (`stamp-wash-ledger.ts`) keeps what its deposits find and its dryings at the times it's given. Where
water lands is per pixel, on the GPU, in each wash's wet
field (`studio/stamp-wet-field.ts`), in draw order, in the pass that resolves the deposit. For a deposit its stages
read, the same pass leaves its landing (its water's contact, the paper it found and the wetness it leaves) as far
round its box as they read (`landingReach`); they read the paper only from there. A boil's epoch and live marks each
have their own wetness, worked out from the marks they draw. The pigment compositor's `landDeposit` lays each deposit by the
laws in `stamp-wet-landing.ts` and `stamp-wet-lift.ts`, and `studio/stamp-wet-stage-list.ts` lists what then works over
the neighbourhood: the flow stage (`stamp-wet-flow.ts`), where a deposit's fresh paint feathers into water on the
paper and the workable paint its water stirs evens out, or paint runs back into a lift, and the drying rim
(`stamp-wet-rim.ts`) at each of a wash's dryings. The dryings come from the resolved wetness, not the waits'
tokens: `compileStampWetness` closes one after any wait the whole wash has set by (a `wait('set')`, or a seconds wait
long enough) and one at the wash's end, each `StampWashRecord.dryings`, which the rim stage and the wet report both
read. A drying is the whole wash's, never a region's. A graded material lays each pigment
of either end, its amount graded on the GPU. A passage without a history lands as it always has. Flat colour has no washes.

**The sheet solver.** A painting document's sheet is solved forward, not timed in closed form. Its program
(`stamp-sheet-program.ts`, compiled by `lib/paint/document`) is a film per layer, a wash per wash and each application
a deposit planned at rest. `solveStampSheet` (`studio/stamp-sheet-solver.ts`) runs it beside the renderer, on the
stages the renderer calls (the deposit drawing, the wet stages, the lay pass). Each application's time is decided
against the paper the ones before it left: the GPU sums over its core (where its touch reaches 0.5, each texel
weighing its touch times the share it may land there: off its fluid, within its regions, inside its clip base) in
integer atomics, two-word totals and 4096-bin damp histograms (`stamp-sheet-reductions.ts`),
and the CPU decides in f64 on a 1 ms grid (`stamp-sheet-schedule.ts`, `stamp-sheet-decide.ts`), checked again by the
field's own law. A histogram bins each wetted texel's weight by the step it turns matte and by its last workable step,
weight set by its first step going into words of its own, so a bin's bound is what's matte by its end less what has
set by its start, exact a step wide (`stamp-damp-histogram.ts`). An `on` that can't hold, or a bloom with nothing to
act on, is a `StampSheetRefusal`, its message the author's (`stampSheetUnreachable`, one shape for every `on`, a fixed
`at`'s too), naming a fix. A `wet` is judged at τ0 alone (wetness only falls), its fix picked by what its failing
texels did: a `dulled` total (laid shiny, dried past it by τ0) at least the rest that failed (never laid shiny) means
it came too late; else a lift the solve state kept since the last drying meeting a failure cell marked never shiny; else
no core texel shiny; else the rim. A solve asked for damp windows (`check --solve`)
reads, after each wash's last landing, when what the wash wetted is damp, and after each bloom, when its footprint is:
the same histograms over the wash's touches and its prewet's contact, or the bloom's core (`stamp-sheet-damp-report.ts`).
The laws' times on the CPU are `stampDryingTimes`, which the reductions' WGSL runs per texel. Then it lands into the
one wet field and its film; its water reaches other films' paint through a proxy, seeded as the deposit is, though
only into films that keep a wet history or lift (any other direct film has no open channel); a drying closes once
everything since the last has set, rimming each film that painted in it, each film's rim seeded by the last deposit it
dries, never by the film's place or the drying's count, and at the end every wet film's open paint
settles. The field keeps times after a base it moves up past 2¹³ s. It solves a posed program: `paintingSheetPosed`
(`lib/paint/document/models/painting-pose.ts`) maps each entry's marks by its chain's similarity, anchored clips,
reserves and resists staying: stamps placed, scaled and turned, areas by their outlines, widths scaled. What travels
with the paint is read where it was planned: a posed deposit, area and prewet carry `rest` (`StampRestMap`,
`stamp-rest-map.ts`), the map back to rest, and a stamp its rest point, where its tip noise is seeded; the resolve
reads the fill's load field, pigment clumps and a flood's local scale there, the region pass a ragged edge's noise,
the prewet its water. The paper's tooth and grain are read where they lie. Keys chain from the program's head through each entry's
digest (the SHA-256 of what it reads of the document, with the marks it compiled to, hashed as its canonical text is
written so that text is never held whole: `platform/hash`'s streaming `createTextSha256`) and its pose's text
(`stamp-sheet-state-key.ts`), so a decision is remembered by its prefix, and a solve's films are kept, cropped, in the device's cache under its last
key (`stamp-sheet-films.ts`), which a still lays as the renderer lays a painting. The run of entries is
`stamp-sheet-run.ts`, on the program's clock, whose policy is pure functions in `stamp-sheet-schedule.ts`: a `scale`
maps model time to scene seconds from S at τc, the unclocked run's end, so a numeric origin or fixed `at` maps back;
`instant` sets the sheet before each clocked entry; `never` dries nothing (its drying's rate 0, the WGSL's set times
infinite). A decision is made in two parts, its wash's start and its landing, and a remembered one replays through
the same parts. A solve may stop at a prefix: `through` entries,
or those landing by a scene second `at`, finished unless asked not to. An entry decided past `at` doesn't land, and a
wash it started is undone from the checkpoint before it. Checkpoints (`stamp-sheet-checkpoints.ts`, the cache's
producer `checkpoint`, given up first) keep every film over its paint box, the field's paper and rim, the clip
coverages later entries read (`stamp-sheet-clips.ts`, one clip target holding one wash's at a time) and the CPU state,
before each wash's first entry, the first posed one, and where a prefix stops, unfinished; a solve resumes from the
latest its prefix has. One a rollback needs is held against eviction from the step keeping it, and a checkpoint
relied on but gone is an engine fault, never a silent restart. Its targets are the device owner's, held by the
solve's scope (`scope.target`, named `sheet …`, at the stage's size) until it ends: kept in the cache once let go,
for the next solve that size to find, so a solve clears its films before it reads them. A solve holds the device's FIFO lease (`stamp-solve-lease.ts`) from its first encode to its
last readback, never holds an encoder across an await, and counts into a `StampPaintCostTally` when given one (its
solve and where it resumed, decisions made and reused, films and checkpoints found or not, readbacks, warnings). The
renderer and the solver read a layered target back through `stamp-layer-readback.ts`. A solve whose every decision is remembered and whose films are still kept under its last
key is that solve (`keptStampSheetFilms`): a pose met again solves nothing. Whoever draws or reads films holds them
(`holdStampSheetFilms`) until it's done, so another solve making room in the cache can't give them up. It solves any
sheet, clocked or not; the gate's `schedule/` and `sheet/` cases hold it to the wet laws' closed forms.
`stamp-sheet-composite.ts` lays a selection's solved sheets as one picture (ENGINE 5.4): the root's paper as the
ground, then each film where its layer comes in document order, and an own sheet's card (its paper, wherever the union
of its films' coverage reaches half, by `STAMP_OPAQUE_COVER`) where its owner comes, before every node under it, so a
nested sheet lies on its parent's card and a scene layer under the owner glazes over the card. Its `shown` levels, a
rig's pieces fading, lay each film at an opacity, count a card's films as far as they show, and mix spans faded apart
back by their visibility (`studio/stamp-span-fade-pass.ts`), as a shot's plane lays them. Each sheet lays with its
own compositor and lay, so one device holds several papers; a sheet its owner's chain poses lays through a rest
texture, films and edge sampled at the rest point (`drawPlacedRest`, by the map's words and its inverse's,
`StampSheetPlace`), so its grain moves with it. The edge is the films' union, cached under their keys (producer
`edge`). A film a reveal cuts (a document's `reveal`, `stamp-reveal.ts`) is laid through `studio/stamp-reveal-pass.ts`:
an r32float cut over the layer target, each texel's share shown at the selection's time, which the lay takes into
its opacity before compositing (pigment, before colour) and the card's union takes into that film's coverage, so the
paper follows the revealed paint. A strokes reveal's arrivals (first arrival and its cover, the first at full cover
and the cover its arrived bands' union reaches, seconds per px) are drawn once into an rgba32uint map over the box its
bands reach, from tile lists of segments, and
kept under producer `arrival` by the reveal, its mapping, wrap and resolution; on a wrapped sheet its segments are
copied a period each way, so a band wraps with its paint. A field's are read where they're needed, at each texel's own
document px with no period, so on a wrapped sheet a mark crossing a seam arrives in two halves unless the field
arrives alike on both edges; the document check warns of it (`painting-reveal-seam-check.ts`). A field's base is read
through its profile: 32 samples of its share, which the document makes from the profile's curve
(`painting-reveal-profile.ts`) and the cut's uniform holds, read linearly between, by the pass and its twin alike. The
engine never sees a curve, so any curve the document names is drawn the same way. The times an author reads off a
reveal (`paintingRevealEnd`, `paintingRevealArrivalAt`) come from the arithmetic the pass reads: its arrival span and its arrivals.
The cuts multiply, a group's over its descendants', and each is read where its node's marks were solved: posed paint
carries its reveal (a warp by its fitted similarity). The root's ground is never cut; the solve, its checkpoints and
the water never see a reveal, so the evaluation diff lists a reveal edit under its `reveals`, recomposing only. `stamp-film-readback.ts` reads a solved film back for a rig and its tools (ENGINE 5.1): its coverage,
document-sized, or its picture, premultiplied linear, laid clear or on its sheet's paper and edge (the root's paper
over the document, an own sheet's card over its union, as its program's `edge` says). A clear picture is laid over
white and over black and read as the two-point reading against each backing's light, so laid back over any ground it
shows as it did on paper. Each readback is kept per device under its film's key and backing,
`STAMP_FILM_READBACK_BYTES` in all, the least recently read given up first, counted as film readback hits and misses;
a composite's picture is kept alike under a key naming its films, steps and cards' papers (`readStampSheetsPictureKept`),
as a shot's rigs read their cels and pieces.

**Wrapped sheets.** A document saying `wrap` (`StampWrap`: `'x'`, `'y'` or `'xy'`) meets its opposite edges on
each axis it names (`stampWrapsAcross`), on every sheet (`stamp-sheet-wrap.ts`); its program carries `wrap`, its head
naming it only when set. Every axis is one treatment: the stage's `wrapPeriods` holds a period per axis
(`StampWrapPeriods`, the frame's width or height, 0 on an axis that doesn't wrap), and each step below reads it per
axis. Its solve's plan
(`stampSheetSolvePlan`, pure: stage, K₀'s head, the program painted) bands it: on a stage whose margin is a halo
(`stampStage(frame, halo, wrap)`), the farthest any mark may lay paint or carry water past its place
(`stampSheetWrapHalo`, the wet reach `stampSheetWetReach` as the load boxes it) rounded up to a power of two, in K₀,
so an edit widening the widest reach a little keeps the key and one past a power of two re-keys the sheet whole; every
deposit's and brushed mask's stamps copied whole periods away along each wrapped axis, and across the corner when both
wrap, as far as a stamp on the halo's edge reaches; and every area copied a period apart on each as the region
textures draw it, both copies enumerated by one `stampWrapOffsets` (the region textures' WGSL mask step its twin). A copy keeps its stamp's `rest`, where its tip noise and rolling grain are read, and its deposit or
prewet its `wrapFrom`, a point `{x, y}` (`StampWrapFrom`): the resolve reads its load field, clumps and flood scale within the
wrap centred on where it was planned, per axis (`stageUnwrapped`, with STAGE_WRAP a vec2f, in `stampStageWgsl`), so a
copy's pixels read as its own. The paper repeats with it: tooth and grain tiles fitted to a whole number round each
wrapped axis, mirrored ones in pairs (`stampStageTile`), so a mirrored tile is laid (W ÷ 2n) × (H ÷ 2m) on `'xy'`,
each side the nearest its own; one axis wrapping, the other side follows and the tile keeps its aspect, though down y
not its scale; both wrapping, its aspect goes by the frame's (a square grain at 0.5 on a 16:9 tile is laid squashed
16:9). Value noise and pigment clumps sit on whole cells per wrapped axis (`paintNoiseWrapped`,
`paintClumpsWrapped`). Films are kept cropped to the frame and a refusal's boxes name only
what lies in it: the halo is painted so paint by a seam finds its neighbours, and never kept. Negative space: the
halo is laid on every side, so an axis that doesn't wrap has it too and water runs off its edges as off a larger
sheet; a deposit wider or taller than the wrap reads its fields within the one wrap round its middle, so a field
running along it jumps where that ends; the halo bounds one entry's reach, and at the stage's edge a flow meets a
wall, not paint going on round, so a long chain of wet-in-wet entries across a seam may drift there; a paper
photograph is laid as it is and meets itself at each seam, and a grain tile laid more than a tenth off its authored
size is warned of: its width by `checkPaintingDocument`, its height, which goes by the image's aspect, by a solve that
loads the image (`paintingWrappedGrainHeightProblem`, printed by `studio paint check --solve` and `studio paint
still`); and the composite moves an own sheet its owner chain poses whole, unwrapped.

**Capabilities.** A `PaintMedium` declares what it can do besides lay paint (`PaintCapability`): `'wet-history'`,
`'wet-conditions'`, `'water'`, `'lift'`, `'burnish'`. Watercolour and gouache declare the first four; crayon `lift`
(its eraser) and `burnish`; flat colour, in no medium, none. Every medium has `wetting` and a sheen, so nothing is
read off them: `checkPaintCapability` is the one check, which the recipe makes as each operation is written (a
burnish, a lift, a wait, a `when`, a wet technique, water a deposit states, `wetHistory: false`), its message naming
the medium. Which law lays a deposit is `stampDepositionLaw`, per
deposit: water, a lift (in a direct wash too: crayon's eraser), and paint from a wet brush in a medium with wet
history land in the wash's history (`landDeposit`); any other paint, a dry-media brush's or crayon's in a wash too, is
laid by the dry law (`layDeposit`: pressure, the tooth, a burnish). A document's wash that lifts compiles `lifts`
(`paintingWashLifts`, which also gives its film the open channel), and a direct one holding it is mixed as a wash
(`stampSheetMixedPainting`), so its lifts land through the history as a recipe passage's do while its other
applications stay direct; the gate's `schedule/forward: eraser` holds a crayon line erased under the eraser's core
and untouched past its reach.

**Dry brush.** Where paint meets the tooth is the medium's `paperContact`: a wet medium pools into the valleys, a dry
one catches on the peaks. Every wet medium also declares a `dryBrush` tooth (0.85 for watercolour and gouache): its
dry-media brushes drag over the sheet and catch only the peaks above it, more as they press (`paintDryContact`), and
skip the valleys whatever the paper's depth, which is tuned to how wet paint shows the tooth. The paint stays the
medium's (it glazes or covers and mixes, stacking no wax). The dry brush's contact scales how far a pixel moves toward
its paint (`dryBrushShare`, beside the rest of its contact in `stamp-paint-pigment-lay.ts`), not the paint itself, so a
valley it skips keeps what's there: a scumble over a block leaves the block in the valleys rather than thinning it.
How a deposit meets the paper (`stampBrushPaperContact`: peaks, valleys or flat) is decided in one place, which the
compiler, the stamps' load and `studio brushes describe` all ask; on the peaks, a dry medium's or a dry brush's, the
tooth answers pressure and the brush's grain depth by pressure is set aside (`STAMP_PRESSURE_GRAIN_OWNER`). The
gate's `wash/dry-brush` (watercolour) and `wash/dry-brush-gouache` hold a dry stroke darker where the paper stands
higher and a wet one not, and a pale dry stroke scumbled over half a dark band lightening it more where the paper
stands higher while its valleys keep the bare half's darkness. A profile's medium key reads the medium as a probe
sees it (`paintMediumAsProbed`), without the dry-brush tooth: probes paint a pack's brushes as the pack reads them,
never dragged dry.

**Water.** A deposit's water is resolved once, as it compiles in its medium (`stampDepositWater`, kept as
`StampPigmentDeposit.water`): a lift's none; water its action states, which a medium without `'water'` refuses (crayon
does); else the medium's `wetting.defaultWater`. Flat colour, in no medium and with no washes, lays wet paint (1).
The wetness history and a stage's reach read it; where a flood stops is its edge's, never its water's. In peaks contact the paper's tooth owns a stamp's grain
response to pressure, the brush's set aside (`STAMP_PRESSURE_GRAIN_OWNER`).

**Fields.** A material, a fill's load and a preparation's wetness are each a `StampPaintField`
(`stamp-paint-field.ts`): constant, linear, radial, or noise, two octaves of seeded value noise at a feature size in
painting pixels, their lattices turned off the painting's axes. Every reader reads one share (`paintFieldShare` on the
GPU, its CPU twin for a strokes fill's stamp opacity). A noise field's seed is settled as the
recipe compiles (`stampSeededPaintField`): its own `seed`, a passage several deposits share, else the deposit's ID (a
preparation's, its passage's), never a boil's epoch's.

**Rim strength.** Each drying carries a `rim`, 0..2: its `wait('set', { rim })`'s, else its passage's `rim`, else 1. A
seconds wait takes no `rim`: one that sets the paper closes its drying at the wash's strength. It
scales what each band pixel gives before the transport normalises it, so pigment stays conserved and the band and its
eligibility are the medium's. At 0 the stage loads nothing for the drying but still owns its deposits' wet edges
(`ownsWetEdges`), so their brushes' own rims stay off: a drying with no rim is a soft-edged wash, not a brush's ring.

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

**Wet state.** Each wash's wet field holds the paper, per pixel: the level its water last went to and when, and
whether it had dried out since (`settled`, 1 at a wash's start too). Every reader works out `wetness`, `workable` and
`settled` at its own painting second (`wetPaperAt`, `stampWetnessAt` and `stampWorkableAt`'s twin). The paint's
own history is in the group's layer: a group with a wash keeps, in its last channel, each pixel's open share, how
much of its paint hasn't set, mixed by amount as paint lands or moves. Every landing first sets it to none where the
paper has settled, over its whole box; so paint that dried and is wetted again moves or lifts only by the medium's
rewetting.
- Landing (`wetLand`): on dry, set paper as `layDeposit` lays, toward the stroke less what the paint there picks up;
  on wet paper adding; between, as workable as the paper is. A wash brush's water hardens its tip's coverage to an
  edge (`wetLandCover`, smoothstep 0.15–0.45) as far as the paper is drier than the brush.
- Each stage declares its static reach (`reach(deposit, medium, water)`); a deposit's resolve box widens by the most of them, and
  what it may find under it (`StampWetFinds`) is judged that far round.

**The flow stage.** Two populations move: the deposit's fresh paint (what `landDeposit` laid, left in `fresh`),
freely, and the paint already there, as far as the deposit's water stirs it (workable and open, where its brush
touched). Each is a conserved diffusion of sigma = spread × diameter / 2 at full wetness, narrower as drier. Paper is as
wet as it was, or as the brush's water where it touched, so paint on dry paper keeps a hard edge. The brush's water
touches by its contact (`stamp-wet-contact.ts`) times the share of its stroke that landed there, whatever pigment it
carried; a flood's, within its barrier too, so a walled flood's stamps' fringe past its outline lies dry. A water stroke's
brush drags paint along where it touches, however damp, so there paint moves as on flooded paper: a soften reaches
its sigma rather than its water's share of it.
- After a lift there's no fresh paint: the paint round it runs back in, as loose as the lift would find it, a pair
  trading only as far as the lift reached either of it, at sigma = spread × diameter / 3, at most 16 px. Paint runs
  into a pixel only as far as the wash covers it (`flowRefill`), so a lift's water never carries paint onto paper the
  wash left bare, such as a flood's specks where its tip broke: filled, they even the wash darker than it was.
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

**Marks, charges and the wet report.** `stamp-marks.ts` is the scatter core (`stampScatterMarks`: candidates over
an area, weighted, or along a path, each drawn from `${key}|${k}` alone, so a bigger count keeps the first ones) and
`StampMark`, a brush's geometry with a placement key. A deposit built from a mark (`p.mark`, every
`stampCharge` touch) is placed by `stampMarkStamps` from the mark's key, the one path a stroke or placement deposit is
placed by, so anything else built from the mark lands the same stamps. `stamp-material-set.ts` is a weighted set of
materials a generator picks from by key (`pickStampMaterial`); a deposit's own material is never a set.
`stampCharge` writes ordinary strokes (`${id}-${k}`), geometry and material from separate streams.

**Waits.** A wash waits for a sheen state, `'shiny'` or `'damp'` (the medium's `PaintSheen` thresholds, which the
bloom's merging reads too), or `'set'` (water gone and no paint workable, a drying: it rims), or for `{ seconds }` (a drying too, if the whole
wash has set by its end).
A shiny or damp `p.wait` judges, in closed form, the wettest paper the wash's water could leave in the whole wash
(compiled `under: 'wash'`) or a region; an operation's or application's `when` judges its own deposits (`under: {
deposits }`, counting only water whose box meets theirs; a charge's touches together). Already past, it takes 0 s. A
`when: 'set'` is a wash wait for `'set'` before the call. Every technique's `when` writes one, carrying the effect
that asked for it (its spec's `effect`, a charge unless it says) and, when the author wrote it rather than the
technique defaulting it, `authored`. `stamp-wet-report.ts` reads them: per wash each wait's span and how much water
it judged, each effect's touches with what they may find under them and the bloom stage's own bound
(`stampBloomBound`, with its reason), and each drying's widest band. Its verdicts are estimates: the GPU sizes each
bloom and rim from the paper itself. The renderer lists, as it loads (`wetWarnings`), effects that certainly won't
act and authored waits that do nothing (no paper, no water, or already drier: 0 s); a strict wash fails on them, and
`assertStampWetEffects` throws on them for a test.

**The transport.** Bloom and rim move what they move along the same ways, as a linear spread G (each pass
symmetric, so the passes in reverse order are exactly Gᵀ) and a normalised scatter: N = Gᵀ(receiver weight),
send = give / N, delivered = weight · G(send · paint). What's delivered totals what's given, per pigment, and goes only
where the paper lets it: a stage supplies the paper (wet, open), the bloom the deposit's wetness over its medium's damp
and where paint may land, the rim open wherever it isn't bare paper at the grain's scale.

**Frame state.** Everything about a group that varies with time reaches the renderer as data, per frame:
`renderer.draw([{ kind: 'once', t, state }])` takes a `StampPaintFrameState`, and `StampPainting`'s `frameAt` prop
gives one for a `PaintMoment` (`stamp-paint-frame-state.ts`, `StampPaintFrameAt`): `at`, the second an exposure sees,
within the frame shown at `frame`. A `fast` frame through a lens takes its `shutter`, the states as it opens and closes;
an `exposure` frame is one of a reference frame's. Each group's travel over a `StampMotionSpan` is rasterised through
its lattice into its plane picture's motion layer: the shutter's (`stampFramePlanMotion`, `shutter`, each group's
by `stampGroupTravel` between how it lies at the two ends; `stampTravel` under it is the one producer of travel, which a
shot's lattices call per vertex too), which the lens
gathers, or frame to frame (`transport`, over a travelling group's whole region), which paper advection asks for
with `renderer.transport({ t, state, from, to })`, apart from any lens. It holds
each group's:
- `lay`: a placement about its pivot;
- `warp`: a rest-to-scene map with a key naming it, sampled on a lattice over the group's painted layer;
- `marks`: `written` at a boil epoch (0 is as written), or `live`, compiled for this frame, with a key naming them;
- `paintAt`: the time its keyed paint reads;
- `visibility`: 0 draws none of it.

The compiled painting holds no functions of time. A group's painted layer, its film, depends only on its marks and
the time its keyed paint reads, so the renderer keeps each film on the device's GPU cache
(`stamp-paint-gpu-cache.ts`, one budget per device) under a key built from those, and equal keys must mean equal
marks. A group's paint lives one of three ways:
- **Stuck:** its film is carried, rigidly or bent by the warp. It's cheap, and blooms and edges ride along, but a
  bend magnifies what it carries.
- **Live:** it is re-placed from its posed geometry and its film painted again; every other film is kept.
  Line width and grain stay true at any stretch. Its marks must be the written group re-placed
  (`stampLiveGroupProblem`).
- **Boiling:** its rest space is wobbled on a stepped epoch, under its warp.

A moved or bent layer is laid at four texels, then blended, so crayon keeps its tooth under sub-pixel motion. A
recipe's own `motion`, `boil` (on the 24 fps animation clock, `PAINT_ANIMATION_FPS`) and keyed paint are evaluated
into the same shape (`stampPaintFrameStateAt`): given marks replace a recipe's boil, and any other field both write is
an error. A recipe's `motion` (`StampGroupMotion`, `stamp-group-motion.ts`) belongs to the recipe path and
StampPainting alone: keys of placements, linear between them. A shot moves a group by a node's `place` play, whose
`value` is a `PresentationValue` (`paint-value.ts`), keyed by `paintKeyed` or any function of the moment. A frame held on twos gives every group the keys it had, so it repaints nothing.

**animation** writes that frame state, and the renderer never sees a scene, a pose or a clock.
- **Shape sources** (`models/figure/`): a posed primitive figure, a construction of circles and capsules, or SVG paths.
  Each gives named parts, a silhouette, interior lines and anchors as regions.
- **Motion** (`paint-motion.ts`, `paint-motion-compile.ts`): a node per moving group, built over the compiled
  painting, which gives each group's painted box. A node has pins and how its marks live; a live node
  registers a poser, and motion keeps its posed marks by key. Plays of clips (`paint-motion-clips.ts`: poses,
  breathe, sway, flutter, place) run through clocks written as parts (`paint-clock.ts`: at, rate, loop, hold,
  freeze, until, on a 24 fps animation clock), compiled to steps in one order.
- **Deformation as data** (`paint-deform.ts`): each bend a node's paint goes through in a frame is a value with every
  spatial parameter and its rounded amount; its map and its key are both read from it. A point goes through its own
  bend and placement, then its parent's, as a rig nests.
- **Checks:** the build checks the tree, the groups, the clocks, the boil's wobble, one writer per lane
  (`paint-channels.ts`), and every frame's emitted warp for folds on the renderer's own lattice.
  `paintMotionFrameAt(motion, moment)` is pure in its `PaintMoment`, and writes each group's `StampGroupFrameState`.
- **Planes and the camera** (`painting/models/stamp-plane.ts`, `paint-camera.ts`, `paint-camera-build.ts`): a scene
  is planes, each `{ id, depth, source }`, laid far to near by each frame's depths: a depth may be a value in time,
  so a plane crossing another's depth passes it. The back, the farthest, keeps one depth and is paper to the stage's edge.
  Every nearer painted plane is clear film: its paint, opaque or glazed, hides and filters what's behind, moving,
  warping and fading with its group; as on one sheet over white and black, and close to it over other paint (see
  Planes on the GPU). A three
  plane is a lens source (`stamp-lens-source.ts`): a picture and motion layer rendered for each frame and exposure,
  which three.js fills (`painted-three-sources.ts`: `loadPaintedThreeSources` over painted textures supplied as
  handles with a hook drawing them each frame, a shot's by `createShotPaintedTextures`, `loadPaintedThree` supplying
  them from old renderers) and any other renderer can. A painted plane's picture doesn't depend on the camera and is kept on the device while
  its groups hold. The camera is one description: its plays, if any (none: at rest, every plane sharp), set `move`
  (pan, dolly, zoom, roll), with moves that add to it (`blend: 'add'`), and `focus` (focus depth, aperture), each a
  value in time (`paint-value.ts`, keyed by `paint-keyed.ts`), plus `fov` and a lens with one `bloom` and its `shutter`, seconds open or `'shut'` (built as 0 s; a shot leaving it out takes `paintFilmShutter`, half its film's frame). `paintCameraLensAt` gives each plane's view (a
  similarity) and defocus (a thin lens's circle of confusion, as gaussian sigma) at a time, through
  `paintCameraDepthLooks`, which gives them at any depth, as each instanced item takes them, and a depth in time
  read at the frame and at the shutter's ends, so a plane blurs along its approach; an instanced plane is
  built by its depths alone, its nearest held from the camera and magnified most, and a plane moving in depth by the
  depths sampled at its span's moments, held from the camera frame by frame. The build checks every plane's
  extent at each moment its shot's span draws (`paint-span-moments.ts`: each frame and its shutter's ends): the back
  everywhere the frame looks, the box those poses bound with no slack (a reference exposure between them lies within
  it unless a move turns inside the shutter, unchecked); a nearer plane where its groups' paint can be laid
  (`paint-motion-reach.ts`: the painted box grown by the most each step of the `motion` it's given and the recipe's
  own motion moves it at those moments, plus 2 px of slack), or everywhere the frame looks once a group's marks are
  live or re-seeded. A frame state from anything but that `motion` isn't covered. What the frame reads of a
  plane, the plane px it shows and how far past them its defocus reaches (3 sigma + 2 px, 0 while sharp), it gives
  span by span over the shot (`paintCameraShotReads`) or at a frame's moments (`paintCameraFrameReads`), for a shot to
  hold its back's painting to. It reports each plane's greatest magnification and names bad planes. `buildPaintingCamera` lays the scene's planes once
  (`StampPaintingCamera.planes`, a `StampLaidPlanes`: the back a picture by type, each nearer picture with the
  groups it shows), and the renderer takes that whole. `paint-camera-world.ts` gives a pose as the studio's one camera
  description (`ShotCamera`), landing a 3D point where the plane step lays its depth. A three plane renders past the
  frame by its widest defocus's reach (its built `margin`), so it blurs in what lies beyond the frame's edge. Each
  of its texels is defocused at its own distance, by depth (`lensDefocusWgsl`): a nearer texel spreads its blur over
  what's behind it, and a texel behind reaches one in front only as far as the sharper of the two blurs, so a sharp
  mug against a soft wall keeps its edge, the wall's blur fills in behind it, and neither gains or loses light there.
  Each render poses the source's scene, sets the exposure's camera (`painted-three-camera.ts`: every layer seen, a
  reference exposure's moved over the aperture), advances three's node frame (three draws a shadow map once a frame
  per camera, and only its animation loop advances frames otherwise), draws the scene's offscreen passes, each
  camera following the scene's first (`three-mirror-camera.ts` sets a planar mirror's), then draws the scene with its
  motion layer. The load draws it once the same way (`drawPaintedThreeSource`), so a render compiles nothing new. A
  scene asking for `shadows` has shadow maps on around its renders alone, the shared renderer put back after
  (`painted-three-shadows.ts`): its and its passes' directional and spot lights' maps filtered as percentage-closer
  soft shadows. A blocker search, reaching as far as a blocker on the shadow camera's near plane could shade the
  receiver, sets its penumbra by the gap behind its blockers, so a contact stays tight and a cast shadow softens, as
  wide as the light makes it whatever the map's size. The search loads texels and the filter compares them, the first
  read a comparison so three binds the map with a comparison sampler. A pass carries no motion layer, and a shadow on
  a still floor isn't blurred over a fast frame's shutter (the motion layer follows surfaces); a reference exposure
  draws both at its own moment.

**Planes on the GPU** (`stamp-paint-renderer.ts`, `stamp-paint-plane-passes.ts`). One owner holds a device
(`stamp-paint-gpu-owner.ts`, built on the studio's `gpu-device-owner.ts`, whose one three.js renderer the three
sources draw with): its images and one cache budget (`STAMP_GPU_CACHE_BUDGET`, 1.5 GiB), shared by films, pictures,
blurred pictures and the passes' targets, whose bytes it reports apart (`bytes()`: kept, and in targets). A pass takes
a target by name and shape for its frame's encoder (`owner.target`); work spanning encoders, a solve or the old
renderer, takes it from a scope, which holds it until it ends (`scope.target`, given the encoder open as it's first
taken, none at a load). A pass that reads what it last wrote, a shot's layer target clearing only its last box, keeps
its targets in a store of its own (`shot-sheets-lay.ts`). Every encoder is made, filled and submitted in one
synchronous run, so the cache knows the one open. Past the budget the cache gives up checkpoints first, then whatever the frame being encoded doesn't
use and nobody holds, least recently used first, so a long render's sizes never pile up. A 1 × 1 blank a pass binds
for nothing is the owner's for its life (`owner.blank`), and a crop's light measure is a texture of its own, freed
once read. A surface is one output on it. One painted plane at rest, sharp and not glowing is drawn straight
to the output, as a still always was. Otherwise each plane's picture is painted (paper, its groups, and each glowing
group's light into the plane's emission), defocused, and composited into a frame-sized target, its emission beside
it, so paint a nearer plane covers doesn't glow. The two renderers measure a glow apart
(`stamp-plane-glow-pass.ts`). StampPainting's is its laid paint's light past the threshold on the plane's first lay
(paper, or white for a clear plane), times the group's cover, opacity, visibility and `amount`; each later opaque
group on the plane dims it by its cover (a glaze leaves it). A shot's is the light its group adds past its threshold:
the painting's linear light over the group's box is kept (f32) before it's laid, and what the lay added, per channel
and never below 0, goes into the emission, its colour kept, its luminance less the threshold (none at or under it),
times `amount`. No coverage multiplies it: the lay already holds the film's opacity, visibility and masks. A glow,
constant or in time, is read once a moment on the node stating it (`shotNodeGlowAt`, `shot-frame-plan.ts`) and named
in the plane's key, so a pulse lays its plane anew as it changes; at an `amount` of 0 the film lays no light. A
pieces picture lays none. The back
glows on its paper, a clear plane on its black lay (`stampPlaneGlowsOn`): on white, light paint over nothing adds
nothing. So a veil glows by its thickness, a halo over a lamp's glass adds none of the glass's light, warm paint over
a dark road glows warm, and a glaze, taking light, glows only by what it scatters. Paper and a ground count as what's
under: a light laid on bare or reserved paper adds only what it's lighter than the paper, about nothing. A shot's
later films and cards on the plane don't dim an earlier film's glow. A clear plane's groups are laid twice, on plain white and on black whatever the paper (its films kept from the first lay):
opaque paint lies on its own paper, and only reserves and lifts show the measuring backing. Its light is taken as
affine in its backing, what it adds plus what it lets through, per RGB channel, from the two lays and the backings'
own light, measured once per renderer. That's exact over white and black; over other paint it's a two-point
linearisation of pigment's KM, which isn't affine (R + T²·b/(1 − R·b)) and works per spectral band. A semi-opaque
film over a mid-tone comes out a few levels light; a strongly coloured glaze over coloured paint, filtering its bands
unevenly, far lighter (the gate's `planes/one-sheet`: a phthalo glaze over mid-grey up to 76 levels). Its picture
holds what it adds and its taken share, what it takes from the light behind, so laying it filters what's behind and
then adds its colour (`over` for the back).
The output blooms the emission once (`lens.bloom`), adds it in linear light, and encodes. Texture contracts:
pictures, three sources and the composite are rgba16float, premultiplied linear; a painted texture three samples is
rgba16float, gamma-encoded and opaque in every mip level it has, decoded by `paintedThreeColorNode`, and read
repeating on each axis its handle's `wrap` names, u along x and v along y. three reads every handle trilinearly
across whatever levels it has and makes none of its own; a handle with a mip chain (a shot's) is read with
anisotropy 8 as well, an old renderer's (one level) without it. A glowing frame drawn without a lens is refused.

**rig** is a painted rig's geometry and its drawing: layers (whole paintings at rest) cut into parts that meet at
skin joints or hinges. `paint-rig-cuts.ts` holds a layer's parts with each joint resolved to its parent's index (a
part whose parent isn't on the layer is loose, a group of its own) and which part owns each texel; how a painter's
drawn regions become that is the painting tool's. `paint-rig-cel-layer.ts` lays parts painted on cels of their own
and skinned to each other as one such layer, each cel keeping its z inside it. `paint-rig-skin.ts` meshes a layer's skin-joined parts and poses
the mesh by rotation-blend skinning, each vertex turning by its share of a joint's angle, from each part's
rest-to-posed map; it measures folds across a joint's band. `paint-rig-pieces.ts` is what a posed rig is drawn from:
pictures through posed triangles (a group through its skin mesh, a cel through its lattice), posed on the CPU once
for renderer and measures alike. `paint-rig-piece-meshes.ts` draws them on the GPU as three.js meshes whose posed
vertices the lens's motion layer follows; `paint-rig-pieces-gpu.ts` draws them for a Node tool and reads them back.
`paint-rig-pose.ts` is a pose's moves and what a pose callback reads off the rig's declaration: a rest point carried
by its part's map up the chain, as the shot builds each part's (exact wherever the skin moves paint wholly with its
part), a two-bone reach, and a pose mirrored. A rig's files, poses and clocks stay with the projects that use them.

**document** is the painting language a source writes, which docs/painting-authoring.md teaches. A `*.painting.ts`
source's factory returns a `PaintingDocument` (`painting-document.ts`: a paper, a medium and a tree of layers, washes
and applications), its values held to its schema (`painting-properties.ts`). `painting()` (`painting-source.ts`)
evaluates a source, memoised by its values, and refuses a document with any error. `painting-document-check.ts` checks
one without the GPU, every problem a record naming its owner's key, field and footprint (`painting-problem.ts`), in
stages: values, shape and keys, the papers, layers, washes and applications (`painting-application-check.ts`,
`painting-region-check.ts`, `painting-mix-check.ts`, which also warns of a field of mixes whose middle, mixed by the
pure mixer, greys), then each sheet's rules (`painting-sheet-check.ts`) and each layer's pigments. Where a rule is the
engine's (a fill's guides and strokes, ring geometry, a deposit's water, a brush's measured diameters) the check calls
the engine's own problem function. A problem's box comes from `painting-footprint.ts`. A mix becomes the engine's
mixture, a hex part a pigment of its own, only in `painting-mix.ts`, which the mix check, the slots and the compile all
read. Brushes and papers are checked against a `PaintingStyleCatalogue` (`painting-styles.ts`): each style's brushes,
read as the bundle reads them (`readBundledStampPaintPacks`, `stampPaintStyleBrushes`), and the files it serves.
`studio paint check` builds it from `work/styles/`; for a source in `work/projects/<p>/` (`studioProjectOfFile`), only
the styles its `project.ts` names (`projectStyleNames`, as the bundle reads them) and of each only the images the bundle
serves (`stampPaintStyleImages`). A fill plans its strokes by its brush's measured profile, so its `diameterPx` is held
to that range by `stampBrushDiameterProblem` (`stamp-brush-profile.ts`, the rule `stampBrushMeasuredProfile` and the
profile's reads refuse by), statically and again as a selection compiles, every unplannable fill at once by owner.
`painting-tree.ts` resolves a document's tree: its sheets, and each node's medium and sheet; `painting-sheet-program.ts`
is each sheet's order, its layers' films (`painting-pigment-slots.ts`) and its clock, the one order the checks, the
evaluation diff (`painting-evaluation-diff.ts`) and the solver read. The checks never touch the GPU.
`painting-document-compile.ts` compiles a selection of an evaluation's layers to one solver program per sheet they
lie on, its clock and order times with it, each application through `painting-deposit-compile.ts` and
`painting-area-compile.ts`, each deposit's ID its layer's, wash's and application's keys (`#i` for an unkeyed
application), which seeds its colour and water, a boiling layer's seeds suffixed for its epoch (`painting-reseed.ts`),
the epochs given by layer or group key, and the composite's steps, the selections last read kept compiled up to
2.5 GiB across every evaluation (`PAINTING_SELECTIONS_KEPT_BYTES`, reckoned at 400 bytes a kept stamp: a render
reaching light after light, or a layer boiling into epoch after epoch, compiles anew at each, and kept for good they'd
fill a page's heap);
`painting-pose.ts` poses a program before it's solved, the poses last asked
for kept up to 256 MiB of stamps across programs (a rigged heron's pose is tens of MB, so a count a program would
grow a render's page frame by frame until it crashed); `studio/painting-sheets-solve.ts` solves a selection's sheets, holding their films until
its caller releases them, and places each own sheet by its owner chain's map; `studio/painting-film-readback.ts` reads
a selected layer's film back through its prefix (a `LayerSelection`, `painting-selection.ts`), its coverage
(`paintingFilmCoverage`) or its picture (`paintingFilmPicture`); `engine/painting-still.ts` resolves its
brushes and papers from `work/styles/` and has `studio/painting-still-page.ts` solve and lay it, for `studio paint
still` and `studio paint check --solve`.

**shot** is what a scene puts on screen from evaluations: a plane shows a `LayerSelection` (`layersOf`, the
document's, as a film readback reads one), `dissolve` blends two, `paintedSourceShares` weighs the selections a dissolve blends (linear in
each form a plane's picture takes, so one weighted sum), and `paintedSourceProblems` is what a shot's load refuses in
a plane's selection, an own sheet split among them (`shot-selection.ts`); `paintingInTime` takes a source's
properties as values in time, the shot choosing its key drawings and dissolving between them
(`shot-painting-in-time.ts`, the choice in `shot-key-drawings.ts`); and `PaintedShotProps` (`shot-props.ts`)
is the shot itself, its camera and its planes, each plane's entry holding all it and its occurrences do (visibility,
motion nodes and plays, rigs), in the engine's shapes. A drawable is named by plane id or occurrence key,
`<plane>/<key>` (`shot-occurrences.ts`): the entries are read into maps by that name as the shot loads
(`shot-entries.ts`), a problem in one named where it's written (`shotEntryProblem`), and every frame draws its planes
and instanced items far to near, planes first on ties (`shot-plan.ts`).

`PaintedShot` (`studio/painted-shot.tsx`) is a shot in a scene, beside `StampPainting`: one device owner over its
canvases, the first opaque and each `PaintedShotCanvas` after it a glaze (`shotCanvasLaying`). A glaze canvas is two
elements (`ShotCanvasElements`; `shot-canvas.ts` makes them, every shot's element and their surfaces): a filter the page multiplies by (`mix-blend-mode:
multiply`), then its colour over it, both premultiplied. Its frame keeps what it lets through per channel, T, beside
its light C (the lens's `through` target: multiplied as filters lay, summed and gathered with the colour), and the
lens's `glaze` encoding writes both images so that over an opaque page colour P, encoded, the browser shows
k + (1 − a)·f·P per channel: a line fitted to enc(C + T·lin(P)), exact over white and least squares over eight
greys, so a strong coloured glaze over a channel the page holds near black strays up to about 20 levels. The shot's
element is an isolated group, so the multiply reaches only its own HTML and canvases: where nothing lies behind a
glaze inside the shot, the multiply meets a clear backdrop and the filter lays as plain colour, so the page outside
sees the glaze through one alpha, exact over white and lighter, toward its filter's hue, over a darker page. Its page is read by `studio/shot-dom-points.ts` once fonts and layout settle, as it
loads and again as each frame draws: whether HTML lies behind the first canvas, which lets the back be clear (laid as
clear film, its canvas a glaze too: `clearBack`) and must stay there while it is; that every canvas, fixed to the
shot's element, fills it, no wrapper between them transformed, filtered or contained, and none between a glaze and its
shot making a stacking context, which would multiply it over that group alone; and where each pinned element (its
`data-pin` named by the pin) lies. `shot-compile.ts` checks the props as they load, every problem at once: planes far
to near, each painted plane's occurrences from its first evaluation (read through its `sourceClock`), the planes'
entries, their rigs, visibility and motion, and the masks over them, and the camera built over each plane's reach (`shot-reach.ts`), every value
sampled over the shot's span; then it warns of motion that may read badly there (`shot-motion-warnings.ts`). A plane laid on the
frame is unchecked in that build and laid through the built camera after it, the inverse of its plane view at the
lay's `at` (`paintPlaneViewAt`, `shotScreenLaid` in `shot-placement.ts`), then checked by the build's own rule
(`paintCameraPictureProblem`): a cover once, as the shot compiles; a pin each frame, from its elements' centres as
measured then, and again when one resizes (`shotPinnedPlanes`). The opaque back's paint stops at its document, past
which lies bare paper a blur or a move would read into the frame's edge, so `shot-back.ts` holds its painting to all
the frame reads of it: its document, taken in by what its node's bend, boil and placements bring each edge in (a
push in brings none in), must hold those reads worked back through its lay. A still lay is checked as the shot
compiles, a cover as it's laid, a pin as it's measured (`shotBarePaperProblem`), and a callback's lay at each frame's
moment and shutter ends as its lay is planned (`shotBackFrameProblem`, thrown). The refusal names the fix in the
lay's own terms: a scale about its pivot or a lay literal, a smaller cover box, pin points nearer, or how many px more
to paint and where the lay then goes. Motion (`shot-motion.ts`) hangs each node from its nearest enclosing node, a paintless
group's too, its clock chained under its parents' and the plane's `clock`. `shot-frame-plan.ts` reads a plane at one
moment: the selections its source blends at its source moment, each with its weight (`shotPlaneSharesAt`), its node poses (boil wobble out of the poses marks solve under, in the
ones the lay reads), boil epochs, visibility and rig poses. A rig (`shot-rigs.ts`) is found over its cels as all the
selection's paint makes them unposed, whatever a timed prefix has painted yet: on a dissolving plane, in each end, every
end holding the group cut alike (`shotPlaneRigEndProblems`, at load and as a callback source is read). A frame reads
each rig's pose once a moment (`shotRigReader`) and poses every end by it. `shotRigSkin` lays its cels as one and
skins them, refusing at the rig's path what the rig engine would refuse naming no rig, by its own rules: cels none of
which is painted (`paintRigPicturePainted`), and a skin joint with no bone (`paintRigSkinProblems`: its child owns no
texel, or its paint centres on its pivot). One whose group owns its sheet is
drawn as pieces: a cel layer of its shown cels (`paint-rig-cel-layer.ts`), cut by ownership and posed through
three.js meshes into colour and motion (`studio/shot-rig-pieces.ts`); any other rig poses its cels' marks before the
solve, a skinned cel by its skin mesh, its pose named by its skin's key (its rest cels' readback keys) as well as
every part's map, since every rest cel shapes the mesh. A hidden cel stays in its sheet's program and isn't laid, so a
cel swap re-solves nothing. A pieces rig's picture lays only its shown cels' films (`ShotPiecesPlan.steps`), each at
its index in its sheet's program, whose mixing group is its palette and drying, so nothing hidden ahead of it moves
it (`readSteps` in `studio/shot-rig-pieces.ts` hands the composite each sheet's films whole, `StampSheetKeptFilms`).
A card is cut round its sheet's films, each counted as far as it shows (its layer's visibility times its groups'
below the owner; a cel a rig hides, not at all), so a view switched off takes its paper, as a pieces rig's hidden
cels do: a composite's card counts the films its steps lay on its sheet (`StampSheetsComposite.cardFilms`). Inside
the rig, a node at visibility 0 lays nothing; one between gives the read its levels (`ShotPiecesPlan.levels`,
`StampSheetsComposite.shown`): each film's opacity, each card's count of its films, and the spans of the groups and own
sheets' owners faded apart, kept and mixed back as a plane's lay does. The levels join the read's key, so a fade reads
the rig's picture back once per level; a rig all shown has none.
`studio/shot-renderer.ts` solves each painted plane once a frame (`studio/shot-painted-plane.ts`,
through `painting-sheets-solve.ts`), each selection a dissolve blends on its own, if it shows at one of the frame's
exposures (`shot-shown.ts`: its visibility above 0, and its ground paper or a layer above 0 through its groups; the
opaque back always shows, a variant as its instanced plane does). One that doesn't is the frame's hidden
(`shotSolvablesShown`), which each exposure carries: it lays nothing, and a mask reading it reads no coverage; then each exposure orders its drawables (`shot-plan.ts`) and plans each plane's
moment purely (`shotPlaneLayPlan`, `shot-sheet-lays.ts`): its steps through lattices (`shot-lattice.ts`), its ground,
its pieces rigs posed, the spans of the occurrences faded apart, groups and own sheets' owners (`shot-visibility.ts`), and a
key naming all of it. `studio/shot-sheets-lay.ts` lays it over `stamp-lattice-pass.ts`: ground, then each card and
film where its owners and the plane's place put it, a pieces rig's picture at its card by the compositor's
`layPicture`, a faded group's or own sheet owner's span mixed back by its visibility, card and paint as one
(`painting/studio/stamp-span-fade-pass.ts`). The plane's picture is
the old renderer's pass (`painting/studio/stamp-plane-picture-pass.ts`), kept in the device's cache under the plan's
key. A dissolve's selections are each laid, kept and blurred so, then summed by weight into a stage-sized picture
(`studio/shot-dissolve-pass.ts`): every layer a plane's picture holds (opaque colour, colour and transmittance, glow,
motion) is linear in what's laid, so the sum is the dissolve, never a pigment mix. Its ends paint one document size
on one ground. A marks rig on it solves each end at each pose; a sheet's keys hash its paint and each entry's pose
text, so an end resumes another's checkpoint only where both paint and pose agree, the skin's key keeping a skinned
cel apart wherever any rest cel differs, and a warm covers both ends. A pieces rig finds its skin in each end and
draws each share of the blend into a target of its own, since three.js renders at once and one submit lays every
share. Picture
and three planes are the old path's sources, laid through `stamp-lens-source-layers.ts`, each read at its
`sourceClock`'s moment (a picture's `pictureAt`, a three scene's `poseAt`) and faded by its visibility, the lens
layer's `visibility` (`lens-compositor.ts`). Three planes read the shot's
painted textures (`studio/shot-painted-textures.ts`): made by `createShotPaintedTextures` before
`loadPaintedThreeSources` when the shot has a three plane and released after it, drawn at each frame's moment once
its planes are solved, before its sources render (the loader's hook finds them drawn), and solved at each warm frame
after the planes. An instanced plane
(`shot-instances.ts`) reads its items at the exposure's moment and its shutter's ends, pairs them by key and looks each through the camera at its own depth. Each variant is compiled, solved
and laid as a painted plane is, still and centred on the stage, its picture kept under its plan's key; an item whose
blur would spread it past the stage round its document is refused as the frame reads it. A batch of items (one
variant, one stepped sigma) lays that picture, blurred in its own px, through each item's view as the lens's items
layer (`studio/shot-instance-passes.ts`): a quad per item, its view, shutter ends, distance and visibility a vertex row
(`lens-compositor.ts`, `platform/gpu/studio/gpu-instance-ring.ts`), its filter then its add before the next. An
item's travel is its views at the shutter's ends, as a plane's is; its picture's own motion isn't read.

Masks (ENGINE 6.3) are drawn. The `alphaOf` graph is checked acyclic and sorted so each read plane composites first
(`shot-masks.ts`); the plan holds each mask and what other planes read of it (`shot-sheet-lays.ts`), and each film's
reveals at the selection's time, read under the poses its marks were solved by, so a moving reveal moves the
picture's key and solves nothing. Each exposure lays every painted plane first, in the graph's order (`present` in
`studio/shot-painted-plane.ts`). `studio/shot-mask-passes.ts` multiplies a plane's masks into one r32float factor
over the stage: an `alphaOf` read where the exposure's camera shows its drawable, a painted or picture plane's through
both lays and the parallax between their depths (the reader's view, then the drawable's undone: `paintViewAcross`,
exactly the identity between equal views, so a reader at its drawable's depth reads plane px to plane px and keys
nothing new as the camera moves; a three render through the reader's camera view; an instanced plane's items drawn still and sharp through the
camera into a frame-sized target by `LensCompositor.cover`, when a lay first asks, and read through the reader's
view), a source's weighed by its visibility, which its render leaves out. The lay takes it into each film's opacity, each card's cover
and each pieces picture, so the light each film adds, its glow, is cut with it; the ground is never cut. A film's reveals
cut it in its layer target before it's laid (`stamp-reveal-pass.ts`), its glow and the coverage it gathers for readers alike. While a plane is laid on white, the
coverage of each drawable another plane reads gathers alongside (film, card, pieces, ground), a channel each, four
to a layer of one array, mixed by a fading group's span like the paint; the picture keeps it, faded by the plane's
visibility, in layers after the lens's (`coverage` in `stampPlanePictureLayers`), so whatever sums pictures sums
their coverage alike. A reader's picture is kept under its plan's key and what it read (`shotPresentedKeys`): a
painted plane's presented key and the map across to it, a picture source's upload and box, a three render's frame and exposure, an instanced
plane's variants' keys and its shown items' views and visibility, each with the map it's read through and its weight. So a reader is laid anew only when what it reads moves. A dissolving plane's masks cut each
selection alike, and its coverage is summed by weight with its colour (`shot-dissolve-pass.ts`); a reader keys it by
every selection's key and weight.

Visibility's keys and range, and the occurrences faded apart (`shot-visibility.ts`), are drawn,
and so are `warm` and the cost report.
A warm (`shot-warm.ts`) solves each painted plane and variant before the first frame at the first of the span's
frames to pair each set of moments on its source and plane clocks (`shotWarmCombinations` over `shotPlaneClocks`;
node clocks run inside the plane's), only the frames its scene shows and the plane shows at, in the render's lens
mode (`shotWarmShown`), each solve let go to the cache; a solve reads no lay, so a pinned plane warms unlaid. It stops between solves once its scene is disposed. `PaintedShot` holds the
render once for its load and warm and once a frame, while each makes progress (the page's two-hour ceiling,
`RENDER_TIMEOUT_MS`, is only a backstop): its watch (`shot-watch.ts`) cancels a hold once nothing has moved for 90 s,
no solve finished and no GPU check settled, naming the shot, the solve it was in and where (the warm, or the frame's
own solve, cold), how many of the run's solves are done and what the run cost so far, its evictions and uploads read
live; a lost device fails the hold at once. Each warm solve that solved sheets, and each frame's solve that took 5 s
or more, logs a line the render prints, and other progress a pulse, so the render's browser watch
(`platform/browser`'s render-watch) sees the page alive while it is. Steps that mustn't
overlap on one device (shares, planes, canvases, textures, three sources) run through `gpuEachInTurn`
(`platform/gpu/models/gpu-in-turn.ts`). The renderer counts evictions and bytes uploaded (every write and image copy
to the owner's queue, three.js's too) around each draw and warm, and after it the bytes the cache keeps, its targets
apart, and what the page's memos keep (`paintingMemosKept`: compiled selections, posed programs and placements, each
a count and its bytes); selections compiled and found kept; and the solves hidden planes skip (`hidden solves
skipped`: one a plane in a frame, one a pairing of moments in a warm). A plane is hidden when it lays nothing at any
of the frame's exposures (`shot-shown.ts`): its own visibility, its layers' through their groups, and a cel its rig's
pose hides, read through the frame's one rig reader (`shotRigReader`), which its solve and lay then read again. The
evaluations a callback source makes or finds memoised are the change in `paintingEvaluationCounts()` across its
synchronous read. The cost report's counts are painting's (`painting/models/stamp-paint-costs.ts`, one set of names the document,
solver, caches and shot all count into); the shot logs a frame's and a warm's under its labels
(`shot-cost-report.ts`), a painting in time's plan among their notes (`plans`), through `picture/profiling`'s costs channel, which knows nothing of paint, so
`studio profile --costs` tables any drawing's counts. Its painted textures (ENGINE 6.3) are compiled with its planes
by `compilePaintedShot`, their problems reported beside the planes', onto `CompiledPaintedShot.paintedTextures`, in
`shot-painted-texture-compile.ts` (`compileShotPaintedTextures`: an id each, whole px, each source at moment 0 as a
plane's is, never on a transparent ground, never blending paintings that wrap otherwise than each other; how it
wraps held from moment 0, a callback's source checked again each frame by `compiledPaintedTextureSourceAt`) and the
compiled ones drawn by `studio/shot-painted-textures.ts` (`createShotPaintedTextures`, the handles
`loadPaintedThreeSources` reads, each saying how it wraps, resampled through a sampler repeating as it does): each
selection a texture's source reads at the moment solved, laid on its paper at its document's size, box-resampled to
the texture's, summed by its dissolve weight in linear light, then gamma-encoded. A texture whose selections and
weights haven't changed isn't solved again, and one whose solves keep the films it was last laid from (their sheet keys,
finished or open) isn't laid again, so a timed painting's frames between two landings lay one prefix once. A warm
solves each texture at each warm frame reading other than the last, laying nothing. Each lay ends in the handle's mip
chain, down to 1 × 1 (`studio/shot-painted-texture-mips.ts`, `shotPaintedTextureMipChain`, in the encode's
submit): each level below the first is the one above through a tent twice a texel's footprint wide, [1 3 3 1] / 8 a
side (wider where a side is odd), decoded to linear light, weighed and encoded again. On an axis the texture wraps
its taps run round the seam, so a wrapped texture's smaller levels are seamless; on one it doesn't they're held at
the edge. A texture not laid again keeps its chain.

**procreate-brushes** reads a Procreate brush's settings into a `StampBrush` (`procreate-brush.ts`, by the constants
of `procreate-reading.ts`), and the stroke Procreate draws its previews along. Its `engine/` reads binary plists and
`.procreate` canvases.

**photoshop-brushes** reads Photoshop's: the preset schema in Photoshop's own units (`photoshop-preset.ts`), the
`.abr` reader and descriptor codec, the normalizer (`photoshop-brush.ts`, by `photoshop-reading.ts`, which resolves every source of pressure,
the brush's, the options bar's and a lingering pose's, into the brush's dynamics by one precedence), computed round
tips, and the capture rig that has Photoshop paint probes and references (docs/photoshop-capture.md). It imports
procreate-brushes only for the S-curve its references are painted along, Procreate's preview stroke.

**brush-packs** is a pack on disk: the manifest (`stamp-paint-pack.ts`), the files an importer writes under
`work/styles/<style>/brushes/<pack>/`, the three importers, the profiles they measure, stored beside the pack a file a
brush and key and found by computing the key (`stamp-brush-profile-store.ts`; a pack a style paints from is a
`ProfiledStampPaintPack`), and the URLs a browser page finds a served pack's files at (`stamp-paint-pack-urls.ts`,
read back by `readServedStampPaintPack`). It is its own feature because a pack and its importer read both apps'
brushes; inside either app's feature, that app would import the other back.

**style** is a style in a project: `StampPaintStyle` (`style.ts`), the styles a project names, checked before a bundle
(`project-styles.ts`), the bundle's styles module (`@stamp-paint-styles`, carrying the profiles Node found for the
brushes each style names, `style-packs.ts`) and `StampPainting`, a painting in a scene.
It also reads a workspace style in Node (`readWorkspaceStampPaintStyle`), and `studio brushes describe` prints its
brushes as numbers to plan by (`style-brush-numbers.ts`, read by `workspace-style-brush-numbers.ts`).

**brush-fidelity** holds a painted brush against its target, a Procreate preview or a Photoshop reference capture
(`brush-fidelity-target.ts`): one measure (`stroke-measure.ts`), one scorer (`brush-fidelity-score.ts`) that the
sheet, the fit, the diagnostic and the guard all use, one versioned report of a sheet (`brush-fidelity-report.ts`,
naming the source, reading and scorer it was drawn under) that the fit's baselines and the guard read, and each app's
reading registered for fitting (`brush-readings.ts`). `npm run brushes:sheet`, `brushes:fit` and `brushes:diagnose` run it (docs/private-styles.md).

**studies** are passages painted for a person to judge, not scored: the wet and dry passage sheets
(`npm run wet:passages`, `dry:passages`), the fill sheet and the stroke hand sheet (`brushes:fills`,
`brushes:hand`), each a Node side over a browser page.

**gate** holds the GPU renderer to accepted output (`npm run stamp:gate -- run`, or `run <ids>` for the baselines and
cases named): every rendering formula over a grid,
each runtime twin against its CPU side, synthetic paintings that walk every path the renderer takes, and a traced
resolve against its frame; `media/mixed` holds each group of a three-medium painting to itself painted alone in its
own medium (max 0), and gouache glazed over a dark watercolour wash to covering it. The sheet solver's cases
(`stamp-gate-sheets.ts`, `stamp-gate-clocks.ts`) solve documents compiled with the gate's round: each decision on its
closed form, scene seconds too on a clock at a scale, `instant` or `never`, an appended application changing no
earlier film, a foot's charge mingling only where it touches wet shallows and not at all from an own sheet, each
prefix played forward matching a fresh solve of it (one resuming from checkpoints that hold a clip's base and a
parked coverage), the reductions exact at 8192², a heron's paper (`paper/heron`, `stamp-gate-paper-heron.ts`:
moved, the grain under its body's paint stays and its wing's cut-out takes its own along; turned and grown, its body
lands where the pose puts it), and three stills (`solved/`) accepted by eye. The shot's cases (`stamp-gate-shots.ts`)
draw through the shot's renderer: a rigged paper heron, its neck skinned to its body on the scene's sheet, bent, then
swapped to its lowered cel with nothing solved, then faded halfway as one group, lying between it shown and hidden
with nothing solved, and reeds owning their sheet drawn as pieces, solving at rest as unrigged and swinging when
posed; the heron boiling, its wobble moving finished paint with nothing solved; and the wet-contact foot posed by a
rig, resuming its sheet's solve from its checkpoints, and painted in as the shot plays, its rig drawing before the
foot's first stroke, then hidden, its paint going and its water's mark on the shallows staying with nothing solved;
the heron dissolving from the scene's sheet to a sheet of its own, and under it, its plane hidden, the back dissolving
from the pond painted with the heron in it to the shallows alone, each halfway lying between its ends with nothing
solved or laid once they are; the rigged heron dissolving from day to dusk on its shared sheet, posed mid-dissolve
(`shot/rigged-dissolve`): halfway, drawn first so both ends' pieces draw in one frame, between its posed ends, and
drawn after them solving nothing, each end solved at a new pose and nothing at the first again, each rig's pose read once a frame, and a warm of the halfway frame solving both
ends; the
foot painting in on sixes, its plane on threes flipping its pose, over a warmed span, the frames its warm skipped as
pairing their clocks' moments alike then solving nothing; and rain (`stamp-gate-rain.ts`) falling about a post under a still camera, a lone drop out of
focus spreading alike on every side, blurring along its own fall and drawn as if shut when keyed anew across the
shutter, a frame moving only drops solving nothing and laying no picture anew; and the post sliding across the street
(`shot/shutter`), its lens leaving out its shutter: blurred along its slide by the film's, about the frame's time,
and shut, drawn as if it stood still. A kite (`stamp-gate-shot-approach.ts`, `shot/approach`) flies in depth from behind
a post to past it under a camera pushing in: each frame draws it as a kite held at its depth then, the post in
front before it crosses the post's depth and the kite after, and an open shutter spreads its rim wider than a kite
held at that depth, which only the push blurs. A ridge's top swept as a painting in time (`shot/properties-in-time`,
`stamp-gate-in-time.ts`) keys the moments its rule names, within four drawings; a frame between two keys lies between
their drawings, each drawing solves once and frames after them solve nothing, and a warm over the sweep solves its
drawings alone. The masked shot (`stamp-gate-shot-masks.ts`) shows the paper heron part revealed by its document's reveal (`shot/masks`),
and cuts a tint to the heron's wing, to all but it, and to a disc moving across as a picture plane and as a three
plane under a panned camera. On a plane nearer than the heron, the tint stays cut to the wing, and to a picture disc,
as a pan parts their depths (`shot/masks-across`), laid anew each frame they move apart; at the heron's depth, never.
Under the film's shutter as the camera whips across (`shot/masks-across-open`), the reference, each exposure cut at
its own views, tints where its shut twin does within half the wing's travel; the fast frame, cut at the frame's moment
and gathered as the tint moves, smears the cut's edge a little wider, held within 64 levels of the reference.
Cut to the revealing heron's wing frame after frame, each frame draws as it does alone and a held frame lays nothing anew; cut
to the heron faded to half, it tints the wing about half as much, and just as much cut to the heron dissolving
halfway to water lying elsewhere. A picture disc at half visibility lays half of itself and cuts the tint at half its
coverage; a three disc hidden draws and cuts as none; a disc held on sixes keeps still, its tint with it, within a
hold; and the tint cut to an instanced plane's painted spot follows it and fades with it. The rainy street (`stamp-gate-rainy-street.ts`, ENGINE test 5) draws them together
in one shot under a camera pushing in: a sky dissolving to night at the back; a street painted in on sixes, its
puddle clocked with drops landing in it at their times and a walker on its wet paper placed by a play; the lamp's
reflection cut to the puddle and fading in; and the rain. Warmed, frames moving only the camera, the rain, `k` or
visibility evaluate and solve nothing; the lamp's property step re-solves from the first entry the evaluation diff
says it changes; the walker stepping back to a pose solves nothing; walking, the street's source reads a new moment
each sixth frame while the walker re-solves every frame. The cards (`stamp-gate-cards.ts`) hold a collage card whose
rigged figure hides its lying cel, and whose sitting view is switched off, each drawing as the card painted without
it; and a leaf owning its card faded halfway, lying between it shown and gone, and gone, drawing as the cards painted
without it, with nothing solved. The sprig (`stamp-gate-pieces.ts`, `shot/pieces`) owns its card and is drawn as
pieces: its flag swapped to a cel of another colour, its bud's rim switched off and its seed hidden by a clear cel,
each ahead of later parts, draw as the sprig painted without what they hide and every cel it holds shown, with
nothing solved; its bud cel fading draws as the sprig laid in place fading it, halfway no further from that than shown
and gone are and apart from both, with nothing solved. The lamp's glass (`stamp-gate-shot-glow.ts`, `shot/glow`)
glowing by a keyed value draws, at its key of 0, as the lamp glowing nowhere and, at its last, as its constant glow,
spilling between them halfway. The reference leaves the hidden layer out: every seed a sheet's solve draws is named by keys, never by
a layer's place on its sheet, so a layer left out reseeds no other.
Each shot's frame is a baseline (`shot/`) accepted by eye. `shot/page`
(`stamp-gate-shot-dom-page.ts`) holds a shot's element on the page, scaled as a player shows it, and reads it through
the DOM adapter: HTML behind the first canvas or not, a canvas in a wrapper at an identity transform refused, a glaze
in a translucent wrapper refused and an opaque back in one not; the heron alone, a clear back, drawn as a glaze, clear
at its corners; then pinned to an element, its paint's centroid on the element's centre wherever it's placed, and the
element resized asking for the frame again. Last, a violet watercolour wash glazed from a later canvas over a yellow
HTML block and a teal back is photographed as the browser composites it (`browserModuleScreenshot`), each channel's
mean over each within 8 levels of the wash drawn in one canvas over a flat picture of that colour. The same wash as a
clear back over the block, nothing in the shot past it, is photographed over a white page and a dark one outside the
shot: over the block, and over nothing on white, within 8 levels of the wash over that colour; over nothing, the page
let through alike in every channel, one alpha, the dark page showing the glaze lighter. Its painted textures
(`texture/`, `stamp-gate-textures.ts`), each accepted by eye and held to a seam no rougher than the roughest texel step
across it within 12 of it, on each axis it wraps (`stampGateSeamSteps`): `texture/wrapped-cylinder`, two paintings
wrapping across x, a flood and an earth band run across their seam and a bloom dropped on it, their bands apart,
dissolved halfway and drawn at half their size by `createShotPaintedTextures`, so the resample averages across the
seam and the sum weighs both, onto a three.js cylinder through the three-source loader, its seam turned to the camera
above the texture laid flat at 2 px a texel and rolled half its width; and `texture/wrapped-tile`, a painting wrapping
both ways, a flood, a bloom and a crossed band across both seams and the corner, drawn at half its size, laid flat 2×2
tiled with its seams in the middle, beside a three.js plane whose uv run to 2 each way. A case is a row of
`STAMP_GATE_TEXTURE_CASES` (its texture, view, flat lay with its roll, seam axes and inputs; its frame and seam texels
derived from them), the page adding only its three.js object. The family holds a texture itself, laid flat. A shot
wearing one is a family of its own (`STAMP_GATE_SHOT_TEXTURE_CASES`, drawn by `paintStampGateShotTexture` through the
shot's renderer): `shot/painted-cylinder`, a label wrapping x, a clocked flood across its seam and earth strokes timed
at 1 s and 3 s, finished as the back plane and, through `paintedTextures`, round a cylinder in front, its seam to the
camera, read at each frame's moment; drawn at 2 s and 4 s through one renderer and laid side by side, so the cylinder
shows the first stroke, then both. Its checks (`checkStampGateShotTextureCase`, over
`STAMP_GATE_SHOT_TEXTURE_CASE_IDS`): the 2 s frame solves the texture's own prefix beside the back's whole painting,
the 4 s frame changes the cylinder and nothing else, and warmed over 2..4 s neither frame solves anything.
`shot/far-cylinder`: the wrapped tile finished as the back and worn at its size round a small cylinder whose uv run
4 times round and twice up, so a texel is near a quarter of a px at its front and its seams and corner come round;
four frames in a row at the shot rate, it turning 3° a frame, laid side by side. Accepted by eye, enlarged: steady
from frame to frame and seamless, where the same frames without the chain sparkle and break its bands. Its lit
three.js shot (`shot/shadow`, `stamp-gate-three-lighting.ts`, drawn by `paintStampGateLighting`): two stands before a
flat wall, each a floor tilted toward the camera with a red-capped post on it and a sun casting from high on the
front right; the right stand asks for soft shadows and mirrors its post through `setThreeMirrorCamera`, its twin on
the left asks for neither. The camera, focused on the stands, pans right 36 px and the posts slide: frames at 0 s
and 1 s draw fast with the shutter open, and 1 s again as a reference frame, laid side by side and accepted by eye.
Its checks (`checkStampGateLightingCase`) read the floor through the stands' own geometry projected by the camera:
dark and sharp beside the foot, its edge halfway down where the post's side casts it, at least twice as wide down
its far end, near the width the sun's angular radius gives; the twin's floor lit where its shadow would fall; and the
cap's reflection within 3 px of the mirrored cap, so a mirror left at rest fails as the camera pans. Apart from the
shot, the shadowed stand's source renders exposures from three points off the aperture's middle, each straight after
one at 0 s in one animation frame (three's loop held, as a fast GPU renders a reference frame's exposures), read back
as rendered: each one's shadow edge where the post stands then (an unadvanced node frame leaves the one before's,
7 units off) and its reflection registered through the shifted lens (a mirror dropping the shift misses by 4 to 8 px).

The reveal cases (`stamp-gate-reveals.ts`, `stamp-gate-reveals-page.ts`) hold a reveal to its CPU twin
(`stampRevealShownAt`): a texel whose twin shows none, its neighbours too, matches the frame with all hidden, one
showing all matches the unrevealed frame, on each surface's own frames. `reveal/strokes`: mixed-width strokes, a round
and a flat cap, a crossing taken by the earlier, an uncovered texel never shown, a soft ramp read along a stroke.
`reveal/fields`: linear, radial and noise fields with a delay, the radial's front run by a profile, seeked forward
and back to the same frames with nothing solved. `reveal/sheets`: a group's reveal intersecting a nested layer's on a heron's own sheet, its card cut
with its paint and the root's ground never; a hidden foot leaving its water's mark on the shallows. `reveal/surfaces`:
one painting through a still, a shot, a clear back over HTML and a painted texture, its mips re-laid. `reveal/clock`:
held on sixes it steps, sampled continuously it moves smoothly, a reveal edit solves nothing, posed paint carries
it, and a dissolve's ends each show theirs.

Frame families (solved sheets, shots, painted textures, the lit shot) are rows of `STAMP_GATE_FRAME_FAMILIES` in
`stamp-gate.ts`: IDs, page function, frame size and inputs, so a new family is one row. Pre-push runs the gate on each
pushed commit's tree when a path it covers changes, once it has the whole adapter (the GPU lease,
`lib/platform/gpu/engine/gpu-lease.ts`), so its deadline never runs while it queues; no adapter, a timeout or a
difference refuses the push. Public baselines live in `harness/fixtures/stamp-paint/`, a pack's brushes' in
`work/validation/stamp-paint/` (`stamp:gate -- private run`). A baseline changes only by `update <ids> --reason …`,
which writes candidates with their differences, then `accept <ids>`.

`lib/platform/zip/` reads the zips packs come in; `lib/platform/browser/` runs the fidelity, study and gate pages, each
under the GPU lease (`lib/platform/gpu/`).
`lint/policy/studio-tree.ts` declares the areas; check:arch holds each feature to its roles and refuses a cycle
between features.
