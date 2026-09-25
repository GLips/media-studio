# Sound effects

Start from a draft: `studio sfx draft <p>` places a sound on every event the video already knows exactly, and you
edit the draft rather than placing each sound by hand (see **Drafting a cue list**). Place an `<Sfx>` by hand only for
a moment the draft can't find.

## What already sounds

Don't add these by hand; they'd play twice:

- **Cursor clicks.** `CursorPath` plays `SFX.click` at every key with `{ click: true }`.
- **Takes.** `TakeCursor` plays the take's logged clicks, and `SFX.key` on every typed key.

Once a video plays a cue list, the list plays these instead, and every `<Sfx>` stays silent.

## Drafting a cue list

```sh
studio sfx draft <p> [--click-style soft|mechanical|pop|tick]
```

It runs a full `studio check` to find the events, drafts a cue for each into `projects/<p>/sfx/cues.json`, and renders
the cues that sound into `sfx/cues.ts`. It prints one line per cue: its time, its event, and its sound or why it's
silent. The events are:

| Event | From | Draft |
|---|---|---|
| `click` | every `<Sfx>` playing a click | The click style's sound. A click within 150 ms of the one before stays silent |
| `key` | every `<Sfx>` playing a key | `key` |
| `placed` | any other `<Sfx>` a scene placed | The sound the scene placed |
| `scene` | each cut or dissolve | `whoosh.soft` on a dissolve, `impact.soft` on a cut, landing on the change |
| `camera-move` | the motion tracks; big if it travels a push of about 1.3× or a quarter frame, quickly | A whoosh as long as the move, passing on its fastest frame |
| `reveal` | a highlight, dialog, card or free-standing text arriving | `riser.short`, peaking as it arrives |

Accents (the last three) follow the rules in **When to add one**, so most are drafted silent. Scene changes come first,
then big moves, then reveals, and within each the ones with the longest pause in the voice around them.

**Hear it** before the video plays it: `studio mix <p> --sfx-draft` writes `out/mix-sfx-draft.wav` beside the video's
own `out/mix.wav`. Hand the user both.

**Edit** `cues.json`, then run `studio sfx cues <p>` to render it. Each cue has its `event`, the `draft`'s sound (or
`null` and `why`), and `alternatives`. Change a cue with the fields at its top level, which a redraft keeps:

- `"sound"`: copy in an alternative, or any `{ "sound": "recipe.preset", "seed": …, "set": {…} }`. Use `null` to
  silence it.
- `"nudge"`: seconds after (negative: before) the event to land.
- `"volume"`: 0–1.

`studio sfx cues` and `studio check` say which of your edits break a rule. That's allowed: the rules are defaults.
Just make sure each one is a choice.

**Use it** by importing the rendered list into the video:

```tsx
import sfx from './sfx/cues.ts';

export default defineVideo({ title, voice, music, sfx, scenes: [...] });
```

**After a re-voice or retime**, `studio check` fails on every cue whose event moved. Run `studio sfx draft <p>` again:
it re-measures, keeps your edits for events that still exist, and names any it had to drop.

## Where sounds come from

Every sound is synthesized from a seeded recipe in `lib/sfx/` (after Farnell's *Designing Sound*): `whoosh`, `riser`,
`impact`, `chime`, `ding`, `pop`, `click`, `key`, `toggle`, `typing` and `scroll`, each in a small room (`room`).
Nothing to license, and a rerun writes identical files. `studio sfx list` prints every recipe's presets and parameters.

1. **The kit**, already rendered: `SFX.click`, `key`, `toggleOn`, `toggleOff`, `pop`, `whoosh`, `whip`, `riser`,
   `impact`, `chime`, `success`, `ding` (`lib/studio/sfx/kit.ts`). Reach for these first.
2. **A project's own**, when the kit's take doesn't fit the moment (a longer whoosh, a softer chime):

   ```sh
   studio sfx render whoosh.soft --seed reveal --set recede=0.9,brightness=0.3 --out projects/<p>/sfx/reveal.wav
   ```

   - `whoosh.soft` is a recipe and one of its presets, and `--set` overrides its parameters.
   - `--mutate 0.2` varies every parameter a little, repeatably from `--seed`. Seed with the id of the event the sound
     marks.
   - It writes `reveal.wav` and a `reveal.ts` beside it. Import the `.ts`, and pass its default export as `sound`.

   Presets are starting points. A note on how a sound sounds maps to a parameter, so rerender with `--set` rather
   than reaching for `volume`. `studio sfx list` gives each recipe's parameters and ranges; the usual mappings are:

   | Note | Parameter |
   |---|---|
   | "Cut off", "stops dead", "dry" | Raise `decay`, or `room` (for a chime, also `shimmer`). For a whoosh, raise `recede`; for a riser, `tail`; `riser.cut` stops dead on its peak by design |
   | "Hollow", "boxy" (a click or key) | Raise `brightness` for more snap; for a click, also lower `decay` for less body ring |
   | "Harsh", "thin" | Lower `brightness`, or lower `pitch` |
   | "Too long", "too slow" | Shorten `duration` (a whoosh's `approach` or `recede`), or lower `decay` |

   If a parameter at the end of its range still doesn't fix the note, the recipe itself needs work: tell the user
   rather than stacking a filter on top.

To hear the options, `studio sfx showcase` renders every preset and a few variants into `scratch/sfx-showcase/`, with an
`index.html` to play them from. Hand the user that path.

## Playing one

For a moment the draft can't find, `<Sfx sound at t id volume>` (`lib/studio/sfx.tsx`, exported from
`lib/studio/api.ts`) plays `sound` so that it **lands** on `at`, in scene seconds. Once the video plays a cue list,
redraft after adding one: it becomes a `placed` cue, since the `<Sfx>` itself stays silent.

- **Where it lands.** Each sound knows where its event is: a click starts on `at`, a whoosh passes on it, and a riser
  peaks on it. So `at` is the event itself, not when the sound starts. Anchor it to a word or to the camera key it
  belongs to, never to a raw number.
- **Takes.** The kit's sounds that repeat have several seeded takes. `id` picks one, the same every render, so give
  each event its own `id` (its index, or its name).
- **Mounting.** It sounds only while it's mounted. An effect in a branch the scene has left stays quiet, just as the
  picture does.
- **Levels.** Every sound is levelled when rendered, by category, relative to the voice: clicks, keys and pops sit
  17 LU under it, and accents 8 LU under. So `volume` defaults to 1, and it only attenuates. Change it
  by ear, per `mix.md`.

```tsx
import reveal from './sfx/reveal.ts';

<Sfx sound={SFX.riser} at={s.line('reveal').start} t={s.t} />
<Sfx sound={reveal} at={camKeyT} t={s.t} />
```

A sound stops when its scene stops painting, at the end of the crossfade into the next scene. An accent that has to
ring across a cut belongs to the scene after it. A riser starting before its scene's first frame is trimmed at its
start. A cue list's cues play over the whole video, so none of this applies to them.

## When to add one

An accent (a whoosh, hit or ding) needs a reason you can name. The draft follows these rules, and `studio check`
reports an edit that breaks one:

- **At most one every 3–5 s**, and only on a scene change, a reveal or a big camera move.
- **Never on every cut.** When every cut has one, none of them stand out.
- **Never under a spoken word**, except in a gap between words or lines. Check against `s.line(id).word(…)`. A riser
  is the exception: it can build under the end of a line into the reveal.
- The picture leads the sound: land a whoosh on the move's peak speed, and a hit on the frame the thing arrives.
- A whoosh on a camera move lasts as long as the move, and a riser peaks on its reveal.
- A click within 150 ms of the one before stays silent.

These are working rules, not published standards; tune them by ear with the user.
