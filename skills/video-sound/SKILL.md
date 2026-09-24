---
name: video-sound
description: Sound for a video as its own pass once the picture is locked, in three parts: music (a bed under the voice, or the track a voiceless teaser is cut to), sound effects, and the mix. Use when adding or changing a video's music or sound effects, or for notes on sound ("the music's too loud", "add a whoosh on the reveal").
---

# Sound

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it.

Sound is a pass of its own, after the motion pass (`video-motion`) has locked the picture. Beats and effects are
placed against cuts and moves, so every re-voice or re-timed scene moves them too. The exception is a voiceless teaser:
there the music comes first and the picture is cut to it, so choose the track before the motion pass.

Pick the part the task needs and read its reference:

| Part | For | Read |
|---|---|---|
| **music** | Adding a track with `studio music`, using it as a bed or as the lead, and cutting to its beat | `references/music.md` |
| **sfx** | What already makes a sound, when an `<Sfx>` earns its place, and where sounds come from | `references/sfx.md` |
| **mix** | What's levelled and mastered automatically, and the few levels worth changing | `references/mix.md` |

A note like "the music drowns the voice" is a mix note, not a music note. Read `mix.md` before you change any level.

## Hearing it

You can't listen to the result, so the user's ears are the check. `studio mix <p>` renders just the mastered
soundtrack to `out/mix.wav`, much faster than a full render. Hand the user that path (or `studio preview <p>`) and say
what to listen for: the first word after a duck, an effect on a reveal, a cut on a downbeat. `docs/directing.md` §8
covers the craft side of sound in brief.
