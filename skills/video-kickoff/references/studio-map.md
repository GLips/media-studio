# The studio's map

What each `studio` verb makes, what a project holds, and where the studio's pieces live. `studio <verb> --help` has
every flag; this is the overview to read before the first video in a session.

## The pipeline

Every step is a `studio` verb. A `<project>` is a slug (`launch-teaser`), a unique part of a name, or a path.
`studio <verb> --help` has the flags; each prints what it made on stdout and its progress on stderr.

| Step | Command | Output |
|---|---|---|
| Start | `studio new <slug> --capability=<music-led\|voice-led\|mixed\|silent\|still-only> [--url=…]` | `work/projects/<yyyy-mm>-<slug>/` that passes `check:arch`, the typecheck and its tests from its first commit: a `project.ts` declaring the capability, and a `timeline.ts` with its retime test and a scene file per scene, each blocked in flat pieces moving on its cues (lines' timing estimated), or a starter `stills.tsx`; with `--url`, that page captured as `home` |
| Probe | `studio probe <project> <url-or-path> [--at=x,y]` | a numbered viewport screenshot of a page as `capture.ts` sees it (signed in by its `prepare`), and its interactive and landmark elements (or the one under `--at`) with selectors for rects |
| Capture | `studio capture <project>` | `captures/` plus `captures/index.ts`: the named shots. A still is a high-DPI full-page screenshot with the page positions of the elements scenes point at; a take is a screen recording of real clicks, scrolls and typing, with marks. Shots `capture.ts` no longer makes are deleted |
| Voice | `studio voice <project>` | `audio/take.wav`, the whole script read in one take, cut into `audio/<line>.wav` plus `audio/manifest.ts`. Any script change re-reads the take. `--read=draft` is a free macOS `say` read, `--read=estimate` times lines from their word count, `--take=<file>` uses a recording. `studio audition` compares voices on one line |
| Music | `studio music add <project> <file>` | `music/<name>.*` plus `music/index.ts`: the track with its loudness, tempo and beats. Use it with `defineVideo({ music: { track: music.bed } })`. `studio music fit <project>` cuts it to the video's length, ending on its own ending, as `music['bed-fit']` |
| Preview | `studio preview <project>` | the Remotion Studio: scrub, see scenes and voice lines on the timeline, toggle `captions` in the props panel |
| Look | `studio look <project> --sheet=1,5,9` | a contact sheet of chosen times, `--strip=4:5` for a stretch of motion, or `--graph=4:6` to plot that stretch's measured motion (position, velocity, size, opacity, reported values) against the words, with its numbers. Open the image to check frames without rendering video |
| Check | `studio check <project>` | the framing check and the motion tracks on every frame (`--scene` or `--at=a:b` for less), a table of when each scene and line starts and ends, `out/check/timeline.json` (scenes, lines, words, crossfades) and `out/check/motion.json` (how every tagged element moved) |
| Mix | `studio mix <project>` | `out/mix.wav`, the mastered mix on its own, to audition |
| Render | `studio render <project>` | `out/mix.wav`, `out/video.mp4` (captions burned in), `out/video.srt` and `out/video.vtt`, review sheets in `out/check/`, each video with a `.snapshot.json` beside it (the timeline it was rendered from). `--animatic` renders the video as it plays now, unchecked and unmixed, to `out/wip/animatic.mp4`, for approving it in `studio review` before it's voiced or finished; `--frames=a:b` renders just those frames, silent; `--join=<folder>` joins such slices under the mix. A `--read=draft` voice gets a loud warning, and its snapshot says so, so `studio review` shows a DRAFT VOICE banner over it. A transparent video (`format: { transparent: true }`, silent) delivers `out/video.webm` (VP9 with alpha, Chrome and Firefox) and `out/video-hevc.mov` (HEVC with alpha via macOS VideoToolbox, Safari) in place of the MP4, and `studio review` plays it over a checkerboard or a colour |
| Review | `studio review <project>` | the studio app (`web/`, on port 4317) on the project's newest render or still: pin notes on a moment and a point, which save to `review/notes-<render>.json` and copy as markdown; the scrubber carries the render's scene cuts, beats and cues, and a storyboard under it has a card per scene with stills cut from the render |

`studio render` refuses to render if any line is still estimated. It renders the captioned video with the check
measuring each frame as it's drawn, and delivers nothing if a highlight sits under a tag or the caption, runs off
the frame or is cut off by its panel, if a scene's `expect` isn't met, or if the motion tracks have tracking errors.
It then masters the mix to −14 LUFS and muxes it in under the muted video. Renders run at low priority in 3 tabs
(`--workers` or a video's `renderWorkers` changes that), fail if their browser has only software GL, and end
with each pass's time, the workers and the GPU backends. Each MP4 must have
the right length and an audio stream, measure −14 ±1 LUFS and peak at −1 dBTP or lower. A `silent` project (no voice,
music or sound) has no mix, mastering or loudness check, and a sidecar only from a caption table: each MP4 must have no
audio track instead. A mix
that renders silent in any other project fails. Each is tiled into a sheet to look over.

`studio api [name]` lists what `lib/api.ts` exports, read from the code, or prints one export's signature and
doc comment. `studio repeatable <project> 2,8.5` proves a painted layer is a pure function of time; `studio sfx` renders sound
effects from seeded recipes (`studio sfx list`; `studio sfx showcase` to listen through them all).

`npm run typecheck` checks everything, including that every rect a scene points at was captured. `npm test` runs the
tests. `npm run check:arch` holds the architecture (where timing is built, what a scene may import, a project's declared
capability against what it binds, the modules its scenes may share) over what the next commit holds; older
violations sit in `lint/arch-baseline.json` (the studio's) and `work/arch-baseline.json` (yours), and a new one
blocks. The pre-commit gate (`.githooks/pre-commit`, switched on by `npm install`) runs `check:arch`, then
`typecheck:gate` and `test:gate`: the typecheck and tests of what a clean clone holds, which has no `work/`. Your workspace's commits run the rest (Your work, above).

## A project

```
work/projects/<yyyy-mm-name>/
  project.ts       its capability: music-led, voice-led, mixed, silent or still-only (lib/platform/project/models/capability.ts),
                   and the modules its scenes may share
  capture.ts       the named shots: stills and takes, each with its own setup (lib/footage/capture/engine/capture.ts)
  voiceover.json   { voice, lines: [{ id, text }] }
  timeline.ts      the timing, stated once: each scene's driver (beats, seconds or its voiced lines) and its cues
  timeline.test.ts registers the timeline with the retime runner
  scenes/, bars/   a file per scene (bars/ for one on the beat), its helpers in a folder of its name
  video.tsx        defineVideo({ title, format, voice, scenes: bindTimeline(timeline, { … }) }), format its fps and size
  stills.tsx       defineStills({ … }): each design, its presets and variants
  storyboard.md    the plan: audience, takeaway, the scene table, what was checked, what's deliberately left out
  captures/, audio/, music/, out/   generated, gitignored
```

Scene lengths come from the voiced lines, so rewording a line re-times the video on its own. Anchor beats to speech
with `s.line(id).word('seventeen')` (from whisper word timings) or `s.line(id).at(f)`, never hard-coded seconds. A
scene's `expect` says what must be on screen while a word is spoken:
`expect: (s) => [{ see: 'matches', during: s.line('combo-a').word('seventeen') }]`, where `matches` is a
`Highlight`'s `name`.

`docs/directing.md` is a short course on directing.

## Pieces

`lib/` holds areas (`timing`, `picture`, `footage`, `output`, `platform`), each a set of features (`timing/voice`,
`picture/camera`, …), and each feature splits by role: `models/` is pure and loads in plain Node, `studio/` renders in
the browser, `engine/` is Node-side machinery. Scenes import the studio's conveniences from `#studio` (`lib/api.ts`),
and anything else in a feature's `studio/` or `models/` as `#lib/<area>/<feature>/<role>/<file>`; never by relative
path.

- `lib/footage/capture/engine/capture.ts`: named shots, each on a fresh page so any can be redone alone. Stills are screenshots with element
  rects in page coordinates; takes are CDP screencasts with marks (rects and times) and a mouse and key log, filmed at
  the site's own pace.
- `lib/footage/capture/studio/take.ts`: takes in a scene. `fitTake` pins marks to words, `takeShot` is the frame showing then (a Shot,
  so cameras work on it), `onTake` moves a mark's rect by the frame's scroll. `TakeCursor` draws our cursor and click
  sounds from the log, so a re-voice never needs a reshoot.
- `lib/timing/timeline/models/timeline.ts`: `defineTimeline` and its drivers (`voiceSpan`, `beatSpan`, `fixedSpan`), the one
  schedule, in frames. `video-layout.ts` beside it places each scene and voice line on the video and decides which
  scenes a frame paints, centring crossfades on the cuts.
- `lib/picture/composition/studio/timeline.ts`: `defineVideo`, which pairs the scenes bound with `bindTimeline` with
  where the timeline placed them.
- `lib/picture/captions/`: captions, one timing core under pluggable styles. A voiced video captions its lines (a
  script's `*word*` is emphasis, `` `key` `` a keycap); a silent one states a `captionTable` in its `timeline.ts`.
  `defineVideo({ captions: { style, table } })` picks the look: `pillCaptions()` (the default) or `wordPopCaptions()`,
  each taking a `band` and a `rule`. The .srt and .vtt page the same track by the style's sidecar rule.
- `lib/picture/camera/models/camera.ts`: a camera over captures (`camFit`, `camAt`, `lerpCam`) and views, which map page rects to the
  frame.
- `lib/footage/capture/studio/capture.tsx`, `lib/picture/kit/studio/overlays.tsx`: captures (with blur, motion blur and state changes), cursor paths with
  clicks, highlights, spotlights, tags, text, frosted glass and washes. Scene text stays above the caption band's top: `useCaptionSafeArea().top`, the
  video's style's band (`camFit` takes it as `captionBand` when it isn't the pill's).
- `lib/picture/kit/studio/kit.tsx`: whole shots built from those, taking their brand colours and words as arguments: `MotionTitle`,
  `ClickToBlur`, `SplitCompare`, `Phone`, `GlassCard`, `SectionCard`, `EndCard`, and redraws of what a screenshot
  can't hold (`ConfirmDialog`, `NativeMenu`). When a shot recurs in a second video, move it here.
- `lib/output/look/studio/probe.tsx`: measures highlights, clicks, tags and the caption on each frame. `lib/picture/frame/models/framing-check.ts`
  decides what's a problem.
- `lib/timing/sound/models/mix.ts`: voice levelling, and a music bed that ducks under the voice. `lib/output/ffmpeg/engine/loudness.ts` measures.
- `lib/timing/sound/studio/sfx.tsx`: `<Sfx>` plays a sound so it lands on a scene time; `CursorPath` clicks sound by themselves.
  `lib/timing/sound/models/recipes.ts` synthesizes every sound from a seeded recipe (whoosh, riser, impact, chime and more), so there's nothing
  to license.
- `lib/timing/voice/engine/whisper-words.ts`, `lib/timing/voice/models/voice-words.ts`: word timings from whisper.cpp (installed on first use into
  `~/.cache/media-studio`), aligned to the script.
- `lib/timing/voice/models/voice-take.ts`: where to cut a take into lines, and the pauses the read left between them.
- `lib/timing/music/models/music-beats.ts`: the tempo and beats of a music track.
- Painted layers are being rebuilt as stamp painting and have no style yet; see the `video-canvas` skill.
  `studio repeatable` proves a drawn layer is a pure function of time.
- `web/`: the studio app behind `studio review`, on TanStack Start, Mantine and StyleX, served in-process
  by Vite (`lib/platform/web/engine/studio-app-server.ts`). It reaches engine code only through
  `web/src/infrastructure/studio-engine.server.ts`.
- `cli/studio.ts`: the `studio` entry point. Each verb is `cli/commands/<verb>.ts`, parsing its arguments and calling
  into `lib/`: `lib/output/render/engine/render-pipeline.ts` checks, mixes, renders and reviews a bundled project
  (`lib/output/render/engine/render-session.ts`), `lib/timing/voice/engine/voice-project.ts` reads the script as one take (Gemini TTS through
  `lib/footage/generation/engine/openrouter.ts`, `say`, or a recording) and cuts it, and `lib/platform/project/engine/studio-project.ts` resolves `<project>`.
- `lib/footage/generation/engine/paid-generation.ts`: every paid image, video or music generation, cached by request hash into a project's
  `generated/` (gitignored) with each result's prompt, model, references and cost in `generated/provenance.json`.
  `lib/output/render/engine/previs-render.ts` is `studio gen video`: a scene's 3D blockout (`lib/footage/previs/studio/blockout.tsx`) rendered into footage.

Remotion bundles one project's `video.tsx` and the `lib/` code it imports. Remotion is free for companies of up to three people;
past that it needs a company license.
