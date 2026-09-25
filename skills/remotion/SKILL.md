---
name: remotion
description: Remotion API references and the studio's conventions for using Remotion directly, in a scene or a new studio primitive (audio, images, fonts, measuring text and DOM, hand-drawn text highlights). Use when lib/studio doesn't already have what a scene needs. For animating scenes, use video-motion; for planning a video, video-kickoff.
---

# Remotion, as this studio uses it

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

`lib/studio/Video.tsx` is the one composition, and the timeline places every scene in it. A scene or a new
`lib/studio` primitive can use any Remotion API inside that, keeping these conventions:

- **Seconds, not frames.** A scene's clock `s.t` is seconds; animate with `seg`, `on`, `off` and the curve tokens in
  `lib/studio/motion.ts`, not `interpolate(frame, …)`. Everything stays a pure function of `s.t`, which can be
  negative or past `s.dur` during crossfades.
- **Imports, not `staticFile()`.** Assets live in the project folder and are imported, so each project bundles on its
  own and a missing file fails to compile.
- **No `TransitionSeries`.** `scenesAt` in `lib/studio/timeline.ts` centres crossfades on the voiced cuts; a
  `TransitionSeries` would shorten the timeline instead.
- **Audio goes through the mix.** Voice lines are levelled and the music bed ducked in `lib/studio/mix.ts`; a new
  sound's volume is set relative to `VOICE_LUFS`, and `studio mix` and `studio render` master the result. Remotion's
  volume is 0–1. Effects are levelled by category when `studio sfx` renders them (`lib/sfx/`).
  Choosing and placing a video's music and effects is the `video-sound` skill.
- **Measure for the checks.** A primitive that marks a subject, a tag or text carries `data-framing` (see
  `lib/studio/probe.tsx`), so the framing check sees it.

## References

Vendored from [remotion-dev/skills](https://github.com/remotion-dev/skills) at commit `9682e99` (Remotion 4.0.527;
this repo pins 4.0.525). Where one contradicts the rules above, the rules above win.

| File | For |
|---|---|
| `references/audio.md` | `<Audio>`: trimming, volume callbacks, looping, speed |
| `references/images.md` | `<Img>` and why it, not `<img>`, waits for the image to load |
| `references/local-fonts.md` | `@remotion/fonts`: loading a font file so every machine renders the same text. The studio has no `public/`, so import the font file for its URL instead of `staticFile` |
| `references/measuring-text.md` | Fitting text to a box before it renders |
| `references/measuring-dom-nodes.md` | Measuring an element's size inside a composition |
| `references/text-highlights.md` | `@remotion/rough-notation`: hand-drawn circles, underlines and boxes. Drive `progress` from the scene clock |

Anything else: the Remotion docs (context7 `/remotion-dev/remotion`), or the upstream repo in
`.agent_cache/resources/remotion-dev/skills`.
