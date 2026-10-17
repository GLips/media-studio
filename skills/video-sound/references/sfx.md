# Sound effects

Start from a **cue list**: `studio sfx draft <p>` measures every event the video already knows exactly (clicks, keys,
placed sounds, scene changes, camera moves, reveals) and drafts a cue for each into `sfx/cues.json`. Edit the draft;
place an `<Sfx>` by hand only for a moment it can't find.

## What already sounds

`CursorPath` clicks at every key with `{ click: true }`, and `TakeCursor` plays a take's clicks and typed keys. Leave
those to them. Once the video plays a cue list, the list plays them instead and their own `<Sfx>` go silent; an
`<Sfx>` a scene placed itself plays either way.

## The cue list

1. **Draft.** Accents follow the rules in **When to add one**, so most draft silent, each with its `why`. Scene
   changes rank first, then big moves, then reveals, and within each the longest pause in the voice around it.
2. **Hear it** before the video plays it: `studio mix <p> --sfx-cues`, and hand the user both mixes.
3. **Edit `cues.json`.** `clickStyle` sets every click. Change a cue with fields at its top level, which a redraft
   keeps: `"sound"` (copy in one of its `alternatives`, any `{ "sound": "recipe.preset", "seed", "set" }`, or `null`
   to silence it), `"nudge"` (seconds after the event, negative before) and `"volume"` (0–1). `studio check` names
   each edit that breaks a rule; the rules are defaults, so keep such an edit only as a choice. Restart an open
   `studio preview` to hear a hand edit.
4. **Play it** with `defineVideo({ ..., sfxCueList: true })`, and commit `cues.json` (the sounds it renders are
   generated). Done when the user has heard the mix with the list in it.

After a re-voice, a retime or a new click, `studio check` fails on every cue whose event moved or went and every event
without a cue. Run `studio sfx draft <p>` again: it re-measures and keeps your edits. Cue ids count a scene's clicks
(or moves, or reveals) in order, so where a count changed it drops that series' edits and names them: redo those.

To change how a sound sounds, or make a project's own, see `sound-design.md`.

## Placing one by hand

`<Sfx sound at t id volume>` (from `#studio`) plays `sound` so it **lands** on `at`, in scene seconds:

- **`at` is the event**, not the sound's start: a click starts there, a whoosh passes on it, a riser peaks on it, to
  the sample. Anchor it to a word (`s.line(id)`) or the camera key it belongs to, never a raw number.
- **`id`** picks one of a kit sound's seeded takes, the same every render: give each event its own.
- **It sounds only while mounted**, and stops when its scene stops painting. An accent that rings across a cut belongs
  to the scene after it; a riser starting before its scene's first frame loses its start.
- **`volume`** defaults to 1; over 1 boosts only as far as the sound's peak leaves room. Change it by ear (`mix.md`).

```tsx
import reveal from './sfx/reveal.ts';

<Sfx sound={SFX.riser} at={s.line('reveal').start} t={s.t} />
<Sfx sound={reveal} at={camKeyT} t={s.t} />
```

Redraft after adding one, so the list's accents keep clear of it.

## Sounds on the music's beat

A music-led video places its hits and whips on the video's clock instead:
`defineVideo({ sounds: [{ at, sound, id, volume }] })`, `at` in video seconds from the resolved storyboard's frames
(`storyboardTimeline(storyboard, { music })`: a cue's frame over `fps`, plus its `soundLagSeconds`). These ring on across cuts, and a scene replayed elsewhere doesn't
replay them.

`studio mix <p>` (or `--check`, which skips rendering the mix) prints each against the music; `studio mix --help`
says what the flags mean. The fixes:

- **FLAM**: move the sound by its gap. If every hit flams early by about the same amount, that's the picture's lead:
  set the storyboard's `soundLagSeconds` to it.
- **BURIED**: raise its `volume` if it's under 1, else lower `bedRelativeLu`.
- **OVER**: lower its `volume`, unless it's meant to ride on top.
- **An empty beat** is where a sound can speak for the picture alone: a slam there has no hit to flam with.

## When to add one

An accent (a whoosh, hit or ding) needs a reason you can name. The draft follows these rules and `studio check`
reports an edit that breaks one; they're working rules, so tune them by ear with the user:

- **At most one every 4 s**, and only on a scene change, a reveal or a big camera move.
- **Leave most cuts bare**: when every cut has one, none of them stand out.
- **Land in the gaps between words**, checked against `s.line(id).word(…)`. A riser may build under the end of a line
  into its reveal.
- **The picture leads the sound**: a whoosh on the move's peak speed lasting as long as the move or dissolve, a hit on
  the frame the thing arrives, a riser peaking on its reveal.
- A click within 150 ms of the one before stays silent.
