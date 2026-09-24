---
name: video-motion
description: Motion and camera for a video's scenes, from the shared vocabulary to lib/studio code. Use when animating an approved storyboard, or for motion feedback ("slow the zooms", "the highlight comes too late").
---

# Motion vocabulary

The user and you should mean the same thing by each word. Each term below maps to `lib/studio/api.ts`, which is all a
scene imports. `docs/directing.md` covers the fuller craft (shot sizes, eye trace, J- and L-cuts, pacing, easing feel,
sound); read it before planning motion for a whole video. Start from the storyboard: the existing projects each show
one way to tell one story, not a structure to copy.

A scene is `defineScene({ id, note, lines, lead, gap, tail, render: (s) => …, expect })`. Inside `render`, `s.t` is
seconds since the scene's start (negative while it fades in), and `s.line(id)` is one of its lines: `.start`, `.end`,
`.word('seventeen')` for when a word is spoken, `.at(0.4)` for a fraction of the way through.

| Term | Means | Build it with |
|---|---|---|
| **Push in** | The camera moves closer until one part fills the frame | `camAt(s.t, [[a, camTop(shot)], [b, camFit(shot, shot.rects.price)]])` into `view(shot, cam)`. Zoom interpolates in log space, so the speed reads as constant |
| **Pull back** | The reverse: out from a detail to the whole | Swap the two cameras |
| **Pan** | The camera slides sideways or up and down, zoom unchanged | Keep one `zoom` and move the centre: `const a = camFit(shot, rect)`, `b = { ...a, cx: centerOf(next).x }`. Two `camFit`s can land at different zooms, since `maxZoom` is only a ceiling |
| **Hard cut** | One shot ends and the next starts on the very next frame | `cut: true` on the later scene (otherwise scenes crossfade over `xfade`, centred on the cut) |
| **Match cut** | Something lines up across two shots, so the cut reads as one move | End shot A and start shot B with the matching element at the same **screen** position (`screenRect(view, rect)`), moving the same way, then `cut: true` |
| **Split / side by side** | Today and the new version in two panels | `SplitCompare` with `SPLIT_LEFT` / `SPLIT_RIGHT` boxes; each side's camera is `camFit(shot, rect, opts, SPLIT_LEFT)`. Put a side's rings, cursor and state changes in its `over`, which clips them to the panel so the check catches a ring cut off at the seam. Only what floats over the whole window (a native menu, a browser dialog) goes in `children` |
| **State change** | The page changes under a still camera (a click's result) | `CaptureStates` with `[shot, at]` pairs; it dissolves between captures of the same page |
| **Motion blur** | The smear a real camera records when something moves fast | `CaptureMotion` on fast moves only. Slow moves stay sharp |
| **Highlight / ring** | A glowing outline drawn on around the subject | `Highlight rect={screenRect(v, rect)} k={on(s.t, when)} name="…"` |
| **Easing** | How a move speeds up and slows down | `seg(t, a, b, fn)` with `easeInOut` (camera moves, the default), `easeOut` (things arriving), `ease` (gentle) |

## Time it by reads

You know what happens because you wrote the code. The viewer sees it once, at full speed, for the first time.

- Before animating a scene, list its **reads**, in order: each thing the viewer must understand ("typing narrows the
  list", "to seventeen"), with a start and an end. Each needs time for the eye to find it, to understand it, and a
  moment before the next.
- **One read at a time.** Cause, then reaction: the click, then what changed. Never both in the same half-second.
- **Lead the eye** to where the next read happens (the camera moves there, or it lights up first) before it happens.
- **Fast actions, slow meanings.** Camera moves and cursor travel can be brisk; the result they reveal gets a hold.
- If the reads don't fit, lengthen the scene (`tail`, `min`) or cut a read. Don't squeeze them.

## Anchor to speech, and lead the word

- Anchor every beat to the voice: `s.line('ladder').word('no volume discount').start`, never raw seconds. Re-voicing
  re-times everything, and the words come from whisper, so they land within a couple of frames. Camera and cursor
  keys must rise in time: word-anchored keys can swap after a re-voice, and the scene throws rather than snapping.
- **The picture leads the word.** A ring draws on over 0.8 s and reads at half-drawn, so start it 0.4 s early:
  `k={on(s.t, w.start - 0.4)}`. A camera move lands as the word starts, not after.
- Say it and show it: give the highlight a `name` and the scene an
  `expect: (s) => [{ see: 'tiers', during: s.line('ladder').word('no volume discount') }]`. The check fails if the
  named highlight isn't drawn, clear of tags and the caption, for the whole span.

## Acting on feel notes

The user watches in the Studio (`npm run studio -- projects/<p>`) and says what feels off. Change only what the note
names:

- **"Slow every zoom and pan to 0.7× of current"**: stretch each camera key's span by 1/0.7 around the word it's
  anchored to. Leave cursor, text and line timing alone. If the scene then runs past its voice, raise `tail` or `min`.
- **"Push in on the click"**: push in over ~0.5 s ending at the click key in `CursorPath`, hold through the ripple,
  then pull back. If the click changes the screen, follow the change.
- **"Cursor comes in from off screen"**: make the first waypoint `offscreen(view, target)` instead of fading `alpha`.
- **"This scene leaves left, so bring the next one in from the right"**: a match cut, with the same easing on both
  sides.
- **"The highlight comes too late"**: move its `on()` earlier relative to its word, and add an `expect` so it stays fixed.

## Checking your work

Look at the images yourself before reporting back.

- `node scripts/render.ts projects/<p> --check` runs the framing check (highlights and clicks under tags or the
  caption, off the frame, cut off by their panel; every `expect`) and writes `out/check/timeline.json`, which says
  when every scene and line lands.
- `--strip=a:b` shows a stretch of motion, 0.1 s apart; `--sheet=t1,t2,…` shows chosen moments. Add `--captions`.
- `node scripts/storyboard.ts projects/<p>` rebuilds the storyboard page from the video.

To judge timing, read a `--strip` like a viewer: at each tile, where are they looking, and do they understand it
yet? Time each read from the tiles' timestamps (a default strip's tiles are 0.1 s apart, three video frames each). A
read that flashes by in a tile or two, or shares its tiles with another read, will be missed.

## Tells of generated motion

Check the strips against these. Each one makes a video look machine-made:

- everything at one brisk speed, with no holds;
- **twinning**: both panels zooming in sync, a list popping in all at once, two rings drawing on together;
- linear moves, and every part of a shot moving at once;
- moves nothing motivates: the camera drifting to a spot the voice never mentions;
- a highlight on every beat, so none of them stands out;
- a setup with no payoff: a spinner nobody resolves, a click with no visible result;
- a video that just stops, with no final read held and no end card.

## Every video becomes a template

When a shot works and could come back (an end card, a title, a product UI rebuilt in DOM), move it into
`lib/studio/kit.tsx` with its brand colours and words as props. The next video starts from it and changes the skin.
For something Remotion-specific (fonts, sound effects, measuring text), see the `remotion` skill.
