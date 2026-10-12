# Painting over time

Paint that changes on screen: a wash painted as you watch, finished paint revealed along a path, a property moving
through a shot, a figure that bends. Planes, the camera and keyed values are in `${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/shots.md`.

Pick by what should change:

| On screen | Use |
|---|---|
| paint landing and meeting wet paint (a charge feathering in, a drop joining a puddle) | a clocked wash, shown by prefix |
| finished paint arriving along a path or over an area (ink drawn on the beat, a flood rising) | a reveal |
| the light, a colour, a mark's weight moving through the shot | a painting in time |
| a shape that moves (a wing, an arm, a gate) | a rig, never painting time or a reveal |
| an element appearing or fading | `visibility` |

## Clocks

| Clock | Unit | Read by |
|---|---|---|
| painting time | model seconds, 0 at its sheet's start | `on`, drying |
| scene time | scene seconds | clocks, `at`, plays, `PaintMoment.at`, reveals |
| animation grid | frames at `camera.animationFps` (24) | holds, boil |
| film | frames at the composition's fps | render frames, the default shutter |

## Washes painted on screen

- A wash with `clock: {origin}` is clocked. Its sheet keeps one clock running at the sheet's `dryingScale`, scene
  seconds per model second (the document's for the root, an own sheet's for that sheet, 1 when left out). The clock
  starts with the sheet's clocked wet work; a scale on a sheet with no clocked wet wash does nothing.
- `dryingScale` = scene seconds wanted ÷ model seconds needed; model seconds from wetness w0 to w1 are
  (w0 − w1) × drying ÷ (0.5 + absorbency). A 0.85 watercolour flood on absorbency 0.5 takes 120 model s to reach damp:
  to see that in 3 scene s, give the sheet `dryingScale: 0.025`.
- A negative `origin` ages the sheet: what landed before scene 0 shows finished from the first frame.
- `origin: 'set'` starts the wash once its layer's earlier clocked washes have set. After a clocked wash, a wash in
  the same layer must be clocked and start once it has set.
- `dryingScale: 'instant'`: the sheet sets before each clocked application, so `wet` and `damp` over earlier paint are
  unreachable. `'never'`: nothing dries, unclocked work included, so no wash can start after a wet one in its layer.
- A fixed `at` never moves; it must not precede its predecessor, and its `on` must hold there. A direct wash
  (`wetHistory: false`) with a clock and an `at` per application draws stroke by stroke.
- Across layers on one sheet, clocked work interleaves by time, landing into whatever is wet. To have a layer meet
  another dry, start it once the other has set (`studio paint check --solve` prints set times) or give its first
  application `on: 'dry'`. An application waiting on `on` holds back everything after it on the sheet: fix its `at`
  to let other work land meanwhile.
- **Show it partway**: `layersOf(p, keys, {at: moment.at})` shows the clocked applications landed by then, each step
  finished. Each distinct prefix is a solve: hold the plane's `sourceClock` to bound them, dissolve between prefixes
  to smooth the jump, and `warm` the span.
- **A drop landing in a wash**: on the wash's sheet, a water stamp `at` its landing (a bloom if wanted), then its paint
  as the next application without `on`. A drop falling on another plane never joins the wash by overlapping it.

## Cues

A painting's times are the scene seconds its selection's `at` counts. Moments come from `timeline.ts`, never typed
into a scene (the cue system is video-motion's: `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/timing.md`).

- **Land paint on a cue**: fix the application's `at` from `sceneCueSeconds(timeline.clock('<scene>'))`, imported from
  `#lib/timing/timeline/models/scene-cue-seconds.ts` so the source stays in plain Node. Moving the cue moves what the
  paint meets: a later cue finds the sky drier, and past its shine `on: 'wet'` fails, naming the fix.
- **Play a painting at another pace**: `layersOf(p, keys, {at: (moment.at - CUE.paint) * 2})` starts it on the
  `paint` cue at double speed. That retimes playback only; to change what the water does, change the document's times
  or `dryingScale`.
- **Time a shot's motion**: `sceneSecondsOf(clock)` gives `cue(name)` (another scene's as `<scene>.<cue>`), `beat(n)`,
  `beats(n)` and `frames(n)` as lengths, `beatAt(s)`, `end` and `span`. A key's or play's `at` is a number worked out
  from these. A shot reading its clock is built once per scene binding, its scene function taking the clock.

## Reveals: finished paint shown over time

A layer's or group's `reveal` gives each texel an arrival time in scene seconds; at a selection's `at` a texel shows
once its arrival has passed, ramping in over `softS`. Left without `at`, it shows whole. A reveal is presentation:
the water and the solve never see it, so editing one re-solves nothing.

- **Strokes**: `{kind: 'strokes', strokes: [{points, widthPx, from, to, cap?}], softS?}`, a band round each path whose
  front advances at constant speed from `from` to `to`. Bands laid edge to edge close up with no seam. An eased pull is
  `paintingEasedRevealStrokes(points, {widthPx, from, to, ease})`, `ease` a function of the share (`sineInOutEase`).
- **Field**: `{kind: 'field', base, delay?, profile?, softS?}`, `base` and `delay` fields of scene seconds: constant
  (all at once), linear (a flood rising), radial (a moon filling out), noise (a petal coming in blotches, a noise
  `delay` ragging a front). `profile` (`'out'`, `'in'`, `'inOut'`) eases the front. `softS` and `delay` are seconds, so
  in px they're the front's speed times them: slow the front and both narrow.
- **Read its times off it**, so retiming the reveal retimes what follows: `paintingRevealEnd(reveal)` and
  `paintingRevealArrivalAt(reveal, point)`, from `#lib/paint/document/models/painting-reveal.ts` like the other reveal
  helpers.
- **The overlap limit**: a reveal shows *finished* paint. Where applications overlap in one film, the crossing shows
  the moment the first band reaches it, every later application in it included; nor can a reveal show a lift or water
  moving paint. Marks that must arrive in order where they overlap go in layers of their own, each with its reveal;
  paint whose arrival changes what it meets is timed with `at` and shown by prefix.
- **Band widths**: share each path as a TS constant between the application and its reveal, and size the band to the
  stroke's visible width plus its wobble. Hold it in a test: `paintingStrokeVisibleWidthPx(application, brushOf)`,
  with `brushOf` from `paintingStylesBrushOf(await readPaintingSourceStyles([painting(src)], '<why>'))`
  (`#lib/paint/document/engine/painting-source-load.ts`), so a pen rebrushed wider fails before it shows trimmed. Then
  look: a band too narrow trims the edge. A band wider than the spacing of its rows shows its neighbours early.
  `paintingRevealBandPx` is the upper bound, for where carried wet paint visibly walks past the stroke.
- A straight edge needs no band: a linear field along it leaves the film its own fringe (an underline over HTML).
- A reveal is part of the sampled painting, so a held `sourceClock` steps it. For a smooth reveal over stepped
  properties, leave the source unheld, quantise the properties, and pass the continuous `moment.at`.

## A painting in time

`paintingInTime(source, {values, layers, ground?, at?, drawings})` (`#studio`) moves properties through a shot:
`values` gives each a constant or a value in time. The shot samples them at every moment the plane reads, solves at
most `drawings` key drawings (the first and last moments, either side of each boolean or enum change, then where
values turn or halfway along the longest change), and dissolves each frame between the two keys either side.
`step` is the finest change worth a solve. Between keys an edge a property moves shows in both places, one fading as
the other comes: what moves an outline belongs in presentation. `studio paint check <project>` prints the keys it
chose and why.

## Rigs: a figure that bends

A group's entry takes `rig: {parts, pose}`. Each part is `{id, z, parent: null, cels}`, or a child joined by
`joint: 'skin'` (bending along its own paint over `blend` px, keeping a limb's width) or `'hinge'` (rigid), with a
`pivot`.

- Every layer under the group lies in exactly one part's cels. A cel is a layer or a group (a line and its wash as one
  part, media mixed). A part's cels after its first are swaps, shown one at a time: a layer meant to show with a part
  goes in its group cel.
- Paint each part whole, running under its neighbours where a joint turns; a texel shows the cel giving it most
  colour. A skinned part's cel must win some texels and not centre its paint on its pivot, or the frame is refused.
- `pose` names parts by id: `{x?, y?, rotation?, bend?, cel?}` in its parent's frame about its pivot. Views a joint
  can't reach are groups switched by `visibility`.
- On an own sheet the rig bends paint and paper as pieces with no solve; on shared paper each pose repaints it into
  the sheet's water. Every cel is painted, shown or not, into its sheet's water: give each later cel's first
  application `on: 'dry'` to paint them apart.
- A rig never mirrors paint: a reflection is a second rig on paint drawn flipped.
- Pose helpers (`#lib/paint/rig/models/paint-rig-pose.ts`): `paintRigTwoBoneReach` turns a two-part chain so its tip
  lands on a target (a planted foot that never slides; keep targets inside the reach, where a knee straightens fast);
  `paintRigMirroredPose(pose, 'y')` poses a reflection in level water; `paintRigPosedPoint` gives where a pose puts a
  rest point (aim a strike's ring there).
- Take a figure's outlines from a figure, not typed coordinates: `posedFigureShapes`, `constructedFigureShapes` and
  `svgFigureShapes` (`#lib/paint/animation/models/figure/`) give each part's region, the silhouette, interior lines and
  anchors. Their polygons are `{points}`: a document ring is those points.

## Recipes

| Look | Write | Watch for |
|---|---|---|
| a wash painted on screen | a clocked wash on a sheet at a `dryingScale`; source `(m) => layersOf(p, keys, {at: m.at})`; `sourceClock: {hold: 2}`; `warm` | each step shows finished; dissolve between prefixes to smooth the jump |
| a drawing appearing stroke by stroke | a direct wash with `clock` and an `at` per application | or a strokes reveal over the finished drawing, which pens each stroke along its length |
| ink drawn on the beat | the ink layer's strokes reveal, a stroke per beat from the cue, paths shared with the application | the overlap limit; band held to the pen's width in a test |
| a flood rising, a moon filling, a petal blotching in | a field reveal: linear, radial, noise with a linear delay | past its ends a linear field holds |
| a mark growing along its own path | a strokes reveal of the application's own subpaths | a field tears where a mark crosses a wrapped seam |
| an element fading | `visibility: (m) => …` in its entry | a visibility stepping 0 to 1 within a frame is a pop |
| a collage cut-out sliding | its layer on `sheet: {kind: 'own', paper}`, a play on its occurrence | its grain travels with it |
| paint drifting over still paper | the layer on its parent's sheet, a play on its occurrence, held | a solve per distinct pose |
| passing behind a ridge on shared paper | `clips: [{region: ABOVE_RIDGE, anchor: 'paper'}]` | the clip stays on the paper |
| mingling with a wet wash as it moves | its layer on the wash's sheet, posed, its charge timed while the wash is wet | hiding it leaves its water's work: fade a group holding both |
| falling rain, glitter on water | an instanced plane, items keyed for life, each its own phase | boil re-rolls a whole layer at once: twinkle each item on its own phase; fade items at an edge rather than dropping them |
| a cycle: a wingbeat, a flicker | the cycle's drawings as one part's cels, `cel` picked by `m.frame` | a swap re-solves nothing; a flier's body rises as its wings beat down |
| a light moving while the scene dissolves | the light a small painting on a nearer plane of its own, laid along its path | a light reserved in each held solve fades in place: a ghost |
| a lamp pulsing | the emitter's `glow` keyed up and back | pulse the glow; dim with visibility only what should go dark |
| a flock passing through | its path starting and ending past the frame, or faded over a few frames | whole flocks appearing mid-frame read as a cut |
