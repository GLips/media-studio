# Remotion, as the studio uses it

The studio renders with Remotion (the version `package.json` pins). One composition holds every video, and the
timeline places each scene in it. A scene or a new studio primitive can use any Remotion API inside that, keeping
these conventions; for the API itself, query the Remotion docs (context7 `/remotion-dev/remotion`).

- **Seconds, not frames.** A scene's clock `s.t` is seconds since its cut; animate with `seg`, `on`, `off` and the
  curve tokens rather than `interpolate(useCurrentFrame(), …)`. `s.t` can be negative or past the scene's length
  during a crossfade, and everything stays a pure function of it.
- **Imports, not `staticFile()`.** There is no `public/`: assets live in the project folder and are imported (an
  import is the file's URL), so each project bundles on its own and a missing file fails to compile.
- **No `TransitionSeries`.** The storyboard centres crossfades on the cuts (a scene's `timing.crossfade`); a `TransitionSeries`
  would shorten the video instead.
- **Images** go through Remotion's `<Img>`, which holds the frame until the image has loaded; a bare `<img>` can be
  captured blank.
- **Fonts**: `loadStudioFaces` loads a face from an imported file, and the render waits for it. Measure text only
  after `useStudioFontsReady`; to fit text to a box, `FitText` does it.
- **Measuring the DOM**: Remotion scales the preview, so `getBoundingClientRect()` is in screen pixels.
  `useScreenRect(ref)` returns a box in composition pixels whatever the zoom, and waits for layout.
- **Audio goes through the mix.** Voice lines are levelled and the music ducked under them, and `studio mix` and
  `studio render` master the result; a scene's own sound is an `<Sfx>`, and a sound on the video's clock goes in
  `defineVideo({ sounds })`. Choosing and placing music and effects is the `video-sound` skill.
- **Measure for the checks.** A primitive that marks a subject, a tag or text carries `data-framing`, as the kit's
  pieces do, so the framing check sees it; a moving one carries a motion tag
  (`${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/tracks.md`).
- **Use the Remotion packages the studio already depends on.** Adding one is a change to the studio itself, not to
  a project: ask first.
