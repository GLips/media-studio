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
- a painted shot's load (`laid out`, `compile`, `device`, `surfaces`, `renderer`, `warm`), its `first draw` and each
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
first). A chunked pass (`video.mp4 frames`) has a span per attempt at a chunk, a failed one included. Each chunk holds:

- `startup`: the browser opening through the first frame
- `drawing`: first frame to last, with `msPerFrame`

Beside the chunks, under the pass:

- `packing frames a–b`: a chunk's frames packed to FFV1 while the next chunk draws, on a `packing` track of its own,
  with a flow from the chunk that drew them
- `waiting on packing`: the next chunk waiting for that packing to finish, recorded only when it waits

The table a render prints at its end sums a pass's chunks into one line.

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

`studio profile <p> --frames a:b` times one span of frames, captured to PNG as delivery captures them and uncaptured,
and tables each drawing's frames and loads from its one-tab pass's trace (`--costs` adds what each frame counted). Its
trace and history line are a render's.
