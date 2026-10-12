# Studying a reference reel

How to break a reference video down so it can be rebuilt here, beat by beat. One agent can do a short reel; for a
longer one, give each section to its own agent with this file as the shared brief, then merge.

## The study

`studio study <video>` (its `--help` has the flags and what it writes) gives the beat grid, every cut against it, and
per section a strip, a sheet, the motion vectors and a per-frame plot of colour, energy and loudness. `--at`
restricts the study to a stretch whose audio alone sets the grid (a compilation changes tracks). The tracker can read
half or double time: when the tempo is known (a HUD prints it, or cuts sit every other grid line), pass `--bpm` and
the grid is phased to the detected beats. A denser strip of a short stretch is `--at=a:b --sections=a:b
--strip-fps=60 --out=<your own work dir>`; `--out` is cleared first.

Measure what the sheets can't show from the source: a full-resolution frame is
`ffmpeg -v error -ss <s> -i <video> -frames:v 1 -q:v 2 <file>.jpg`, and a crop adds `-vf crop=w:h:x:y`. To land on
frame N exactly, seek half a frame early, `(N − 0.5)/fps`.

## What to write, per beat

A beat is one idea on screen, usually one or two beats of the music. For each:

- **When**: start and end in seconds and bar.beat, length in frames (at the source's fps) and in beats.
- **What's on screen**: the composition as a designer would spec it: positions and sizes as a share of frame height
  (cap height of type, diameter of a ball), margins, alignment, layers front to back.
- **What moves, and how**: each moving thing's path and timing in frames; its easing, read from positions frame to
  frame (even steps are linear; bunched at the end is an ease-out; a pass beyond the rest point is overshoot, and how
  far); motion blur or smear and its length, squash and stretch (the ratio at its extreme), parallax, camera moves.
  What leads, what follows, and by how many frames.
- **The transition out**: hard cut, match cut (what matches), wipe, mask, zoom-through, whip; on which frame, against
  the beat.
- **Colour**: the hexes, read at the centre of a flat field (compression smears thin coloured strokes), what's ground
  and what's accent.
- **Type**: family class (grotesk, mono, serif), weight, case, tracking, size as a share of frame height, how it
  enters and leaves, with frame counts.
- **HUD and chrome**: every corner mark, label, counter, timecode and rule: its text, size, position, and how it
  animates.
- **How we'd build it here**: the studio renders at the video's own format (1920×1080 at 30 fps unless it names
  another), every frame a pure function of time. Say whether DOM/SVG, a canvas, three.js on `ThreeStage` or a painted
  layer (`video-canvas`) fits, and name the reusable piece it implies, with its parameters, rather than a one-off.
  Note what a 30 fps render must do differently from a 60 fps source (`${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/curves.md`, Fast moves).

Measure rather than guess. When a number is an estimate, say so and how it was made. Where two readings disagree, the
later, frame-measured one wins, and the breakdown says so.

Done when every beat of your section has all of the above.

## Fences

Write only your own breakdown file and scratch files inside your own section's directory, point `--out` only at your
own work directory, and make no paid calls.
