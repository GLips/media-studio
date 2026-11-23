# A video cut from a recording

When the voice is the speaker's own, from a recording in the footage library, every line is a stretch of it. The
media stays in the library; the project names the item by its id.

## Find the stretches

`studio library search "<words>"` finds where something is said; `studio library show <item>` prints the transcript
with times. A line's stretch is two item seconds, `from` and `to`: put each edge in the quiet just past the words.
The speaker flags takes they like in the studio app's library (G L); `show` prints the flags.

## Name the item once

A shared module (listed in `project.ts`'s `shared`), loaded by the storyboard in plain Node, so it imports
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
recording's levelled speech. Add `text` to clean up the captions; its words are timed from the transcript, as a read
line's are from its clip. The storyboard needs no `voice` unless some lines are read too. A line not yet levelled is
flagged: `studio library finish <item>`.

## The scenes

- `recording.timeAt(s)` is the item second a scene shows now, on the words being said through every cut.
- `<LibraryVideo footage={recording} track="camera" at={…} />` fills its box with a track at that second.
- `<PictureInPicture main={screen} inset={face} k={…} />`: the face full frame at `k` 0, a circle in the corner at
  1. When it switches, and how, is each scene's call.
- To follow the cursor: `useLibraryInputLog(recording)`, `recording.cursorOn('screen', log)`, `followPointAt(path,
  at, { seconds })`, and `<ZoomOnPoint picture focus zoom>` around the screen's `LibraryVideo`.

A render needs the library's media online; `studio library config` says where it is.
