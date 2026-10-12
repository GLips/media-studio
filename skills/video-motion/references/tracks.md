# Motion tracks: saying why with numbers

The strip shows whether a move reads; the tracks say why: when a ring finishes drawing against its word, whether the
camera lands before the line starts, which of two things moves first. `studio check <p>` records them to
`out/check/motion.json` (a scoped check's `motion-<scope>.json`), rewritten every run, so it describes the code as it
is now; a render's own timeline is in its snapshot.

## Tagging

- Library pieces tag themselves under names they pick (`camera`, `cursor`, a Highlight's `name`, a Tag's words). Each
  takes `motion` to name it yourself, or `false` for no track.
- Tag hand-written motion with `data-motion="name"`, or `useMotionTag(ref, 'name', selector)` for an element a host
  component renders. A tagged element inside another belongs to it, and is measured in that owner's frame as well as
  on screen: a ring riding a push-in moves on screen while its page box holds still.
- A Highlight on a rect straight from `screenRect` records its camera. Otherwise pass `through`: its view, or
  `'screen'` for a rect in screen coordinates.
- A canvas or three.js scene is opaque to the probe: tag it `unmeasuredAttrs('<what>')` and judge it by eye. The
  check names everything it couldn't see (a take's contents, generated footage, pieces it couldn't tell apart until
  named) and fails on two elements under one name of yours.

## Holding a read

Give the element a `motion` name and the scene an `expect` like
`{ hold: 'price', for: 1, during: { start, end } }`. The check fails unless it stays put (within 2 px, or `within`)
and visible for `for` seconds inside `during`, and names what moved, when and by how much. Steady and visible isn't
readable: judge size and contrast by eye.

## Reading a graph

`studio look <p> --graph a:b` renders a stretch and plots each tracked element's position, velocity, size and values,
with words and crossfades marked:

- **Easing**: an eased move's velocity is a bell; a linear one is a flat plateau that starts and stops dead. Trail
  dots bunch where something is slow.
- **Overshoot and wind-up**: signed velocity crosses zero.
- **What leads**: which element moves first, and where each move starts and lands against its word or beat.
- **Snaps and jitter**: a jump in a single frame, or a hold whose velocity keeps flipping.

A graph can't say whether a move reads: check that on the strip, and the feel in playback.

## Scene models, before rendering

A piece drawn from a model (a ball's bounce, a needle's strikes, a camera path) keeps its numbers in the scene's
`bars/<id>-model.ts`, which exports a `definePieceTracks` naming each piece's place on a frame, the box it covers and
what it keeps clear of. `studio look <p> --graph models --bar N` prints and graphs each piece's position, values and
clearance from the HUD (negative where it overlaps) in about two seconds, with no render. Read it before rendering a
change to such a piece, and give a new piece a track when you'd otherwise render to find where it is.
