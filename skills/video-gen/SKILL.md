---
name: video-gen
description: Generated footage for a scene, made the film previs way: block the shot in 3D (or flat, for a 2D shot), get the blockout approved, then pay for one Seedance render with `studio gen video`. Use when a scene needs footage no capture or kit shot can give (a product in use, a place, people), or for notes on generated footage.
---

# Previs

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

Generated footage is made the way film **previs** is: block the shot, get it approved, then pay for one render.
The blockout is the draft. Every decision (subjects, where they stand, the camera move, how long it runs) is made and
approved there, where changes are free. The render only dresses it. There are no cheap-model video drafts: they look
bad and don't predict what Seedance does.

## 1. Block it

Block a shot whenever a video model will take its motion: the blockout is the only way to tell the model when things
move. A previs scene is an ordinary scene with `previs: { blockout, prompt }`, timed to the voice like any other.
Its `render` draws the blockout: `<Blockout pose subjects />` in 3D (`blockout: '3d'`) for a camera moving through
a place, with the parallax the model copies:

```tsx
// A café counter. Each subject has its own tint, and the prompt names it by that tint.
const COUNTER: BlockoutSubject[] = [
  { shape: 'box', at: [0, 0, 0], size: [2.4, 0.9, 0.7], color: '#9a8f86' },
  { shape: 'box', at: [-0.35, 0.9, -0.05], size: [0.45, 0.5, 0.4], color: '#c9956b' },
  { shape: 'cylinder', at: [0.25, 0.9, 0.12], size: [0.09, 0.1, 0.09], color: '#e8e4dc' },
];

const orbit = defineScene({
  id: 'orbit', note: 'An 80° orbit around the counter, the machine turning from three-quarter to profile.',
  min: 5, lead: 0, tail: 0,
  previs: {
    blockout: '3d',
    prompt: 'A small café in the morning. The long stone-grey block is a pale oak and concrete counter; the orange box '
      + 'is a brushed-steel espresso machine; the small white cylinder is a ceramic cup on a saucer. Warm window light '
      + 'from the left, shallow depth of field, 35mm film look. No people.',
  },
  render: (s) => (
    <Blockout subjects={COUNTER} pose={orbitMove({ target: [0, 1, 0], radius: 3.4, height: 1.6, fromDeg: -50, toDeg: 30 })(seg(s.t, 0, s.dur, motionCurves.cubic.standard))} />
  ),
});
```

A flat shot (a layout assembling, type and panels moving) is blocked in 2D: a timed scene's
`blockingScene(clock, { note, pieces, previs: { prompt } })` (`video-motion`, "Blocking a flat scene"), which sets
`blockout: '2d'`. The prompt names each flat piece by its tint or its label. The rest of this section is the 3D
blockout's.

- **Subjects** are grey primitives (`BlockoutSubject`: box, sphere, cylinder, cone, `figure` for a person, `card` for a
  phone, screen or sign), sized in metres, standing on the ground at y = 0. Give each one its own muted tint. The
  prompt names subjects by tint, and a saturated block comes back as a saturated object.
- **The camera really moves.** `orbitMove`, `pushInMove` and `dollyMove` return a pose for 0..1 progress; drive them
  with `seg(s.t, a, b)`. Move the camera and keep `fov` fixed. A 3D blockout gives the model real perspective and
  parallax to copy, which is why its moves don't come back as zooms. A change of `fov` does come back as a zoom.
- **Block the set, not just the subjects.** Seedance follows the camera path, the easing and where each subject
  stands closely, but around bare subjects on the empty grid it frames them tighter than blocked. Walls, a window and
  a counter (big boxes and cards, tinted and named in the prompt) hold the framing: a kitchen blocked with its walls, window
  and counter came back framed as blocked.
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

`studio gen video` puts a preamble ahead of it, worded for a 3D or a 2D blockout, that asks for a new video
referencing `@Video1`, the blockout. Never
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
the footage's. The shot takes the video's shape (16:9, 9:16, 1:1, 4:3, 3:4 or 21:9); a video of any other shape
can't have one. Never render without the user's explicit yes to the cost. The request is cached by its blockout,
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
