# Footage first

The speaker has recorded themselves talking through something, off the cuff, with rough takes. You are their
**producer and editor**: the producer learns what the piece is for, proposes ways to tell it and asks for the
**pickups** that would make it stronger; the editor cuts the chosen story from the best takes. Work as a documentary
editor does: log the footage, build a **paper edit** from the transcript, cut the **radio edit** (sound first), then
lay picture over it. The ladder's rungs, from the material: intake and story options are the treatment, the paper
edit is the scene table, and the first cut, blocked on the real voice, is the animatic.

The mechanics of a project spoken from a recording (naming the item, spoken lines, layouts, cursor zooms):
`${CLAUDE_PLUGIN_ROOT}/skills/video-kickoff/references/recorded-footage.md`.

## 1. Log the footage

Find the recordings: `studio library list`, `studio library recordings --inbox` for takes not yet added, `studio
library search` by what's said. For each one:

- Read its transcript whole: `studio library show <item>`. Each line is one utterance, at its item time.
- Skim its picture: `studio library look <item> screen --every 15 --columns 2`, and the camera's every minute.

Write the **log**: the recording divided into sections by idea, each with its item range, what's said in a line, what's
on screen, and its takes. Mark what the cut drops:

- **Retakes**: a phrase said again, often after "another take" or a false start. Each utterance is its own line, so a
  retake shows as the same words twice. Keep the better delivery; note both.
- **Asides and stumbles**: "let me say that again", "hang on", "what was I going to say", a tangent the speaker
  abandons, muttering, a clipped ending.
- **Dead air**: silence while they click about or think.
- **Private data on screen**: client and customer names, other people's names, inboxes, messages, keys, URLs of
  client work, in the page and in what's around it (tabs, bookmarks, side panels). Where the skim shows a page that
  could hold some but is too small to read, read one frame of it across (`--from <s> --to <s> --columns 1`), and log
  each range with what shows and where on screen.

Done when every minute of every recording is in a section or marked dropped, and every page the screen shows has been
read for private data.

## 2. Intake

Show the speaker the log, then ask only what the material doesn't answer, in the same message, with your guess for
each from what you heard:

- **The kind of piece**: a tutorial, a marketing piece, a short post that needs a hook in its first seconds, a
  walkthrough for the team, or whatever else fits.
- **Audience**: who watches, and what they already know.
- **The takeaway**: the one thing a viewer should leave with, when the recording doesn't make it plain.
- **Platform and length**: where it's posted sets the length and the frame.
- **The private data in the log**, range by range: cut it, zoom the screen past it when it sits at an edge (tabs, a
  side panel), cover it with the speaker's face full frame, or fine to show. Nothing goes to posting until each range
  has an answer.

Done when the purpose, kind, audience, platform, length and takeaway each fit one line, and every private range has
its answer.

## 3. Story options

Start the project (`studio new <slug> --capability voice-led`) and name each recording in it once (the reference
above). Then propose **two or
three structures**, really different ways to tell it, each built from the log's sections:

- **Through-line**: the one sentence the piece argues.
- **Opening**: its first seconds, word for word from the recording, or a pickup when nothing recorded opens it well.
  A short post opens on the problem.
- **Order**: the sections, by name and item range, with the running length. Reorder freely: recorded order is the
  order the speaker thought of things, rarely the order a viewer needs them. At least one option departs from it.
- **Left out**: the sections it drops, and why.
- **Pickups it needs**, if any (step 4).

Post them as one decision with a `text:` candidate each (`studio review decide <p> story --question "Which way do we
tell it?" --candidate "text:…"`, the `studio-review` skill), and say them in the chat too. The speaker picks one or
combines them. Done when they have.

## 4. Pickups

Name the short, specific things the speaker could record to make the chosen story work: a sentence bridging two
thoughts that were recorded apart, a hook that states the problem, the missing step a tutorial skips, a clean read of a
point they stumbled through every time. For each: what to say (a draft they put in their own words), where it goes,
why, on camera or voice only, and what the cut does without it.

Write them under a `Pickups` heading in the storyboard's `brief`, where the plan page shows them beside the story to
edit and comment on, and tell the speaker. A pickup, once recorded, is a recording like any other: log it and cut it
in. The cut never waits for one; until it's recorded, the cut does what the pickup's line says it does without it.

Done when every join in the chosen order that jumps a thought, and an opening that doesn't hook, has a pickup or a
reason it needs none.

## 5. The cut

The story pick is the plan's gate: cut straight through, and the plan goes to review with the cut.

**Radio edit first.** Rewrite the plan from the chosen story (the skill's **The plan**): a scene per section, each line
a stretch of the recording whose edges land in silence (the reference above). Then:

- Take the best take of each point. A genuinely close call between two takes is a decision with
  `library:<item>@<from>-<to>` candidates; a clear one is yours.
- Cut every retake, aside, stumble and dead air in the log: a line splits around what it drops.
- A short even `timing` gap stands in for the pauses cut; `text` cleans the captions.

**Then picture**, by **layout**:

- Open on the speaker's face, full frame: the viewer meets a person before a screen.
- When they show something on screen, the screen fills the frame with their face in a corner circle, switching as
  they start showing it. Zoom on the cursor when what they point at is too small to read.
- Close on their face again.
- A private range stays as its answer says: zoomed past, or on the face full frame.

Render the delivery (`studio render <p>`) and check it yourself:

- Every line is heard whole: run `studio transcribe` on the render and compare it with the plan's lines; a missing
  first or last word is a clipped cut.
- Every layout switch lands where the speaker starts or stops showing something (`studio look <p> --video
  out/video.mp4 --strip a:b`).
- No private range shows that the speaker didn't clear.

Hand it over for review (`studio-review`), saying what the cut left out and which pickups would improve it. Done
when it's open for review with every check above passing.
