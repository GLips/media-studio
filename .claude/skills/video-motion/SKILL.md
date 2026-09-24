---
name: video-motion
description: Shared camera and motion vocabulary for animating scenes, with each term mapped to lib/studio primitives, and how to act on "feel" notes. Use when animating an approved storyboard, or when the user gives motion feedback like "slow the zooms", "push in on the click", "cursor from off screen", "make the cut feel continuous".
---

# Motion vocabulary

The user and you should mean the same thing by each word. Each term below maps to `lib/studio/engine.js` and `kit.js`. `docs/directing.md` covers the fuller craft (shot sizes, eye trace, J- and L-cuts, pacing, easing feel, sound); read it before planning motion for a whole video.

| Term | Means | Build it with |
|---|---|---|
| **Push in** | The camera moves closer until one part fills the frame | `camAt(t, [[a, camTop(n)], [b, camFit(n, rectOf(n, key))]])`. Zoom is interpolated in log space, so the speed reads as constant |
| **Pull back** | The reverse: out from a detail to the whole | Same keys reversed |
| **Pan** | The camera slides sideways or up and down, zoom unchanged | Keyframes with the same `zoom` and a different `cx`/`cy` |
| **Hard cut** | One shot ends and the next starts on the very next frame | `cut: true` on the later scene (otherwise scenes crossfade over `xfade`) |
| **Match cut** | Something lines up across two shots (same spot, same movement), so the cut reads as one move | End shot A and start shot B with the matching element at the same **screen** position, moving the same way. Compute both cameras from the element's rect, then `cut: true` |
| **Motion blur** | The smear a real camera records when something moves fast | `drawCaptureMotion(n, camA, camB, k)` on fast moves only. Slow moves stay sharp |
| **Easing** | How a move speeds up and slows down | `seg(t, a, b, fn)` with `easeInOut` (the default for camera moves), `easeOut` (things arriving), `ease` (gentle) |

## Acting on feel notes

The user watches `studio.html` and says what feels off. Change only what the note names:

- **"Slow every zoom and pan to 0.7× of current"**: stretch each camera keyframe's duration by 1/0.7 around the beat it's anchored to. Leave cursor, text and line timing alone. If the scene then runs past its voice, raise `tail` or `min` instead of squeezing another move.
- **"Push in on the click"**: push in over ~0.5 s ending at the click key in `drawCursorPath`, hold through the ripple, then pull back. If the thing clicked changes the screen, follow it: pan along with it while it types or expands.
- **"Cursor comes in from off screen"**: make the first cursor waypoint a point outside the frame (convert back from screen space) instead of fading `alpha` in.
- **"This scene leaves left, so bring the next one in from the right"**: carry the direction across the cut. Shot A's last move and shot B's first move point the same way on screen, with the same easing on both sides, so the cut reads as one camera move.

## Timing

- Anchor every beat to speech, with `s.line(id).start` or a fraction through a line (the `beat` helper in the project's `scenes.js`), never to raw seconds. Re-voicing then re-times everything.
- After a change, check it with `node lib/render.mjs projects/<p> --strip=a:b` for motion, or `--sheet=…` for framing. Look at the images yourself before reporting back.

## Every video becomes a template

When a shot works and could come back (an end card, a title, a product UI rebuilt in canvas), move it into `lib/studio/kit.js` with its brand colours and words as arguments. The next video starts from it and changes the skin.
