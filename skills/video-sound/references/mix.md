# The mix

## What's automatic

All of this already happens, so don't redo it with your own gain, `loudnorm` or compressor:

- **Voice.** Every line is levelled to −20 LUFS (`VOICE_LUFS`, `lib/studio/mix.ts`). A line quieter than that throws,
  since the composition can only attenuate. Re-read it rather than boosting it.
- **Music.** Levels are set in LU relative to the voice, so a quiet track and a hot one sit the same under the same
  words. Between lines the bed sits at `bedRelativeLu` (default −8); under a line it ducks to `duckedRelativeLu`
  (default −18). The duck starts 0.25 s before a line, so the first word lands clear, and releases over 0.5 s after it.
  Gaps too short to come back up in stay ducked. With no voice lines, nothing ducks.
- **Effects** play at their own `volume`, neither levelled nor ducked (`sfx.md`).
- **Mastering.** `studio mix` and `studio render` render the soundtrack, then apply one gain to reach −14 LUFS and a
  true-peak limiter at −2 dBTP (`lib/render-pipeline.ts`). Encoding to AAC adds a little overshoot, and the extra 1 dB
  of headroom keeps the delivered file under the −1 dBTP ceiling. `studio render` then measures the delivered video
  and fails if it isn't −14 ± 1 LUFS or peaks over −1 dBTP.

Because mastering lifts the whole mix to −14 LUFS, the absolute levels before it don't matter. Only the balance
between voice, music and effects does.

With no voice, the music is still set against −20 LUFS, so the bed sits at −28 by default and mastering lifts
everything about 14 dB. Effects set by ear then come out loud against the music. When the music is the lead, raise
`bedRelativeLu` toward 0, as far as the track's own loudness allows.

## Changing a level

Change a level only when it sounds wrong, and only the one the note names:

| Note | Change |
|---|---|
| "Music's too loud under the words" | Lower `duckedRelativeLu`, e.g. −18 → −22 |
| "Music's too loud (or too quiet) in the gaps" | `bedRelativeLu`, a few LU at a time |
| "The click is too loud" | That effect's `volume` |
| `the music measures … LUFS, too quiet for a bed at …` | The track is quieter than the bed level. Lower `bedRelativeLu` until it fits, or ask for a louder master of the track |

Then run `studio mix <p>`. It prints the loudness before and after mastering and writes `out/mix.wav` for the user
to hear.
