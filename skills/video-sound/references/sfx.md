# Sound effects

## What already sounds

Don't add these by hand; they'd play twice:

- **Cursor clicks.** `CursorPath` plays `SFX.click` at every key with `{ click: true }`.
- **Takes.** `TakeCursor` plays the take's logged clicks, and `SFX.key` on every typed key.

## Where sounds come from

Every sound is synthesized from a seeded recipe in `lib/sfx/` (after Farnell's *Designing Sound*): `whoosh`, `riser`,
`impact`, `chime`, `ding`, `pop`, `click`, `key`, `toggle`, `typing`, `scroll`, and `bed` (a quiet ambient loop).
Nothing to license, and a rerun writes identical files. `studio sfx list` prints every recipe's presets and parameters.

1. **The kit**, already rendered: `SFX.click`, `key`, `toggleOn`, `toggleOff`, `pop`, `whoosh`, `whip`, `riser`,
   `impact`, `chime`, `success`, `ding` (`lib/studio/sfx/kit.ts`). Reach for these first.
2. **A project's own**, when the kit's take doesn't fit the moment (a longer whoosh, a softer chime, a bed):

   ```sh
   studio sfx render whoosh.soft --seed reveal --set duration=1.2,brightness=0.3 --out projects/<p>/sfx/reveal.wav
   ```

   - `whoosh.soft` is a recipe and one of its presets, and `--set` overrides its parameters.
   - `--mutate 0.2` varies every parameter a little, repeatably from `--seed`. Seed with the id of the event the sound
     marks.
   - It writes `reveal.wav` and a `reveal.ts` beside it. Import the `.ts`, and pass its default export as `sound`.

   Presets are starting points. A note on how a sound sounds maps to a parameter, so rerender with `--set` rather
   than reaching for `volume`. `studio sfx list` gives each recipe's parameters and ranges; the usual mappings are:

   | Note | Parameter |
   |---|---|
   | "Cut off", "stops dead" | Raise `decay` (for a chime, also `shimmer`). A riser ending sharply is by design: it lands on its end |
   | "Hollow", "boxy" (a click or key) | Raise `brightness` for more snap, lower `decay` for less body ring |
   | "Harsh", "thin" | Lower `brightness`, or lower `pitch` |
   | "Too long", "too slow" | Shorten `duration`, or lower `decay` |

   If a parameter at the end of its range still doesn't fix the note, the recipe itself needs work: tell the user
   rather than stacking a filter on top.

To hear the options, `studio sfx showcase` renders every preset and a few variants into `scratch/sfx-showcase/`, with an
`index.html` to play them from. Hand the user that path.

## Playing one

`<Sfx sound at t id until volume rate>` (`lib/studio/sfx.tsx`, exported from `lib/studio/api.ts`) plays `sound` so that it
**lands** on `at`, in scene seconds:

- **Where it lands.** Each sound knows where its event is: a click starts on `at`, a whoosh passes on it, and a riser
  ends on it. So `at` is the event itself, not when the sound starts. Anchor it to a word or to the camera key it
  belongs to, never to a raw number.
- **Takes.** The kit's sounds that repeat have several seeded takes. `id` picks one, the same every render, so give
  each event its own `id` (its index, or its name).
- **Beds.** `until` loops the sound from `at` to `until`: a `bed` joins end to start without a seam.
- **Mounting.** It sounds only while it's mounted. An effect in a branch the scene has left stays quiet, just as the
  picture does.
- **Levels.** Every sound is levelled when rendered, by category, relative to the voice: clicks, keys and pops sit
  17 LU under it, accents 8 LU under, the bed 18 LU under. So `volume` defaults to 1, and it only attenuates. Change it
  by ear, per `mix.md`.

```tsx
import reveal from './sfx/reveal.ts';

<Sfx sound={SFX.riser} at={s.line('reveal').start} t={s.t} />
<Sfx sound={reveal} at={camKeyT} t={s.t} />
```

A sound stops when its scene stops painting, at the end of the crossfade into the next scene. An accent that has to
ring across a cut belongs to the scene after it. A riser starting before its scene's first frame is trimmed at its
start.

## When to add one

An accent (a whoosh, hit or ding) needs a reason you can name.

- **At most one every 3–5 s**, and only on a scene change, a reveal or a big camera move.
- **Never on every cut.** When every cut has one, none of them stand out.
- **Never under a spoken word**, except in a gap between words or lines. Check against `s.line(id).word(…)`. A riser
  is the exception: it can build under the end of a line into the reveal.
- The picture leads the sound: land a whoosh on the move's peak speed, and a hit on the frame the thing arrives.

These are working rules, not published standards; tune them by ear with the user.
