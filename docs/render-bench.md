# Timing local renders

Every `studio render` appends one JSON line to `~/.cache/media-studio/render-history.jsonl`
(`STUDIO_RENDER_HISTORY` points it elsewhere). A line holds the arguments, the studio's and the workspace's commits and
whether each was dirty, whether the render delivered, the whole command's seconds with the GPU lease wait apart
(`gpuWaitSeconds`), and every span the render recorded. The code is `lib/output/render/engine/render-history.ts`.

Spans have a start, an end and a parent, so they can overlap. A chunked pass (`video.mp4 frames`) has a span per
chunk. Each chunk span holds:

- `startup`: the browser opening through the first frame
- `drawing`: first frame to last, with `msPerFrame`
- `packing`: its frames packed to FFV1, while the next chunk draws
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

`studio profile <p> --frames a:b` times one span of frames, captured to PNG as delivery captures them and uncaptured.
