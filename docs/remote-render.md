# Rendering on Modal's GPUs

`studio render --remote` and `studio look --remote` draw frames on cloud GPUs instead of this machine's. Modal runs
the GPUs: Linux containers with NVIDIA cards. No Mac runs in the cloud. This machine hashes the project, uploads
what the cloud lacks, and gets frames back. It then joins them and masters the mix, as `studio render --join` does.
The GPU lease isn't taken and the shared adapter stays free, so a remote command needs no GPU lock.

The code is `lib/output/remote-render/`. The app Modal runs is `engine/modal_render_app.py`. This machine calls it
through Modal's JS SDK, `modal` on npm.

## Setting up

1. Install Modal's CLI and log in. Both SDKs read the login it writes to `~/.modal.toml`:

   ```
   uv tool install modal
   modal setup
   ```

2. Deploy the app:

   ```
   studio remote deploy
   ```

   The first deploy builds the image, which takes a few minutes. The image is Ubuntu 24.04 with this machine's Node,
   `npm ci` from `package-lock.json`, Chrome for Testing, ffmpeg and the Vulkan loader. Modal keeps the image until
   the lockfile or the Node version changes.

Deploy again after `package-lock.json`, Node or `modal_render_app.py` changes. Until you do, remote commands refuse
and name the file that changed. `studio remote status` checks the same thing.

Each deploy sets every setting. A flag you leave out goes back to its default:

| Flag | Default | What it sets |
|---|---|---|
| `--gpu` | `T4` | `T4`, `L4`, `A10` or `L40S`. A T4 renders as fast as an L4 here: each browser's GPU process waits on the CPU, and the card idles at 10–15% |
| `--warm` | `10` | Minutes a container stays up after its last call, waiting for the next. This is Modal's `scaledown_window`, which can be anything from 2 s to 20 min |
| `--max-containers` | `4` | Most render containers at once. A render takes about one container per 600 frames |
| `--browsers` | `3` | Browsers each container draws its share in, one piece each. It keeps one more open for the sound. A T4 fits three painting browsers |

Every container reserves 2 cores and 4 GiB of memory. A render can burst to 8 cores and 16 GiB, and is billed for
what it uses. A deploy also stops any containers the last deployment left warm. Otherwise they would answer calls
on the old settings and code until their window ran out.

## Rendering

```
studio render <project> --remote                 # the whole video → out/wip/joined.mp4
studio render <project> --remote --frames=0:299  # a slice → out/wip/frames-0-299.mp4, lossless beside it
```

The frames are shared over up to `--max-containers` containers, and each container's share over its browsers. Each
piece comes back as lossless FFV1, about 1.3 MB a painted 1080p frame. The whole video's pieces are kept in
`out/wip/remote/`. The first container also gathers the mix's raw sound there, in one more browser it keeps for
that, and this machine masters it and muxes the result under the joined pieces. `studio render <project> --join
out/wip/remote` joins those pieces again, under a mix made here.

A remote render is a work-in-progress render, like `--frames` and `--join`. It has no framing check, no captions and
no sidecars. It never writes `out/video.mp4`: a local `studio render` delivers the video. `--remote` refuses
`--join`, `--animatic` and `--plain`. It passes on `--lens`, and `--workers`, which sets the tabs per browser. Tabs
are capped at the cores Remotion counts, which is 2 in a container. A project with a host (`work/hosts.json`) is
refused, because its host's checkout isn't in the studio.

A container's first frame comes about a minute after the call, once it has laid out the files, bundled, read the
timeline and solved a page's first painting. After that, a T4 browser takes 1.5–2 s a painted frame. Three browsers
together draw about as fast as an M1 Max, so a remote render is faster than a local one only when the video spans
several containers. Each container has an hour for its share. A 600-frame share takes about 7 minutes.

## Looking

```
studio look <project> --remote --sheet=0.5,4,9
studio look <project> --remote --frames=200:210 --against=out/wip/frames-200-210.mp4
studio look <project> --remote --bar=3 --motion
```

A container draws the stills. The sheet, the comparison and the motion measures are made here, as a local
`studio look` makes them. `--captions`, `--lens` and `--set` apply to the remote drawing. `--video` and `--graph`
read things on this machine, so a remote look refuses them.

## What it costs

Each remote command prints what each container billed. A cold call is billed from the container's start, and a warm
call from the end of the call before it, since Modal bills the wait between calls too. The total is followed by what
the warm window costs if nothing else comes. The estimate is Modal's list price times what the container reports.
`modal environment billing report --for today` has the real figure, a few minutes later.

Modal's rates per second (October 2026):

| | $/s | $/h |
|---|---|---|
| T4 | 0.000164 | 0.59 |
| L4 | 0.000222 | 0.80 |
| A10 | 0.000306 | 1.10 |
| L40S | 0.000542 | 1.95 |
| CPU core | 0.0000131 | 0.047 |
| GiB of memory | 0.00000222 | 0.008 |

On the defaults, a container waiting warm costs about $0.72 an hour: a T4 plus the 2 cores and 4 GiB it reserves.
After its last call it waits out the warm window and then stops, so it never bills forever. A 10-minute window costs
about $0.12 a container, which is more than a 300-frame render. Nothing runs between windows (`min_containers=0`),
and a call after the window starts cold. A cold start costs about 40 s, mostly reading the timeline and bundling
in a fresh page. For a single render, run `studio remote stop` afterwards. For a session of edits and looks, keep
the window.

You can make the window shorter or longer:

```
studio remote deploy --warm 3     # 3 minutes: a cold start costs less than waiting 10
studio remote deploy --warm 20    # the most Modal allows, for a long session of looks
studio remote stop                # end every container now; nothing bills after it
```

Just after `studio remote stop`, the next call's upload step can take 10–40 s more than usual while Modal places
new containers. Let the window run out instead when you don't need the money back now.

## Measured

On `2026-10-ceramic-turntable`: 300 frames, music-led, painted gouache and watercolour, one T4 container with three
browsers and the sound's, on the defaults.

| Run | Wall | Billed (estimate) | Where the time went |
|---|---|---|---|
| Cold render, the whole video | 307 s | $0.066 | 13 s hashing and uploading, then 60 s on the container before its first frame; the three pieces took 196–226 s, with the sound (137 s) beside them; joining and mastering here took 22 s |
| Warm re-render after a one-line edit | 265 s | $0.073 | 1 file uploaded and copied in 4 s; bundle rebuilt in 8 s; timeline 14 s, not 24. The bill includes 50 s idle since the call before |
| Warm look, a sheet of 3 | 42 s | $0.014 | bundle kept (0.2 s); stills 31 s. The bill includes 35 s idle |
| Cold look, the same sheet | 79 s | $0.014 | bundle 8 s; stills 46 s |

For comparison, the M1 Max delivers this video in 275 s, with the framing check and all. A warm container saves
about 40 s a call, so for renders the painting dominates; for looks, warm halves the wait. Modal's billing report
for the hour of these four calls was $0.37. That hour also held the 10-minute idle wait before the cold look (about
$0.12) and the tail of an earlier render.

## What stays warm

A warm container keeps:

- the studio tree it laid out, so the next call copies only the files that changed;
- the project's bundle, so the next call rebuilds it only when a file it reads changed;
- its open render browsers, which a keeper process holds (`studio remote keep-browsers`);
- the image's `node_modules` and Node's compile cache.

Each call opens fresh pages, so a page's painting caches start empty and a painted scene solves again.

## Uploads

A call uploads only what the app's Volume (`media-studio-render-blobs`) lacks. Files go by content hash, and each
file is hashed once. A hash is remembered in the user cache while the file's size and modification time stay the
same.

| What | Which files |
|---|---|
| The studio | What git lists in `lib/` and `cli/`, tracked and new, plus the root files a render reads |
| The project | What the workspace's git lists, plus its `music/`, `audio/` and `captures/` |
| Styles | The styles the project names |
| Brand kits | Every brand kit, with its fonts |

Ignored files never go. A brush pack goes as its current generation, uploaded once under its style, pack and
generation, since a generation never changes once made.

## Never for the GPU gate

Each GPU rounds a painted frame its own way. A T4's frames aren't the shared adapter's, so remote output never feeds
`npm run stamp:gate` or its baselines. For the same reason, `--join` refuses slices drawn on two GPUs.

## On Linux

The render browser is Chrome for Testing, because the headless shell has no WebGPU on Linux. It runs ANGLE over the
NVIDIA driver's EGL, and Chrome is asked for its GPU info before any page asks WebGPU for an adapter
(`lib/platform/browser/engine/render-browser-launch.ts`). The image needs Mesa's Vulkan drivers and every NVIDIA
driver capability (`NVIDIA_DRIVER_CAPABILITIES=all`). Without them, WebGPU falls back to software and the render
fails.
