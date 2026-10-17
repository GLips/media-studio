# Shots: paintings in a scene

How a scene shows and moves finished paint: planes, the camera, lays, values in time, motion and what each costs.
Paint landing over time, reveals and rigs are in `${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-over-time.md`; three.js and wrapped paintings in
`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/three-and-wrapping.md`. Field-level reference: the JSDoc of `$(studio home)/lib/paint/shot/models/shot-props.ts`.

## Paint or present?

Each distinct set of property values is an evaluation, its sheets solved again on the GPU. **Presentation** is what a
shot does with finished paint (lays and the camera, motion nodes and plays, rigs and cels, visibility, glow, reveals,
instances): it runs every frame and solves nothing. So whatever changes continuously (a position, a size, an angle,
an outline sliding) goes in presentation: a figure walks by its node's `place`, a gate swings on a rig, a sun climbs
on its own plane's `lay`. Properties carry what only a new painting can show: the light, a colour, how heavily a wash
is charged, a mark there or not. A property that sweeps through a shot is a painting in time (`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-over-time.md`).

## A shot is a camera and planes

```
PaintedShotProps {camera, span, planes, paintedTextures?, warm?}
```

- `span` is the scene seconds its frames show: `sceneSecondsOf(clock).span`. Every value is sampled at its frames
  and their shutters' ends, for what the shot checks and warns of; a render refuses a span not its scene's.
- A plane's entry says everything about it: what and where (`source`, `lay`, `depth`), `visibility`, its own motion
  node (`pivot`, `pins`, `marks`, `glow`, `plays`, held by `clock`), and under `occurrences`, by layer or group key,
  what each layer or group it shows does. A play is written under the node it moves; only the camera's plays sit on
  the camera. So one helper returns one whole thing (a flock, a card) as one `PlaneProps`, and a problem is named where
  it's written (`birds.occurrences.flock.marks`).
- Planes draw farther first by each frame's depths. The farthest plane at one numeric depth is the **back**: opaque,
  painted on paper wherever the frame reads it, so a back smaller than the frame and its blur is refused. Nearer
  painted planes are clear film: opaque paint hides what's behind, a glaze filters it. A strongly coloured glaze over
  coloured paint on another plane comes out lighter than on one sheet: put such a glaze on the plane of what it tints.
- A small painting meant to sit inside the frame goes on a nearer plane with `ground: 'paper'`, in front of a
  frame-sized bare back (a document of the same paper with one empty layer).
- `layersOf(evaluation, keys, {ground?, at?})` selects layers or groups (with their descendants). An own sheet's
  layers go with their owner, on one plane. The same layer on two planes is two occurrences, two paintings.
- Keep `PaintedShotProps` a module constant, memoised, or built once per scene binding: the shot reloads when its
  identity changes.

| Concept | Write | Notes |
|---|---|---|
| visibility | an entry's `visibility`, 0..1 or a value in time | a group fades all it holds as one; an own sheet's owner fades its card with it; the back takes none |
| hold | `clock: {hold: n}` holds presentation and motion; `sourceClock: {hold: n}` holds what `source` reads | each reads its clock's moment floored to the hold's grid; the camera still moves through the shutter |
| masks | `masks: [{kind: 'alphaOf', drawable: '<plane>' or '<plane>/<key>', invert?}]` on a painted plane | cuts by another drawable's coverage where the frame shows it, through parallax; no mask reads its own plane through any chain; to leave a layer unmasked, put it on a second plane at the same depth |
| instances | `{kind: 'instanced', depths, variants, instances(m)}` | each variant solved once and shared by every item; paint a variant on a document tight round its paint; one key per item's lifetime, so the shutter blurs it along its own travel |
| dissolve | `dissolve(a, b, k)`, nestable | blends pictures, never pigment or shapes; every end one document size on one ground |
| picture | `{kind: 'picture', extent, pictureAt}` | premultiplied; return the same object while it's still |
| HTML among canvases | `<PaintedShot>` children: HTML and `<PaintedShotCanvas name>`, in DOM order | below |

**HTML among canvases.** Every canvas is the whole frame, clear where nothing is painted. When any exists, every
plane names one; a later canvas holds only planes nearer than an earlier one's. A canvas is positioned, so it paints
over HTML that isn't: position HTML meant to lie over a canvas. A later canvas, and a clear back, is a glaze over the
HTML behind it (a violet wash turns a yellow block brown, as paint would), exact over white and close elsewhere. No
wrapper between a canvas and its shot may transform, filter or make a stacking context (opacity below 1, a blend
mode, `isolation`, a z-index on a positioned element, a clip path or mask): it's refused. A clear back needs HTML
behind it inside the shot at every frame; over a dark page, put an opaque background behind it inside the shot.

## The camera

- `stage: stampStage(frame, margin)`: margin whole, even, at least 2; more for defocus or a lay carrying paint past
  the frame. `fov` vertical degrees. `animationFps` (24) is the grid holds count on: give it the span's `fps`
  (`sceneSecondsOf(clock).span.fps`, the storyboard's, 30 by default), or a hold of 3 lasts 4, 4, 4, 3 frames, a stutter.
- `lens: {bloom, shutter?}`: bloom is frame px of sigma; the shutter left out is the film's, half a frame open (1/60 s
  at 30 fps); `'shut'` draws every frame sharp, on purpose.
- `plays: [paintCameraPlay({kind: 'move', value}, {clock, origin, blend?})]`, `origin` the name errors give it,
  `value` a `PaintCameraMovePose` `{pan?, dolly?, zoom?, roll?}` in time; `{kind: 'focus', value: {focus, aperture}}` for depth of field, `focus` the
  depth held sharp, `aperture` the blur sigma at infinity. One move plays at a time: a second over the same seconds
  is refused unless it says `blend: 'add'`, which adds its fields to the move under it (a kick on a push).
- A plane at depth d shows scaled zoom · d ÷ (d − dolly) about the frame centre, shifted by −pan · zoom ÷ (d − dolly).
  A pan of 100 moves a plane at depth 2 by 50 and one at 0.5 by 200; a dolly grows near planes more than far ones.
  A pan moves a far plane less, so give it a document wider by what it travels.
- The back's painting must reach past everything the frame reads of it: past the frame by its blur (about 3 × sigma
  + 2 px each side) and any travel the move and shutter show. Short of that the shot is refused (`back.lay`), never
  clamped, naming fixes in the lay's own terms: a larger scale, a cover of a box inside the painting, or how many px
  more to paint and how far up and left to lay it. Apply one as written. Painting more on the top and left moves every
  document px right and down, so the lay moves up and left with it.
- Past about 1.3 magnification a plane's paint looks soft.

`paintCameraPlay` and `PaintCameraMovePose` come from `#lib/paint/animation/models/paint-camera.ts`, `stampStage` from
`#lib/paint/painting/models/stamp-stage.ts`. A 4 s push-in:

```ts
plays: [paintCameraPlay(
  { kind: 'move', value: paintKeyed<PaintCameraMovePose>([{ at: 0, value: { zoom: 1 } }, { at: 4, value: { zoom: 1.08 }, curve: 'inOut' }]) },
  { clock: { at: 0 }, origin: 'push-in' },
)],
```

## Lays

A plane's `lay` takes its document px to plane px; the camera then shows plane px.

| Form | Write | Notes |
|---|---|---|
| still | `{placement: {x, y, rotation, scale}, pivot}`, or none (document px are plane px) | a cropped painting lies where its box did: `x: box.x0, y: box.y0`, pivot 0 |
| moving | a value in time of still lays | checked over the span; the back is checked each frame; at scale 0 the plane draws nothing |
| cover | `{kind: 'cover', box, at?}` | through the shot's camera at `at`, scaled until the box holds the frame's corners: a frame-sized middle of a larger painting, no placement to work out |
| pin | `{kind: 'pin', points: [{sourcePx, element}], at?}`, one point or two | puts `sourcePx` on the centre of the element inside the shot with `data-pin="<element>"`; two points also scale and turn. Measured each frame, never blurred by its element's move |

A plane moves by its lay or by a `place` play on its own node, never both. **One move for paint and HTML**: a move
that should blur is said in paint and the HTML follows it. One function of the scene second lays every plane that
moves together and places the HTML riding them: at rest `x: slide(m.at)` in the lay and `left: slide(t)` in the scene;
under a moving camera, `paintSimilarityApply(paintShotViewAt(camera, span, depth, paintMoment(t)), point)`.

**Across depths** (`#lib/paint/animation/models/paint-camera-depths.ts`, each taking the shot's camera and span):

- `paintPointAcrossDepths(camera, span, {depth, point}, toDepth, m)`: the px on a plane at `toDepth` the frame shows
  where it shows `point` at moment `m`. Lay a figure's feet in a pool on the back with it.
- `paintCameraReachAt(camera, span, depth)`: how far past the frame, each side, the camera reads a plane at `depth`
  over the span, blur included. A painting that large laid at (−left, −top) holds every frame.
- `paintShotViewAt(camera, span, depth, m)`: the similarity, plane px to frame px.

Things that must stay in register as the camera moves (a glint under its sun, a shadow under a walker) share a depth,
or are placed each moment through these. All three are exact between image-parallel planes only: a ground receding
to a horizon is a three plane wearing its painting (`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/three-and-wrapping.md`).

## Values in time

Whatever may change takes `PresentationValue<T>`: a constant, or `(m) => T` read at each exposure (`m.at` the second
seen, `m.frame` the frame shown). `paintKeyed(keys, {between?})` (`#studio`; in a model,
`#lib/paint/animation/models/paint-keyed.ts`) builds one from keys over any value made of numbers, every key naming the
same numbers. A key is `{at, value, curve?, curves?, through?, snap?}` or `{at, hold: true}`:

- `curve` is how the value moves *into* this key; key 0 takes none. `curves` gives a channel (`x`, `pan`) its own.
- `hold: true` keeps the previous value until `at`. `through: [p, …]` passes points at speed.
- `snap: true` says the speed changes at once here, and means to (a strike, a bounce): the motion warnings accept it.
- Name the type when keys are written `as const`: `paintKeyed<PaintCameraMovePose>(…)`.

| Curve | Moves into its key | Past it? |
|---|---|---|
| `'linear'` | at an even pace | no |
| `'in'`, `'out'`, `'inOut'`; `{in: p}` … | quadratically (or at power p): from rest, onto it at rest, or both | no |
| `{accelerate: a, brake: b}` | speeding up for `a` s, cruising, braking for the last `b` s | no |
| `{back: o}` | `o` of the way past, settling back by its time | yes |
| `{spring: {duration, bounce?}}` | a perceptual spring arriving on the key at its time | when bouncing |
| `(u) => share` | any ease of the share covered | as written |

`between: 'smooth'` runs uncurved channels on a monotone cubic through the keys, never past one. `paintKeyedAccent`
(rise to `peak`, settle) and `paintKeyedHit` (wind back first) rest at 0, so they add, and their peak snaps. Key with
these, never a hand-written ease; `#studio`'s motion functions (`sineInOutEase`, `powerOutEase(3)`, `stagger`) are for
where a function of the share is wanted. Moment times come from the storyboard's cues, never typed in
(`${CLAUDE_PLUGIN_ROOT}/skills/video-canvas/references/painting-over-time.md`, Cues).

- **Moves on moves.** Node moves compose by level: an occurrence's play rides its group's node, and that its plane's.
  Slide a tram on its plane and bump it over each rail joint on its occurrence. Only two writers of one thing on one
  node clash. Paint that moves apart from its surroundings needs a layer or group of its own to carry a node, and an
  own sheet to move as finished paint rather than be repainted at each pose.
- **Scale 0** on a `place` or lay draws nothing, so a figure can shrink away and grow back. The back can't.
- **Depth in time.** A plane's `depth` may be a value: it's drawn behind a plane before crossing its depth and in
  front after. It stays nearer than the back at every moment. Depth places a plane but doesn't size it at rest: for
  growth seen at rest, scale its lay by painted depth ÷ depth now. A three plane's depth holds still.

## Motion nodes, plays, glow

- **Node fields**: `pivot` (document px), `marks`: `'stuck'` (default) or `{boil: {every, amount?, scale?, reseed?}}`
  (lines wobbling every n frames; `reseed` repaints, a solve an epoch), `clock: {hold: n}` or `{freeze: s}`, `glow`.
- **Plays**, each `{clip, clock, origin}`: clock `{at, rate?, loop?: {period, mode?: 'repeat' | 'pingpong', times?},
  hold?, until?}`, `at` in scene seconds, a cue's. Clips: `place` (rigid, about the pivot), `poses` (per pin),
  `breathe`, `sway {root, direction, length, amount, period}` (reeds, a hanging leaf), `flutter`. Two plays writing
  one thing (a place, one pin) over the same seconds are refused; a place and a sway on one node compose.
- **Glow** (`{amount, threshold}`, a value in time) is light a node's paint adds past a luminance threshold, bloomed
  by the lens at `lens.bloom`. Glow the emitter (the lamp's glass, the lit window), never a painted halo: a halo glows
  only by its own thin film. Light comes only from paint that adds it, so an emitter is opaque paint (gouache, white
  in the mix) on a clear plane or over darker paint; a moon left as paper glows on no plane. Visibility, a mask or a
  reveal thins a film before its light is measured, so its glow falls faster than its paint: pulse the glow itself.

## Holds and costs

Hold drawn motion on twos (or the grid the look wants); fades and the camera run on ones. A hold holds through its
frame's shutter, so it never smears into the next drawing.

| You change | Cost |
|---|---|
| a property value | a solve of each sheet from its first changed application |
| a pose on a sheet the occurrence doesn't own | a solve per distinct pose of it and everything after it in the sheet's order |
| `layersOf` `at` crossing a clocked application | one solve per prefix, cached |
| a painting in time | a solve per key drawing, at most its `drawings` |
| lay, depth, camera, lens, visibility, a pose on an own sheet, boil wobble, a reveal, instances, a dissolve's weight | per frame, no solve |
| a plane whose visibility (or every layer's) is 0 at every exposure of a frame | nothing: it isn't solved |

A solve's cost grows with the stamps laid, and nothing caps the marks in an application. A moving element repaints
everything after it in its sheet's order at each pose: put moving elements late in the document, or on own sheets.
Unclocked work comes first on a sheet with clocked washes wherever it's written, so an unclocked walker repaints
every clocked drop shown by then; clock its wash or hold it. Quantise properties with `step`, hold planes, and
`warm: {from, to}` (scene seconds, not frames) the span a scene plays. Fade a plane out over frames it isn't seen in
and they skip its paint.
