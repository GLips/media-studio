# Curves, springs and staggers

Each function's parameters are in its doc: `studio api motionCurves` (and `perceptualSpring`, `stagger`, `seg`,
`backOutEase`). This file is which to reach for, and the traps.

## Pick one system per video

- `motionCurves.productive` for UI moving as it does in the app; `expressive` for a reveal that should be felt;
  `expo` for a reel's snap, nowhere else. Each has `standard` (moving within the frame), `entrance` and `exit`. Keep a
  video, or at least a register's stretch of it, on one system.
- `dissolve` is for opacity, `linear` for what should read as mechanical (a scroll, a timer, a progress bar).
  `cubic` is the library pieces' own and the camera's default.
- `motionDurations` is calm UI seconds by action and distance. A reel sets its own, from its beat.

## Raw or eased `k`

Each library piece's doc says whether its `k` is raw (the piece eases it: Highlight, Tag, Text, GlassCard, DrawPath)
or eased. Hand a raw `k` `seg(t, a, b, motionCurves.linear)`; an eased one from `on()` or a curve eases twice and
lands harder. A ring must be fully drawn as its word starts: end its `seg` just before the word.

## Springs

`perceptualSpring(duration, bounce)`: `duration` is the pace, the same feel at every bounce (0.2–0.4 s for a reel's
lift, about 0.5 s for UI); `bounce` only sets the overshoot (0.15 felt, 0.3 seen).

- **On a beat or a word, the beat goes on its `arrival`**, and so does the move's hit sound: start the spring
  `arrival` early, `pop(t - (beat - pop.arrival))`. A bouncy spring then reaches home on the beat and overshoots after
  it; started on the beat, it reads a beat late.
- Springs are for moves. Fades and colour are `seg`. Type, the camera and numbers don't overshoot: they're read, and
  a number's bounce is a wrong value.

## Staggers

`stagger(i, n, { each, max, from, fps })` is item `i`'s start, on a whole frame. 40–80 ms apart reads as one gesture;
`max` caps a long list's spread so the last item isn't late. Tag each item's motion with
`stagger: { group, index, count }` so the tracks see the group. At 30 fps short steps round (46 ms lands on frames 0,
1, 3, 4, 6, 7), so keep authored timings in seconds and let `stagger` round once.

## Fast moves at 30 fps

Anything travelling more than about 40 px a frame strobes. Smear it: stretch it along its velocity (its position at
`t` and `t - 1/fps`), draw fading ghosts behind it, blur it along its path, or wrap the shot in `ShutterBlur`, at
`samples` times the render cost. A pose that must be seen (a max squash, a flash frame) has to land on a rendered
frame, not between two.
