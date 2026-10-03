# The brush engine

Stamp painting is split by body of knowledge: what paint is, what a brush is and how a hand lays it, how a painting
lands, what each app's brushes mean, the packs they come in, the styles that carry a pack into a project, how close a
painted brush comes to the app's own, the studies a person judges, and the gate that holds the renderer. Each is a
feature under `lib/paint/`, each importing only those below it:

```
animation          → painting
rig                → painting
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
compositors.

**Fills and forms.** A fill floods its region (`stamp-fill.ts`) or lays it in strokes (`stamp-fill-strokes.ts`): a
pattern (`StampFillPattern`, each an object by `kind`) makes marks, `stampFillMarks`, each with a key and the patch a
hand lays it in, and `stampFillStrokePath` joins them, lifting between, into one stroke deposit. Rows (hatch, back and
forth, zigzag, shading, scribble) share one hand's random walk, so their keys are their order; a `contour`'s rings
(inset level sets of the region's distance grid, closed) and a `guided` fill's marks (blended by arc length between
consecutive authored cross-sections, keyed by the pair's guide IDs) draw from their own keys, so adding a guide
anywhere leaves the other pairs' marks where they were. A flood (`placeStampFlood`) is its brush's strokes round the
outline and in rows across it, landing within a barrier its `edge` (`StampFloodEdge`) makes: `barrier`, the default,
the outline itself, a wall its paint and water stop at and its drying rim gathers against; `lost`, a ramp out over
`reach` px past it, so the wash bleeds into wet paper and dries without a line. Only a barrier is a wall
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
(`stampAreaCoverageAt` is their coverage's CPU twin). A group's `standsBefore` compiles into one more mask over the fluid of each deposit of the groups it names,
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
so the same mark painted elsewhere lands the same footprint. The renderer draws each brushed mask once as it loads:
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
laws in `stamp-wet-landing.ts` and `stamp-wet-lift.ts`, and `studio/stamp-wet-stages.ts` lists what then works over
the neighbourhood: the flow stage (`stamp-wet-flow.ts`), where a deposit's fresh paint feathers into water on the
paper and the workable paint its water stirs evens out, or paint runs back into a lift, and the drying rim
(`stamp-wet-rim.ts`) at each of a wash's dryings. The dryings come from the resolved wetness, not the waits'
tokens: `compileStampWetness` closes one after any wait the whole wash has set by (a `wait('set')`, or a seconds wait
long enough) and one at the wash's end, each `StampWashRecord.dryings`, which the rim stage and the wet report both
read. A drying is the whole wash's, never a region's. A graded material lays each pigment
of either end, its amount graded on the GPU. A passage without a history lands as it always has. Flat colour has no washes.

**Capabilities.** A `PaintMedium` declares what it can do besides lay paint (`PaintCapability`): `'wet-history'`,
`'wet-conditions'`, `'water'`, `'lift'`, `'burnish'`. Watercolour and gouache declare the first four; crayon `lift`
(its eraser) and `burnish`; flat colour, in no medium, none. Every medium has `wetting` and a sheen, so nothing is
read off them: `checkPaintCapability` is the one check, which the recipe makes as each operation is written (a
burnish, a lift, a wait, a `when`, a wet technique, water a deposit states, `wetHistory: false`), its message naming
the medium. Which law lays a deposit is `stampDepositionLaw`, per
deposit: water, a lift, and paint from a wet brush in a medium with wet history land in the wash's history
(`landDeposit`); any other paint, a dry-media brush's or crayon's in a wash too, is laid by the dry law (`layDeposit`:
pressure, the tooth, a burnish).

**Dry brush.** Where paint meets the tooth is the medium's `paperContact`: a wet medium pools into the valleys, a dry
one catches on the peaks. Watercolour also declares a `dryBrush` tooth: its dry-media brushes drag over the sheet and
catch only the peaks above it, their valleys left as bare as wet paint would settle into them deep, while the paint
stays watercolour's (it glazes and mixes, stacking no wax). The gate's `wash/dry-brush` holds a dry stroke darker
where the paper stands higher, and a wet one not. Gouache declares none, so its dry brush still settles.

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
its lattice into its plane picture's motion layer: the shutter's (`stampFramePlanMotion`, `shutter`), which the lens
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
an error. A frame held on twos gives every group the keys it had, so it repaints nothing.

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
  is planes, each `{ id, depth, source }`, laid far to near. The back, the farthest, is paper to the stage's edge.
  Every nearer painted plane is clear film: its paint, opaque or glazed, hides and filters what's behind, moving,
  warping and fading with its group; as on one sheet over white and black, and close to it over other paint (see
  Planes on the GPU). A three
  plane is a lens source (`stamp-lens-source.ts`): a picture and motion layer rendered for each frame and exposure,
  which three.js fills (`painted-three-sources.ts`) and any other renderer can. A painted plane's picture doesn't depend on the camera and is kept on the device while
  its groups hold. The camera is one description: its plays key `move` (pan, dolly, zoom, roll) and `focus` (focus
  depth, aperture), plus `fov` and a lens with one `bloom`. `paintCameraLensAt` gives each plane's view (a
  similarity) and defocus (a thin lens's circle of confusion, as gaussian sigma) at a time. The build proves every
  plane's extent over the whole shot, not at sampled times: the back everywhere the frame looks; a nearer plane where
  its groups' paint can be laid (`paint-motion-reach.ts`: the painted box grown by the most each step of the
  `motion` it's given and the recipe's own motion can move it), or everywhere the frame looks once a group's marks
  are live or re-seeded. A frame state from anything but that `motion` isn't covered. It reports each plane's
  greatest magnification and names bad planes. `buildPaintingCamera` lays the scene's planes once
  (`StampPaintingCamera.planes`, a `StampLaidPlanes`: the back a picture by type, each nearer picture with the
  groups it shows), and the renderer takes that whole. `paint-camera-world.ts` gives a pose as the studio's one camera
  description (`ShotCamera`), landing a 3D point where the plane step lays its depth. A three plane renders past the
  frame by its widest defocus's reach (its built `margin`), so it blurs in what lies beyond the frame's edge.

**Planes on the GPU** (`stamp-paint-renderer.ts`, `stamp-paint-plane-passes.ts`). One owner holds a device
(`stamp-paint-gpu-owner.ts`, built on the studio's `gpu-device-owner.ts`, whose one three.js renderer the three
sources draw with): its images, pipelines' targets and one cache budget, shared by films, pictures and
blurred pictures. A surface is one output on it. One painted plane at rest, sharp and not glowing is drawn straight
to the output, as a still always was. Otherwise each plane's picture is painted (paper, its groups, and each glowing group's light past its threshold
into the plane's emission, which each later opaque group on the plane dims by its cover; a glaze leaves it), defocused,
and composited into a frame-sized target, its emission beside it, so paint a nearer plane covers doesn't glow. A clear
plane's groups are laid twice, on plain white and on black whatever the paper (its films kept from the first lay):
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
rgba16float, gamma-encoded and opaque, decoded by `paintedThreeColorNode`. A glowing frame drawn without a lens is
refused.

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
A rig's files, poses and clocks stay with the projects that use them.

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
