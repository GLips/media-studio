---
name: video-sound
description: Sound for a video: music (a bed under the voice, or the lead a music-cut piece is planned on, before its motion), sound effects, and the mix. Use when adding or changing a video's music or effects, or for notes on sound ("the music's too loud", "add a whoosh on the reveal").
---

# Sound

The studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read and Edit, and
for a file you hand `studio music add`.

Sound follows the motion pass (video-motion): beats and effects sit against cuts and moves, so a re-voice or retime
moves them too. A piece cut to music is the exception: its track is chosen before the motion pass, and the picture
is cut to it.

Read the reference for the part the task needs:

| Part | For | Read |
|---|---|---|
| **music** | Choosing a bed or a lead, importing or generating it, fitting it to the video, cutting to its beat | `${CLAUDE_PLUGIN_ROOT}/skills/video-sound/references/music.md` |
| **sfx** | The drafted cue list, placing a sound by hand, sounds on a music-led video's beat, when an accent earns its place | `${CLAUDE_PLUGIN_ROOT}/skills/video-sound/references/sfx.md` |
| **sound design** | Making a project's own sound, and turning a note on how one sounds into a parameter | `${CLAUDE_PLUGIN_ROOT}/skills/video-sound/references/sound-design.md` |
| **mix** | What's levelled and mastered automatically, and the few levels worth changing | `${CLAUDE_PLUGIN_ROOT}/skills/video-sound/references/mix.md` |

"The music drowns the voice" is a mix note: read `mix.md` before changing any level.

## Hearing it

You can't listen, so the user's ears are the check. `studio mix <p>` renders just the mastered soundtrack to
`out/mix.wav`, far faster than a full render. Hand the user that path (or `studio preview <p>`) and say what to
listen for: the first word after a duck, an effect on a reveal, a cut on a downbeat. Put the mix up for review, and
post competing beds or mixes as a decision (studio-review); a note aimed at one sound names it in the timeline's sound
lane.

Done when the user has heard the mix and every note on it is resolved.
