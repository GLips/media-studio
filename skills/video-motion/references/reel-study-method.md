# Studying a reference reel

How to break a reference video down so it can be rebuilt here, beat by beat. One agent can do a short reel; for a
longer one, give each section to its own agent with this file as the shared brief, then merge.

## The study

`studio study <video> [--at=a:b] [--sections=a:b,c:d] [--bpm=N] [--strip-fps=15] [--out=dir]` writes, beside the video
(or in `--out`, **which it clears first**):

- `index.md`: the beat grid (tempo, the phase of beat 0), every cut with its bar.beat and how many frames it sits off
  the nearest beat, and per section its palette (hex and share of pixels) and mean motion energy.
- `overview.png`: over the whole stretch, the mean colour of each frame, motion energy (how much each frame changed),
  cut scores, audio loudness, the beat grid (every bar numbered) and the cuts, marked with their offset.
- per section `NN-start-end/`: `strip.jpg` (every 4th frame of a 60 fps video at the default 15, each labelled with
  its time and bar.beat), `sheet.jpg` (12 larger frames), `vectors.jpg` (the encoder's motion vectors drawn on
  frames: where things move and which way), `plot.png` (the overview's bands for that section, per frame).

`--at` restricts the study to a stretch, and only that stretch's audio sets the grid (a compilation changes tracks).
The tracker can read half or double time; when a tempo is known (a HUD prints it, or cuts sit every other grid line),
pass `--bpm` and the grid is phased to the detected beats.

Measure what the sheets can't show from the source itself: a full-resolution frame is
`ffmpeg -v error -ss <s> -i <video> -frames:v 1 -q:v 2 <file>.jpg`, a crop adds `-vf crop=w:h:x:y`, and a denser strip
of a short stretch is `studio study <video> --at=a:b --sections=a:b --strip-fps=60 --out=<your own work dir>`.

## What to write, per beat

A beat is one idea on screen, usually one or two beats of the music. For each:

- **When**: start and end in seconds and bar.beat, length in frames (at the source's fps) and in beats.
- **What's on screen**: the composition, as a designer would spec it: positions and sizes as a share of frame height
  (cap height of type, diameter of a ball), margins, alignment, layers front to back.
- **What moves, and how**: each moving thing's path and timing in frames; its easing, read from positions frame to
  frame (even steps are linear; bunched at the end is an ease-out; a pass beyond the rest point is overshoot, and how
  far); motion blur or smear (and its length), squash and stretch (the ratio at its extreme), parallax (layers moving at
  different rates), camera moves (push, orbit, rack focus). Say what leads and what follows, and by how many frames.
- **The transition out**: hard cut, match cut (what matches), wipe, mask, zoom-through, whip; on which frame, against
  the beat.
- **Colour**: the hexes (from `index.md` or a full-res frame), what's ground and what's accent.
- **Type**: family class (grotesk, mono, serif), weight, case, tracking, size as a share of frame height, how it
  enters and leaves (per letter, per word, mask, slide, blur), with frame counts.
- **HUD and chrome**: every corner mark, label, counter, timecode and rule: its text, size, position, and whether and
  how it animates.
- **How we'd build it here**: this studio renders 1920×1080 at 30 fps in Remotion, every frame a pure function of
  time. Say which of React/CSS (`lib/studio`), three.js drawn per frame (see `lib/studio/blockout.tsx` for the pattern)
  or p5 (`lib/paint`, the `video-canvas` skill) fits, and name the reusable piece it implies with its parameters, not
  a one-off. Note anything a 30 fps render must do differently from a 60 fps source.

Measure rather than guess. When a number is an estimate, say so and how it was made.

## Fences

Write only your own breakdown file and scratch files inside your own section's directory. Don't edit the repository,
don't point `--out` anywhere but your own work directory, and make no paid calls.
