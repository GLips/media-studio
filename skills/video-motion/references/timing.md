# Timing: the timeline, cues and beats

A project states its schedule once, in `timeline.ts`. Start from the one `studio new <slug> --capability <kind>` writes
for its kind, the worked example of its drivers and cues (music-led: three 4-beat bars on `tempoGrid(120)` with the
final-hit landmark): it already passes the retime test. `studio api <name>` prints any
function below with the line importing it. `studio clock <p>` prints what it resolves to, every scene, cue and beat as a frame.

## Scenes and their drivers

`defineTimeline({ scenes, … })` lists the scenes in order, each with one driver that sets its length:

- `voiceSpan(lines, { lead, gap, tail, min })`: as long as its recorded lines. Their words are its cues
  (`{ line: 'fix-a', phrase: 'showing only' }`, `nth` for a later one), so a re-recorded line re-times the scene and
  everything anchored to it.
- `beatSpan(beats, { cues, moves, cutIn })`: beats on the timeline's `grid`, from a fitted track (`recordedGrid`) or a
  bare tempo (`tempoGrid(bpm)`) for a piece cut to a beat nobody hears. `cutIn` is for a scene whose picture takes over
  after its first beat.
- `fixedSpan(seconds)`: authored time, for a stretch cut to neither.

The beat scenes form one unbroken musical section: a voice or fixed scene between two of them is refused. A cut is
hard unless the later scene's span names a `crossfade` in seconds, centred on the cut.

## Cues, moves and clocks

Each scene counts its own time from 0 and names the moments others need as **cues**: a beat, `'end'`, a word, or
another cue plus `frames`. Another scene's moment is reached by its cue name (`clock.cue('ink.strike2')`), never by an
import or an absolute time; a finale's replays of earlier scenes are declared in the timeline and handed in.

`video.tsx` binds every scene with `bindTimeline`, handing each its resolved clock, in frames from its own beat 0:
`clock.beat(n)` reaches every beat of the scene, its end (`beat(beats)`) included, and off-beats are fractions
(`beat(1.5)` is the "and"); `clock.cues` and `clock.moves` are its own. Its type is
`TimelineSceneClock<typeof timeline, '<id>'>`. Any scene, whatever its driver, turns its clock into a scene with
`blockingScene` while blocked and `sceneForTimelineClock` once built; `sceneCueSeconds(clock)` gives its cues in
`s.t`'s seconds.

A **move** that must keep its length is declared in the span's `moves`: a start plus a duration anchored at one end
(`{ from: { at: 'end', frames: -3.75 }, to: { at: 'end', frames: -1 } }`), never pinned between two scenes' moments.
The project's `timeline.test.ts` runs the retime runner: it lengthens each scene in turn and fails if anything
before it moves or anything after it moves by other than what was added, which is how a pinned move shows.

## Music: the final hit and the lead

- **The final hit is a landmark.** A recorded grid needs a `landmarks` entry with `downbeat: -1` on the last beat
  scene's `'end'` cue. A bar table that no longer ends on the music's last hit is refused, naming the fixes: refit the
  track (`studio music fit --bars`, which plays the source's bars in the order the picture needs) or change the
  timeline.
- **Picture leads sound.** A beat tracker hears a hit late, and a picture cut exactly on the sound reads late too.
  `pictureLeadFrames` (default 0) moves every beat's frame earlier; a high-energy cut usually wants 1–2 at 30 fps.
  `soundLagSeconds` states the matching delay for sounds: add `timeline.soundLagSeconds` to the `at` of each sound
  you place on a picture event (`defineVideo({ sounds })`), so a slam lands with the music's hit instead of flamming
  ahead of it. Set both once, for the project, and confirm them with `studio mix --check`.

## The frame

`defineVideo({ format })` picks the size, 1920×1080 by default (`{ width: 1080, height: 1920 }` for a vertical cut);
the frame rate is the timeline's `fps`, 30 by default. A scene reads both with `useVideoFormat()` and hands them to
what needs them (`camFit(shot, rect, frame)`). `{ transparent: true }` paints nothing behind the scenes, so a piece
that would paint a backdrop checks `useVideoFormat()` first.
