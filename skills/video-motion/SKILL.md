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
| **Highlight / ring** | A glowing outline drawn on around the subject | `Highlight rect={screenRect(v, rect)} k={seg(s.t, a, b, motionCurves.linear)} name="…"` |
| **Easing** | How a move speeds up and slows down | `seg(t, a, b, curve)` with a curve token (below). The default, `motionCurves.cubic.standard`, is the camera's |

## Time it by reads

You know what happens because you wrote the code. The viewer sees it once, at full speed, for the first time.

- Before animating a scene, list its **reads**, in order: each thing the viewer must understand ("typing narrows the
  list", "to seventeen"), with a start and an end. Each needs time for the eye to find it, to understand it, and a
  moment before the next.
- **One read at a time.** Cause, then reaction: the click, then what changed. Never both in the same half-second.
- **Lead the eye** to where the next read happens (the camera moves there, or it lights up first) before it happens.
- **Fast actions, slow meanings.** Camera moves and cursor travel can be brisk; the result they reveal gets a hold.
- If the reads don't fit, lengthen the scene (`tail`, `min`) or cut a read. Don't squeeze them.

## Choreography

- **One dominant read**, with supporting motion allowed: the camera settling, a card's contents following it. Never
  two moves that both ask to be read.
- **The container moves first**, and its contents follow, overlapping it by 30–50%: a card rises, and its lines start
  when it's half to two-thirds of the way up.
- **Secondary action waits** until 100 ms or more after the main move lands: a ring, a badge, a count.

## Motion tokens for product UI

In a walkthrough or product explainer, pick a token rather than inventing a curve or a number. They're defaults for
that calm, legible register. A teaser or showreel designs its own motion, and nothing here limits it.

- **Curves** (`motionCurves`): `productive` for UI moving as it does in the app, `expressive` for a reveal that
  should be felt. Each has `standard` (moving within the frame), `entrance` and `exit`. Keep a video to one system.
  `cubic` is the library pieces' own, `dissolve` is for opacity, and `linear` is for a scroll or a timer.
- **Durations** (`motionDurations`): seconds by action and distance, from a `press` to a camera `push`. When a moment
  doesn't read, lengthen the anticipation before it or the hold after it, not the move. Land moves on words.
- **Raw or eased `k`**: a piece that eases `k` itself (Highlight, Tag, Text, GlassCard) says so in its doc. Give it
  `seg(…, motionCurves.linear)`, or it eases twice.
- **Springs**: `springBy(duration, bounce)` reaches its target at `duration` (a bouncy one then overshoots), so
  `pop(s.t - (w.start - pop.landed))` lands on the word, and `pop.settled` is when its bounce dies away. Springs are
  for moves; fades and colour are `seg`.
- **Staggers**: `stagger(i, n, { each, max, from })` is item `i`'s start offset, on a whole frame. `max` caps the
  spread of a long list, `from` is `'center'`, `'edges'` or an index, and `{ lagRatio, duration }` sets the gap as a
  fraction of each item's move. `staggerFinish` is when the last one lands. Tag each item with
  `stagger: { group, index, count }` so the tracks see the group.

## Kit recipes: words, numbers, strokes

Shortcuts for moments explainers keep needing, all in `lib/studio/kit.tsx` and all raw: each eases itself. Anything
they don't cover is built directly; a scene is any React that's a pure function of `s.t`.

- **Words coming in**: `<WordReveal t={s.t - at} text x y width />` staggers words 60 ms apart (`timing.each`,
  40–80 ms reads as one gesture), each rising 12 px (`rise`) as it fades in. The box is laid out whole from its
  first frame, so the line never shifts. `letters` is for one short display word only. To have it finished as a
  word is spoken, start it at `w.start - wordRevealFinish(text)`, passing it the same `letters` and `timing`.
- **A number rolling**: `<Odometer t={s.t} value={(t) => lerp(0, 1299, motionCurves.cubic.entrance(seg(t, a, a + 1.2,
  motionCurves.linear)))} mode="direct" prefix="$" x y />` turns digit wheels to whatever `value` reads at `t` and
  lands pin-sharp; `y` is the baseline. `direct` is the calm walkthrough roll (1.2–2.5 s); the default `mechanical`
  blurs the ones past, for a price that snaps. Name it (`motion="total"`) and `expect` it to hold once it lands, since
  a number the voice names must be read.
- **A stroke drawing on**: `<DrawPath d k={seg(…, motionCurves.linear)} />` draws a path from its start with
  `@remotion/paths`: an underline, an arrow, a check. `viewBox` plus `box` draws an icon's path into a rect. Draw-on only;
  morph paths directly.

## Anchor to speech, and lead the word

- Anchor every beat to the voice: `s.line('ladder').word('no volume discount').start`, never raw seconds. Re-voicing
  re-times everything, and the words come from whisper, so they land within a couple of frames. Camera and cursor
  keys must rise in time: word-anchored keys can swap after a re-voice, and the scene throws rather than snapping.
- **The picture leads the word.** A ring must be fully drawn as its word starts, or its `expect` fails:
  `k={seg(s.t, w.start - 0.7, w.start - 0.1, motionCurves.linear)}`. A camera move lands as the word starts, not after.
- Say it and show it: give the highlight a `name` and the scene an
  `expect: (s) => [{ see: 'tiers', during: s.line('ladder').word('no volume discount') }]`. The check fails if the
  named highlight isn't drawn, clear of tags and the caption, for the whole span.
- Hold what must be read: when the voice names something the viewer has to read (a price, a total, a changed
  setting), give its element a `motion` name and the scene an `expect` like
  `{ hold: 'price', for: 1, during: { start: s.line('price').word('twelve').start, end: s.line('next').start } }`.
  The check fails unless it stays put (within 2 px, or `within`) and visible for `for` seconds inside `during`. The
  failure names what moved, when and by how much, with the `studio look --graph` to see it. Steady and visible isn't
  readable: judge size and contrast by eye.

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
- The default, `openai/gpt-image-2.5-sunburst`, does titles, product shots, icons and legible small text, and takes
  `--aspect` and `--transparent` (for a cutout laid over a scene). Reach past it only for the job:
  `recraft/recraft-v4.1-vector` when an icon must be an SVG (its colours drift, so check the hex);
  `x-ai/grok-imagine-image-2.0` for the closest likeness to a product `--ref`, but it's slow (up to ~90 s). Not
  `google/gemini-3.1-flash-image`: fastest, but it redraws products and garbles text. If the default is gone from
  OpenRouter, `openai/gpt-image-2` is its fallback (no transparent background).
- It lands in `generated/images.ts`: `import { images } from './generated/images.ts'`, then `images[name].src`.
  Pass `--aspect 16:9` for a full-frame still; it still won't be exactly 1920×1080, so fill the frame with
  `objectFit: 'cover'`.
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

Look at the rendered frames yourself before reporting back. Motion is judged by eye; the numbers only explain it.

- `studio check <p>` measures every frame (`--scene=<id>` or `--at=a:b` for one stretch): the framing check
  (highlights and clicks under tags or the caption, off the frame, cut off by their panel; every `expect`) and the
  motion tracks. It writes `out/check/timeline.json` (when every scene, line and word lands, and where scenes
  crossfade) and `out/check/motion.json` (a scoped check writes `motion-<scene>.json` beside it).
- `studio look <p> --strip=a:b` shows a stretch of motion; `--sheet=t1,t2,…` shows chosen moments; `--graph=a:b`
  plots it (below).
- `studio storyboard <p>` rebuilds the storyboard page from the video.

To judge timing, read a `--strip` like a viewer: at each tile, where are they looking, and do they understand it
yet? Time each read from the tiles' timestamps (a default strip's tiles are 0.1 s apart, three video frames each). A
read that flashes by in a tile or two, or shares its tiles with another read, will be missed.

Then use the tracks to say why, with numbers: when the ring finishes drawing against its word, whether the camera
lands before the line starts, which of two things moves first. `motion.json` has each tagged element's centre, size,
opacity and reported values (a ring's `draw`, a camera's `zoom`) on every frame. It has both the screen box and the
box in the element's owner's frame, so for a ring riding a push-in the screen box moves with the camera while the
page box holds still.

A graph shows the shape of a move that a strip only hints at, and prints the numbers it's drawn from:

- **Easing**: an eased move's velocity is a bell; a linear one is a flat plateau that starts and stops dead. Trail dots
  bunch up where something is slow.
- **Overshoot and wind-up**: signed velocity crosses zero. A speed curve would hide this.
- **What leads**: which element moves first, and where each move starts and lands against the voice's words.
- **Snaps and jitter**: a jump in a single frame, or a "hold" whose velocity keeps flipping.

A graph can't tell you whether a move reads. Check that on the strip, and check the feel in playback.

- Library pieces tag themselves, under names they pick (`camera`, `cursor`, a Highlight's `name`, a Tag's words).
  Each takes `motion` to give it a name of yours, or `false` for no track. Tag hand-written motion with
  `data-motion="name"`, or `useMotionTag(ref, 'name', selector)` for an element a host component renders. A tagged
  element inside another belongs to it, and is measured in that owner's frame.
- A Highlight on a rect straight from `screenRect` records its camera. Otherwise pass `through`: its view, or
  `'screen'` for a rect in screen coordinates.
- The check fails on tracking errors (two elements under one name of yours), and names what it can't see: a take's
  contents, a generated clip, a painted canvas, or pieces the library couldn't tell apart until you name them.

## Tells of generated motion

Review guidance for walkthroughs and product explainers, not rules: a teaser or showreel may do any of these on
purpose, and no check looks for them. When a strip looks machine-made, these are the usual reasons:

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
