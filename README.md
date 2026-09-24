# video-studio

Walkthrough and explainer videos, made in code: capture a site's states, voice a script, animate the captures in
[Remotion](https://www.remotion.dev), render to MP4.

Every frame is a pure function of time, so a change to one scene is an edit and a re-render. Nothing gets reshot by hand.

## The pipeline

| Step | Command | Output |
|---|---|---|
| Start | `npm run new -- <slug> --url=… [--title=…]` | `projects/<yyyy-mm>-<slug>/`, captured and with estimated timing, so it opens in the Studio at once |
| Capture | `node projects/<p>/capture.ts [--only=a,b]` | `captures/` plus `captures/index.ts`: the named shots. A still is a high-DPI full-page screenshot with the page positions of the elements scenes point at; a take is a screen recording of real clicks, scrolls and typing, with marks. `--only` redoes just those shots |
| Voice | `npm run tts -- projects/<p>` | `audio/take.wav`, the whole script read in one take, cut into `audio/<line>.wav` plus `audio/manifest.ts`. Any script change re-reads the take. `--take=read.m4a` uses a recording instead, `--draft` a free macOS `say` read, and `--estimate` (with no take) times lines from their word count |
| Music | `node scripts/music.ts projects/<p> <file> [--name=bed]` | `music/<name>.*` plus `music/index.ts`: the track with its loudness, tempo and beats. Use it with `defineVideo({ music: { track: music.bed } })` |
| Storyboard | `node scripts/storyboard.ts projects/<p>` | `out/storyboard/index.html`: a preview on top, a card per scene with its note, a still and the audio for each line; click to play from a scene |
| Watch | `npm run studio -- projects/<p>` | the Remotion Studio: scrub, see scenes and voice lines on the timeline, toggle `captions` in the props panel |
| Look | `node scripts/render.ts projects/<p> --sheet=1,5,9` | a contact sheet of chosen times; `--strip=4:5` for a stretch of motion. Open the image to check frames without rendering video |
| Check | `node scripts/render.ts projects/<p> --check` | the framing check, plus `out/check/timeline.json` (when each scene and line lands) |
| Mix | `node scripts/render.ts projects/<p> --audio` | `out/mix.wav`, the mastered mix on its own, to audition |
| Make | `npm run video -- projects/<p>` | `out/mix.wav`, `out/video.mp4` (captions burned in; `--plain` adds `out/video-plain.mp4`), `out/video.srt`, review sheets in `out/check/`, and `out/watch.html` |

`npm run video` runs the framing check on every frame first and refuses to render if a highlight sits under a tag or
the caption, runs off the frame or is cut off by its panel, if a scene's `expect` isn't met, or if any line is still
estimated. It then masters the mix to −14 LUFS, renders the video muted and muxes the mix in. Each MP4 must have
the right length and an audio stream, measure −14 ±1 LUFS and peak at −1 dBTP or lower. Each is tiled into a sheet
to look over.

`npm run typecheck` checks everything, including that every rect a scene points at was captured. `npm test` runs the
tests.

## A project

```
projects/<yyyy-mm-name>/
  capture.ts       the named shots: stills and takes, each with its own setup (lib/capture.ts)
  voiceover.json   { voice, lines: [{ id, text }] }
  video.tsx        defineVideo({ title, voice, scenes }): each scene names its lines and renders itself
  storyboard.md    the plan: audience, takeaway, the scene table, what was checked, what's deliberately left out
  captures/, audio/, music/, out/   generated, gitignored
```

Scene lengths come from the voiced lines, so rewording a line re-times the video on its own. Anchor beats to speech
with `s.line(id).word('seventeen')` (from whisper word timings) or `s.line(id).at(f)`, never hard-coded seconds. A
scene's `expect` says what must be on screen while a word is spoken:
`expect: (s) => [{ see: 'matches', during: s.line('combo-a').word('seventeen') }]`, where `matches` is a
`Highlight`'s `name`.

The skills in `.claude/skills` carry the workflow: `video-kickoff` (from the first dump to a signed-off storyboard),
`video-motion` (the camera vocabulary and feel notes), `video-canvas` (painted and generative layers) and `remotion`. `docs/directing.md` is a short course on
directing.

## Pieces

Scenes import everything from `lib/studio/api.ts`.

- `lib/capture.ts`: named shots, each on a fresh page so any can be redone alone. Stills are screenshots with element
  rects in page coordinates; takes are CDP screencasts with marks (rects and times) and a mouse and key log, filmed at
  the site's own pace.
- `lib/studio/take.ts`: takes in a scene. `fitTake` pins marks to words, `takeShot` is the frame showing then (a Shot,
  so cameras work on it), `onTake` moves a mark's rect by the frame's scroll. `TakeCursor` draws our cursor and click
  sounds from the log, so a re-voice never needs a reshoot.
- `lib/studio/timeline.ts`: `defineScene`, `defineVideo`, and the layout that times scenes to their lines and centres
  crossfades on the cuts.
- `lib/studio/camera.ts`: a camera over captures (`camFit`, `camAt`, `lerpCam`) and views, which map page rects to the
  frame.
- `lib/studio/capture.tsx`, `overlays.tsx`: captures (with blur, motion blur and state changes), cursor paths with
  clicks, highlights, spotlights, tags, text, frosted glass and washes. Scene text stays above `CAPTION_SAFE_TOP`.
- `lib/studio/kit.tsx`: whole shots built from those, taking their brand colours and words as arguments: `MotionTitle`,
  `ClickToBlur`, `SplitCompare`, `Phone`, `GlassCard`, `SectionCard`, `EndCard`, and redraws of what a screenshot
  can't hold (`ConfirmDialog`, `NativeMenu`). When a shot recurs in a second video, move it here.
- `lib/studio/probe.tsx`: measures highlights, clicks, tags and the caption on each frame. `lib/framing-check.ts`
  decides what's a problem.
- `lib/studio/mix.ts`: voice levelling, and a music bed that ducks under the voice. `lib/loudness.ts` measures.
- `lib/studio/sfx.tsx`: `<Sfx>` plays a sound at a scene time; `CursorPath` clicks sound by themselves. The sounds are
  synthesized by `node scripts/sfx.ts`, so there's nothing to license.
- `lib/whisper-words.ts`, `lib/voice-words.ts`: word timings from whisper.cpp (installed on first use into
  `~/.cache/video-studio`), aligned to the script.
- `lib/voice-take.ts`: where to cut a take into lines, and the pauses the read left between them.
- `lib/music-beats.ts`: the tempo and beats of a music track.
- `lib/paint/`: drawn layers (p5 sketches) inside scenes, with a watercolour style ported from p5.brush. See the
  `video-canvas` skill. `--repeatable=t1,t2` proves a drawn layer is a pure function of time.
- `scripts/render.ts`: bundles one project (`lib/render-session.ts`) and checks, mixes, renders and reviews it.
- `scripts/tts.ts`: reads the script as one take (Gemini TTS through OpenRouter, `say`, or a recording) and cuts it.
  `--audition "line" --voices=A,B,C` compares voices.
- `scripts/openrouter.ts`: the shared OpenRouter client, for TTS and any other model calls.

The scripts are TypeScript run directly by Node 24; Remotion bundles `lib/studio` and one project's `video.tsx`.
Remotion is free for companies of up to three people; past that it needs a company license.

## Secrets

`.env.op` holds 1Password references, not keys. The npm scripts run through `op run`, so `OPENROUTER_API_KEY` exists
only inside that one process. Needs the 1Password app's CLI integration (Settings → Developer).
