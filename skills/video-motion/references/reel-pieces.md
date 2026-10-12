# Building a reel piece

A reel piece is one device of the high-energy register (a slam of type, a morphing grid, a ticker band, a rolling
odometer, a 3D field) as a component beside the other reel pieces, exported through `#studio`. It is built once, to
the craft of a reference reel, and reused by any music-led video with its own words, colours and beat grid. This is
the brief for building one, alone or as one of several builders.

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-system.md` (the system, then the bar your piece
comes from) and `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/curves.md`. With the reference video to hand,
`studio study <video>` writes each section's strip, sheet, motion vectors and energy plot.

The register isn't a walkthrough's: `motionCurves.productive`, `motionDurations` and "one read at a time" give way to
the reel's rules (`${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-critique.md`). Arrivals snap on the beat,
shapes and type are big enough to be the image, and something is always moving.

## The contract

- **A pure function of time**, like every scene. Take `t`, seconds since the piece starts (negative before it), and
  when its events happen in seconds; a piece that acts every beat also takes `spb` (seconds per beat, from the video's
  `BeatGrid`). Randomness is `seededRandom` / `hashRandom` on a `seed` prop.
- **Everything an author would change is a prop**: words, colours, sizes, counts, direction, how long each part takes.
  Default to the reference's values, so the piece looks right untuned. Sizes are frame pixels as measured on the
  reference's 1920×1080 frame, and the doc says what share of frame height each is. Read the frame's size and fps
  from `useVideoFormat()`; a model takes them as arguments, never assumes them.
- **Type**: `DISPLAY_FONT` (Archivo, variable: weight 100–900 and width 62–125% are continuous, so both can animate;
  narrower than 62% takes `scaleX` on top) and `MONO_FONT` for HUD labels and readouts. Wait on
  `useStudioFontsReady` before measuring a word or painting one into a canvas.
- **3D** is `ThreeStage`: `draw()` builds this frame's scene and camera from scratch, and the stage disposes it. It
  averages `samples` exposures a frame, so depth of field (`lens`), motion blur (`shutter`) and soft shadows are real,
  not post passes; `bloom` applies once, to the average. A transparent stage over a light ground takes that ground as
  its `backdrop`. Project 3D points through the studio's one camera, `ShotCamera` (`shotCameraProject`,
  `shotCameraRay`), never by hand.
- **Colours into three.js** are hex or comma `rgb()`: it reads neither `oklch()` nor space-separated `rgb()`.
  `parseGlyphColor` turns any CSS colour into numbers first.
- **Motion tags.** The moving element carries `pieceMotionAttrs(motion, '<name>', { kind: '<piece>', values })`,
  with a `motion?: string | false` prop. A piece of hundreds of parts tags the whole and reports its progress as a
  value; a canvas carries `unmeasuredAttrs('<what>')` (`ThreeStage` does this itself).
- **Cost.** A reel renders hundreds of frames. Past about 2,000 DOM nodes a frame, draw into a canvas (2D redrawn in
  a `useLayoutEffect` each frame, or `ThreeStage`).
- **SVG filters** do post work on DOM and canvases alike, but Chrome has four traps:
  - It recomputes a filter result once for every step that reads it: have each tap read the source rather than
    chaining stages.
  - `feDisplacementMap` samples nearest-neighbour, so a sub-pixel shift needs bilinear weights of your own.
  - An `feImage` of an element or an SVG counts as cross-origin and switches `feDisplacementMap` off: feed it a PNG
    data URL.
  - A CSS `mask-image` on a subtree re-rasterises all of it, shifting edges and glyphs. To keep a region clear, draw
    over it instead.
- **Doc comments** say what it draws, what each non-obvious prop does, and the reference's values: why rather than
  what, under 60 words each.

Before writing a helper, run `studio api` (every export by file, with its first sentence): curves and eases, the
shutter and smear, beat grids, geometry, the HUD's ground reading, type metrics and scrambles, the recap's glitches
all exist, and a second copy drifts from the first.

## Proving it

1. Write a demo at `scratch/reel-<piece>/video.tsx`: the piece used as the reference uses it, on
   `steadyBeatGrid(120)`, over a few seconds, plus each variant the props promise (another colour, word, direction).
2. `studio look scratch/reel-<piece> --frames=a:b` (or chosen frames, `161,176,191`) beside the reference's frames
   for the same beat. Fix what differs: arrival against the beat, snap, overshoot, smear, stagger, size, colour.
3. For a tagged piece, `--graph=a:b`: one track per tagged part, no jitter, values running where they should.
4. The repo typechecks. A test only where pure logic could fail silently (an odometer's digit positions, a grid's
   filtering order), as `<piece>.test.ts` through the exported functions.

Done when the demo's frames match the reference's at each beat, or every difference is named with its reason.

## Building alongside others

- Write only your piece's file (and its test, if earned) and `scratch/reel-<piece>/`. Read anything.
- Leave the `#studio` barrel, shared modules and other pieces to the orchestrator: a shared helper you need goes in
  your piece file, named in your report.
- No paid calls, no `git add`, no commits.

End with: the exported names and each one's props in a line; a usage snippet as an author would write it; the frames
you checked (paths) and what you compared them against; where the piece still differs from the reference, and why;
any helper worth lifting.
