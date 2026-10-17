---
name: studio-review
description: Review of any plan, video, still or mix with the reviewer in the studio app. Use when handing work over for approval, when the user has left notes, or when the user should choose between options.
---

# Review

The studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read and Edit.

The reviewer works in the studio app; you work the other half from the CLI. Every note, reply, question and pick lands
in the project's `review/review.json` and shows on both sides within a second. Each verb's mechanics are in
`studio review <verb> --help`; this skill is when to use them and how to judge what comes back. Paths the CLI prints
are from the studio root (a scene's source is from the project): Read them under `$(studio home)`.

## When to hand over

Open a review at every gate where the next step costs more than a redo of this one: the plan, the animatic, a
blockout before generating footage, style frames and stills, generated footage, the mix, the cut before delivery.
Send it once the work passes its own checks, so the reviewer spends their eyes on taste. When the user has handed
over the creative calls ("surprise me"), make them yourself and review only the result.

Done when `studio review open <p>` (or a render or still in it) has the page open, the user has its address, and the
watcher below is running.

## The loop

1. **Watch.** Run `studio review watch <p>` as a background command (in Claude Code, `run_in_background`), one
   watcher a project: its exit wakes you. It prints what the reviewer changed; act on it, then run it again. Its
   cursor means nothing is missed or repeated. `studio review notes <p>` lists what's open at any time.
2. **Read each note whole.** Read its frame image: the reviewer's marks say what terse words leave out. Its moment,
   scene, sounds and tagged elements tell you where (a reviewer's "scene 3" is the third in `studio clock <p>`); its
   `look:` line shows the frames around it. `keep` notes are standing constraints, not work.
3. **Talk on any note, any time.** A plain `reply` leaves the note's state alone: answer a question, say your plan,
   check which reading they meant. Their answers wake `watch`. `reply --question` is for when you're blocked: the
   note then waits on them. Raise something nobody noted with `studio review ask`.
4. **Fix, then hand the fix back.** One fix per note, held to every `keep`. Then reply `--addressed` with a commit and
   the render that shows it:
   - A fix inside one scene: the note's `fix:` line, a `render --scene` slice, which the page lays into the cut over
     that scene. A `won't splice` names why, and the fix is usually a full render.
   - Everything else gets a full render (`--animatic` before the cut is built, else the delivery): a length change,
     sound, a shared component, several scenes, a transparent video, the hand-over. It retires every slice.
   Write the reply by the moment ("the ring now lands on *faster*"), not the frame number: notes follow their moment
   to each new render. A second thought is another `--addressed` reply with the newer render.
5. **Leave resolving to the reviewer.** They resolve or reopen once they've seen the fix; a reopened note comes back
   through `watch` like a new one.

Done when `studio review notes <p>` lists nothing open or reopened that you haven't addressed, answered or asked
about, every addressed note names what shows it, and the reviewer has said it's approved or resolved every note.
Approval is explicit: their word, a resolve, or a sign-off.

## The plan

The scene table or beat sheet is reviewed before anything renders, on its own page, `/projects/<p>/plan`. It reads
`storyboard.ts` live, so a saved edit re-times it at once: the brief, a timing bar (each line timed by its read, or
its word count until voiced; cues on their words; long silences and holds flagged), then a row per scene.

- The reviewer notes a brief section, a scene's cell, a line or words in it, or a left-out item. A note quotes what
  it's on, so it follows the words through your edits and is unplaced once they've gone. `watch` wakes on them;
  `studio review notes <p> --on plan` lists them. A fix is an edit to `storyboard.ts`, replied `--addressed` with
  its commit and no render.
- The reviewer signs off scene by scene. A sign-off holds the scene's row and its own timing, not where it starts,
  so an edit unsigns only the scene it touches: say which scenes changed. Done when every scene is signed off.

## Decisions

Post a decision when the choice is the reviewer's taste and the options really differ: music beds, voices, takes,
models, still variants, headlines (`text:` candidates). When one option is clearly better, pick it yourself and say
why.

- **Cull first.** Two to four candidates, each one you'd ship, differing along the axis the question names. Render
  each to `out/decisions/<topic>/`, identical but for that axis: a bed is heard in its mix, a lead against the cut
  (`${CLAUDE_PLUGIN_ROOT}/skills/video-sound/references/music.md`).
- **Ask one question**, the axis in words ("Which bed under the VO?"). `--many` when they may keep several. For
  generated candidates, carry the model, seed and cost as meta (`--spec`), so the pick can be made again.
- **Act on the sign-off.** `watch` wakes on each pick or reject and on the sign-off. Comments on a candidate are notes
  (`notes --on decision`): a rejected one's often says what the next round needs. Re-posting the open topic swaps
  its candidates and keeps verdicts on the unchanged ones, for another round on the same question.

Done when `studio review decisions <p> --open` lists none, and the picks are in the work.
