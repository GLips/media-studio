# Cut

Make one piece from the recordings. Work as a documentary editor does: log the footage, pick the angle, cut a **rough
cut** fast and put it in front of the person, then refine it from their notes. They react to a cut far better than to
a description of one, so the rough cut comes early and rough on purpose.

The mechanics (naming the item, spoken lines, layouts, zooms):
`${CLAUDE_PLUGIN_ROOT}/skills/producer/references/recorded-footage.md`.

## 1. Log

Skip what `ingest` logged already. Otherwise, for each recording: read its transcript whole (`studio library show
<item>`) and skim its picture (`studio library look <item> screen --every 15 --columns 2`, and `camera --every 60`).
Write the **log**: sections by idea, each with its item range, what's said, what's on screen and its takes. Mark what
the cut drops: **retakes** (the same words twice; keep the better), **asides and stumbles**, **dead air**, and
**private data on screen** (client or customer names, other people's names, inboxes, messages, keys, client URLs, in
the page and around it). Read any page too small to judge in one frame across (`--from <s> --to <s> --columns 1`).

Done when every minute is in a section or marked dropped, and every page shown has been read for private data.

## 2. Angle

Settle what the piece is before cutting it. Ask in the chat only what the material doesn't answer, each with your
guess: the kind of piece and platform (they set length and frame), who watches, the takeaway, and each private range's
answer (cut, zoom past, cover, or fine to show). Then propose **two or three stories**, really different ways to tell
it, each with its through-line, its opening word for word, its order of stretches by item range with the running
length, and what it leaves out. At least one departs from recorded order.

A clear favourite goes in the chat; a close call goes to the review UI as a decision (`studio review decide`, the
`studio-review` skill). Start the project (`studio new <slug> --capability voice-led`) and write the brief from the
answers: kind and platform in its angle, length as `target`, the private ranges in its rules.

Done when a story is picked and every private range has its answer.

## 3. Rough cut

Fast, whole, and rough. Write the plan (`storyboard.ts`) from the picked story: a scene per section, each line a
stretch of the recording (the reference above), the best take of each point, every retake, stumble and dead air cut,
a short even `timing` gap for the pauses dropped. Give each scene the simplest picture the craft allows: a fixed slice
of the screen that fills the frame, the face in a corner circle. No zoom moves, cards or polish yet.

Render it (`studio render <p>`), check every line is heard whole (`studio transcribe` on `out/video.mp4`, compared
with the plan's lines) and that no uncleared private range shows, then hand it over for review (`studio-review`),
saying it's rough, what it left out, and which pickups or recaptures would improve it.

Done when the rough cut is open for review.

## 4. Refine

Work the notes in the review UI, and any in the chat, round by round, as `studio-review`'s loop runs them: this session
watches, and a subagent takes each note, side by side when none waits on another. Each round, also judge the cut against the craft
yourself and fix what falls short: the picture follows what the words are about, the frame is filled, a newcomer can
tell what they're looking at. Moves, cards, labels and cursor zooms come in here, written as `video-motion` writes
them. A pickup the person records, or a recapture they approve, is logged and cut in like any recording; the cut
never waits for one.

Done when the person signs it off. Then `video-sound` adds any music.
