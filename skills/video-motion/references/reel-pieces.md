# Building a reel piece

A reel piece is one device of the high-energy register (a slam of type, a morphing grid, a ticker band, a rolling
odometer, a 3D field) as a component in `lib/studio/reel/<piece>.tsx`, exported through `lib/studio/api.ts`. It is
built once, to the craft of a reference showreel, and reused by any music-led marketing video (an ad, a launch teaser,
a social cut, a product promo, the punchy open of a walkthrough) with its own words, colours and beat grid. This file
is the shared brief for building one, whether you're the only builder or one of several working in parallel.

Read first: `skills/video-motion/references/showreel-breakdown.md` (the system section, then the beats your piece
comes from). When the breakdown names a section, its frames are in the study beside the reference video
(`study-claude/NN-*/strip.jpg`, `sheet.jpg`, `vectors.jpg`, `plot.png`); pull a full-resolution frame with
`ffmpeg -v error -ss <s> -i <video> -frames:v 1 -q:v 2 <file>.jpg`.

## The register

A reel is not a walkthrough. The walkthrough tokens (`motionCurves.productive`, `motionDurations`, "one read at a
time") don't apply; the breakdown's rules do. In short: something is always moving, every arrival lands on a beat,
arrivals snap (most of the move in its first few frames, then a long settle), shapes and type are big enough to be
the image rather than a label on it, and colour comes in full-bleed fields, not tints.

## The contract

- **A pure function of time.** Take `t`, seconds since the piece starts (negative before it), and when it happens in
  seconds. A piece that does something every beat also takes `spb` (seconds per beat); the author gets it from the
  video's `BeatGrid` (`lib/studio/beats.ts`). No `Math.random`, `Date`, `performance.now`, or state carried between
  frames: any frame renders the same alone. Randomness comes from `seededRandom` / `hashRandom`
  (`lib/studio/random.ts`), seeded by a `seed` prop.
- **Everything the author would change is a prop**: words, colours, sizes, counts, where it starts from, how long each
  part takes. Default to the reference's values (from the breakdown), so the piece looks right with no tuning. Sizes
  are frame pixels in the 1920×1080 frame; say in the doc comment what share of frame height a size is.
- **Type**: `DISPLAY_FONT` (Archivo, variable: `fontWeight` 100–900 and `fontStretch` 62–125% are continuous, so
  both can animate) and `MONO_FONT` for HUD labels and readouts (`lib/studio/fonts.ts`).
- **Curves**: `motionCurves.expo` (`entrance` for arrivals, `exit`, `standard`) and `seg`, or `springBy(duration,
  bounce)` for an overshoot that must still land on its beat (`lib/studio/motion.ts`). Physics (a bounce, a roll) is
  written as physics, closed-form in `t`.
- **30 fps.** The reference is often 60 fps; at 30, a fast move strobes. Smear what moves more than about 40 px a
  frame: stretch it along its velocity (computed from the position function at `t` and `t - 1/FPS`), draw fading
  ghosts behind it, or blur it along its path (an SVG `feGaussianBlur` with `stdDeviation="x 0"`). A whole shot can
  use `ShutterBlur` (`lib/studio/motion-blur.tsx`), at `samples` times the cost.
- **Motion tags.** The moving element carries `pieceMotionAttrs(motion, '<picked name>', { kind: '<piece>', values:
  { … } })` (`lib/studio/motion-tag.ts`), with a `motion?: string | false` prop. A piece of hundreds of parts tags
  the whole and reports its progress as a value; it doesn't tag each cell. A canvas the probe can't see into carries
  `unmeasuredAttrs('<what>')` (`ThreeStage` does this itself).
- **Cost.** A reel renders 600 frames. Keep a frame under about 2,000 DOM nodes; past that, draw into a canvas (2D in
  a `useLayoutEffect` that redraws each frame, or `ThreeStage` for 3D, `lib/studio/three-stage.tsx`).
- **3D** is `ThreeStage`: `draw()` builds the scene and camera for this frame from scratch, and the stage disposes it.
  Lens effects (`dof`, `bloom`) are props.
- **Doc comments** say what it draws, what each non-obvious prop does, and the reference's values. Under 60 words
  each, and why rather than what.

## Proving it

1. Write a demo at `scratch/reel-<piece>/video.tsx` (gitignored): the piece used the way the reference uses it, on
   `steadyBeatGrid(120)`, over a few seconds, plus any variant the props promise (another colour, another word, the
   other direction). `scratch/three-test/video.tsx` shows the shape of a scratch project.
2. Look at it: `studio look scratch/reel-<piece> --strip=a:b --step=0.0333` gives every frame of a stretch, and
   `--sheet=…` chosen moments. Put them beside the reference's frames for the same beat, and fix what differs: when
   it arrives against the beat, how hard it snaps, how far it overshoots, how long it smears, how the stagger runs,
   the sizes, the colour.
3. For a tagged piece, `studio look scratch/reel-<piece> --graph=a:b` shows its tracks: one track per tagged part, no
   jitter, values that run where they should.
4. `npx tsc --noEmit -p .` shows no errors in your files. (`projects/sale-only-view` has known errors that aren't
   yours.)
5. A test only if the piece has pure logic whose failure would be silent (the odometer's digit positions, a grid's
   filtering order), beside it as `<piece>.test.ts`, through the exported functions.

## Fences

- Write only `lib/studio/reel/<piece>.tsx` (and its test, if earned) and `scratch/reel-<piece>/`. Read anything.
- Don't edit `lib/studio/api.ts`, `kit.tsx`, `motion.ts`, another piece, `projects/`, `skills/`, `README.md` or `bin/`.
  If you need a shared helper that doesn't exist, write it in your piece file and name it in your report, so the
  orchestrator can lift it.
- No paid calls (`studio gen`, `studio music gen`), no `git add`, no commits.

## The report

End with: the exported names and each one's props in a line; a usage snippet as an author would write it; the frames
you checked (paths) and what you compared them against; where your piece still differs from the reference, and why;
any helper worth lifting.
