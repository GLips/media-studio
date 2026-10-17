# Music

Decide the music's role first; it decides who sets the timing:

- **A bed under the narration.** The voice sets the timing; the music sits under it and ducks under each line.
- **The lead in a piece cut to music.** The music sets the timing, and the picture is cut to its beat in `storyboard.ts`.
  Choose this track before the motion pass.

## Getting a track

**Import** (`studio music add`) when the brand has its own music or the user has licensed a track; the licence is
theirs to settle. **Generate** with Lyria (`studio music gen`) when there's none or the video needs only a mood.
Either way it lands in the project's `music/`, listed in `music/index.ts`, which every run rewrites. Flags, prices
and the key it needs: `studio music <verb> --help`.

Write a Lyria prompt for the role, naming mood, tempo, instruments and structure:

- **A bed:** open with "Instrumental only, no vocals", since vocals fight the narration. Ask for a gentle intro and
  outro and an even middle with no drops or big builds: a bed that builds competes with the voice. About 90–110 BPM
  for a calm walkthrough, faster for a launch. A 30 s clip is enough; `fit` repeats its bars to any length.
- **The lead:** structure is the point. Ask in bars for the builds, drops and hits the cut will land on ("an 8-bar
  riser that drops to near silence for one bar, then a big hit into the drop"), and use `--full`: a clip has no room
  for a shape.

There's no seed, so a near miss can't be nudged: change the prompt. **Try two or three** under their own names
(`--name=bed-a`, `--name=bed-b`), fit each, and post them as a decision (studio-review) for the user to hear in
context. A bed is heard under the real voice: for each, point `video.tsx` at its fit, run `studio mix <p>` and copy
`out/mix.wav` to `out/decisions/music-bed/<name>.wav`, leaving `video.tsx` on the one in use. A lead is heard against
the cut: `studio render <p> --animatic --out out/decisions/music-lead/<name>.mp4` carries the fitted track as it
stands. Beds can be made and chosen while picture notes are still open; fit again once the length settles.

Check the tempo `add` or `gen` prints against the user's sense of the track. The tracker reads 60–180 BPM and leans
toward 120, so a slow or fast track can read at half or double time, and Lyria drifts from the asked tempo (a 100 BPM
bed has come back reading 133).

## A bed

Once the picture is locked, `studio music fit <p> --name=<track>` cuts the track to exactly the video's length, so
the track's own ending finishes the video, and adds it as `music['<track>-fit']` beside the original. A generated
track always goes through it. Point `video.tsx` at the fit: `bed: { track: music['bed-a-fit'] }`, and pass `music`
beside it too when the storyboard's grid is `{ music: '<track>' }`.

Read what `fit` prints:

- **The seams.** Give the user the file and the seam times to listen at. A clip fitted to a long video repeats one
  stretch many times, so offer a `--full` track if the seams show.
- **The downbeat guess.** A steady four-on-the-floor can fool it; ask the user which beat is beat 1.
- **Each cut against its nearest downbeat** (a report; nothing moves). Under narration the voice leads: land only a
  cut that matters (a section card, a reveal after a pause, the end card), by nudging the scene's `tail` or the next
  one's `lead` by a fraction of a beat, within the read. Then fit again and re-read the report, since a new length
  shifts every downbeat. The rest of the cuts stay where the voice puts them.

Fit again after any retime or re-voice: a fit that no longer matches the video's length fades out like any track.
Adding or generating a track under a name drops the fits cut from its old audio.

Unfitted, the track plays from `sourceStartSeconds` (fading in over 1 s when that's partway in), and a video that
outlasts it loops back with a hard splice that breaks the beat. Setting `sourceStartSeconds` to a beat's time puts
that beat on the video's first frame.

## The lead

The picture is cut to the music, so the beat lives in `storyboard.ts`. The timing model (grids, bars, cues,
landmarks, the picture lead) is in `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/timing.md`. The music's side:

1. **Draft on a tempo.** Until there's a track, `grid: { tempo: bpm }` drives the bars and the render
   clicks each beat. Done when the cut reads on the clicks.
2. **Cut the track to the bars.** `studio music fit <p> --name=<track> --bars=<list>` plays the source's bars in the
   order given (bar 1 on its first downbeat), so the music's builds, drops and hits fall where the scenes need them.
   The bars' beats add up to the beat scenes'. Done when the seams it prints pass the user's ear.
3. **Switch the grid.** `grid: { music: '<track>-fit' }` in `storyboard.ts` (with `steady: true` for a track made
   to a click, as generated and electronic music is), and in `video.tsx` hand `defineVideo` music/index.ts's `music`
   and a `bed` on the same fit. Done when `studio clock <p>` resolves, the final-hit landmark included: it fails
   wherever the storyboard and the music disagree.
4. **Lift the level.** With no voice to duck under, raise `bedRelativeLu` toward 0 (`mix.md`).

A retime that changes a beat scene's length fails the landmark check at load: refit with a new `--bars` list, or
change the bars back.

## Cutting to it

From editing practice:

- Put major cuts on **downbeats**; cutting on every beat reads as a slideshow.
- Under a voice, change scenes every **4 or 8 bars**. The high-energy register is the exception: one idea a bar,
  cut on each downbeat (video-motion).
- A motion's **peak** (a push-in landing, a ring fully drawn, a card settling) lands on **beat 1** of a bar.
- A reveal lands harder **after a short dip** in the music: cut it in just as the music comes back from a break.
