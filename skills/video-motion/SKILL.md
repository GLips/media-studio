---
name: video-motion
description: Motion and camera for a video's scenes, from the shared vocabulary to lib/studio code, including a product repo's real components. Use when animating an approved storyboard, or for motion feedback ("slow the zooms", "the highlight comes too late").
---

# Motion vocabulary

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

The user and you should mean the same thing by each word. Each term below maps to `lib/studio/api.ts`, which is all a
scene imports; `studio api <name>` prints any function's signature and doc. `docs/directing.md` covers the fuller craft (shot sizes, eye trace, J- and L-cuts, pacing, easing feel,
sound); read it before planning motion for a whole video. Start from the storyboard: the existing projects each show
one way to tell one story, not a structure to copy.

A scene is `defineScene({ id, note, lines, lead, gap, tail, render: (s) => …, expect })`. Inside `render`, `s.t` is
seconds since the scene's start (negative while it fades in), and `s.line(id)` is one of its lines: `.start`, `.end`,
`.word('seventeen')` for when a word is spoken, `.at(0.4)` for a fraction of the way through. Lines in a scene keep
the pause the read left between them; `gap` overrides it, for every line or as `{ lineId: seconds }` before one.

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
- **The picture leads the word.** A ring must be fully drawn as its word starts, or its `expect` fails:
  `k={on(s.t, w.start - 0.7, 0.6)}`. A camera move lands as the word starts, not after.
- Say it and show it: give the highlight a `name` and the scene an
  `expect: (s) => [{ see: 'tiers', during: s.line('ladder').word('no volume discount') }]`. The check fails if the
  named highlight isn't drawn, clear of tags and the caption, for the whole span.

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
them. With the project's host synced (the `video-kickoff` skill, step 1), import from `@host/<path from the host
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

## Generated stills

A still no capture or kit shot can give (title-card art, a background, a physical product's shot, a concept icon)
is generated with `studio gen image <p> "<prompt>" --name <name>`, never the product itself (the `video-kickoff`
skill, Real UI only). It's paid and cached by request, so settle the prompt before re-running.

- Hand it what's real: the product's own photo or capture crop as `--ref`, and brand colours as hex in the prompt.
- Pick the model for the job: `recraft/recraft-v4.1-vector` for an icon that scales cleanly (SVG), `--transparent`
  on a model that allows it for a cutout laid over a scene, the default for everything else.
- It lands in `generated/images.ts`: `import { images } from './generated/images.ts'`, then `images[name].src`.
  Models make their own sizes (3:2, 1376×768), not 1920×1080, so fill a frame with `objectFit: 'cover'`.
- Look at it before using it: colours drift from the hex asked for, and a product shot can invent parts.

## Acting on feel notes

The user watches in the Studio (`studio preview <p>`) and says what feels off. Change only what the note
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

- `studio check <p>` runs the framing check (highlights and clicks under tags or the caption, off the frame, cut off
  by their panel; every `expect`) and writes `out/check/timeline.json`, which says when every scene and line lands.
- `studio look <p> --strip=a:b` shows a stretch of motion; `--sheet=t1,t2,…` shows chosen moments.
- `studio storyboard <p>` rebuilds the storyboard page from the video.

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
For something Remotion-specific (fonts, measuring text), see the `remotion` skill. A shot no capture or kit shot can
give (a product in use, a place, people) is generated footage, blocked in 3D and rendered once: the `video-gen` skill.
Music, sound effects and the mix are their own pass once the picture is locked: the `video-sound` skill.
