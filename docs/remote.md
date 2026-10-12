# Running on Modal: renders, looks and checks

Two kinds of work can run on Modal instead of this machine:

- `studio render --remote` and `studio look --remote` draw frames on cloud GPUs. This machine hashes the project,
  uploads what the cloud lacks, and gets frames back. It then joins them in order and masters the mix here.
- `studio remote run <script…>` runs the repo's checks (`typecheck`, `lint`, `check:arch`, `test:gate` or any other
  npm script but the GPU gate) in cloud containers, against this checkout as it is on disk.

Modal runs Linux containers, with NVIDIA cards for renders and tests. A remote command opens no local browser and
runs no check here, so it never takes the GPU lease, and it leaves this machine's cores to the work that must stay
here.

The code is `lib/platform/remote/`; the render and look jobs are `lib/output/remote-render/`. The app Modal runs is
`lib/platform/remote/engine/modal_remote_app.py`, called through Modal's JS SDK (`modal` on npm). Flags, defaults and
what each verb prints are in `studio remote <verb> --help`; this doc is the model behind them.

## Setting up

1. Install Modal's CLI and log in. Both SDKs read the login it writes to `~/.modal.toml`:

   ```
   uv tool install modal
   modal setup
   ```

2. Deploy this checkout's version of the app with `studio remote deploy`. The first deploy builds the image (Ubuntu
   24.04, this machine's Node, `npm ci` from `package-lock.json`, Chrome for Testing, ffmpeg, git, the Vulkan
   loader), which takes a few minutes. Renders and checks share it; Modal keeps it until the lockfile or Node changes.

Each deploy sets every setting of its version, so a flag left out goes back to its default. A deploy also ends every
container its version's deployment left before, warm or busy (Modal's `recreate` strategy); otherwise they would
answer calls on the old settings until their window ran out. A busy call runs again from the start on a new
container, so a deploy costs a running render of the same version its progress.

The default T4 is the right card: each browser's GPU process waits on the CPU, the card idles at 10–15%, and an L4
renders no faster.

## Versions

The app is deployed once per version, named `media-studio-remote-` and 8 hex digits of what the version is bound
to: `package-lock.json`, Node and `modal_remote_app.py`. Checkouts that differ in any of the three deploy and call
versions of their own, so one never stops or replaces another's. Checkouts alike in all three share a version, its
deployment and its containers. Every version uploads into the one Volume, keyed by content.

After any of the three changes, remote commands refuse until you deploy the new version. `studio remote status`
lists the versions deployed. A version no checkout uses costs nothing once its containers stop; `modal app stop
<name>` retires it.

## Running checks

```
studio remote run typecheck lint check:arch test:gate
studio remote run test:workspace
```

Each script runs as `npm run <script>`, in a container of its own, all at once, with no arguments of its own, so
`check:arch` and `lint` judge both scopes, as they do by hand. It runs against this checkout as it is on disk: both
repositories with uncommitted and untracked files, every project's media, every brand kit's fonts, every style's
current brushes and measured profiles. It's for the runs between commits; the pre-commit hook still runs its checks
here.

In the container, each repository's index holds the files this checkout tracks, each as it is on disk here. So
`--snapshot index` there sees your tracked files with their unstaged edits, not what you've staged.

`stamp:gate` and every `harness/` script are refused: they paint on this Mac's GPU or drive Photoshop, and another
GPU rounds paint its own way.

A Modal container sees every processor of its host, whatever it reserved, so each script runs pinned to what it
reserved (`taskset`), and `node --test` starts one file per reserved core. A test runner gets a T4 because some of
its files render fixtures in the render browser, which refuses software GL. More cores wouldn't speed test:gate up:
its render tests take the GPU lease one at a time and hold it for most of the run. Modal's cores are slower one at a
time than this Mac's, so a check takes longer there; what a remote run buys is this machine's cores.

## Rendering

```
studio render <project> --remote                 # the whole video → out/wip/joined.mp4
studio render <project> --remote --frames=0:299  # a slice → out/wip/slices/frames-0-299.mp4
```

The frames are shared over the render containers, and each container's share over its browsers. Each piece comes
back as lossless FFV1 (about 1.3 MB a painted 1080p frame); the whole video's pieces are kept in
`out/wip/remote/`. The first container also gathers the mix's raw sound in one more browser, and this machine masters
it and muxes it under the joined pieces. Pieces join only when every one was drawn on one timeline, on the project's
clock as it is now, with no gap or overlap.

A remote render is a work-in-progress render, like `--frames`: no framing check, no captions, no sidecars, and never
`out/video.mp4`. A local `studio render` delivers the video. A project with a host (`work/hosts.json`) is refused,
because its host's checkout isn't in the studio.

A container's first frame comes about a minute after the call (laying out files, bundling, reading the timeline,
solving a page's first painting). After that, a T4 browser takes 1.5–2 s a painted frame, so one container's
browsers draw about as fast as this Mac: a remote render wins only when the video spans several containers. Each
container has an hour for its share.

## Looking

```
studio look <project> --remote --sheet=0.5,4,9
studio look <project> --remote --frames=200:210 --against=out/wip/slices/frames-200-210.mp4
studio look <project> --remote --bar=3 --motion
```

A container draws the stills; the sheet, the comparison and the motion measures are made here, as a local look makes
them. Options that read this machine's files (`--video`, `--graph`) are refused.

## What it costs

Each remote command prints what each container billed, then what the warm window costs if nothing else comes. The
figure is Modal's list price times what the container reports; `modal environment billing report --for today` has
the real one a few minutes later. A cold call is billed from the container's start, a warm one from the end of the
call before it, since Modal bills the wait between calls too.

The warm window is the knob. A container waits out its window after its last call and then stops (`min_containers=0`),
so it never bills forever, but a 10-minute render window can cost more than a short render. For a single render, run
`studio remote stop` afterwards; for a session of edits and looks, keep the window, since a warm call skips most of
a cold start. Just after a stop, the next call can take 10–40 s longer while Modal places new containers.

A command that fails or is stopped leaves no call running. When one container of a render fails, the others' calls
are cancelled. Ctrl-C or a kill (SIGINT, SIGTERM, SIGHUP) cancels every call in flight, waiting up to 5 s, before
the command exits; a cancelled call's container is ended with its warm state. A failed command still prints the bill
of every call that answered; a cancelled call never reports, so its cost is left out.

## What stays warm

A warm render container keeps:

- the studio tree it laid out, so the next call copies only the files that changed;
- the project's bundle, rebuilt only when a file it reads changed;
- its open render browsers, which a keeper process holds (`studio remote keep-browsers`);
- the image's `node_modules` and Node's compile cache.

Each call opens fresh pages, so a page's painting caches start empty and a painted scene solves again.

A warm check container keeps the checkout it laid out and Node's compile cache. Before each script it deletes
whatever a run before wrote in the tree, so a script sees the caller's checkout alone. Its brush generations are
links into the Volume, not copies. A render container copies them, because its kept browsers outlive a call and the
Volume can't reload while one of its files is open.

## Uploads

A call uploads only what the app's Volume (`media-studio-remote-blobs`) lacks. Files go by content hash; a hash is
remembered in the user cache while the file's size and modification time stay the same.

| What | A render's | A check's |
|---|---|---|
| The studio | What git lists in `lib/` and `cli/`, tracked and new, plus the root files a render reads | Everything git lists, tracked and new |
| The workspace | The project's files as its git lists them, plus its `music/`, `audio/` and `captures/` | Everything its git lists, plus every project's `music/`, `audio/` and `captures/` |
| Styles | The styles the project names, with their brushes | Every style, with its brushes |
| Brand kits | Every brand kit, with its fonts | Every brand kit, with its fonts |

Ignored files never go otherwise; a project's `generated/` and `out/` never do. A brush pack goes as its current
generation, uploaded once under its style, pack and generation (a generation never changes once made), with its
measured profiles (`profiles/`) sent as files.

## Never for the GPU gate

Each GPU rounds a painted frame its own way. A T4's frames aren't the shared adapter's, so remote output never feeds
`npm run stamp:gate` or its baselines. Slices drawn on two GPUs still join: the difference is too small to see.

## On Linux

The render browser is Chrome for Testing, because the headless shell has no WebGPU on Linux. It runs ANGLE over
Vulkan (over the NVIDIA driver's EGL, Chrome hands WebGPU only SwiftShader), and Chrome is asked for its GPU info
before any page asks WebGPU for an adapter (`lib/platform/browser/engine/render-browser-launch.ts`). The image needs
Mesa's Vulkan drivers and every NVIDIA driver capability (`NVIDIA_DRIVER_CAPABILITIES=all`); without them WebGPU
falls back to software and the render fails. In a container with no GPU, Chrome's GL is Mesa's llvmpipe, which the
render browser refuses too.
