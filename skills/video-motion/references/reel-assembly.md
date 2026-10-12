# Building a bar of a reel

A reel here is any music-led video in the high-energy register (an ad, a teaser, a social cut, a promo, a showreel,
or the open and close of a walkthrough): a run of bars, each one device doing one thing to the beat, cut together on
the music. This is the brief for building and proving one bar, whether you build the whole reel or one bar of it.

Read first, from `${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/`: `reel-system.md` (the system, then the reference bar
yours answers), `reel-critique.md` (the rules every bar is judged by) and `timing.md` (beats, cues, the picture's
lead). Then the project's `storyboard.md` (what each bar does on which beat) and the docs of the pieces you'll use
(`studio api <name>`).

## On the beat

Everything lands on a hit frame: cuts, arrivals, impacts, section labels. A bar reaches only its own beats
(`clock.beat(n)`) and cues; another bar's moment is a cue in `timeline.ts`.

- A cut or an instant change goes on the hit frame itself.
- A move that has to *arrive* on a beat starts early, by 1–6 frames: an expo arrival does most of its travel in its
  first frames, so started on the hit it reads late. A spring starts its `arrival` early.
- A fall or a swing that *peaks* on the beat is physics, closed-form in time, solved backwards from the landing.

## The bar

A bar is a pure function of its own frame, 0 on its beat 0 (negative before it, for a bar that starts on a pickup),
like every scene. The finale may replay it live in a cell, and a replay plays silent, so:

- **Sounds the picture lands** (a strike, a whip, a stamp) are placed on the video, `defineVideo({ sounds })`, at
  the bar's beat plus `timeline.soundLagSeconds`, never as an `<Sfx>` inside the bar's render: a replay would drop
  it, and a cut would stop a whip that runs across it.
- **The HUD** sits over every bar and must read at its size on every frame. Have the bar say what it draws under each
  HUD part rather than guessing: `reelHudGrounds(box, groundAt)` samples the box into each ground's share, and
  `reelHudReadGrounds` picks the ink most of the box wants, plated where the other grounds or busy type show.

## Proving it

Preview the bar alone: a scratch project (`scratch/<reel>-<bar>/video.tsx`) whose default export is a video of just
this bar, with its place on the reel, inside the same HUD and grade, frame 0 on the bar's first frame. Builders
working in parallel then can't break each other's renders.

1. `studio look scratch/<reel>-<bar> --frames 0:<last>` renders every frame. At each hit: does the arrival land on
   its frame, how hard does it snap, what does it smear, is anything still for more than half a beat?
2. Put your strip beside the reference section's (`studio study <reference video>` writes one per section) and fix
   what differs in timing, scale, snap, smear and colour. The reference is the bar to clear, not a script to copy.
3. A capture on a `CapturePlane`: `--graph 0:<seconds> --tracks plane` plots its `upscale`, frame px per capture px
   where it's most magnified. Past about 1.3 the page's text goes soft: capture it again at a higher `scale`.
4. The project typechecks with no errors in your files.

Done when every hit frame is worth pausing on and the strip clears the reference.

When the whole reel is assembled, render it and run `studio study` on the render: its cuts should land on the beat
grid, and its motion energy never sit at zero. Then hand it to a critic who didn't build it, with
`${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-critique.md` as the brief. A reel worth several rounds of fixes earns a `tools/` folder of checks it reruns
after each (each sound against the music, each beat frame's luma, the HUD's legibility on every frame);
`studio look <project> --video <after.mp4> --against <before.mp4> --bar N` shows which frames a change moved.

## Building alongside others

- Write only your bar's module and your scratch project. Read anything.
- Leave the pieces, the timeline, `video.tsx` and other bars to the orchestrator: where a piece lacks something your
  bar needs, work around it in your bar and name the gap in your report.
- No paid calls, no `git add`, no commits.

End with: what the bar does beat by beat (frame numbers), the frames you checked (paths) and what you compared them
against, and every piece gap or workaround.
