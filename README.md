# video-studio

Videos and stills made in code, in [Remotion](https://www.remotion.dev): walkthroughs over a site's captured states,
music-led ads and teasers, drawn and 3D pieces. Voice, music, sound effects and the mix included; render to MP4.

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
| Music | `studio music add <project> <file>` | `music/<name>.*` plus `music/index.ts`: the track with its loudness, tempo and beats. Use it with `defineVideo({ music: { track: music.bed } })`. `studio music fit <project>` cuts it to the video's length, ending on its own ending, as `music['bed-fit']` |
| Storyboard | `studio storyboard <project>` | `out/storyboard/index.html`: a preview on top, a card per scene with its note, a still and the audio for each line, and a still on each cue, replay and landmark in `timeline.ts`, silent or on its music |
| Preview | `studio preview <project>` | the Remotion Studio: scrub, see scenes and voice lines on the timeline, toggle `captions` in the props panel |
| Look | `studio look <project> --sheet=1,5,9` | a contact sheet of chosen times, `--strip=4:5` for a stretch of motion, or `--graph=4:6` to plot that stretch's measured motion (position, velocity, size, opacity, reported values) against the words, with its numbers. Open the image to check frames without rendering video |
| Check | `studio check <project>` | the framing check and the motion tracks on every frame (`--scene` or `--at=a:b` for less), a table of when each scene and line starts and ends, `out/check/timeline.json` (scenes, lines, words, crossfades) and `out/check/motion.json` (how every tagged element moved) |
| Mix | `studio mix <project>` | `out/mix.wav`, the mastered mix on its own, to audition |
| Render | `studio render <project>` | `out/mix.wav`, `out/video.mp4` (captions burned in), `out/video.srt`, review sheets in `out/check/`, and `out/watch.html`, each video with a `.snapshot.json` beside it (the timeline it was rendered from). `--frames=a:b` renders just those frames, silent; `--join=<folder>` joins such slices under the mix. A `--read=draft` voice gets a loud warning and a DRAFT banner on the watch page |

`studio render` runs the check first and refuses to render if a highlight sits under a tag or the caption, runs off
the frame or is cut off by its panel, if a scene's `expect` isn't met, if the motion tracks have tracking errors, or
if any line is still estimated. It then masters the mix to −14 LUFS, renders the video muted and muxes the mix in. Each MP4 must have
the right length and an audio stream, measure −14 ±1 LUFS and peak at −1 dBTP or lower. Each is tiled into a sheet
to look over.

`studio api [name]` lists what `lib/studio/api.ts` exports, read from the code, or prints one export's signature and
doc comment. `studio repeatable <project> 2,8.5` proves a painted layer is a pure function of time; `studio sfx` renders sound
effects from seeded recipes (`studio sfx list`; `studio sfx showcase` to listen through them all).

`npm run typecheck` checks everything, including that every rect a scene points at was captured. `npm test` runs the
tests.

## A project

```
projects/<yyyy-mm-name>/
  capture.ts       the named shots: stills and takes, each with its own setup (lib/engine/capture/capture.ts)
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

- `lib/engine/capture/capture.ts`: named shots, each on a fresh page so any can be redone alone. Stills are screenshots with element
  rects in page coordinates; takes are CDP screencasts with marks (rects and times) and a mouse and key log, filmed at
  the site's own pace.
- `lib/studio/take.ts`: takes in a scene. `fitTake` pins marks to words, `takeShot` is the frame showing then (a Shot,
  so cameras work on it), `onTake` moves a mark's rect by the frame's scroll. `TakeCursor` draws our cursor and click
  sounds from the log, so a re-voice never needs a reshoot.
- `lib/studio/timeline.ts`: `defineScene`, `defineVideo`, and the layout that times scenes to their lines and centres
  crossfades on the cuts.
- `lib/models/camera/camera.ts`: a camera over captures (`camFit`, `camAt`, `lerpCam`) and views, which map page rects to the
  frame.
- `lib/studio/capture.tsx`, `overlays.tsx`: captures (with blur, motion blur and state changes), cursor paths with
  clicks, highlights, spotlights, tags, text, frosted glass and washes. Scene text stays above `CAPTION_SAFE_TOP`.
- `lib/studio/kit.tsx`: whole shots built from those, taking their brand colours and words as arguments: `MotionTitle`,
  `ClickToBlur`, `SplitCompare`, `Phone`, `GlassCard`, `SectionCard`, `EndCard`, and redraws of what a screenshot
  can't hold (`ConfirmDialog`, `NativeMenu`). When a shot recurs in a second video, move it here.
- `lib/studio/probe.tsx`: measures highlights, clicks, tags and the caption on each frame. `lib/models/frame/framing-check.ts`
  decides what's a problem.
- `lib/studio/mix.ts`: voice levelling, and a music bed that ducks under the voice. `lib/engine/ffmpeg/loudness.ts` measures.
- `lib/studio/sfx.tsx`: `<Sfx>` plays a sound so it lands on a scene time; `CursorPath` clicks sound by themselves.
  `lib/sfx/` synthesizes every sound from a seeded recipe (whoosh, riser, impact, chime and more), so there's nothing
  to license.
- `lib/engine/voice/whisper-words.ts`, `lib/models/voice/voice-words.ts`: word timings from whisper.cpp (installed on first use into
  `~/.cache/video-studio`), aligned to the script.
- `lib/models/voice/voice-take.ts`: where to cut a take into lines, and the pauses the read left between them.
- `lib/models/music/music-beats.ts`: the tempo and beats of a music track.
- `lib/paint/`: drawn layers (p5 sketches) inside scenes, with a watercolour style ported from p5.brush. See the
  `video-canvas` skill. `studio repeatable` proves a drawn layer is a pure function of time.
- `cli/studio.ts`: the `studio` entry point. Each verb is `cli/commands/<verb>.ts`, parsing its arguments and calling
  into `lib/`: `lib/engine/render/render-pipeline.ts` checks, mixes, renders and reviews a bundled project
  (`lib/engine/render/render-session.ts`), `lib/engine/voice/voice-project.ts` reads the script as one take (Gemini TTS through
  `lib/engine/generation/openrouter.ts`, `say`, or a recording) and cuts it, and `lib/engine/project/studio-project.ts` resolves `<project>`.
- `lib/engine/generation/paid-generation.ts`: every paid image, video or music generation, cached by request hash into a project's
  `generated/` (gitignored) with each result's prompt, model, references and cost in `generated/provenance.json`.
  `lib/engine/render/previs-render.ts` is `studio gen video`: a scene's 3D blockout (`lib/studio/blockout.tsx`) rendered into footage.

Remotion bundles `lib/studio` and one project's `video.tsx`. Remotion is free for companies of up to three people;
past that it needs a company license.

## Secrets

Only paid calls need a secret (`studio voice`, `studio audition`, and generation through `lib/engine/generation/paid-generation.ts`):
`OPENROUTER_API_KEY`, read from the environment. A reference video (`studio gen video`) is also uploaded to our R2
bucket for the provider to fetch through a link that expires (`lib/engine/generation/s3-upload.ts`), which needs `STUDIO_UPLOAD_S3_ENDPOINT`,
`STUDIO_UPLOAD_S3_BUCKET`, `STUDIO_UPLOAD_S3_ACCESS_KEY_ID`, `STUDIO_UPLOAD_S3_SECRET_ACCESS_KEY` and, for a bucket
outside R2, `STUDIO_UPLOAD_S3_REGION`. `.env.op` holds 1Password references, not keys, and `bin/studio-secrets`
resolves them for the one command it runs:

```sh
"$(studio home)/bin/studio-secrets" studio voice <project>
```

It reads a 1Password service account's token (read-only on the `video-studio` vault) from the macOS keychain, hands it
to `op` alone and strips it before the command starts, so neither a shell nor the command's environment carries it.
Code running as your user can still read the keychain item, so the account's read-only, one-vault scope is the real
limit. `scratch/op-service-account-setup.sh` creates the account and the keychain item.

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
`video-capture` writes the shots, `video-motion` animates, `video-sound` scores it, `video-canvas` paints, `stills` makes OG images, thumbnails and social images, and `remotion` covers new primitives.
`docs/directing.md` is a short course on directing.
