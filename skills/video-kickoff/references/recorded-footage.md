# A video cut from a recording

When the voice is the speaker's own, from a library recording, every line is a stretch of it, named by item id.

## Find the stretches

`studio library search "<words>"` finds where something is said; `studio library show <item>` prints the transcript
with times and the speaker's flags (made in the studio app's library, G L). A line runs from its first utterance's
time to the next utterance's: it keeps the words whose middles fall between, and each edge moves into a pause. To cut inside an utterance, give
a word's time from `show --json`; words with no pause between are cut midway.

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
recording's levelled speech. `text` cleans up the captions, its words timed from the transcript. The storyboard
needs no `voice` unless some lines are read too. A line not yet levelled is flagged: `studio library finish <item>`.

## The scenes

Each component's props: `studio api <name>`.

- `recording.timeAt(s)` is the item second a scene shows now, on the words being said.
- `<LibraryVideo footage={recording} track="camera" at={…} />` fills its box with that track.
- `<PictureInPicture main={screen} inset={face} k={…} />`: the face full frame at `k` 0, a circle in the corner at 1.
- To follow the cursor: `useLibraryInputLog(recording)`, `recording.cursorOn('screen', log)`, `followPointAt(path,
  at, { seconds })`, and `<ZoomOnPoint picture focus zoom>` around the screen.
- To keep tabs or a side panel out of frame: `<ZoomOnPoint>` on a fixed `focus` and `zoom`.

A render needs the library's media online (`studio library config`).
