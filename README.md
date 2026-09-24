# video-studio

Walkthrough and explainer videos, made in code: capture a site's states, voice a script, animate the captures in
[Remotion](https://www.remotion.dev), render to MP4.

Every frame is a pure function of time, so a change to one scene is an edit and a re-render. Nothing gets reshot by hand.

## Install

```sh
npm install
npm link        # puts `studio` on your PATH, pointing at this checkout
```

`studio` is TypeScript run directly by Node 24. `studio home` prints this repo's root, from anywhere.

## The pipeline

Every step is a `studio` verb. A `<project>` is a slug (`sale-only-view`), a unique part of a name, or a path.
`studio <verb> --help` has the flags; each prints what it made on stdout and its progress on stderr.

| Step | Command | Output |
|---|---|---|
| Start | `studio new <slug> [--url=…]` | `projects/<yyyy-mm>-<slug>/` with estimated timing, so it previews at once; with `--url`, that page captured as `home` and titled over |
| Probe | `studio probe <project> <url-or-path> [--at=x,y]` | a numbered viewport screenshot of a page as `capture.ts` sees it (signed in by its `prepare`), and its interactive and landmark elements (or the one under `--at`) with selectors for rects |
| Capture | `studio capture <project>` | `captures/` plus `captures/index.ts`: the named shots. A still is a high-DPI full-page screenshot with the page positions of the elements scenes point at; a take is a screen recording of real clicks, scrolls and typing, with marks. Shots `capture.ts` no longer makes are deleted |
| Voice | `studio voice <project>` | `audio/take.wav`, the whole script read in one take, cut into `audio/<line>.wav` plus `audio/manifest.ts`. Any script change re-reads the take. `--read=draft` is a free macOS `say` read, `--read=estimate` times lines from their word count, `--take=<file>` uses a recording. `studio audition` compares voices on one line |
| Music | `studio music <project> <file>` | `music/<name>.*` plus `music/index.ts`: the track with its loudness, tempo and beats. Use it with `defineVideo({ music: { track: music.bed } })` |
| Storyboard | `studio storyboard <project>` | `out/storyboard/index.html`: a preview on top, a card per scene with its note, a still and the audio for each line |
| Preview | `studio preview <project>` | the Remotion Studio: scrub, see scenes and voice lines on the timeline, toggle `captions` in the props panel |
| Look | `studio look <project> --sheet=1,5,9` | a contact sheet of chosen times, or `--strip=4:5` for a stretch of motion. Open the image to check frames without rendering video |
| Check | `studio check <project>` | the framing check, a table of when each scene and line starts and ends, and the same as `out/check/timeline.json` |
| Mix | `studio mix <project>` | `out/mix.wav`, the mastered mix on its own, to audition |
| Render | `studio render <project>` | `out/mix.wav`, `out/video.mp4` (captions burned in), `out/video.srt`, review sheets in `out/check/`, and `out/watch.html`. A `--read=draft` voice gets a loud warning and a DRAFT banner on the watch page |

`studio render` runs the framing check on every frame first and refuses to render if a highlight sits under a tag or
the caption, runs off the frame or is cut off by its panel, if a scene's `expect` isn't met, or if any line is still
estimated. It then masters the mix to −14 LUFS, renders the video muted and muxes the mix in. Each MP4 must have
the right length and an audio stream, measure −14 ±1 LUFS and peak at −1 dBTP or lower. Each is tiled into a sheet
to look over.

`studio api [name]` lists what `lib/studio/api.ts` exports, read from the code, or prints one export's signature and
doc comment. `studio repeatable <project> 2,8.5` proves a painted layer is a pure function of time; `studio sfx` re-synthesizes
the kit's click sounds.

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

`docs/directing.md` is a short course on directing.

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
  synthesized by `studio sfx`, so there's nothing to license.
- `lib/whisper-words.ts`, `lib/voice-words.ts`: word timings from whisper.cpp (installed on first use into
  `~/.cache/video-studio`), aligned to the script.
- `lib/voice-take.ts`: where to cut a take into lines, and the pauses the read left between them.
- `lib/music-beats.ts`: the tempo and beats of a music track.
- `lib/paint/`: drawn layers (p5 sketches) inside scenes, with a watercolour style ported from p5.brush. See the
  `video-canvas` skill. `studio repeatable` proves a drawn layer is a pure function of time.
- `cli/studio.ts`: the `studio` entry point. Each verb is `cli/commands/<verb>.ts`, parsing its arguments and calling
  into `lib/`: `lib/render-pipeline.ts` checks, mixes, renders and reviews a bundled project
  (`lib/render-session.ts`), `lib/voice-project.ts` reads the script as one take (Gemini TTS through
  `lib/openrouter.ts`, `say`, or a recording) and cuts it, and `lib/studio-project.ts` resolves `<project>`.
- `lib/paid-generation.ts`: every paid image, video or music generation, cached by request hash into a project's
  `generated/` (gitignored) with each result's prompt, model, references and cost in `generated/provenance.json`.

Remotion bundles `lib/studio` and one project's `video.tsx`. Remotion is free for companies of up to three people;
past that it needs a company license.

## Secrets

Only paid calls need a secret (`studio voice`, `studio audition`, and generation through `lib/paid-generation.ts`):
`OPENROUTER_API_KEY`, read from the environment. `.env.op` holds 1Password
references, not keys, so the key exists only inside the one process `op run` starts:

```sh
op run --account branchlabs.1password.com --env-file="$(studio home)/.env.op" -- studio voice <project>
```

A shell alias saves typing it. Needs the 1Password app's CLI integration (Settings → Developer).

## Hosts

A video can be about a product repo, its host, and compose that repo's real React components. `hosts.json`
(committed) maps a host name to `{ "repo": "<git url>" }`; `hosts.local.json` (gitignored, optional) maps it to an
absolute (or `~/…`) path of a working copy on this machine, used as it stands, uncommitted changes included. A project
opts in with `projects/<p>/host.json` `{ "name", "ref", "browserStubs"? }`. `studio hosts sync <p> [--install]`
checks the ref out into `~/.cache/studio/hosts/<name>@<sha>` (outside the studio, so the host's own tooling never
finds the studio's packages), or uses the working copy, and links it at `projects/<p>/host`. `--install` runs the
host's install in a checkout, lifecycle scripts included.

A scene imports `@host/<path from the host root>`. The bundle resolves host files' own tsconfig `paths` and packages,
shares the studio's React, and replaces host files matching `browserStubs` (server-only code) with empty modules.
tsc types `@host/…` as `any`, so `studio look` is the check. Plain CSS and CSS modules load; Tailwind/PostCSS doesn't.
Every capture writes `captures/provenance.json` (per shot: URL, time, studio and host commits), so a video can be
traced to its source without keeping media.

## Skills

The skills (`skills/`) ship as the `video-studio` Claude Code plugin, and this repo is its own marketplace, so they work
from any repo ("make a PR walkthrough video for this change"). Install once per machine, in Claude Code:

    /plugin marketplace add ~/Programming/video-studio
    /plugin install video-studio@video-studio

A local-directory marketplace loads the plugin in place, so edits to `skills/` reach the next session. Skills find
this repo with `studio home`. `video-kickoff` takes a video from the first dump to an approved storyboard,
`video-capture` writes the shots, `video-motion` animates, `video-canvas` paints, and `remotion` covers new primitives.
`docs/directing.md` is a short course on directing.
