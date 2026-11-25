---
name: video-kickoff
description: Kickoff for any video, from the first brief, context dump or raw recording to an animatic or first cut the user has signed off. Use when the user asks for a video from any repo, dumps context for one, points at recordings to make something from, wants story angles, or wants a storyboard or beat sheet.
argument-hint: [script|footage]
---

# Starting a video

The studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read and Edit. Every
video lives there, whatever repo the request came from; read the source material where it is. No `studio` on the
PATH, or no `work/`: the `studio-setup` skill comes first. `${CLAUDE_PLUGIN_ROOT}/skills/video-kickoff/references/project-anatomy.md`
lays out a project's files.

## The ladder

Plan in rungs of rising fidelity, each settling one question cheaply and needing the user's yes before the next spends
more on it.

| Rung | Settles |
|---|---|
| **Treatment** | the idea, the tone, the takeaway |
| **Scene table or beat sheet** | what happens, in order, and what's said; the track, when it's cut to music: `storyboard.ts`, on the plan page |
| **Style frames** | the look: two to four finished stills of key moments (the `stills` skill) |
| **Animatic** | pacing and movement: every scene blocked at its real timing, on the voice or the music (`video-gen` where a video model takes the motion) |
| **Polish, then sound** | the finish: `video-motion`, then `video-sound` |

**Choose the path at kickoff, and say which.** The full ladder suits a piece whose pacing or look is uncertain, or
whose later rungs are expensive (generated footage, a long reel). To try ideas fast, skip style frames. On every path
the animatic is signed off before anything gets a real voice or motion polish: a scene table is cheap to change, and
voiced, polished motion is not. On the `footage` path the voice is recorded already: the story pick is the plan's
gate, and the first cut is the animatic.

**An autonomous brief skips the gates** ("go all out", "surprise me"): make each gate's call yourself, write the
table as your plan, build through to a render, and show the result.

Each gate is a review, run by the `studio-review` skill; between gates, subagents build the rung's pieces side by side.

## The plan

Whichever way in, the plan is the project's `storyboard.ts`. Start the project with `studio new <slug> --capability
<…>`; its scenes start blocked, so `studio render <p> --animatic` shows the plan as it plays from the first
minute. Write `title`, a `target` only for a length the user or a platform sets, the `brief` (headings in order: who
it's for, the takeaway, the angle, the sources, the rules), then a row per scene:

- Scene and line ids are the names everything else uses. A cue sits on its word (`{ phrase, nth }` for a later one),
  so a reworded line changes one place; a cue whose word has gone is flagged on its scene. `paragraph: true` starts a
  new beat: the read pauses, and no caption runs across it.
- Every scene has an **event**: something changes between its first frame and its last. Its `reads` list what the
  viewer must understand, in order: the motion pass times from them.
- Plan the whole video: what's set up is paid off, and the ending rhymes with the opening where it can.
- Write each `motion` so it turns straight into code, in the camera vocabulary (`video-motion`).
- End with `leftOut`: true things the video skips, one line each with the reason. It keeps them from creeping back
  in.

Hand it over on the plan page (`studio-review`): it times the plan, flags long silences and holds, and takes the
reviewer's notes on any cell, line or word. Done when every scene is signed off.

## Two ways in

| Command | Starts from | File |
|---|---|---|
| `script` | a brief, a context dump, a draft: the words are yet to be written | [subcommands/script.md](subcommands/script.md) |
| `footage` | recordings in the footage library: the words are spoken already, and the story is found in them | [subcommands/footage.md](subcommands/footage.md) |

A command word picks its file. Without one, a request pointing at recordings, takes or footage ("make something from
this week's recordings") is `footage`, and any other is `script`. Load the file and follow it.
