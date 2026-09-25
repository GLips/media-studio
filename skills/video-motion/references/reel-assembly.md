# Assembling a reel from its pieces

A reel, in this file's sense, is any music-led marketing video in the high-energy register (an ad, a launch teaser, a
social cut, a product promo, a showreel, or the open and close of a walkthrough): a run of bars, each one device (a
bounce, a slam of words, a field, a ticker) doing one thing to the beat, built from the pieces in `lib/studio/reel/`
(see `reel-pieces.md`) and cut together on the music. This is the shared brief for building one bar of it, whether
you're building the whole video or one of several builders.

Read first: `showreel-breakdown.md` (the system section, then the reference section your bar answers), the project's
`storyboard.md` (the beat sheet: what each bar does on which frame) and the doc comments of the pieces you'll use.

## The clock

A reel project keeps its clock in one module (`timeline.ts`): the fitted track, its `BeatGrid`, and `hitFrame(n)`,
the frame beat `n` hits on. Hits are two frames ahead of `grid.frame(n)`: the tracker hears a hit about 20 ms late,
and the picture should lead the sound by about a frame. Everything lands on `hitFrame`: cuts, arrivals, impacts,
section labels. Off-beats are fractions (`hitFrame(9.5)` is the "and").

- A cut or an instant change goes on the hit frame itself.
- A move that has to *arrive* on a beat starts early (40–190 ms, 1–6 frames): an expo arrival does most of its travel
  in its first frames, so start it one or two frames before the hit, or the eye reads it late.
- A fall or a swing that *peaks* on the beat is physics, closed-form in time, solved backwards from the landing.

## A bar

A bar is a module exporting a `Bar` (`id`, `note`, `from`, `to`, `render(f)`, `hudTone`): `render` takes the
**video's** frame, so a bar can finish what the last one started and the finale can replay any bar live in a cell.
Draw only through the bar's pure function of `f`: no state, no randomness but seeded.

- **Always moving.** Nothing holds still longer than about half a beat: a held word breathes, drifts or re-lights; a
  held field punches on the beats. The camera moves at most once per bar, on a phrase.
- **Full-bleed colour and big type.** A ground is a colour, not a tint. Display type is the image (a quarter of the
  frame height and up), set tight.
- **Figure and ground trade places** from word to word and bar to bar, so every cut is a change of value you feel.
- **Colour runs in an order.** The storyboard's colour script says what each colour means and when the ground
  changes; a ground that changes for no reason reads as random, however good each frame is.
- **Every beat carries a strong frame.** No near-black or empty frame before the final fade: a dark ground always
  holds a big figure. A product shot is the hero: push in until it fills the frame, never a small card in a field.
- **Transitions are built, not dissolved:** a hard cut on the hit, a zoom through a shape into its colour, a match on
  position or shape, a speed-matched whip. A dissolve is the exception.
- **One dominant move at a time.** Secondary moves follow it by a frame or two.
- **The HUD** sits over every bar; tell it the tone of the ground under each of its parts through `hudTone`.

## Proving it

Preview your bar alone: a scratch project (`scratch/<reel>-<bar>/video.tsx`) whose default export is the project's
`barPreview(bar, index)` renders just your bar, inside the same HUD and grade, with its frame 0 on the bar's first
frame. Several builders editing bars at once can't break each other's renders that way.

1. `studio look scratch/<reel>-<bar> --strip=0:<seconds> --step=0.0333` renders every frame of your bar. Look at the hits: does
   each arrival land on its hit frame, how hard does it snap, what does it smear, is anything still for more than
   half a beat?
2. Put your strip beside the reference section's (`study-claude/NN-*/strip.jpg`, beside the reference video) and fix
   what differs in timing, scale, snap, smear and colour. The reference is the bar to clear, not a script to copy.
3. `studio look <project> --sheet=…` at your bar's hit frames: each should be a frame worth pausing on.
4. `npx tsc --noEmit -p .` shows no errors in your files.
5. When the whole reel is assembled: render it and run `studio study` on the render. Its cuts should land on the
   beat grid, and its motion-energy plot should never sit at zero. Then give it to a critic who didn't build it, with
   `reel-critique.md` as the brief.

## Fences

- Write only your bar's module. Read anything.
- Don't edit the pieces (`lib/studio/reel/`), the clock module, `video.tsx` or other bars. If a piece lacks something
  your bar needs, work around it in your bar and name the gap in your report, so the orchestrator can fix the piece.
- No paid calls, no `git add`, no commits.

## The report

End with: what the bar does beat by beat (frame numbers), the frames you checked (paths) and what you compared them
against, and every piece gap or workaround.
