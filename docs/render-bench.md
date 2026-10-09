# Timing local renders

Every `studio render` appends one JSON line to `~/.cache/media-studio/render-history.jsonl`
(`STUDIO_RENDER_HISTORY` points it elsewhere). A line holds the arguments, the studio's and the workspace's commits and
whether each was dirty, whether the render delivered, the whole command's seconds with the GPU lease wait apart
(`gpuWaitSeconds`), the spans the command recorded in Node, and `trace`, the render's whole trace. The code is
`lib/output/render/engine/render-history.ts`.

The trace is Chrome trace JSON in `render-traces/` beside the history. Read it as text with

```sh
npm run trace -- latest                       # the newest render: time by span name, each chunk's startup step by step
npm run trace -- latest --against latest~1    # two renders side by side, biggest change first
```

or drop it on [ui.perfetto.dev](https://ui.perfetto.dev) to see it on a timeline. The newest 100 are kept (under 2 GB
between them); a history line outlives its trace. The model, the recorders and the writer are `lib/platform/trace/`;
the reader is `harness/trace.ts`.

A trace holds the Node command's spans and every render page's, on one clock. Each page sends its spans by the page-log
channel in batches, its top spans under the chunk (or pass) that opened its browser. A page traces always:

- its start: `navigation`, then `page scripts` up to the video's first render
- a painted shot's load (`laid out`, `compile`, `device`, `surfaces`, `placements`, `renderer`, `warm`; `placements`
  waits for and adopts the stamps the command's `placing paintings` placed once in Node, so a page compiles only
  what they lack), its `first draw` and each
  `shot frame` after, with what each counted (solves, cache hits and misses, readbacks, bytes uploaded)
- a span per solve (`solve <plane>`), under the warm or frame that ran it, with its counts and the GPU cache's
  evictions in it by producer (`evicted film`, `evicted checkpoint`…). Under it, its source's `evaluate`, then for each
  selection its `compile` (with `digest`, the ms spent hashing entries), `lays`, a rigged plane's `rest solve`, and
  `leased solve`, holding a span per sheet (`sheet <program>`) with its `keys`, `binding brushes` and `loading`, and as
  attributes its `known prefix`, `resumed from`, `entries run`, `checkpoint bytes` and `readback wait`
- a StampPainting's `stamp painting surface`, `stamp painting load` and frames

Node adds each chunk's `browser launch`, `GPU probe` and `composition select`.

`studio render --trace detail:a:b` (or `--trace detail`, every frame) traces those frames' solves in detail: under
each sheet, a span per entry (`entry <name>`, `decision` made or replayed) holding its parts (`deciding its landing`,
`deciding its wash start`, `reading when its wash sets`, `reading its damp windows`) and its GPU steps (`landing`,
`starting its wash`, `keeping a checkpoint`…, each with `encode` and `submit` ms), each readback a span over its
`reduction` step with its `readback wait`. A step's GPU time comes from timestamp queries on its passes, where the
adapter has them, noted on it once read back: `gpu` (first pass's start to last's end), `gpu busy` and `gpu passes`,
or `gpu: untimed` (a copy-only step, or the query pool spent). Chrome rounds timestamps to 100 µs. `npm run trace`
tables these by span name. A warm is detailed when the frame its shot loads in is. That's thousands of spans a solve:
give it a few frames.

Spans have a start, an end, a parent and a status (`ok`, `failed`, `cancelled`, or `incomplete` when the render died
first). A chunked pass (`video.mp4 frames`) has a span per attempt at a chunk, a failed one included, on its browser's
track (`browser 1`, `browser 2`: two draw at once, each a run of the frames). Each chunk holds:

- `startup`: the browser opening through the first frame
- `drawing`: first frame to last, with `msPerFrame`

Beside the chunks, under the pass:

- `packing frames a–b`: a chunk's encodes (H.264 for a video, and FFV1 when the render keeps it lossless) finishing
  after its last frame, while its browser's next chunk draws, on its browser's `packing` track, with a flow from the chunk that
  drew them. Frames stream into the encodes as they draw; the video's pieces are joined as they are after the last
- `waiting on packing`: the next chunk waiting for that packing to finish, recorded only when it waits

The table a render prints at its end sums a pass's chunks into one line.

## The solved-paint cache

A render keeps its paintings' sheet solves on disk, in `~/.cache/media-studio/paint-cache/`, and the next render of
anything painted alike reads them back rather than solving again: a repeat render, or one after an edit, starts warm
except for the paintings the edit touched. It holds each solve's decisions by state key and its films by film key,
under a namespace named by the code a solve runs (from `painting-sheets-solve.ts` and `painting-document-compile.ts`,
through every module they import), the lockfile and the styles' files. It's pruned to 8 GiB, least recently used
first. `lib/output/render/engine/render-paint-cache.ts` serves it to the pages; `stamp-sheet-disk.ts` is their side.

Nothing checks what it serves. If a render ever looks stale, delete the folder. To time a render cold, point
`STUDIO_PAINT_CACHE` at an empty folder: other renders on the machine fill the shared one. A solve's span in the trace
holds `reading the disk` and counts `films from disk`. What a solve gives the cache crosses to Node beside the frames
after it, and a page closes only once that has (`render-page-settle.ts`).

## The suite

Run it on a quiet M1 Max, one render at a time, with nothing else on the GPU (`studio gpu` shows the queue). Run each
command once, and again only when a result is ambiguous.

```sh
studio render 2026-10-ceramic-turntable    # 300 frames, music-led: a three.js mug with painted textures, a mix
studio render 2026-10-lake-dawn-to-dusk    # 420 frames, silent: one painted world, a slow page startup per chunk
```

The turntable's `music/` is ignored by the workspace's git. A checkout without it can't render the turntable.

To compare two runs, read their lines:

```sh
tail -n 2 ~/.cache/media-studio/render-history.jsonl | jq '{project, seconds, gpuWaitSeconds, engine}'
```

`studio profile <p> --frames a:b` times one span of frames, read back from the page and sent to Node as delivery sends
them and again sending none, and tables each drawing's frames and loads from its one-tab pass's trace (`--costs` adds
what each frame counted), then each step of sending a frame: settle (waiting out the frame's drawing), paint, read
(drawing the page into its canvas and reading it back) and send. Its trace and history line are a render's.

## A Chrome upgrade

A render reads each frame back from the page through Chrome's HTML-in-Canvas (`lib/picture/readback/`), which must
draw what a screenshot of the page shows. After moving Remotion's Chrome, hold the readback against screenshots:

```sh
npm run picture:oracle -- 2026-09-pricing-design-story 0,450,900
npm run picture:oracle -- 2026-10-ceramic-turntable 100
```

Expect a few px of 3D edges and resampled images apart (max up to about 50, tens of px past 4); a frame missing whole
elements is a regression. Pricing frame 900 is the case Chrome 149 failed: nested opacity over a later sibling
dropped unrelated paint.
