# video-studio

Walkthrough and explainer videos, made in code: capture a site's states, voice a script, animate the captures in a canvas, render to MP4.

Every frame is a pure function of time, so a change to one scene is an edit and a re-render. Nothing gets reshot by hand.

## The pipeline

| Step | Command | Output |
|---|---|---|
| Start | `npm run new -- <slug> --url=… [--title=…]` | `projects/<yyyy-mm>-<slug>/`, which renders a title and an outro as soon as it's captured and voiced |
| Capture | `node projects/<p>/capture.mjs` | `captures/*.png` plus `captures/index.js`: high-DPI full-page screenshots and the page positions of the elements scenes point at |
| Voice | `npm run tts -- projects/<p>` | `audio/<line>.wav` plus `audio/manifest.js`, one file per line. Only changed lines are re-voiced |
| Look | `node lib/render.mjs projects/<p> --sheet=1,5,9` | a contact sheet of chosen times, to check frames without rendering video |
| Make | `npm run video -- projects/<p>` | `out/video.mp4`, `out/video-captions.mp4`, `out/video.srt`, and review sheets in `out/check/` |

`npm run video` renders the frames, encodes both versions with the voice lines mixed in at their cues, and checks each MP4's length and audio. It also tiles each one into a sheet to look over. The single steps are `--frames`, `--encode` and `--review`, each with an optional `--captions`.

Frames are stamped with a hash of everything that draws them: the studio lib, the scenes, the captures and the voice timing. Editing any of those clears the old frames at the next render, and an encode from stale frames is refused. Never delete frames by hand.

Open `projects/<p>/studio.html` in Chrome to scrub the video, and `storyboard.html` to review a plan before building it.

## A project

```
projects/<yyyy-mm-name>/
  capture.mjs      Playwright steps that reach each state and snap() it (lib/capture.mjs)
  voiceover.json   { voice, lines: [{ id, text }] }
  scenes.js        defineScenes([...]): each scene names its lines and draws itself
  studio.html      loads captures, audio, lib/studio/engine.js, kit.js and scenes.js
  storyboard.html  the plan, with thumbnails from the real captures
```

Scene lengths come from the voiced lines, so rewording a line re-times the video on its own. Anchor beats to speech with `s.line(id).start` rather than hard-coded seconds.

## Pieces

- `lib/capture.mjs`: screenshots and element rects, in page coordinates.
- `lib/studio/engine.js`: the timeline, and a camera over captures (`camFit`, `camAt`), cursor paths with clicks, highlights, spotlights, tags, text, frosted glass, motion blur and captions. Scene text stays above `CAPTION_SAFE_TOP`.
- `lib/studio/kit.js`: whole shots built from those, taking their brand colours and words as arguments: `drawMotionTitle`, `drawClickToBlur`, `drawGlassCard`, `drawEndCard`, `drawCaptureSwap`. When a shot recurs in a second video, move it here.
- `lib/render.mjs`: headless rendering, encoding and review, adapted from [ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase) (MIT).
- `scripts/tts.mjs`: Gemini TTS through OpenRouter. `--audition "line" --voices=A,B,C` compares voices.
- `scripts/openrouter.mjs`: the shared OpenRouter client, for TTS and any other model calls.

## Secrets

`.env.op` holds 1Password references, not keys. The npm scripts run through `op run`, so `OPENROUTER_API_KEY` exists only inside that one process. Needs the 1Password app's CLI integration (Settings → Developer).
