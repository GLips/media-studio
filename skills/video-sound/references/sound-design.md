# Sound design

Every sound is synthesized from a seeded recipe (after Farnell's *Designing Sound*): nothing to license, and a rerun
writes identical files. `studio sfx list` prints every recipe, its presets and its parameters with their ranges.

1. **The kit first.** `SFX.click`, `SFX.whoosh`, `SFX.riser`, `SFX.impact` and the rest (from `#studio`) are already
   rendered, with several takes of the ones that repeat.
2. **A project's own**, when the kit's take doesn't fit the moment (a longer whoosh, a softer chime). From the studio
   root, since `--out` resolves against the working directory:

   ```sh
   studio sfx render whoosh.soft --seed reveal --set recede=0.9,brightness=0.3 --out work/projects/<p>/sfx/reveal.wav
   ```

   Seed it with the id of the event it marks. It writes the `.wav` and a `.ts` beside it: import the `.ts` and pass
   its default export as `sound`, or put it in a cue's `"sound"`. `--category accent` levels a sound whose job is
   bigger than its recipe's (a pop marking a music-led video's colour flood) as an accent; `ui` goes the other way.
   After a recipe changes, `studio sfx rerender <dir>` rebuilds every sound there from the request its `.ts` records.
3. **Audition.** `studio sfx showcase` renders every preset and a few variants with an `index.html` to play them
   from: hand the user that path when they'd rather pick by ear.

## Notes to parameters

Presets are starting points. A note on how a sound sounds maps to a parameter, so rerender with `--set` before
reaching for `volume`:

| Note | Parameter |
|---|---|
| "Cut off", "stops dead", "dry" | Raise `decay` or `room` (a chime: also `shimmer`; a whoosh: `recede`; a riser: `tail`). `riser.cut` stops dead on its peak by design |
| "Hollow", "boxy" (a click or key) | Raise `brightness` for snap; a click: also lower `decay` for less ring |
| "Weak", "no bass", "floaty" (an impact or buzz) | Raise `weight`; an impact: also lower `room`. A last hit the picture holds on can ring: raise a buzz's `boom` |
| "Harsh", "thin" | Lower `brightness` or `pitch` |
| "Too long", "too slow" | Shorten `duration` (a whoosh's `approach` or `recede`), or lower `decay` |

Done when the user hears the note fixed. A parameter at the end of its range that still misses the note means the
recipe itself needs work: tell the user, and leave the recipe's sound unfiltered.
