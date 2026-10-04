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
capability against what it binds, the modules its scenes may share) over the working tree, untracked files included
(the hooks read what the commit holds); older violations sit in `lint/arch-baseline.json` (the studio's) and
`work/arch-baseline.json` (yours), and a new one blocks. The pre-commit gate (`.githooks/pre-commit`, switched on by
`npm install`) runs `check:arch` and `lint`, then `typecheck:gate` and `test:gate`: the typecheck and tests of what a clean clone holds, which has no `work/`. Your workspace's commits run the rest (Your work, above).

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

`lib/` holds areas (`timing`, `picture`, `paint`, `footage`, `output`, `platform`), each a set of features
(`timing/voice`, `picture/camera`, …), and each feature splits by role: `models/` is pure and loads in plain Node,
`studio/` renders in the browser, `engine/` is Node-side machinery. Scenes import the studio's conveniences from
`#studio` (`lib/api.ts`), and anything else in a feature's `studio/` or `models/` as
`#lib/<area>/<feature>/<role>/<file>`; never by relative path. `studio api` lists what `#studio` exports.

**timing**: when things happen.
- `timeline`: `defineTimeline` and its drivers (`voiceSpan`, `beatSpan`, `fixedSpan`), the one schedule, in frames;
  `video-layout.ts` places each scene and voice line on the video; the retime runner every `timeline.test.ts` calls.
- `voice`: a script voiced as one take and cut into lines (`studio voice`), with word timings from whisper.cpp.
- `sound`: the mix's levels (a voice levelled, a music bed ducking under it), and `<Sfx>`, every sound synthesized from
  a seeded recipe, so there's nothing to license.
- `music`: a track added, generated, beat-tracked and cut to a length (`studio music`).

**picture**: what a frame shows.
- `frame`: a video's format (frame rate and size), and the points, rects and transforms everything lays out in.
- `motion`: easing and progress helpers, seeded randomness and a shutter's smear: a frame is a function of its clock.
- `type`: the studio's faces and their metrics, and Archivo laid out glyph by glyph without the DOM.
- `color`: how far apart two colours read, by WCAG 2.
- `captions`: one timing core under pluggable styles (`pillCaptions()`, the default, or `wordPopCaptions()`), paged
  for the burned-in captions and the .srt and .vtt. A silent video states a `captionTable` in its `timeline.ts`.
- `camera`: cameras over captures (`camFit`, `camAt`, `lerpCam`) and views, which map page rects to the frame.
- `measurement`: the probe that measures each frame (highlights, clicks, tags, the caption, tagged motion) for the
  checks, and piece tracks read from a scene's model without a render.
- `profiling`: how drawing code offers its work to `studio profile` to be timed, and its costs to be counted (`--costs`).
- `video`: `defineVideo`, the scene clock, and a timed video's scenes bound to where the timeline placed them.
- `stills`: `defineStills`, the sizes stills render at, and the check a still must pass.
- `composition`: the Remotion root and the composition that plays a project's scenes, voice and captions.
- `brand`: what a brand kit is, read from `work/brands/<name>/` and imported as `@brand`.
- `kit`: overlays (cursors, highlights, spotlights, tags, text, frosted glass, washes) and whole shots built from them
  (`MotionTitle`, `SplitCompare`, `Phone`, `EndCard`, …). When a shot recurs in a second video, move it here.
- `film`: what finishes a frame: grain and grade, motion blur, and a three.js scene through a real lens.
- `reel`: the reference reel's devices (bouncing ball, cube and glyph fields, HUD, needle, recap), and `studio study`,
  which measures a reference video.

**paint**: stamp painting, a painted layer drawn on the GPU (`docs/brush-engine.md`; the `video-canvas` skill).
- `materials`: pigments, mediums and paper, mixed by Kubelka–Munk.
- `brush`: `StampBrush`, its tip and dynamics, where its stamps land, and the hand that moves it along a stroke.
- `painting`: the painting a scene writes (deposits, fills, regions, washes and their wet laws), and the WebGPU
  renderer.
- `photoshop-brushes`: Photoshop presets and `.abr` files read into a `StampBrush`, and the rig that has Photoshop paint
  references.
- `procreate-brushes`: Procreate brushes read into a `StampBrush`, and the stroke Procreate previews them along.
- `brush-packs`: a pack of brushes on disk, and `studio brushes import` for either app's.
- `style`: a private painting style (`work/styles/<name>/`), the styles a project names, `StampPainting`, which
  paints in one in a scene, and `studio brushes describe`, a style's brushes as numbers to plan by.
- `brush-fidelity`: how close a painted brush comes to its app's own, measured, scored and fitted
  (`npm run brushes:sheet`).
- `studies`: wet and dry passages, fill and stroke-hand sheets, painted for a person to judge.
- `gate`: holds the GPU renderer to accepted output (`npm run stamp:gate`), run by pre-push.

**footage**: what's filmed or generated.
- `capture`: a site filmed as named shots, stills and takes (`studio capture`, `studio probe`), shown in a scene
  through a view (`capture.tsx`), a take's marks pinned to words (`fitTake`, `takeShot`, `TakeCursor`).
- `generation`: `studio gen image`, a generated still listed by name.
- `previs`: 3D and 2D blockouts of a shot, the video models `studio gen video` renders one with, and a previs scene
  playing its generated footage.

**output**: rendering and checking.
- `render`: one project bundled and rendered (`render-session.ts`, `render-pipeline.ts`: checks, mixes, renders,
  reviews), its stills and snapshots, and `studio gen video`, `studio profile` and `studio clock`.
- `picture-checks`: the probe's measurements turned into problems a viewer would notice (framing, holds), and motion
  drawn over time for review.
- `look`: `studio look`'s sheets, strips and graphs.
- `review`: what `studio review` shows (a project's reviewable files, pinned notes, the storyboard), and
  `studio still --sheet`.
- `sfx-cues`: a video's sound-effect cue list, drafted from what `studio check` measured.
- `sound-check`: each sound a video plays against its music, as the mix plays them.

**platform**: the machinery under everything.
- `project`: where the studio and your workspace live, which project an argument means, and a project's capability.
- `scaffold`: `studio new`'s starting files, and the `studio api` reference.
- `paid-generation`: every paid image, video or music generation through OpenRouter, cached by request hash into a
  project's `generated/` with each result's prompt, model, references and cost in `generated/provenance.json`.
- `ffmpeg`: the one place ffmpeg runs: loudness, contact sheets.
- `browser`: the browser every render runs in and the GPU it got, and a studio module run in it outside a bundle.
- `raster`: graphs, plots and sheets drawn to PNG.
- `web`: the studio app behind `studio review` (`web/`, on TanStack Start, Mantine and StyleX), served in-process by
  Vite. The app reaches engine code only through `web/src/infrastructure/studio-engine.server.ts`.
- `host`: a product repo a video is about, whose real React components it composes.
- `photoshop`: Photoshop driven from Node with no UI, its settings kept as they were.
- `temp`, `git`, `wav`, `zip`: the temp space, git in a throwaway repo, WAV files, and reading zips.

`cli/studio.ts` is the `studio` entry point. Each verb is `cli/commands/<verb>.ts`, parsing its arguments and calling
into `lib/`.

Remotion bundles one project's `video.tsx` and the `lib/` code it imports. Remotion is free for companies of up to three people;
past that it needs a company license.
