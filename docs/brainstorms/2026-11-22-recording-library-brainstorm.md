---
date: 2026-11-22
topic: recording-library
---

# Recordings and the Library

## What We're Building

A way for Graham to share his projects as they happen, without scripting or scheduling a demo. When something is worth talking through, he hits one key and talks: screen, camera and mic each record as their own file, alongside a log of keystrokes and clicks. He does as many rough takes as he likes, says "bad take, let me say that again" out loud when he stumbles, and stops. Every recording lands in the studio's library, transcribed with word timing.

Later, in the studio, an agent turns those recordings into a video: it finds the right moments across the library, picks the best take of each point, cuts the stumbles, and chooses layouts (his face full-screen, then the screen with his face in a corner circle). It writes an ordinary storyboard that he reviews and steers with notes. The videos are a mix: building-in-public posts, marketing pieces, and later, longer demos cut from many recordings. Early on, all of it is interactive; reusable recipes per format come once patterns settle.

## Requirements

- **R1 (must): One-key recording.** A single key or button starts and stops a recording of screen, camera (A6400 through an Elgato capture card) and mic, each as its own file, plus a keystroke and click log. · works when one press gives separate, usable files with nothing to set up first.
- **R2 (must): Files stay in sync.** Tracks line up over a long recording; the capture card's fixed camera delay is measured once and corrected on import. · works when a 20-minute clap test shows no drift.
- **R3 (must): The library.** Every recording lands in one library with a word-timed transcript and a date, and any video can pull clips from it. The library holds any footage, not only recordings. · works when an agent can find "the part where I explained the inbox" across recordings.
- **R4 (must): The agent drafts the cut.** From a request, the agent picks the best takes, cuts stumbles (reading spoken asides like "let me redo that" from the transcript), chooses layouts and writes a normal storyboard that Graham reviews in the existing review screens. · works when a rough session becomes a reviewable draft without hand-trimming.
- **R5 (must): Swappable recorder.** The studio reads recordings through its own import step, which turns a recorder's output (files, start offsets, input log, folder layout) into one library format. Scenes read only that format. · works when switching recorders touches only the import step.
- **R6 (nice): Input log readable by scenes.** Click times and positions and keys are data a scene can read; the agent writes zooms or key overlays by hand with the studio's camera tools when a moment calls for it. Nothing is applied automatically.
- **R7 (nice): Browse and flag the library together.** Agent and Graham both flag ranges and recordings; either can step through the other's flags quickly.

## Scope

- **In:** the recorder choice and its import step, the library, transcription of library media, agent-drafted cuts reviewed in the studio, flagging ranges on any media, and redesign of existing review pieces where volume demands it.
- **Out:** format recipes (X, YouTube, demos) until patterns settle; Graham cutting by editing transcript text himself; automatic cleanup, for now (see Left open); auto-posting to social; A6400 shooting technique (its own session); a time-to-post target (efficiencies will emerge from use); marker hotkeys (spoken asides are enough, and he's out of hotkeys).

## Why This Approach

The heart is separating recording from editing: recording stays nearly free, and the agent does the shaping afterward on raw material. The studio already has most of the editing half, so this extends it rather than standing beside it. Recordings are a fourth way footage enters the studio, next to `lib/footage/capture`, `generation` and `previs`.

Most of what recordings need is general studio capability, built first for them:

- **Range notes and flags on any media.** Review notes already anchor to a frame range (`ReviewAnchor` `on: 'video'`, `frame`/`end`), but only on a project's own renders, and the library is shared across projects.
- **Choosing between takes.** Review decisions with candidates already do this, for voice reads and generated options.
- **Word-timed transcripts.** `lib/timing/voice` already has them (`whisper-words`) for voice takes; they should work on any audio or video.

What is specific to recordings is small: the recorder, the import step and library storage.

**Recorder:** Cap (cap.so, open source, mostly AGPL, about 3 years old, v0.6, 25k stars, one dominant author) is the leading candidate. Its Studio Mode writes separate `display.mp4`, `camera.mp4`, mic and system audio files, `cursor.json` with clicks, a keyboard track and per-source start times, and a CLI drives it. OBS needs the shaky Source Record plugin for separate files on Apple Silicon and has no input log. Screen Studio, which Graham already likes alongside Descript, exports raw files but keeps cursor data proprietary. A small native recorder built from Cap's MIT crates (`scap`, `cap-camera`) is the fallback.

## Key Decisions

- **Recording** is one hotkey press to the next; **library** is where recordings and other footage live; **take** stays the everyday word. (The capture feature and voice already use `Take` in code; recordings don't take that name.)
- One shared library, not footage per video: one recording can feed a short post now and a long demo later.
- Agent drafts, Graham steers with notes (option 1); cutting by editing the transcript can come later.
- No marker hotkey: Graham talks naturally and the editing agent reads intent from the transcript.
- The camera comes in live through the Elgato; camera audio isn't needed; the mic is the only audio.
- Effects from the input log are written per video by the agent, not applied automatically.
- **Redesign for volume, don't bolt on.** Review, decisions, notes and transcripts were built for short videos with a few choices; a 10-minute video cut from many recordings means dozens of choices. Plans and tickets give workers explicit room to rethink these as if this had been the requirement from day one. Example: one queue that steps through every open take choice in a video, with keyboard pick and next, instead of a separate decision per scene. The plan names the specific openings.

## Left open

- **Recorder choice.** Before planning, run a 20-minute Cap recording with a clap at each end, kill it once mid-recording, and look inside a `~/Screen Studio Projects` folder. Check sync drift, the capture card's delay, and whether a killed recording can be recovered.
- **The start/stop control:** a key or a menu-bar button.
- **Automatic cleanup.** Whether unused recordings should ever be deleted on their own is undecided. If they are, the rule covers Graham's own recordings only, never third-party or other footage in the library.
- **Storage.** Estimated 12–20 GB per hour of HEVC at 30fps; 438 GB is free now. If a drive is needed, get a 2 TB external SSD, not a spinning disk.
