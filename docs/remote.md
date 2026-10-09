# Running on Modal: renders, looks and checks

Three things can run on Modal instead of this machine:

- `studio render --remote` and `studio look --remote` draw frames on cloud GPUs. This machine hashes the project,
  uploads what the cloud lacks, and gets frames back. It then joins them and masters the mix, as `studio render
  --join` does.
- `studio remote run <script…>` runs the repo's checks (`typecheck`, `lint`, `check:arch`, `test:gate` or any other
  npm script but the GPU gate) in cloud containers, against this checkout as it is on disk.

Modal runs Linux containers, with NVIDIA cards for renders and tests. No Mac runs in the cloud. A remote command opens no
local browser and runs no check here, so it never takes the GPU lease and needs no GPU lock, and it leaves this
machine's cores to the work that must stay here.

The code is `lib/platform/remote/`; the render and look jobs are `lib/output/remote-render/`. The app Modal runs is
`lib/platform/remote/engine/modal_remote_app.py`. This machine calls it through Modal's JS SDK, `modal` on npm.

## Setting up

1. Install Modal's CLI and log in. Both SDKs read the login it writes to `~/.modal.toml`:

   ```
   uv tool install modal
   modal setup
   ```

2. Deploy this checkout's version of the app:

   ```
   studio remote deploy
   ```

   The first deploy builds the image, which takes a few minutes. The image is Ubuntu 24.04 with this machine's Node,
   `npm ci` from `package-lock.json`, Chrome for Testing, ffmpeg, git and the Vulkan loader. Renders and checks run
   on the same image. Modal keeps it until the lockfile or the Node version changes.

Each deploy sets every setting of its version. A flag you leave out goes back to its default:

| Flag | Default | What it sets |
|---|---|---|
| `--gpu` | `T4` | `T4`, `L4`, `A10` or `L40S`. A T4 renders as fast as an L4 here: each browser's GPU process waits on the CPU, and the card idles at 10–15% |
| `--warm` | `10` | Minutes a render container stays up after its last call, waiting for the next. This is Modal's `scaledown_window`, which can be anything from 2 s to 20 min |
| `--check-warm` | `2` | The same for a check container (`studio remote run`). A cold check takes 13–19 s longer, mostly laying the checkout out, and bills about what 15 s of waiting warm would. So a check container waits only for a quick rerun |
| `--max-containers` | `4` | Most render containers at once. A render takes about one container per 600 frames |
| `--browsers` | `3` | Browsers each render container draws its share in, one piece each. It keeps one more open for the sound. A T4 fits three painting browsers |

Every render container reserves 2 cores and 4 GiB of memory. A render can burst to 8 cores and 16 GiB, and is
billed for what it uses. Check containers are sized by the script they run, not by a flag (see below).

A deploy ends every container its version's deployment before left, warm or busy (Modal's `recreate` strategy).
Otherwise they would answer calls on the old settings until their window ran out. A call busy in one runs again from
the start on a new container, so a deploy costs a same-version checkout's running render its progress. No other
version's containers are touched.

## Versions

The app is deployed once per version, named `media-studio-remote-` and 8 hex digits of what the version is bound
to: `package-lock.json`, Node and `modal_remote_app.py`. A checkout finds its own version by computing that name.
Checkouts that differ in any of the three deploy and call versions of their own, so one never stops or replaces
another's. Checkouts alike in all three share a version, its deployment and its containers. Every version uploads
into the one Volume, which is keyed by content.

After `package-lock.json`, Node or `modal_remote_app.py` changes, this checkout's version is a new one. Remote
commands refuse until you deploy it. `studio remote status` lists the versions deployed, each with its containers up
now, and says what this checkout's runs on, or that it isn't deployed. A version no checkout uses any more costs
nothing once its containers stop; `modal app stop <name>` retires it.

## Running checks

```
studio remote run typecheck lint check:arch test:gate
studio remote run test:workspace
```

Each script runs as `npm run <script>`, each in a container of its own, all at once. It runs against this checkout
as it is on disk:

- both repositories, uncommitted and untracked files included;
- every project's media;
- every brand kit's fonts;
- every style's current brushes and their measured profiles.

Output streams here as it comes. When several scripts run, each line starts with its script's name. The command
ends with a line per script, then the bill:

- whether it passed;
- its seconds;
- cold or warm, and how long laying the checkout out took.

It exits 1 if any script failed. A script runs as package.json names it, with no arguments of its own, so
`check:arch` and `lint` judge both scopes, as they do by hand. It's for the runs between commits: the pre-commit hook
still runs its checks here.

Refused up front, before anything uploads:

- `stamp:gate`. Its baselines are this Mac's GPU pixels, and another GPU rounds paint its own way. Run it here, as
  pre-push does.
- Any script that runs `harness/`. Those paint on this Mac's GPU or drive Photoshop.
- A name package.json lacks.

In the container, each repository is a git repository. Its index holds the files this checkout tracks, each as it
is on disk here. So `--snapshot index` there sees your tracked files with unstaged edits, not what you've staged.
`node_modules` is the image's, installed from `package-lock.json`.

### What a check container gets

| Script | Container | Why |
|---|---|---|
| A test runner (`node --test`: `test:gate`, `test:workspace`, `test`) | a T4, 16 cores, 16 GiB (up to 32) | `node --test` runs a file on each processor it sees but one, so 16 cores run 15 files at once; the Mac runs 9 on 10. Three of test:gate's files render fixtures in the render browser, which refuses software GL, so the container has the cheapest GPU |
| Anything else (`typecheck`, `lint`, `check:arch`) | 4 cores, 8 GiB (up to 16) | Each is one program with a helper thread or two. Measured, they use 2.1–2.9 cores |

A Modal container sees every processor of its host, whatever it reserved. So the script runs pinned to as many
processors as it reserved (`taskset`), and `node --test` starts one file per core it has, not one per host core. At
most 32 check containers run at once, over every checkout sharing the version; a call past that waits for one.

More cores wouldn't make test:gate faster. Its render tests take the GPU lease one at a time, as they do here, and
together hold it for about 110 s of its 124. A T4 starts a browser and bundles more slowly than the M1 Max does.

### Measured

Measured on 2026-10-05 with this checkout: 2353 files and 13 brush generations. All four ran in one `studio remote
run`, each in its own container. Local times are the M1 Max's, with a load of 6–7 before each run; test:gate's own
run took the load to 21. A remote time is the script's call, from here, with the script's own seconds after it. The
command spends about 6 s more before the calls, hashing and uploading. A warm call's cost is the call alone, at
Modal's rates.

| Check | Here | Remote, cold | Remote, warm | Cost, cold | Cost, warm |
|---|---|---|---|---|---|
| `typecheck` | 1.7 s | 20.8 s (5.2 s) | 8.1 s (5.0 s) | $0.001 | $0.001 |
| `check:arch` | 16.8 s | 59.1 s (41.2 s) | 44.1 s (39.2 s) | $0.004 | $0.003 |
| `lint` | 5.8 s | 32.2 s (14.5 s) | 16.3 s (11.7 s) | $0.002 | $0.001 |
| `test:gate` | 80 s | 145.8 s (124.2 s) | 127.1 s (122.1 s) | $0.057 | $0.052 |

The whole command took 2 min 33 s cold and 2 min 18 s warm, with test:gate the long pole. Each check is slower
there than here:

- Modal's cores are slower one at a time than the M1 Max's. check:arch takes 39 s there against 17 s here.
- A cold container spends 8–13 s laying the checkout out before the script starts. A warm one spends 2–3 s.
- A cold test runner can wait 10–35 s more while Modal places its T4.

What a remote run buys is this machine's cores: none of these checks runs here. The cold run billed $0.064. The warm
run billed $0.11, about $0.10 of it for the 3 minutes the containers waited between the two runs.

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

A command that fails or is stopped leaves no call running. When one container of a render fails, the calls of the
others are cancelled. Ctrl-C or a kill (SIGINT, SIGTERM, SIGHUP) cancels every call in flight, waiting up to 5 s,
before the command exits. A cancelled call's container is ended, its warm state with it. A failed command still
prints the bill of every call that answered. A cancelled call never reports, so what it ran is left out.

Modal's rates per second (October 2026):

| | $/s | $/h |
|---|---|---|
| T4 | 0.000164 | 0.59 |
| L4 | 0.000222 | 0.80 |
| A10 | 0.000306 | 1.10 |
| L40S | 0.000542 | 1.95 |
| CPU core | 0.0000131 | 0.047 |
| GiB of memory | 0.00000222 | 0.008 |

On the defaults, a render container waiting warm costs about $0.72 an hour: a T4 plus the 2 cores and 4 GiB it
reserves. A test runner's container costs $1.47 an hour warm, and any other check's $0.25. After its last call a
container waits out its warm window and then stops, so it never bills forever. A 10-minute window costs about $0.12
a render container, which is more than a 300-frame render. A 2-minute window costs a test runner's container $0.05.
Nothing runs between windows (`min_containers=0`), and a call after the window starts cold. A cold render start costs about 40 s, mostly reading
the timeline and bundling in a fresh page. For a single render, run `studio remote stop` afterwards. For a session
of edits and looks, keep the window.

You can make the window shorter or longer:

```
studio remote deploy --warm 3                   # 3 minutes: a cold start costs less than waiting 10
studio remote deploy --warm 20                  # the most Modal allows, for a long session of looks
studio remote deploy --warm 20 --check-warm 10  # checks too, for a session of many reruns
studio remote stop                              # end this checkout's version's containers now; nothing bills after it
studio remote stop --all                        # end every version's
```

`studio remote stop` ends the containers of this checkout's version, a call busy in one failing, whichever
checkout of the version made it. Other versions' containers run on unless you add `--all`. Just after a stop, the next
call's upload step can take 10–40 s more than usual while Modal places new containers. Let the window run out
instead when you don't need the money back now.

## Measured renders

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

A warm render container keeps:

- the studio tree it laid out, so the next call copies only the files that changed;
- the project's bundle, so the next call rebuilds it only when a file it reads changed;
- its open render browsers, which a keeper process holds (`studio remote keep-browsers`);
- the image's `node_modules` and Node's compile cache.

Each call opens fresh pages, so a page's painting caches start empty and a painted scene solves again.

A warm check container keeps the checkout it laid out and Node's compile cache. Before each script it deletes
whatever a run before wrote in the tree, so a script sees the caller's checkout alone. Its brush generations are
links into the Volume, not copies, which spares a cold check copying 300 MB. A render container copies them, because
its kept browsers outlive a call, and the Volume can't reload while one of its files is open.

## Uploads

A call uploads only what the app's Volume (`media-studio-remote-blobs`) lacks. Files go by content hash, and each
file is hashed once. A hash is remembered in the user cache while the file's size and modification time stay the
same.

| What | A render's | A check's |
|---|---|---|
| The studio | What git lists in `lib/` and `cli/`, tracked and new, plus the root files a render reads | Everything git lists, tracked and new |
| The workspace | The project's files as its git lists them, plus its `music/`, `audio/` and `captures/` | Everything its git lists, plus every project's `music/`, `audio/` and `captures/` |
| Styles | The styles the project names, with their brushes | Every style, with its brushes |
| Brand kits | Every brand kit, with its fonts | Every brand kit, with its fonts |

Ignored files never go otherwise; a project's `generated/` and `out/` never do. A brush pack goes as its current
generation, uploaded once under its style, pack and generation, since a generation never changes once made, and its
measured profiles (`profiles/`), sent as any file is, a profile at a time as it's added.

## Never for the GPU gate

Each GPU rounds a painted frame its own way. A T4's frames aren't the shared adapter's, so remote output never feeds
`npm run stamp:gate` or its baselines, and `studio remote run stamp:gate` is refused. Slices drawn on two GPUs still
join: the difference is too small to see.

## On Linux

The render browser is Chrome for Testing, because the headless shell has no WebGPU on Linux. It runs ANGLE over
Vulkan (over the NVIDIA driver's EGL, Chrome 157 hands WebGPU only SwiftShader), and Chrome is asked for its GPU info
before any page asks WebGPU for an adapter (`lib/platform/browser/engine/render-browser-launch.ts`). The image needs Mesa's Vulkan drivers and every NVIDIA
driver capability (`NVIDIA_DRIVER_CAPABILITIES=all`). Without them, WebGPU falls back to software and the render
fails. In a container with no GPU, Chrome's GL is Mesa's llvmpipe, which the render browser refuses too. That's why
a test runner's check container has a T4.
