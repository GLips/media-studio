# The reel system

The system the reel pieces were built to: a frame-measured reading of one reference motion-design showreel, eight
bars of four beats at 128 BPM, 60 fps, 1920×1080, 15 s, each bar one device under a HUD naming it. Its numbers are
the pieces' defaults (`studio api <piece>` has them); this file is the system behind them, the bar a new reel is
judged against. The rules it implies are in `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-critique.md`.

H is the frame height. Rates per frame are at the reference's 60 fps unless they say otherwise.

## Clock

- Every event lands on the first frame at or after its beat line; the HUD's beat squares switch exactly there.
- Moves that must arrive on a beat start early: a band entry 4 frames, a collapse 8, a morph 12 (at 60). Reactions
  trail by 1–2 frames: a HUD square and a callout dot +1, a ground ring +2.
- The music's onsets trail the lines by about 40 ms, so picture leads sound by 25–45 ms. That is the timeline's
  `pictureLeadFrames` (`${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/timing.md`).

## Cut grammar

- One idea per bar, named by a HUD label that changes only on the downbeat. Every beat carries an event.
- Six bars of one device each, then an accelerando that brakes: a recap cutting each beat to more tiles, then four
  sixteenth-note flashes; an end card adding one element a beat, black on the next downbeat.
- Every cut is a 0 ms switch, often carrying a glitch split or a chromatic kick, and figure and ground trade places.
- No dissolves. Bars join by a colour zoom-through, a point match (a dot becomes the next bar's flash), a layout match
  (a grid's squares become 3D column tops), a speed-matched whip, a match on the word, a white or grey flash, and a
  final fade to black.
- The camera makes one real move in the whole reel (an in-out cubic over 1.4 beats). Every other camera change is a
  punch that decays.

## Easing

- **Arrivals are the exact out-expo**, 1 − 2^(−10k), which is `motionCurves.expo.entrance`. An ease over d seconds
  keeps 2^(−10/(fps·d)) of the remaining distance each frame, so a measured per-frame ratio gives the duration; a
  ratio r at 60 fps is r² at 30. Measured: rules and slides 0.30 s, letters rising 0.40 s, band entries 0.49 s, a
  title's letters 0.71 s.
- **Exits accelerate exponentially** (×1.6–1.85 a frame): they leave faster than they came.
- **Hits decay**: a camera punch is 1 + a·e^(−Δt/τ) (1–3%, τ about 0.1 s); a landing hits ×1.06–1.09 and relaxes
  ×0.85 a frame; a kick is a damped cosine; flashes fall ×0.65 a frame.
- **Overshoot is rare and small** (a 2° pass on a 45° turn, a back-out of 12% on a tile's pop, a bounce's string).
  Type, the camera and numbers never overshoot.
- **Falls are physics**, closed-form in t (g about 4 px a frame² at 60).
- Linear only for fades, fills, scramble fronts, scrolls and drifts. In-out only for the one camera move and the
  particle morphs.
- **Nothing is ever still.** The HUD's timecode changes every frame, the ticker breathes off the beat, spins run
  115–145°/s, the end card pushes in 2%. The longest HUD-only stretch is 20 frames; a median frame changes 9% of its
  pixels.

## Colour

- A near-black ground (#0a0a0c), cream (#efece6), red-orange (#ef4c22) and blue (#3037f2), each read at the centre of
  a flat field. Warm ink (#15090c) carries type on the accents.
- Two accents, used full bleed. The ground is the colour event and changes on the beat; an accent reaches full frame by
  a zoom through a shape of its colour.
- In fields of many parts, accents are scattered by hash in small shares (5–20% red, 3–8% blue); in 3D the ball is the
  only saturated warm thing that moves.

## Type

- **One word is the image**, at 20–31% of H; everything else is mono at 2.2% of H or less, with nothing in between.
- **Each word gets its own mechanism**: letters rising through a mask, a weight sweep inside a selection box, a slant,
  a scramble, breathing bands, a dissolve to particles.
- **Set tight**: 0–26 px between letters at 220–318 px caps, ≈−0.03 em. Archivo's cap height is ≈0.69 em, JetBrains
  Mono's ≈0.73 em.
- Words whose letters move are set one glyph per span, placed from the font's advances (`layoutGlyphLine`), not by
  the browser's line layout.

## HUD

Dim static chrome in the outer 60 px, over the content and every transition and under the frame post: corner
brackets, a top row (name, title, `128 BPM 60 FPS 1920×1080`), a bottom row (timecode, four beat squares, a progress
rule, the bar's `NN — TITLE` label). Its text decodes in on boot and each label decodes over 18 frames from its
downbeat. Its tone follows the ground under each part: light over dark grounds, dark where a flash or a cream field
reaches it, plated where the ground is mixed. Where the tone is wrong a part vanishes, and that frame is a flaw.
`ReelHud` builds all of it, reading each part's ground from what the bar draws under it.

## Frame post

- **No grain**: static holds change under half a level frame to frame. Leave `FilmGrain` off (its overlay blend is
  invisible on near-black anyway).
- **Chromatic aberration**: radial at rest (red out, blue in, under a pixel at the corners), kicked to 2–4 px on cuts,
  split sideways on glitches (6–14 px, falling ×0.85 a frame). `LensFringe` wraps the whole frame, HUD included.
- **Flashes**: grey or white, ramping in over 4–5 frames at 60 or falling ×0.65 a frame; the HUD sits over them,
  toned dark.
- **Vignette**: an 11% falloff to the corners, built into the grounds (`Vignette` on the ground layer), never over
  the HUD.
- **Bloom** only on the end card's title.

## 60 fps, 30 fps and smear

- The reference has a centred 180° shutter: each frame averages sub-frames over ±¼ frame, and smear runs 0.4–0.5 of a
  frame's travel. `REEL_SHUTTER` keeps that smear length at 30 fps; 0.5 suits transitions.
- At 30 fps a beat at 128 BPM is 14.06 frames: keep timings in seconds and let the clock round once.
- These strobe without smear: a ball's drop (≈140 px a frame at 30), a zoom through a dot, band entries and exits, a
  whip, an implosion. Every max squash, newborn colour, glitch frame and flash frame must land on a rendered frame.
- A sphere spinning 115°/s wagon-wheels at 30: halve it.
- Around a `ThreeStage`, use the stage's own `samples` and `shutter` rather than `ShutterBlur`: each sample would be
  a stage with a GPU device of its own.

## The bars, and their pieces

| Bar | Device | Pieces |
|---|---|---|
| 1 Squash & stretch | A ball bouncing on a baseline that rings like a string, callouts typed in, then swelling to fill the frame with the next ground | `BounceBall`, `bouncingBallAt`, `FieldSwell` |
| 2 Kinetic type | One word a beat, each its own mechanism and ground: rise through a mask, weight sweep in a selection box, slant into a zooming tittle, scramble with glitches, out on a CRT collapse | `RiseWord`, `WeightWord`, `SelectionBox`, `SlantWord`, `ScrambleText` |
| 3 Generative grid | A 19×11 field of glyphs; each beat a wave (radial, diagonal, inward) morphs every cell into the next shape | `GlyphField`, `FieldFlash`, `ShockRing` |
| 4 3D / depth | The grid's squares become column tops; the camera cranes into 3D while a ball bounces a beat at a time, then whips out | `ColumnField` on `ThreeStage` |
| 5 Variable fonts | Seven full-width bands of one word scrolling in turn, breathing between light-condensed and heavy-wide, kicked on each beat | `TickerBands` |
| 6 Particles | The held word dissolves to points that land as a sphere, a knot, a galaxy, one a beat | none yet: build on `ThreeStage` points |
| 7 Edit / rhythm | The earlier bars replayed live in a 2-up, 2×2 and 3×3, popping in on a back-out, then sixteenth-note flashes and an implosion | `RecapGrid`, `GlitchFlash`, `Shake` |
| 8 End card | A title rising letter by letter, a rule drawing, mono lines decoding, a full stop falling and bouncing, fade to black | `RiseWord`, `ScrambleText`, `bouncingBallAt`, `FadeToBlack` |

`Odometer` (a price roll), `CapturePlane` and `Needle` (a reel over captures) extend the set past the reference.

## Gotchas

- SSAO and GTAO aren't deterministic from render to render: bake ambient occlusion per instance.
- `BokehPass` blurs linearly with depth, not by a lens's circle of confusion: accumulate aperture samples instead.
- Soft shadows are `PCFShadowMap` with a shadow `radius`. Scaling a `RoundedBoxGeometry` stretches its
  bevel: set height per instance. FilmPass, GlitchPass and AfterimagePass break determinism.
- Flaws in the reference not to copy: an accent over an accent (a lit HUD square on orange), HUD text vanishing over
  a paper tile, and sub-frame blends on cut frames.
