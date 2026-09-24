# Music

## Adding a track

The studio doesn't find or generate music: the user supplies the track, and its licence is theirs to settle. Add it:

```
studio music <p> path/to/track.mp3            # music.bed
studio music <p> path/to/other.wav --name=lead # music.lead
```

That copies the file into `projects/<p>/music/`, measures its loudness, tempo and beats (`lib/music-track.ts`,
`lib/music-beats.ts`) and rewrites `music/index.ts`, which says `Edits here are lost on the next run`. Then:

```tsx
import { music } from './music/index.ts';

export default defineVideo({ title, voice, scenes, music: { track: music.bed, sourceStartSeconds: 12.4 } });
```

A video has one music track. It plays from `sourceStartSeconds` into the track (default 0), fades in over the first
1 s and out over the last 2.5 s, and ducks under every voice line on its own (`mix.md`). If the video outlasts the
rest of the track, it loops back to `sourceStartSeconds` with a hard splice and no crossfade, which breaks the beat.
Choose a track that runs longer than `sourceStartSeconds` plus the video.

`studio music` prints the tempo it found. The tracker only looks between 60 and 180 BPM and leans toward 120, so a very
slow or fast track can read at half or double time. Check the number against the user's sense of the track before
cutting to it.

## Its role

Decide which role the music plays before cutting anything:

- **A bed under the narration.** The voice sets the timing; the music sits underneath and ducks under each line. Cut
  to its beat only where the voice leaves room: a section card, a reveal after a pause, the end card.
- **The lead in a voiceless teaser.** The picture is cut to the music. Pass `voice: {}` to `defineVideo`. With no
  `lines`, a scene lasts `max(lead + tail, min)` (1.1 s by default), so `min` sets its length, a whole number of bars.
  With nothing to duck under, raise `bedRelativeLu` toward 0 (`mix.md`).

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
