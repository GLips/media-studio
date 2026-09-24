# Port the studio to Remotion

Status: all four phases built and reviewed with Codex. Branch `remotion-port`, in the worktree `../video-studio-remotion`.

## Why

The studio was a canvas engine, a Playwright frame renderer and ffmpeg. Remotion gives us a real Studio (a timeline
with named sequences, a props panel, hot reload), audio mixing with per-frame volume, `@remotion/captions`,
whisper.cpp word timing, and a maintained renderer. It also lets scenes be DOM, so a shot can rebuild a piece of UI in
HTML instead of zooming a screenshot until it softens. The license is free: one person, and the threshold is 3.

## What stayed

- **Capture:** Playwright snaps full-page PNGs plus page-space element rects, now as a typed `captures/index.ts`.
- **TTS:** Gemini through OpenRouter, one WAV per line, re-voiced only when the text changes; a typed `audio/manifest.ts`.
- **Timing model:** scene length = lead + lines + gaps + tail (or `min`). Crossfades are centred on the cut; `cut: true`
  is a hard cut. Scene code works in **seconds**.
- **Camera model:** `{ cx, cy, zoom }` in page coordinates; zoom 1 fills the frame (or the box) with the capture's
  width; zoom interpolates in log space. `camFit` centres its subject in the part of the box above the caption band.
- **Framing rule:** a highlight under a tag, under the caption, or off the frame fails the render.
- **Two outputs:** a plain MP4 and a captioned MP4, plus `.srt`, review sheets and `watch.html`.

## Boundaries

- **Node** (`scripts/`, `lib/capture.ts`, `lib/project-bundle.ts`) runs TypeScript by type stripping: no TSX, no
  imports from the browser side except types.
- **Browser** (`lib/studio/`, `projects/*/video.tsx`) is bundled by Remotion, **one project per bundle**. The `@project`
  alias points at that project's `video.tsx` and `PROJECT_SLUG` names its composition, so a project with missing
  captures can't break another's render. The Studio takes the project from the `PROJECT` env var
  (`npm run studio -- projects/<p>`).
- **Assets are imported**, not `staticFile()`: each project stays self-contained, and rect keys are types, so a scene
  pointing at a rect the capture never measured doesn't compile.

## Timeline

- `layoutVideo` works in continuous seconds and validates the definition (unique ids, known lines, each line used
  once, finite numbers).
- The composition's length is the timeline rounded up to a frame. The scene clock is `frame / fps - scene.start`,
  continuous, and runs negative or past `dur` during crossfades, so scenes must be pure functions of `t`.
- `scenesAt(t)` decides what paints and at what alpha. The `<Sequence>`s around scenes and voice lines only mount and
  label them in the Studio; they don't decide visibility. `TransitionSeries` was rejected: it shortens the timeline by
  each overlap and puts transitions between sequences, where ours are centred on the voiced cuts.
- Voice lines start at `round(start * fps)` with one frame of slack at the end.

## Scene API

```tsx
const ladder = defineScene({
  id: 'ladder', lines: ['ladder'], lead: 0.3, tail: 0.8,
  render: (s) => {
    const shot = C['ball-10'];
    const v = view(shot, camFit(shot, union(shot.rects.price, shot.rects.tiers), { pad: 50, maxZoom: 1.4 }));
    return (
      <>
        <Capture view={v} />
        <Highlight rect={screenRect(v, shot.rects.tiers)} k={on(s.t, s.line('ladder').at(0.45))} color={SALE_RED} />
      </>
    );
  },
});
export default defineVideo({ title: 'Simple buy box', voice, scenes: [title, …, ladder, …] });
```

- `defineScene` types `s.line(id)` against the scene's own `lines`, so a beat can't anchor to another scene's line.
- A **view** (`{ shot, cam, box }`) is what `Capture`, `CursorPath` and `screenRect` share, so a split panel's
  highlight can't be mapped with the wrong camera.

## Primitives as DOM

Captures are an `<Img>` laid out at their on-screen size (so CSS blur is in frame pixels) inside a box that clips.
Motion blur is N stacked samples, the same algorithm as the canvas. Cursor, highlight and spotlight are SVG; tags and
captions are DOM; text is SVG `<text>` for canvas's baseline semantics; glass is `backdrop-filter`. `MotionTitle`'s
smear is a 48-sample stack under a `mask-image`.

**Parity:** checked with sheets sampled at every line, against the canvas MP4s. `simple-buy-box` matches frame for
frame. `sale-only-view`'s reference predates the caption-aware `camFit`, so its cameras sit about 120px higher there.

## Checks and sheets

- **Framing:** highlights, tags and the caption carry `data-framing`. With `probe: true`, `FramingProbe` holds a
  `delayRender` until fonts are ready, measures, and emits a per-frame JSON `<Artifact>`. Node collects them via
  `renderFrames({ imageFormat: 'none', onArtifact })` and decides what's a problem. The caption is laid out (hidden)
  even when captions are off, so it's still measured.
- **Timeline report:** frame 0 emits `timeline.json` (scenes and cues), which feeds the `.srt`, the watch page and the
  length check. `--check` writes it to `out/check/`.
- **Sheets and strips** render chosen frames small with `renderFrames({ scale })` and tile them with ffmpeg in Node,
  rather than a `<Freeze>` grid composition, which would mount the whole video once per cell.
- `--video` refuses estimated lines.

## After the port (same branch)

1. **Word-level timing.** whisper.cpp 1.8.6 (medium.en, cached in `~/.cache/video-studio`) gives DTW token times,
   merged into words and aligned to the script by edit distance (`lib/voice-words.ts`). They're stored in the
   manifest; `s.line(id).word('price')` anchors beats to words. They land within about 2 frames of the silence edges.
2. **Audio finishing** (`lib/studio/mix.ts`). Voice lines are levelled to −20 LUFS through `<Audio volume>`. An
   optional music bed (`scripts/music.ts` imports a track and detects its beats) sits 8 LU under the voice and ducks
   to 18 LU under while lines play. The mix renders once, then gets gain plus an oversampled limiter (not loudnorm,
   whose dynamic mode fills in the ducks). The videos render muted and are muxed with that master. The delivery
   check wants −14 ±1 LUFS and true peak ≤ −1 dBTP on each MP4.
3. **Motion checks.** A scene's `expect` names a highlight to be drawn and clear for a word or line, on every frame of
   it. Clicks are framing subjects, panels clip their highlights, and camera and cursor keys must rise in time.
4. **Skills and storyboard.** `video-kickoff` gates dump → angle → scene table → storyboard.
   `scripts/storyboard.ts` builds the storyboard page from the animatic itself. `video-motion` maps the vocabulary
   to this API. A subset of Remotion's own skills is vendored in `.claude/skills/remotion`.

Deferred: snapping cuts to music beats (the beats are detected; nothing uses them yet), and where music comes from.

## Risks still open

- Fonts are the system SF Pro stack, so a render on another machine can differ.
- Render time: `--video` on simple-buy-box takes about 7.5 min (framing check about 45 s, each MP4 about 200 s) at
  about 880 MB of Node memory.
