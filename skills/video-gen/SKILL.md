---
name: video-gen
description: Generated footage for a scene, made the film previs way: block the shot in 3D, get the blockout approved, then pay for one Seedance render with `studio gen video`. Use when a scene needs footage no capture or kit shot can give (a product in use, a place, people), or for notes on generated footage.
---

# Previs

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

Generated footage is made the way film **previs** is: block the shot in 3D, get it approved, then pay for one render.
The blockout is the draft. Every decision (subjects, where they stand, the camera move, how long it runs) is made and
approved there, where changes are free. The render only dresses it. There are no cheap-model video drafts: they look
bad and don't predict what Seedance does.

## 1. Block it

A previs scene is an ordinary scene with `previs` in its `defineScene`, timed to the voice like any other. Its
`render` draws a `<Blockout pose subjects />`. `projects/2026-09-previs-test/video.tsx` has one scene per move.

- **Subjects** are grey primitives (`BlockoutSubject`: box, sphere, cylinder, cone, `figure` for a person, `card` for a
  phone, screen or sign), sized in metres, standing on the ground at y = 0. Give each one its own muted tint. The
  prompt names subjects by tint, and a saturated block comes back as a saturated object.
- **The camera really moves.** `orbitMove`, `pushInMove` and `dollyMove` return a pose for 0..1 progress; drive them
  with `seg(s.t, a, b)`. Move the camera and keep `fov` fixed. A 3D blockout gives the model real perspective and
  parallax to copy, which is why its moves don't come back as zooms. A change of `fov` does come back as a zoom.
- **Block the set, not just the subjects.** Seedance follows the camera path, the easing and where each subject
  stands closely, but around bare subjects on the empty grid it frames them tighter than blocked. Walls, a window and
  a counter (big boxes and cards, tinted and named in the prompt) hold the framing: `kitchen` in the test project
  came back framed as blocked.
- **Subjects can move too.** Compute them from `s.t`, like the pose.
- **Time the move to its scene's cues** (its words or beats), like any scene (the `video-motion` skill). The footage covers the
  scene's whole time on screen, crossfades included, rounded up to whole seconds between 4 and 30. A longer scene
  has to be split.

Done when `studio look` strips show the move landing on its cues, and the user has approved the blockout in
`studio preview`.

## 2. Write the prompt

`previs.prompt` says what the finished shot is, not how the camera moves (the blockout already says that):

- what each tint is ("the orange box is a brushed-steel espresso machine");
- the place, the light, the lens and the look.

`studio gen video` puts a preamble ahead of it that asks for a new video referencing `@Video1`, the blockout. Never
word the prompt as changing the blockout ("turn the box into…", "replace", "restyle"): Seedance reads the task type
from the prompt, and a request that reads as an edit of `@Video1` fails, since OpenRouter can't send what an edit
needs.

`previs.references` are stills of the real subjects (paths relative to the project), sent in order as `@Image1`,
`@Image2`…, so name them in the prompt ("the machine is the one in @Image1").
Leave `audio` off unless the shot's own sound matters: the voice and music carry a video's sound, and footage with
sound can't be retimed.

## 3. Render once

```sh
studio gen video <project> <scene> --dry     # renders the blockout and prints the full prompt, free
"$(studio home)/bin/studio-secrets" studio gen video <project> <scene>
```

A render costs **$0.28 per second** at 720p ($1.39 for a 5 s shot): Seedance bills the blockout's seconds as well as
the footage's. Never render without the user's explicit yes to the cost. The request is cached by its blockout,
prompt and stills: asking again for an unchanged scene costs nothing, and changing a subject, the move or the prompt
pays again.

From then on the scene plays its footage, even after its blockout changes, until `studio gen video` runs again.
Pass `blockouts: true` in the Studio's props panel to see the blockout; `--dry` says when the footage is stale.

## 4. Fix timing in the edit

**Timing never pays for a render.** When a re-voice moves the words, retime the footage with
`previs.retime: (s) => [[sceneTime, blockoutTime], …]`: the moment the blockout showed at `blockoutTime` now plays
at `sceneTime`. It works the way `fitTake` does for a take, and `studio check` warns the same way: past 1.6× or
under 0.6×, motion reads as sped up or drifting. Only a change of content, such as a new subject, move or look, calls for
a new render.
