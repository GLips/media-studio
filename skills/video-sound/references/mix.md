# The mix

## What's automatic

Levels are loudness, set relative to the voice, and mastering sets the delivered loudness. So only the balance between
voice, music and effects is yours; leave gain, `loudnorm` and compressors out of it.

- **Voice.** Every line is levelled to −20 LUFS. A line too quiet to reach it without clipping fails: re-read it,
  never boost it.
- **Music** sits at `bedRelativeLu` (default −8 LU) between lines and ducks to `duckedRelativeLu` (default −14)
  under each, clear of its first word. With no voice nothing ducks, and a default bed sits level with the accents.
- **Effects** are levelled by category (`ui` or `accent`) when `studio sfx` writes them, then play at their
  `volume`, unducked.
- **Mastering** lifts the mix to −14 LUFS under a true-peak limiter, and `studio render` fails a delivered file
  that misses it or renders silent. A video meant to have no sound declares `capability: 'silent'` in `project.ts`.

## Changing a level

Change a level only when it sounds wrong, and only the one the note names:

| Note | Change |
|---|---|
| "Music's too loud under the words" | Lower `duckedRelativeLu`, e.g. −14 → −18 |
| "The music dips too much under the voice" | Raise `duckedRelativeLu`, e.g. −14 → −12; past about −10 the words compete |
| "Music's too loud (or too quiet) in the gaps" | `bedRelativeLu`, a few LU at a time |
| "The music should lead" (no voice) | Raise `bedRelativeLu` toward 0, as far as the track's loudness allows |
| "The click is too loud" | That effect's `volume` |
| `the music measures … LUFS, too quiet for a bed at …` | Lower `bedRelativeLu` until it fits, or ask for a louder master of the track |

Done when `studio mix <p>` has written `out/mix.wav` and the user has heard the change.
