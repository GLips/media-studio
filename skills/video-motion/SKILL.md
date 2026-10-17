---
name: video-motion
description: Motion for a video's scenes in the studio's React code, from blocking on the timeline to a checked render. Use when animating an approved storyboard or animatic (a voiced walkthrough or explainer, a music-cut ad, teaser or reel), or for motion notes ("slow the zooms", "the highlight comes too late").
---

# Motion

The studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read and Edit.

## What a scene can be

Any React whose output depends only on its time, fixed inputs and seed: DOM, SVG, canvas, three.js, video, your own
components. Frames render independently, out of order and in several tabs at once, so each frame is a **pure function
of time**: nothing carries over from the frame before (no counters, no `Math.random()`, no stepped physics; write
physics closed-form in time), randomness comes from `seededRandom` / `hashRandom`, and anything that loads (an image,
a font, a texture) finishes before the frame is captured. The rule holds for every scene, piece and bar.

`#studio` exports the conveniences: cameras over captures, curves and springs, the kit and reel pieces, the checks'
tags; storyboard.ts imports `defineStoryboard`. `studio api` lists both; `studio api <name>` prints one's import,
signature and doc. Use them where they fit and import anything else a scene needs. Existing projects each show one
way to tell one story, not a structure to copy.

## The references

Read the ones your branch reaches before building:

- **Timing**, for every timed project: the storyboard, drivers, cues, beats, the final-hit landmark, the frame:
  `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/timing.md`.
- **Curves**, springs, staggers and fast moves: `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/curves.md`.
- **A real product's UI to a voice** (walkthrough, explainer, PR video): captures, the camera vocabulary, anchoring
  to words, takes, host components, feel notes: `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/walkthrough.md`.
- **Cut to music at high energy** (ad, teaser, social cut, promo, showreel): The high-energy register, below.
- **Measuring motion** (tags, `expect` holds, graphs, scene models):
  `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/tracks.md`.
- **Remotion directly** (audio, images, fonts, measuring the DOM), where `#studio` has nothing:
  `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/remotion.md`.
- **Directing vocabulary** (shot sizes, cuts, pacing, the words of a note), for reading a note or giving one:
  `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/directing.md`.

Registers mix: a walkthrough can open on a few bars cut to music and close on a slammed end card, calm in between.
Keep each stretch in one register, and change register on a cut.

## The work

1. **Block every scene.** A blocked scene is `(clock) => blockingScene(clock, { pieces, view })`, its note the
   row's `onScreen`: flat pieces (`box`, `type`, `image`), each named and tinted, resting at a `pose` in frame pixels
   and moved by `keys` on its clock's frames (`{ at: clock.cues.land, to: { y: 380 }, over: 9 }`), a `view` pushing or
   panning over them. Block what the scene really shows, its own pieces moving as they will. Every scene `studio new`
   writes starts blocked, and a blockout is also the motion reference a video model takes (`video-gen`). Done when the animatic
   (`studio render <p> --animatic`) is approved in review. Pacing is signed off before polish: a scene polished
   first gets re-timed when the notes say it's too fast.
2. **List each scene's reads** (Time it by reads, below), in order, each with a start and an end on the scene's cues.
   Done when every read fits with time to find it, get it and breathe; where they don't, lengthen the scene in
   `storyboard.ts` (its `timing`, or its seconds or beats) or cut a read.
3. **Build it.** Replace the scene's blocking binding with `sceneForTimelineClock(clock, { render, expect,
   rung: 'final' })`, over the same cues and rhythm; the review page shows each scene's rung. Done when
   `studio check <p>` passes: framing, every `expect`, no tracking errors.
4. **Look at it yourself** before reporting back: motion is judged by eye, and the numbers only explain it.
   `studio look --help` is organised by question (these frames, a bar, a strip, before against after, does it keep
   moving, where does a piece go); `studio check` prints when each scene, line and word lands, and `studio clock <p>`
   the storyboard's frames. Read a `--strip` as a viewer: at each tile, where are they looking, and do they understand
   it yet? A read that flashes by in a tile or two, or shares its tiles with another read, will be missed. Done when
   every read holds on the strip and each hit frame is worth pausing on.
5. **Hand it over** through the `studio-review` skill. A fix inside one scene goes back as a slice,
   `studio render <p> --scene <id>`, which the review page lays into the cut.

A subagent you hand a render-look-adjust loop (tuning a bar or a move by eye) runs on Sonnet: the loop is many short
turns, and faster turns buy more iterations. Design and review stay on the default model.

## Time it by reads

You know what happens because you wrote the code. The viewer sees it once, at full speed, for the first time.

- A **read** is one thing the viewer must understand ("typing narrows the list", "to seventeen"). Each needs time for
  the eye to find it, to understand it, and a moment before the next.
- **One read at a time.** Cause, then reaction: the click, then what changed, never both in the same half-second.
- **Lead the eye** to where the next read happens before it happens.
- **Hold what must be read**, and have the check hold you to it with an `expect` (the tracks reference).

## Choreography

- **One dominant read**, with supporting motion allowed (the camera settling, a card's contents following it); never
  two moves that both ask to be read.
- **The container moves first**, and its contents follow, overlapping it by 30–50%: a card rises, and its lines start
  when it's half to two-thirds of the way up.
- **Secondary action waits** until 100 ms or more after the main move lands: a ring, a badge, a count.

## The high-energy register

A launch ad, teaser, social cut, promo or showreel is cut to music: one idea per bar, an event on every beat,
full-bleed colour, display type as the image, hard cuts on the hit. `#studio`'s reel pieces are built for it (a
bounce, kinetic type, ticker bands, a glyph field, a 3D column field, a capture on a tilted plane, a recap grid, a
HUD, a lens fringe), with the kit's `Odometer`; a bar they don't cover is built directly, or as a new piece.

- `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-system.md`: the reference reel's system, the bar to clear.
  An ad or teaser takes its clock, cut grammar, easing and type; the HUD and palette are that showreel's identity,
  and the brand's colours replace them.
- `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-assembly.md`: building and proving one bar.
- `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-pieces.md`: adding a reusable piece.
- `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-critique.md`: the reel's rules, and the fresh-eyes
  critique a cut gets before it's done.
- `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-study-method.md`: breaking down a new reference video.

## Kit, stills and templates

- **Words coming in, a number rolling, a stroke drawing on**: `WordReveal` (`wordRevealFinish` to finish it on a
  word), `Odometer` and `DrawPath`. `studio api <name>` gives each one's props, defaults and modes.
- **A still nothing drawn or captured gives** (title-card art, a background, a physical product's shot, a concept
  icon) is generated, and paid: `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/generated-stills.md`. A
  product's UI is captured or built in DOM, never generated (video-kickoff, Real UI only).
- **Every video becomes a template.** When a shot works and could come back (an end card, a title, a product UI
  rebuilt in DOM), lift it into the kit with its brand colours and words as props, so the next video changes the skin.

Neighbours: a painted or generative layer is `video-canvas`; real-world footage (a product in use, a place, people)
is `video-gen`; music, effects and the mix are `video-sound`, once the picture is locked.
