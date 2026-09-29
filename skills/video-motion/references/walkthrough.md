# Walkthroughs: a real product, shown and voiced

The craft of a video that shows a real product's UI to a voice: a walkthrough, an explainer, a PR video. The picture
is captures (stills and takes, the `video-capture` skill) or the product's own components, moved by a camera and
marked with rings and a cursor, and every beat hangs off a word.

## Scenes on a voice

Each voiced scene is a `voiceSpan` in `timeline.ts` (see the skill's Timing), bound in `video.tsx` with
`sceneForTimelineClock(clock, { note, render: (s) => …, expect })`. Inside `render`, `s.t` is seconds since the
scene's cut (negative while it fades in), and
`s.line(id)` is one of its lines: `.start`, `.end`, `.word('seventeen')` for when a word is spoken, `.at(0.4)` for a
fraction of the way through. Lines in a scene keep the pause the read left between them; `gap` overrides it, for every
line or as `{ lineId: seconds }` before one.

- Anchor each beat to its word (`s.line('ladder').word('no volume discount').start`, or a speech cue), never raw
  seconds. Re-voicing re-times everything, and the words come from whisper, so they land within a couple of frames.
  Camera and cursor keys must rise in time: word-anchored keys can swap after a re-voice, and the scene throws rather
  than snapping.
- **The picture leads the word.** A ring must be fully drawn as its word starts, or its `expect` fails:
  `k={seg(s.t, w.start - 0.7, w.start - 0.1, motionCurves.linear)}`. A camera move lands as the word starts, not after.
- **Say it and show it**: give the highlight a `name` and the scene an
  `expect: (s) => [{ see: 'tiers', during: s.line('ladder').word('no volume discount') }]`. The check fails if the
  named highlight isn't drawn, clear of tags and the caption, for the whole span.

## Camera vocabulary

The user and you should mean the same thing by each word; the storyboard's Motion column is written in them.

| Term | Means | Build it with |
|---|---|---|
| **Push in** | The camera moves closer until one part fills the frame | `camAt(s.t, [[a, camTop(shot, frame)], [b, camFit(shot, shot.rects.price, frame)]])` into `view(shot, cam, frame)`, `frame` being `useVideoFormat()`. Zoom interpolates in log space, so the speed reads as constant |
| **Pull back** | The reverse: out from a detail to the whole | Swap the two cameras |
| **Pan** | The camera slides sideways or up and down, zoom unchanged | Keep one `zoom` and move the centre: `const a = camFit(shot, rect, frame)`, `b = { ...a, cx: centerOf(next).x }`. Two `camFit`s can land at different zooms, since `maxZoom` is only a ceiling |
| **Hard cut** | One shot ends and the next starts on the very next frame | No `crossfade` on the later scene's span in `timeline.ts` (`crossfade: 0.5` dissolves over half a second, centred on the cut) |
| **Match cut** | Something lines up across two shots, so the cut reads as one move | End shot A and start shot B with the matching element at the same **screen** position (`screenRect(view, rect)`), moving the same way, on a hard cut |
| **Split / side by side** | Today and the new version in two panels | `SplitCompare` with `splitLeftRect(frame)` / `splitRightRect(frame)` boxes; each side's camera is `camFit(shot, rect, frame, opts, splitLeftRect(frame))`. Put a side's rings, cursor and state changes in its `over`, which clips them to the panel so the check catches a ring cut off at the seam. Only what floats over the whole window (a native menu, a browser dialog) goes in `children` |
| **State change** | The page changes under a still camera (a click's result) | `CaptureStates` with `[shot, at]` pairs; it dissolves between captures of the same page |
| **Motion blur** | The smear a real camera records when something moves fast | `CaptureMotion` on fast moves only. Slow moves stay sharp |
| **Highlight / ring** | A glowing outline drawn on around the subject | `Highlight rect={screenRect(v, rect)} k={seg(s.t, a, b, motionCurves.linear)} name="…"` |

These are the words for moving over captures, not the edge of what a scene can do.

## Takes: when the viewer should watch it happen

A cut from one still to the next state hides the action. Where following the click matters (a carousel, a menu
opening), film a take (the `video-capture` skill) and put it in the scene:

- `fitTake(T[name], [[word.start, 'pick'], [later.start, 'shown']])` pins its marks to words. Keep the speed between
  pins near 1×; past ~1.5× a scroll or animation reads rushed, so move a pin to an earlier word or refilm slower.
- `takeShot(take, tt)` is the frame showing then, and cameras work on it as on a still. Aim through
  `onTake(take, tt, mark.rects.x)`: it follows the page's scroll.
- Draw the cursor with `<TakeCursor view fit t />`, not `CursorPath`. It comes from the take's log, clicks included.
- A take's frames are JPEG, so a close-up whose point is sharpness (a lightbox comparing two pages) belongs on a
  still.

## Host components

When the video is about a product repo's code, its real React components can be the shot instead of a capture of
them. With the project's host synced (the `video-kickoff` skill, Take the dump), import from `@host/<path from the host
root>` in `video.tsx`, lay them out yourself and animate with plain Remotion (`spring`, `interpolate`, or `seg` on
`s.t`). Cameras and capture rects don't apply.

- Import the host's packages through it too (`@host/apps/web/node_modules/@mantine/core`), so the scene shares the
  copy the host's files use, and with it their React contexts.
- Render them as the app does: wrap them in the provider its root mounts, with its theme (tk: `MantineProvider` with
  its `theme`, `cssVariablesResolver` and `forceColorScheme`), and import the app's global stylesheet and its UI
  library's CSS.
- The app's font `<link>` (Google Fonts) isn't in the bundle, so text silently falls back. Put the font files in
  the project, import them (an import is the file's URL) and load them with `@remotion/fonts` `loadFont`.
- Try the real, exported component first, even a container; feed it fixture data. Server-only files its imports
  reach go in `host.json` `browserStubs`. Fall back to a pure piece inside it only if it won't render.
- tsc types `@host/…` as `any`, so wrong props only show on screen: `studio look` is the check.
- To ring a composed element, pass `useScreenRect(ref)` to `Highlight`, drawn outside any scaled wrapper. For an
  element a component renders itself, ref the container and add a selector: `useScreenRect(ref, '[aria-label="…"]')`.
- Pin "now" with `defineVideo({ clock })` and `captureShots({ clock })`, so relative dates ("5 minutes ago") match
  across captures and composed scenes and never drift between renders.

## Acting on feel notes

The user watches in the Studio (`studio preview <p>`) and says what feels off. Change only what the note names:

- **"Slow every zoom and pan to 0.7× of current"**: stretch each camera key's span by 1/0.7 around the word it's
  anchored to. Leave cursor, text and line timing alone. If the scene then runs past its voice, raise `tail` or `min`.
- **"Push in on the click"**: push in over ~0.5 s ending at the click key in `CursorPath`, hold through the ripple,
  then pull back. If the click changes the screen, follow the change.
- **"Cursor comes in from off screen"**: make the first waypoint `offscreen(view, target)` instead of fading `alpha`.
- **"The highlight comes too late"**: move its `on()` earlier relative to its word, and add an `expect` so it stays
  fixed.

## Tells of generated motion

Review guidance, not rules, and no check looks for them. When a walkthrough's strip looks machine-made, these are the
usual reasons:

- everything at one brisk speed, with no holds;
- **twinning**: both panels zooming in sync, a list popping in all at once, two rings drawing on together;
- linear moves, and every part of a shot moving at once;
- moves nothing motivates: the camera drifting to a spot the voice never mentions;
- a highlight on every beat, so none of them stands out;
- a setup with no payoff: a spinner nobody resolves, a click with no visible result.
