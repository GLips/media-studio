# Music

## Adding a track

Decide the music's role first (below), then import or generate:

- **Import** when the brand has its own music or the user has licensed a track. Its licence is theirs to settle.
- **Generate** with Lyria when there's no track or the video only needs a generic mood.

```
studio music add <p> path/to/track.mp3             # music.bed
studio music add <p> path/to/other.wav --name=lead  # music.lead
studio music gen <p> "<prompt>"                     # music.bed, a 30 s Lyria clip, $0.04
studio music gen <p> "<prompt>" --name=lead --full  # a full-length track (about a minute), $0.08
```

Either way, the track is copied into `projects/<p>/music/`. Its loudness, tempo and beats are measured
(`lib/engine/music/music-track.ts`, `lib/models/music/music-beats.ts`), and `music/index.ts` is rewritten. That file says `Edits here are lost
on the next run`. Then:

```tsx
import { music } from './music/index.ts';

export default defineVideo({ title, voice, scenes, music: { track: music.bed, sourceStartSeconds: 12.4 } });
```

A video has one music track. It plays from `sourceStartSeconds` into the track (default 0), fades in over the first
1 s if that's partway into it (from the track's own start it opens as written, so a reel's first hit lands), fades out
over the last 2.5 s, and ducks under every voice line on its own (`mix.md`). If the video outlasts the
rest of the track, it loops back to `sourceStartSeconds` with a hard splice and no crossfade, which breaks the beat.
Fit the track instead (below), or choose one that runs longer than `sourceStartSeconds` plus the video.

`studio music add` prints the tempo it found. The tracker only looks between 60 and 180 BPM and leans toward 120, so a very
slow or fast track can read at half or double time. Check the number against the user's sense of the track before
cutting to it.

## Generating one

`gen` needs `OPENROUTER_API_KEY` (`"$(studio home)/bin/studio-secrets" studio music gen …`). The result is
cached in `generated/` by prompt and model (a clip and a `--full` track of one prompt are different tracks), so the
same prompt costs nothing and always gives the same track, whatever `--name` it's under.
There's no seed either, so you can't nudge a result you almost like. Change the prompt and try again instead.
`music/index.ts` records each generated track's `model` and `prompt`. Lyria is in preview, so a change in its output
can be traced to the model id.

Write the prompt for the role. Give it the mood, tempo, instruments and structure:

- **A bed:** start with "Instrumental only, no vocals", since vocals fight the narration. Ask for a gentle intro and
  outro with an even middle and no drops or big builds, because a bed that builds competes with the voice. Use about
  90–110 BPM for a calm walkthrough and faster for a launch. A 30 s clip is enough, since `fit` repeats its bars to
  any length.
- **The lead:** structure is the point. Ask, in bars, for the builds, drops and hits the edit will cut to, e.g. "an
  8-bar riser that drops to near silence for one bar, then a big hit into the drop". Use `--full` whenever the
  music has to change shape, such as a build to a reveal. A 30 s clip has no room for that.

Lyria doesn't always keep to the asked tempo. Read the BPM `gen` prints (a 100 BPM bed has come back reading 133).

**Try two or three, then choose.** Each costs cents. Give each a different prompt and its own name
(`--name=bed-a`, `--name=bed-b`), fit each, and judge each in context: a bed under the actual voice in
`studio preview`, a lead against the cut. Point the video at the one you keep. Its generation stays cached.

Don't send Lyria a frame of the video as a reference. Nobody has tested whether it helps.

## Fitting it to the video

Once the picture is locked, `studio music fit <p>` cuts a track to exactly the video's length so its own ending, not
a fade, finishes the video. A generated track always goes through it, since Lyria's lengths aren't frame-exact and a
clip is only 30 s. Fitting a clip to a long video repeats one stretch of it many times, so have the user listen at
the seams, or generate with `--full`:

```
studio music fit <p>                          # music.bed → music['bed-fit'], the video's length
studio music fit <p> --name=lead --as=lead-60 --seconds=60   # any length, to audition; skips the report
```

It keeps the intro, drops or repeats whole bars by jumping between downbeats whose bars sound alike, and keeps the
outro (`lib/models/music/music-fit.ts`). Less than a bar left over comes off the head, or goes before it as silence. The original
stays, so point the video at the fit (`music: { track: music['bed-fit'] }`, no `sourceStartSeconds`) and rerun `fit`
after any retime. Adding or generating a track under a name drops the fits cut from its old audio, so fit again
after that too. A fitted track that no longer matches the video's length fades out like any other.

It prints:

- **The seams**, in the fitted track's seconds, and how alike the worst one's sides are (dB per band; bars a beat
  apart in a track typically differ by about 5). Give the user the file and the seam times to listen at.
- **A downbeat guess**, from bass hits and chord changes. A steady four-on-the-floor can fool it; ask the user.
- **Each cut and `expect` against the nearest downbeat**: a report only, nothing moves. To land one, nudge a `tail`
  or the next `lead` by the offset, within the voice's read (below), then fit again, since the length changed. A new
  length can shift every downbeat, so read the report again rather than trusting the old offsets.

Then run `studio check <p>`. Change a level only if something sounds wrong: the mixer already ducks under the
voice (only where there is one) and sets loudness.

`music/index.ts` records each fit's `spans` of the source, its `seams` and `downbeats`; the same track and length
always give the same fit.

## Its role

Decide which role the music plays before cutting anything:

- **A bed under the narration.** The voice sets the timing; the music sits underneath and ducks under each line. Cut
  to its beat only where the voice leaves room: a section card, a reveal after a pause, the end card.
- **The lead in a piece cut to music.** The picture is cut to the music: pass `voice: {}` to `defineVideo`, and
  each scene's `beatSpan` in `timeline.ts` sets its length in beats (the `video-motion` skill, Timing). With nothing to
  duck under, raise `bedRelativeLu` toward 0 (`mix.md`).

## The beat

Each track in `music/index.ts` carries `bpm` and `beats`: every beat's time **in the track**, in seconds. To use one:

- **Video time** = beat − `sourceStartSeconds`, before any loop (see above).
- The tracker follows the drift in tempo, so `beats` isn't a fixed grid. Measure lengths as differences between
  entries of `beats`, not as multiples of `60 / bpm`, which drift off the beat over a few bars.
- **Scene time** = video time − the scene's `start`. `studio check <p>` prints each scene's start and writes it to
  `out/check/timeline.json`.
- **A bar** is 4 beats, taking the track as 4/4. The tracker finds beats, not downbeats, so it doesn't know which beat
  is beat 1. Take the first strong beat as beat 1 of bar 1, then ask the user to confirm it by ear.
- `sourceStartSeconds` is the cheapest lever. Setting it to a beat's time puts that beat on the video's first frame,
  and every later beat shifts with it. Choose it so the cut that matters most lands on a beat.
- Beat times you copy into a scene are plain numbers, so a re-voice or a changed `lead`, `gap`, `tail` or `min` puts
  them off the beat. Recompute them from `timeline.json` after any retime.

A cut is a scene's `start`. Scenes crossfade by default, over 0.5 s centred on the cut, which blurs a beat. Give a cut
that lands on the beat `cut: true`.

## Cutting to it

These rules come from editing practice ([Toolfarm, editing to the beat](https://www.toolfarm.com/tutorial/edit-to-the-beat/)):

- Put major cuts on **downbeats**, not on every beat. Cutting on every beat reads as a slideshow.
- Change scenes every **4 or 8 bars**: 16 or 32 entries along `beats`. In a voiceless teaser, each scene's `min` is
  the time from its first beat to the next scene's.
- A motion's **peak** (a push in's landing, a ring fully drawn, a card settling) lands on **beat 1** of a bar.
- A reveal lands harder **after a short dip in the music**: a break or drop in the track. Choose `sourceStartSeconds`
  so the reveal's cut arrives just as the music comes back.

Under narration, the voice still leads: never stretch a scene past its read just to reach a beat. Nudge its `tail` or
the next scene's `lead` by a fraction of a beat instead, or leave that cut off the beat.
