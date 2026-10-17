# Timing: the storyboard, cues and beats

A project states its schedule once, in its plan, `storyboard.ts`. Start from the one `studio new <slug> --capability
<kind>` writes for its kind, the worked example of its drivers and cues (music-led: bars on `{ tempo: 120 }` with the
final-hit landmark). `studio api defineStoryboard` prints the shape, every field documented. `studio clock <p>` prints
what it resolves to, every scene, cue and beat as a frame, and fails naming each problem.

## Scenes and their drivers

`scenes` lists the scenes in order, each with one driver that sets its length:

- `lines`: a voiced scene, as long as its lines take to read, by the recorded take once `studio voice` has read them
  and by word count until then. A line's words are its cues, written on the line
  (`cues: { shutter: 'photo' }`, `{ phrase, nth }` for a later one), so a reworded or re-recorded line re-times the
  scene and everything anchored to it.
- `beats`: beats on the storyboard's `grid`, a fitted track (`{ music: '<track>-fit' }`) or a bare tempo
  (`{ tempo: bpm }`) for a piece cut to a beat nobody hears. Its cues are in beats; a mixed project puts lines on
  them (`at`).
- `seconds`: authored time, for a stretch cut to neither.

The beat scenes form one unbroken musical section: a voiced or fixed scene between two of them is refused. A scene's
`timing` holds what isn't the plan's: a voiced scene's `lead`, `gap`, `tail` and `min`, a bar's `cutIn` (its picture
takes over after its first beat), a `crossfade` in seconds centred on the cut in (hard by default), and `nudge`, the
frames a word cue moves off its word. Left out, the defaults hold.

## Cues, moves and clocks

Each scene counts its own time from 0 and names the moments others need as **cues**: a word, a beat (or seconds),
`'end'`, or `{ after }` another cue plus `frames`. Another scene's moment is reached by its cue name
(`clock.cue('ink.strike2')`), never by an import or an absolute time; a finale's replays of earlier scenes are the
storyboard's `replays`, handed in.

`video.tsx` gives `defineVideo` the storyboard and a binding per scene, and each binding gets its scene's clock, in
frames from its own beat 0: `clock.beat(n)` reaches every beat of the scene, its end (`beat(beats)`) included, and
off-beats are fractions (`beat(1.5)` is the "and"); `clock.cues` and `clock.moves` are its own. Its type is
`StoryboardSceneClock<typeof storyboard, '<id>'>`. Any scene, whatever its driver, turns its clock into a scene with
`blockingScene` while blocked (its note is the row's) and `sceneForTimelineClock` once built; `sceneCueSeconds(clock)`
gives its cues in `s.t`'s seconds.

A **move** that must keep its length is declared in the scene's `moves`: a start plus a duration anchored at one end
(`{ from: { at: 'end', frames: -3.75 }, to: { at: 'end', frames: -1 } }`), never pinned between two scenes' moments.
The workspace's retime check lengthens each scene of every storyboard in turn and fails if anything before it moves or
anything after it moves by other than what was added, which is how a pinned move shows.

## Music: the final hit and the lead

- **The final hit is a landmark.** A recorded grid needs a `landmarks` entry with `downbeat: -1` on the last beat
  scene's `'end'` cue. A bar table that no longer ends on the music's last hit is refused, naming the fixes: refit the
  track (`studio music fit --bars`, which plays the source's bars in the order the picture needs) or change the
  bars.
- **Picture leads sound.** A beat tracker hears a hit late, and a picture cut exactly on the sound reads late too.
  The storyboard's `pictureLeadFrames` (default 0) moves every beat's frame earlier; a high-energy cut usually wants
  1–2 at 30 fps. Its `soundLagSeconds` states the matching delay for sounds: add it to the `at` of each sound you place
  on a picture event (`defineVideo({ sounds })`), so a slam lands with the music's hit instead of flamming ahead of
  it. Set both once, for the project, and confirm them with `studio mix --check`.

## The frame

`defineVideo({ format })` picks the size, 1920×1080 by default (`{ width: 1080, height: 1920 }` for a vertical cut);
the frame rate is the storyboard's `fps`, 30 by default. A scene reads both with `useVideoFormat()` and hands them to
what needs them (`camFit(shot, rect, frame)`). `{ transparent: true }` paints nothing behind the scenes, so a piece
that would paint a backdrop checks `useVideoFormat()` first.
