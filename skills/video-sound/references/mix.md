# The mix

## What's automatic

Levels are loudness, set relative to the voice, and mastering sets the delivered loudness. So only the balance between
voice, music and effects is yours; leave gain, `loudnorm` and compressors out of it.

- **Voice.** Every line is levelled to −20 LUFS. A line quieter than that throws rather than being boosted (Remotion
  clips each source at full scale, and a voice peaks close to it): re-read it.
- **Music** sits at `bedRelativeLu` (default −8 LU) between lines and ducks to `duckedRelativeLu` (default −18)
  under each, starting 0.25 s before the line so the first word lands clear and releasing over 0.5 s after. Gaps too
  short to come back up in stay ducked. With no voice, nothing ducks, and a default bed sits level with the accents.
- **Effects** are levelled by category when `studio sfx` renders them (clicks 17 LU under the voice, accents 8 LU
  under), then play at their `volume`, unducked.
- **Mastering.** One gain lifts the mix to −14 LUFS and a true-peak limiter catches the peaks; when the AAC encode
  still overshoots −1 dBTP, the limiter's ceiling comes down and it masters again. `studio render` then fails a
  delivered file outside −14 ± 1 LUFS or over −1 dBTP, and any mix that renders silent. A video meant to have no
  sound declares `capability: 'silent'` in `project.ts` and delivers with no audio track.

## Changing a level

Change a level only when it sounds wrong, and only the one the note names:

| Note | Change |
|---|---|
| "Music's too loud under the words" | Lower `duckedRelativeLu`, e.g. −18 → −22 |
| "Music's too loud (or too quiet) in the gaps" | `bedRelativeLu`, a few LU at a time |
| "The music should lead" (no voice) | Raise `bedRelativeLu` toward 0, as far as the track's loudness allows |
| "The click is too loud" | That effect's `volume` |
| `the music measures … LUFS, too quiet for a bed at …` | Lower `bedRelativeLu` until it fits, or ask for a louder master of the track |

Done when `studio mix <p>` has written `out/mix.wav` and the user has heard the change.
