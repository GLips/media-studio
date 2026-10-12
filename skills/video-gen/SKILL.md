---
name: video-gen
description: Generated footage for a scene, made the film previs way: block the shot in 3D (or flat, for a 2D shot), get the blockout approved, then pay for one render with `studio gen video`. Use when a scene needs footage no capture or kit shot can give (a product in use, a place, people), or for notes on generated footage.
---

# Previs

The studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read and Edit.

Generated footage is made the way film **previs** is: block the shot, get it approved, then pay for one render. The
blockout is the draft. Every decision (subjects, where they stand, the camera move, how long it runs) is made and
approved there, where changes are free; the render only dresses it. The models aren't drafts of each other: a render
on one doesn't predict what another makes of the same blockout.

`studio gen video` needs `OPENROUTER_API_KEY` and an upload bucket (`STUDIO_UPLOAD_S3_*`) for the blockout; studio-setup
sets both up. Models, lengths and prices: `studio gen video --help`.

## 1. Block it

A previs scene is an ordinary scene with `previs: { blockout, prompt }`, timed to its cues like any other; the
blockout is the only way to tell the model when things move. For a camera moving through a place, its `render` draws
`<Blockout lookAt subjects />` (`blockout: '3d'`), whose parallax the model copies:

```tsx
// A café counter. Each subject has its own tint, and the prompt names it by that tint.
const COUNTER: BlockoutSubject[] = [
  { shape: 'box', at: [0, 0, 0], size: [2.4, 0.9, 0.7], color: '#9a8f86' },
  { shape: 'box', at: [-0.35, 0.9, -0.05], size: [0.45, 0.5, 0.4], color: '#c9956b' },
  { shape: 'cylinder', at: [0.25, 0.9, 0.12], size: [0.09, 0.1, 0.09], color: '#e8e4dc' },
];

// timeline.ts: `orbit: fixedSpan(5)`
const orbit = (clock: TimelineSceneClock<typeof timeline, 'orbit'>) => sceneForTimelineClock(clock, {
  note: 'An 80° orbit around the counter, the machine turning from three-quarter to profile.',
  previs: {
    blockout: '3d',
    prompt: 'A small café in the morning. The long stone-grey block is a pale oak and concrete counter; the orange box '
      + 'is a brushed-steel espresso machine; the small white cylinder is a ceramic cup on a saucer. Warm window light '
      + 'from the left, shallow depth of field, 35mm film look. No people.',
  },
  render: (s) => (
    <Blockout subjects={COUNTER} lookAt={orbitMove({ target: [0, 1, 0], radius: 3.4, height: 1.6, fromDeg: -50, toDeg: 30 })(seg(s.t, 0, s.dur, motionCurves.cubic.standard))} />
  ),
});
```

A flat shot (a layout assembling, type and panels moving) is blocked in 2D with `blockingScene(clock, { note, pieces,
previs: { prompt } })` (video-motion covers flat blocking), and its prompt names each piece by its tint or label. The
rest of this section is the 3D blockout's.

- **Subjects** are grey primitives (`BlockoutSubject`; `figure` for a person, `card` for a phone, screen or sign),
  sized in metres, standing on y = 0. Give each its own muted tint: the prompt names subjects by tint, and a saturated
  block comes back as a saturated object.
- **The camera really moves.** `orbitMove`, `pushInMove` and `dollyMove` give a `lookAt` for 0..1 progress; drive
  them with `seg(s.t, a, b)`. Keep `fov` fixed: real perspective is why the moves don't come back as zooms, and a
  change of `fov` does come back as one.
- **Block the set, not just the subjects.** The model follows the camera path, the easing and each subject's place
  closely, but frames bare subjects on the empty grid tighter than blocked. Walls, a window and a counter (big tinted
  boxes and cards, named in the prompt) hold the framing.
- **Subjects can move**, computed from `s.t` like the look-at.
- **Length.** The footage covers the scene's whole time on screen, rounded up to whole seconds within the model's
  range; a longer scene has to be split.

Done when `studio look` strips show the move landing on its cues and the user has approved the blockout on its
animatic, its notes worked through review (studio-review).

## 2. Write the prompt

`previs.prompt` says what the finished shot is; the blockout already says how the camera moves. Name what each tint
is ("the orange box is a brushed-steel espresso machine"), then the place, the light, the lens and the look.

`studio gen video` heads it with a preamble asking for a new video that references `@Video1`, the blockout. Word
the prompt as a description of a new shot: one that reads as editing `@Video1` ("turn the box into…", "replace",
"restyle") makes the model take it for an edit, which fails, since OpenRouter can't send what an edit needs.

`previs.references` are stills of the real subjects (paths relative to the project), sent in order as `@Image1`,
`@Image2`…; name them in the prompt ("the machine is the one in @Image1"). Set `audio: true` only when the shot's own
sound matters: the voice and music carry a video's sound, and footage with sound can't be retimed.

Done when `studio gen video <p> <scene> --model <any> --dry` prints the full prompt and each tint in it is named.

## 3. Pick a model, render once

`--dry` renders the blockout and prints each model's length and cost for this shot, free. **Ask the user which model
before every paid render**, quoting those numbers, and render only on their explicit yes to the model and its cost;
an earlier answer doesn't carry over to a new shot. Then:

```sh
studio gen video <p> <scene> --model <the user's pick>
```

The shot takes the video's shape, and `gen` refuses a shape no model renders. The request is cached by its model,
blockout, prompt and stills: an unchanged scene costs nothing again, and a changed model, subject, move or prompt pays
again. From then on the scene plays its footage, even after its blockout changes, until `gen video` runs again; the
Studio's `blockouts` prop shows the blockout, and `--dry` says when the footage is stale.

Done when the footage plays in the scene and is up for review (studio-review); when the user should choose between
takes or models, post them as a decision.

## 4. Fix timing in the edit

**Timing never pays for a render.** When a re-voice moves the words, retime the footage with
`previs.retime: (s) => [[sceneTime, blockoutTime], …]`: the moment the blockout showed at `blockoutTime` plays at
`sceneTime`, as `fitTake` does for a take. `studio check` warns past 1.6× or under 0.6×, where motion reads sped up or
drifting. Only a change of content (a new subject, move or look) calls for a new render.

Done when `studio check` passes without a retime warning.
