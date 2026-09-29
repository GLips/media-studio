---
name: video-motion
description: Motion for any video's scenes in the studio's React code, and checking the render. Use when animating an approved storyboard or brief, or for motion feedback ("slow the zooms", "the highlight comes too late").
---

# Motion

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

## What a scene can be

A scene may render any React whose output depends only on its time, fixed inputs and seed: DOM, SVG, canvas, three.js,
video, your own components. Remotion renders frames independently, out of order and several tabs at once, so
nothing may carry over from the frame before (no counters, no `Math.random()`, no stepped physics), and anything that
loads (an image, a font, a model, a texture) must finish before the frame is captured (`<Img>`, `delayRender`).
Randomness comes from `seededRandom` / `hashRandom` (`lib/picture/motion/models/random.ts`).

`lib/api.ts` exports the studio's conveniences: the timeline, curves and springs, cameras over captures, the
kit and reel pieces, the checks' tags. Use them where they fit, and import anything else a scene needs. `studio api
<name>` prints any function's signature and doc. The existing projects each show one way to tell one story, not a
structure to copy.

Pick up the register's own reference before building:

- **A real product's UI to a voice** (a walkthrough, an explainer, a PR video): captures, the camera vocabulary,
  anchoring to words, takes and host components are in [references/walkthrough.md](references/walkthrough.md).
- **Cut to music at high energy** (an ad, a teaser, a social cut, a promo, a showreel): the high-energy register below.
- **Anything else** starts from this file and builds what it needs.

## Timing

A project states its schedule once, in `timeline.ts`: `defineTimeline` (`lib/timing/timeline/models/timeline.ts`) lists the
scenes in order, each with one driver that sets its length:

- `voiceSpan(['fix-a', 'fix-b'], { lead, gap, tail, min })`: as long as its recorded lines, whose words are its cues
  (`onlyOnSale: { line: 'fix-a', phrase: 'showing only' }`, `nth` for a later one).
- `beatSpan(beats, { cues, moves, cutIn })`: beats on a grid, from a fitted track (`recordedGrid`) or a bare tempo
  (`tempoGrid(bpm)`) for a piece cut to a beat nobody hears.
- `fixedSpan(seconds)`: authored time, for a piece cut to neither.

A fixed scene never sits inside the music. Each scene counts its own time from 0 and names the moments others need as
cues (`ink.strike2`); another scene's moment is a cue, never an import or an absolute time. `video.tsx` binds each
scene with `bindTimeline`, handing it its resolved clock in frames from the scene's beat 0 (`clock.beat(n)`, `clock.cues`, `clock.moves`); a voice
scene turns its clock into a scene with `sceneForTimelineClock`, and `sceneCueSeconds(clock)` reads its cues in
`s.t`'s seconds. A finale's replays are declared in the timeline and handed in. A move that must keep its length is a start plus a duration anchored at one end (`{ from:
{ at: 'end', frames: -3.75 }, to: { at: 'end', frames: -1 } }`), never pinned between two scenes' moments: the
project's `timeline.test.ts` runs the retime runner, which lengthens every scene and fails a move that stretches.
`studio clock <project>` prints the resolved frames on the video, each scene at its origin. `studio new <slug> --capability voice-led`
(or `music-led`, `mixed`) writes a timeline of each kind that already passes the retime test; start from it.

**The frame.** `defineVideo({ format })` picks the frame rate and size, 30 fps at 1920×1080 by default: `{ width: 1080,
height: 1920 }` for a vertical cut. A timed video's rate is its timeline's, `defineTimeline({ fps })`. A scene reads
the frame with `useVideoFormat()` and hands it to what needs it (`camFit(shot, rect, frame)`, `view(shot, cam,
frame)`); a project laying out outside a scene declares its format once and reads that constant. `{ transparent: true }`
paints nothing behind the scenes (blocking included), so a scene draws only what sits on the page; `useVideoFormat()`
says so, for a piece that would otherwise paint a backdrop.

## Time it by reads

You know what happens because you wrote the code. The viewer sees it once, at full speed, for the first time.

- Before animating a scene, list its **reads**, in order: each thing the viewer must understand ("typing narrows the
  list", "to seventeen"), with a start and an end. Each needs time for the eye to find it, to understand it, and a
  moment before the next.
- **One read at a time.** Cause, then reaction: the click, then what changed. Never both in the same half-second.
- **Lead the eye** to where the next read happens before it happens.
- If the reads don't fit, lengthen the scene or cut a read. Don't squeeze them.
- **Hold what must be read**: give its element a `motion` name and the scene an `expect` like
  `{ hold: 'price', for: 1, during: { start, end } }`. The check fails unless it stays put (within 2 px, or `within`)
  and visible for `for` seconds inside `during`, and names what moved, when and by how much. Steady and visible isn't
  readable: judge size and contrast by eye.

## Choreography

- **One dominant read**, with supporting motion allowed: the camera settling, a card's contents following it. Never
  two moves that both ask to be read.
- **The container moves first**, and its contents follow, overlapping it by 30–50%: a card rises, and its lines start
  when it's half to two-thirds of the way up.
- **Secondary action waits** until 100 ms or more after the main move lands: a ring, a badge, a count.

## Curves, springs and staggers

- **Curves** (`motionCurves`): `productive` for UI moving as it does in the app, `expressive` for a reveal that
  should be felt, `expo` for a reel's snap. Each has `standard` (moving within the frame), `entrance` and `exit`. Keep a
  video to one system. `cubic` is the library pieces' own, `dissolve` is for opacity, and `linear` is for a scroll or a
  timer. `motionDurations` gives calm UI seconds by action and distance; a register of its own sets its own.
- **Raw or eased `k`**: a piece that eases `k` itself (Highlight, Tag, Text, GlassCard) says so in its doc. Give it
  `seg(…, motionCurves.linear)`, or it eases twice.
- **Springs**: `perceptualSpring(duration, bounce)`. `duration` is its pace, the same feel at every bounce (0.2–0.4 s
  for a reel's lift, 0.5 s for UI), and `bounce` only sets the overshoot (0.15 felt, 0.3 seen). **On a beat or word,
  the beat goes on its `arrival`, and so does the move's hit sound**: start it `arrival` early,
  `pop(t - (beat - pop.arrival))`. `arrival` is when it has covered 98% of the way, so a bouncy spring reaches home
  on the beat and overshoots after it. `settled` is when it stops moving. Springs are for moves; fades and colour are
  `seg`.
- **Staggers**: `stagger(i, n, { each, max, from, fps })` is item `i`'s start offset, on a whole frame of `fps`. `max` caps the
  spread of a long list, `from` is `'center'`, `'edges'` or an index, and `{ lagRatio, duration }` sets the gap as a
  fraction of each item's move. `staggerFinish` is when the last one lands. Tag each item with
  `stagger: { group, index, count }` so the tracks see the group.

## The high-energy register: ads, teasers, promos

A launch ad, teaser, social cut or product promo is usually cut to music: one idea per bar, an event on every beat,
full-bleed colour, display type as the image, hard cuts on the hit. `lib/picture/reel/studio/` has pieces built for it (a
bounce, kinetic type, ticker bands, a glyph field, a 3D field, a capture on a tilted card, a recap grid, a HUD), and
kit.tsx's `Odometer`; a bar the pieces don't cover is built directly, or as a new piece.
`references/reel-assembly.md` builds it bar by bar on a beat grid, `references/reel-pieces.md` adds a piece,
`references/showreel-breakdown.md` is the reel it's measured against, and `references/reel-critique.md` is the
fresh-eyes critique a cut gets before it's done.

**Pacing is signed off before polish.** The first cut is an animatic: each bar blocked (`blockingScene`, below) on its
cues, on the fitted music, rendered with `studio render <p> --animatic` and sent as the `studio review <p>` page
(`video-kickoff`, step 4). Building a bar replaces that binding with its own `sceneForTimelineClock`, declaring
`rung: 'final'`; studio review shows each scene's rung on its scrubber, its storyboard and its notes. Build and polish
bars only once the user has approved the pacing: a bar polished before then gets re-timed when the notes say it's too
fast.

Registers mix: a walkthrough can open on a few bars of this and close on a slammed end card, calm in between. Keep
each stretch in one register, and change register on a cut.

## Blocking a flat scene

Every scene starts blocked: what moves on which cue, how long each move takes, whether the scene breathes, settled at
the real timing before anything is styled, and the reference a video model takes when one will (`video-gen`). Block
what the scene really shows, its own pieces moving as they will, never a placeholder standing in for it. A blocked
scene is
`(clock) => blockingScene(clock, { note, pieces, view })`: `FlatPiece`s (`box`, `type` set at its box's height,
`image` a crossed slot), each named and tinted, resting at a `pose` in frame pixels and moved by `keys` on the frames
of the scene's own clock, `{ at: clock.cues.land, to: { y: 380 }, over: 9 }`, a `view` pushing or panning over them.
It declares `rung: 'blocking'`, so the animatic and `studio review` show it as blocking; every scene `studio new`
writes starts as one. A few pieces moving on cues, a view pushing in:

```tsx
const layout = (clock: Clock<'layout'>) => blockingScene(clock, {
  note: 'The buy box assembles: the photo and title, then the price.',
  view: { keys: [{ at: clock.moves.settle.from, to: { cx: 1010, zoom: 1.06 }, over: clock.moves.settle.to - clock.moves.settle.from }] },
  pieces: [
    { kind: 'image', name: 'photo', color: '#a9b1bc', pose: { x: 160, y: 180, w: 700, h: 720, opacity: 0 }, keys: [{ at: clock.cues.photo, to: { opacity: 1 } }] },
    { kind: 'type', name: 'title', text: 'Linen shirt', pose: { x: 960, y: 240, w: 700, h: 80, opacity: 0 }, keys: [{ at: clock.cues.title, to: { opacity: 1, y: 220 } }] },
    { kind: 'type', name: 'price', text: '$59.99', color: '#b82b2b', pose: { x: 960, y: 620, w: 500, h: 110, opacity: 0 }, keys: [{ at: clock.cues.price, to: { opacity: 1, y: 580 }, over: 9 }] },
  ],
});
```

A scene timed in seconds draws `<FlatBlockout pieces frame={s.t * fps} />` itself and declares `rung: 'blocking'` in its `sceneForTimelineClock`. Get the moves
approved in review, then build the scene over the same cues and rhythm.

## Kit and generated stills

- **Words coming in, a number rolling, a stroke drawing on**: `WordReveal`, `Odometer` and `DrawPath` in
  `lib/picture/kit/studio/kit.tsx`. Read [references/kit-recipes.md](references/kit-recipes.md) before using one.
- **A still nothing drawn or captured gives** (title-card art, a background, a physical product's shot, a concept
  icon) is generated, paid, with `studio gen image`: read [references/generated-stills.md](references/generated-stills.md)
  first. A product's UI is never generated (the `video-kickoff` skill, Real UI only).

## Checking your work

Look at the rendered frames yourself before reporting back. Motion is judged by eye; the numbers only explain it.

### To know X, run Y

Every question below has one command. A tool or brief points here, never at a script of its own.

| To know | Run |
|---|---|
| When each scene, line and word lands, and where scenes crossfade | `studio check <p>`: its table, and `out/check/timeline.json` |
| A timed project's scene, cue or beat frames | `studio clock <project>` |
| Whether highlights, clicks and every `expect` hold | `studio check <p>` (`--scene=<id>` or `--at=a:b` for one stretch) |
| How each tagged element moved, frame by frame | `studio check <p>`: `out/check/motion.json` (a scoped check's `motion-<scope>.json`) |
| What frames look like | `studio look <p> --frames=a:b` (`a:b:step`, `f1,f2`), `--bar=N`, `--sheet`, `--strip` |
| What a render shows, not the code | `studio look <p> --video <mp4>`: its snapshot places a slice in the video |
| Which frames and pixels a change moved | `studio look <p> --video <after.mp4> --against <before.mp4>` (`--crop=x,y,w,h`) |
| Whether a stretch keeps moving | `studio look <p> --motion --bar=N` (or `--frames=a:b`) |
| Where a piece is on each frame, and its clearance from the HUD, with no render | `studio look <p> --graph=models --bar=N` (or `--frames=a:b`), below |
| Where a tracked element goes on the render, and how it eases | `studio look <p> --graph=a:b` (below) |
| A change in motion, quickly | `studio render <p> --frames=a:b`: a silent slice, the bundle kept between runs |
| The whole cut again from its slices | `studio render <p> --join=<folder>` |
| What a render was made from | `<render>.snapshot.json` beside it, which `studio review` and `look --video` read |
| What the user sees in it | `studio review <p \| render.mp4 \| still.png>` |

`studio check` rewrites `out/check/` every run, so it's for what the code does now. A render's timeline is in its own
snapshot. `studio review` has the user pin notes on a render (or a still) and copy them back as markdown; each names
its moment (bar, rung and beat in timeline.ts's counting, a named cue near it, or line and word), then its scene, the sounds within 3 frames and the
tagged elements under the point, from the render's snapshot. After a retime, a note from the earlier render moves to
its moment's frame on the new one and says where it came from, or says its moment is gone. Reply by the moment, not
the frame. They're saved to `review/notes-<render>.json`, so read that file instead of asking for a paste. Offer it when motion feel
needs the user's eyes: the same page approves every rung, the animatic (`studio render <p> --animatic`) through the cut.

To judge timing, read a `--strip` like a viewer: at each tile, where are they looking, and do they understand it
yet? Time each read from the tiles' timestamps (a default strip's tiles are 0.1 s apart, three video frames each). A
read that flashes by in a tile or two, or shares its tiles with another read, will be missed.

Then use the tracks to say why, with numbers: when the ring finishes drawing against its word, whether the camera
lands before the line starts, which of two things moves first. `motion.json` has each tagged element's centre, size,
opacity and reported values (a ring's `draw`, a camera's `zoom`) on every frame. It has both the screen box and the
box in the element's owner's frame, so for a ring riding a push-in the screen box moves with the camera while the
page box holds still.

Before rendering a change to a piece drawn from a model (a ball's bounce, a needle's strikes, a camera path), read
the model. A scene's `bars/<id>-model.ts` holds the numbers its scene draws from, and exports a `definePieceTracks`
naming each piece's place on a frame, the box it covers and what it keeps clear of. `--graph=models` prints a table per
piece (position, values, state, clearance in px from the nearest HUD part, negative where it overlaps) and graphs it,
in about two seconds. Give a new piece a track when you'd otherwise render to find where it is.

A graph shows the shape of a move that a strip only hints at, and prints the numbers it's drawn from:

- **Easing**: an eased move's velocity is a bell; a linear one is a flat plateau that starts and stops dead. Trail dots
  bunch up where something is slow.
- **Overshoot and wind-up**: signed velocity crosses zero. A speed curve would hide this.
- **What leads**: which element moves first, and where each move starts and lands against its word or beat.
- **Snaps and jitter**: a jump in a single frame, or a "hold" whose velocity keeps flipping.

A graph can't tell you whether a move reads. Check that on the strip, and check the feel in playback.

- Library pieces tag themselves, under names they pick (`camera`, `cursor`, a Highlight's `name`, a Tag's words).
  Each takes `motion` to give it a name of yours, or `false` for no track. Tag hand-written motion with
  `data-motion="name"`, or `useMotionTag(ref, 'name', selector)` for an element a host component renders. A tagged
  element inside another belongs to it, and is measured in that owner's frame.
- A Highlight on a rect straight from `screenRect` records its camera. Otherwise pass `through`: its view, or
  `'screen'` for a rect in screen coordinates.
- The check fails on tracking errors (two elements under one name of yours), and names what it can't see: a take's
  contents, a generated clip, a canvas or three.js scene, or pieces the library couldn't tell apart until you name
  them. Tag a canvas you draw with `unmeasuredAttrs('<what>')`, and judge what's inside it by eye.

## Every video becomes a template

When a shot works and could come back (an end card, a title, a product UI rebuilt in DOM), move it into
`lib/picture/kit/studio/kit.tsx` with its brand colours and words as props. The next video starts from it and changes the skin.
For something Remotion-specific (fonts, measuring text), see the `remotion` skill. A painted or generative layer is the
`video-canvas` skill. A shot of the real world (a product in use, a place, people) can be generated footage, blocked
in 3D (or flat, for a 2D shot) and rendered once: the `video-gen` skill. Music, sound effects and the mix are their own pass once the picture
is locked: the `video-sound` skill.
