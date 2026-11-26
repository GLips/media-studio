# A video cut from a recording

When the voice is the speaker's own, from a library recording, every line is a stretch of it, named by item id.

## Find the stretches

`studio library search "<words>"` finds where something is said; `studio library show <item>` prints the transcript
with times and the speaker's flags. A line keeps the words whose middles fall between its times, and each edge moves
into a pause. To cut inside an utterance, give a word's time from `show --json`.

## Name the item once

A shared module (`shared: ['recording.ts']` in `project.ts`), loaded by the storyboard in plain Node, so it imports
`libraryFootage` from its model, not `#studio`:

```ts
// recording.ts
import { libraryFootage } from '#lib/footage/library/models/library-footage.ts';
import item from '#library/<id>/item.json' with { type: 'json' };
import transcript from '#library/<id>/transcript.json' with { type: 'json' };

export const recording = libraryFootage(item, transcript);
```

## The plan

A line is `{ speech: recording.speech(from, to) }`: timed by its stretch, worded by the transcript, its sound the
recording's levelled speech; a call's far side is `{ track: 'system' }` in the third argument. `text` cleans up the
captions. A line not yet levelled is flagged: `studio library finish <item>`. An edge with no quiet before the next
word cuts into sound and is flagged: ask for a stretch ending at a pause, or mark the line `hardEdge: true`.

## What a line leaves out

A line drops uh/um/er, stutters, false starts and retakes, turns breaths down and takes clicks out, each cut in
quiet. A long pause is cut short in its quiet: a hesitation shorter than a sentence's end.

Review's voice lane marks each: ✂ taken out, ◌ left in, a dotted underline under speech the transcript has no
words for. A click writes the line's choice into storyboard.ts. `speech`'s third argument takes `keep: [s]` (restore
what was cut at item second `s`), `cut: [s]`, its own `pauses` (`LibraryPausePacing` values, or `false`) and `rules`;
`libraryFootage`'s third argument sets the project's. `[...SPOKEN_CLEANUP_RULES, mine]` adds a `SpokenDisfluencyRule`; `[]` takes nothing out.

## The scenes

Each component's props: `studio api <name>`.

- `recording.timeAt(s)` is the item second a scene shows: a screen plays on across a line's cuts.
- `recording.heardAt(s)` jumps with them, keeping a face on its words.
- `<LibraryVideo footage={recording} track="camera" at={…} />` fills its box with that track.
- `<PictureInPicture main={screen} inset={face} k={…} />`: the face full frame at `k` 0, a circle in the corner at 1.
- To follow the cursor: `useLibraryInputLog(recording)`, `recording.cursorOn('screen', log)`, `followPointAt(path,
  at, { seconds })`, and `<ZoomOnPoint picture focus zoom>` around the screen.
- To keep tabs or a side panel out of frame: `<ZoomOnPoint>` on a fixed `focus` and `zoom`.
- Where the screen already shows the words being said (a call's live transcript), list those lines in
  `defineVideo`'s `captions.shownInPicture`: the burned-in captions leave them out, the .srt and .vtt keep them.

A render needs the library's media online (`studio library config`).
