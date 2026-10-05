# modal_remote_app.py: the studio's remote app on Modal, deployed by `studio remote deploy` (remote-admin.ts), which
# names its settings file in STUDIO_REMOTE_SETTINGS; the containers read the same settings from /settings. Called
# from the studio through Modal's JS SDK (remote-modal.ts). docs/remote.md says how to run it.
#
# Three classes. StudioRemoteBlobs, a small CPU container, keeps a Volume of what remote calls upload: files by content
# hash, and brush generations by style, pack and generation (never changed once made). StudioRenderServer, a GPU
# container kept warm between calls, lays a call's files out as a studio tree at /studio, keeps render browsers open
# across calls (`studio remote keep-browsers`) and runs the call's render job (`studio remote job`). StudioCheckServer,
# sized by each call (a T4 only for tests), lays out the caller's whole checkout, both repositories indexed as the
# caller's are, and runs one npm script in it. Each streams its output to the caller and answers with what it ran.
#
# Linux needs: Chrome for Testing (the headless shell has no WebGPU there), ANGLE over the NVIDIA driver's EGL
# (render-browser-launch.ts), Mesa's Vulkan ICDs, and NVIDIA's libraries, mounted only with every driver capability.
import hashlib
import json
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath

import modal

LOCAL = modal.is_local()
if LOCAL and "STUDIO_REMOTE_SETTINGS" not in os.environ:
    raise SystemExit("deploy this app with `studio remote deploy`, which writes its settings")
SETTINGS_FILE = Path(os.environ["STUDIO_REMOTE_SETTINGS"]) if LOCAL else Path("/settings/remote-settings.json")
SETTINGS = json.loads(SETTINGS_FILE.read_text())
RENDER = SETTINGS["render"]
# The studio checkout this file sits in (lib/platform/remote/engine/); only a deploy reads files from it.
STUDIO = Path(__file__).resolve().parents[4] if LOCAL else Path("/")

# As remote-settings.ts names them.
app = modal.App("media-studio-remote")
volume = modal.Volume.from_name("media-studio-remote-blobs", create_if_missing=True, version=2)

BLOBS = Path("/blobs")
TREE = Path("/studio")
KEPT = Path("/tmp/kept-render-browsers")
# A Volume read waits on each file's latency, not on bandwidth: laying a tree out reads this many files at once.
VOLUME_READERS = 64
# The code the keeper runs: when a call's copy of it differs, the keeper starts again on the new one.
KEEPER_CODE = ("lib/platform/", "cli/studio.ts", "cli/commands/remote.ts")
# Most check containers at once, over every size a call asks for (remote-run.ts sizes each script's).
CHECK_MAX_CONTAINERS = 32

# Chrome's libraries (Remotion's Linux list), ffmpeg, the Vulkan loader, and git, which the repo's checks run.
# Looks unused: mesa-vulkan-drivers. Headless Chrome's Vulkan wants VK_EXT_headless_surface, which only Mesa's ICDs
# offer; without them WebGPU falls back to SwiftShader, and with them it still picks the NVIDIA adapter.
APT = (
    "ca-certificates curl xz-utils unzip git ffmpeg libvulkan1 mesa-vulkan-drivers fonts-dejavu-core fonts-liberation2 "
    "libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libgbm1 libasound2t64 libxrandr2 libxkbcommon0 "
    "libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2t64 libxshmfence1 libdrm2 libegl1 libgl1"
)
NODE = SETTINGS["node"]

image = (
    modal.Image.from_registry("ubuntu:24.04", add_python="3.12")
    .env({
        "NVIDIA_DRIVER_CAPABILITIES": "all", "DEBIAN_FRONTEND": "noninteractive", "NODE_COMPILE_CACHE": "/root/.cache/node-compile",
        "NPM_CONFIG_UPDATE_NOTIFIER": "false",
    })
    .run_commands(f"apt-get update && apt-get install -y --no-install-recommends {APT} && rm -rf /var/lib/apt/lists/*")
    .run_commands(f"curl -fsSL https://nodejs.org/dist/v{NODE}/node-v{NODE}-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1")
    .add_local_file(STUDIO / "package.json", "/deps/package.json", copy=True)
    .add_local_file(STUDIO / "package-lock.json", "/deps/package-lock.json", copy=True)
    # --ignore-scripts skips the root's `prepare` (git hooks); esbuild's and msgpackr's own install steps run after.
    .run_commands(
        "cd /deps && npm ci --ignore-scripts --no-audit --no-fund && npm rebuild esbuild msgpackr-extract",
        "cd /deps && node -e \"import('@remotion/renderer').then((r) => r.ensureBrowser({ chromeMode: 'chrome-for-testing' }))\"",
        "ldd $(find /deps/node_modules/.remotion -path '*chrome-linux64/chrome' -type f) | grep 'not found' && exit 1 || echo 'chrome libraries: all found'",
        # The headless shell too: Remotion's selectComposition ensures it whatever browser it's handed, and would
        # download it in every container.
        "cd /deps && npx remotion browser ensure",
    )
    .add_local_file(SETTINGS_FILE, "/settings/remote-settings.json")
)
blobs_image = modal.Image.debian_slim(python_version="3.12").add_local_file(SETTINGS_FILE, "/settings/remote-settings.json")


def inside(root: Path, path: str) -> Path:
    """`path` (relative, `/`-separated) under `root`; refuses one that would leave it."""
    relative = PurePosixPath(path)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError(f"{path} isn't a path inside {root}")
    return root / relative


def blob_file(digest: str) -> Path:
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError(f"{digest} isn't a SHA-256")
    return BLOBS / "files" / digest[:2] / digest


def generation_dir(key: str) -> Path:
    return inside(BLOBS / "generations", key)


def copy_whole(pair: tuple[Path, Path]) -> None:
    """Copies `pair`'s first file to its second so no reader finds half of it."""
    source, target = pair
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f"{target.name}.{threading.get_ident()}.part")
    shutil.copyfile(source, partial)
    os.replace(partial, target)


def remove_tree(path: Path) -> None:
    """Deletes the folder at `path`, or the link there to one, if either is."""
    if path.is_symlink():
        path.unlink()
    else:
        shutil.rmtree(path, ignore_errors=True)


def write_whole(path: Path, data: bytes) -> None:
    """Writes `data` at `path` so no reader finds half of it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.part")
    partial.write_bytes(data)
    os.replace(partial, path)


@app.cls(image=blobs_image, volumes={str(BLOBS): volume}, cpu=0.25, memory=512, scaledown_window=SETTINGS["warmSeconds"], min_containers=0, max_containers=4, timeout=600)
class StudioRemoteBlobs:
    @modal.method()
    def prepare(self, request: dict) -> dict:
        """The deployment's settings, and which of the asked-after files and generations the Volume lacks."""
        volume.reload()
        # A folder listed per hash prefix, many at once: a Volume answers each look-up a round trip later.
        folders = sorted({blob_file(digest).parent for digest in request["files"]})
        with ThreadPoolExecutor(VOLUME_READERS) as pool:
            present = set().union(*pool.map(lambda folder: set(os.listdir(folder)) if folder.is_dir() else set(), folders))
            complete = list(pool.map(lambda key: (generation_dir(key) / ".complete").exists(), request["generations"]))
        return {
            "settings": SETTINGS,
            "missingFiles": [digest for digest in request["files"] if digest not in present],
            "missingGenerations": [key for key, done in zip(request["generations"], complete) if not done],
        }

    @modal.method()
    def put(self, request: dict) -> None:
        """Keeps a batch of uploads: files checked against their hashes, or files of a generation, complete on its last."""
        if request["kind"] == "files":
            for file in request["files"]:
                if hashlib.sha256(file["bytes"]).hexdigest() != file["hash"]:
                    raise ValueError(f"an upload's bytes don't hash to {file['hash']}")
                write_whole(blob_file(file["hash"]), file["bytes"])
        else:
            root = generation_dir(request["key"])
            for file in request["files"]:
                write_whole(inside(root, file["path"]), file["bytes"])
            if request["complete"]:
                write_whole(root / ".complete", b"")
        volume.commit()


def cgroup_cpu_seconds() -> float | None:
    """CPU seconds the container has used, when its cgroup tells (v2, then v1)."""
    stat = Path("/sys/fs/cgroup/cpu.stat")
    if stat.exists():
        for line in stat.read_text().splitlines():
            if line.startswith("usage_usec "):
                return int(line.split()[1]) / 1e6
    usage = Path("/sys/fs/cgroup/cpuacct/cpuacct.usage")
    return int(usage.read_text()) / 1e9 if usage.exists() else None


def cgroup_memory_bytes() -> int | None:
    for name in ("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"):
        if Path(name).exists():
            return int(Path(name).read_text())
    return None


def gpu_name() -> str | None:
    """The container's GPU and its driver, or None in one without: Modal mounts nvidia-smi with the driver."""
    if shutil.which("nvidia-smi") is None:
        return None
    query = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"], capture_output=True, text=True, check=True)
    name, driver = (part.strip() for part in query.stdout.strip().splitlines()[0].split(","))
    return f"{name} (driver {driver})"


def container_started() -> float:
    """When this container started, epoch seconds: Modal bills from then, before the image loaded and any code ran."""
    return time.time() - float(Path("/proc/uptime").read_text().split()[0])


class MemoryPeak:
    """The container's memory sampled each second while a call runs; `peak` the most seen."""

    def __init__(self) -> None:
        self.peak = cgroup_memory_bytes()
        self.done = threading.Event()
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.thread.start()

    def sample(self) -> None:
        while not self.done.wait(1):
            now = cgroup_memory_bytes()
            if now is not None:
                self.peak = max(self.peak or 0, now)

    def stop(self) -> int | None:
        self.done.set()
        self.thread.join()
        return self.peak


def call_report(gpu_name: str | None, started: float, last_ended: float | None, called: float, ended: float, cpu: tuple, peak: int | None) -> dict:
    """What a call ran on and used, for its bill (remote-cost.ts)."""
    before, after = cpu
    # Every number goes as a float: Modal's JS SDK decodes a CBOR integer past 2^32 (a peak over 4 GiB) as a BigInt.
    return {
        "gpuName": gpu_name, "containerStarted": started, "previousCallEnded": last_ended, "callStarted": called, "callEnded": ended,
        "cpuSeconds": None if before is None or after is None else after - before, "memoryPeakBytes": None if peak is None else float(peak),
    }


class StudioTree:
    """
    The studio tree a container lays out at /studio from the Volume, kept between its calls so each copies only what
    changed. Files are copied, not linked: Node resolves a linked module's imports from where its link points. Brush
    generations are copied too where a process outlives the call (a render server's kept browsers), since the Volume's
    reload refuses while any of its files is open; elsewhere `link_generations` links them, which a cold start skips.
    """

    def __init__(self, link_generations: bool) -> None:
        # Each laid file's hash, and its size and mtime once laid: a run that rewrote it gets it copied again.
        self.laid: dict[str, tuple[str, int, int]] = {}
        self.generations: dict[str, str] = {}
        self.link_generations = link_generations
        TREE.mkdir(parents=True, exist_ok=True)
        (TREE / "node_modules").symlink_to("/deps/node_modules")

    def still_laid(self, path: str, digest: str) -> bool:
        known = self.laid.get(path)
        if not known or known[0] != digest:
            return False
        try:
            stat = inside(TREE, path).stat()
        except FileNotFoundError:
            return False
        return (stat.st_size, stat.st_mtime_ns) == known[1:]

    def lay_out(self, files: list, generations: list) -> str:
        """
        Makes /studio hold `files` ([path, hash]) and `generations` ([path, key]), copying only what changed since the
        last call, and deleting what it no longer lists. Says what it did.
        """
        started = time.time()
        wanted, placed = dict(files), dict(generations)
        for path in [p for p in self.laid if p not in wanted]:
            inside(TREE, path).unlink(missing_ok=True)
            del self.laid[path]
        for path in [p for p in self.generations if placed.get(p) != self.generations[p]]:
            remove_tree(inside(TREE, path))
            del self.generations[path]
        changed = [(path, digest) for path, digest in wanted.items() if not self.still_laid(path, digest)]
        copies = [(blob_file(digest), inside(TREE, path)) for path, digest in changed]
        arriving = [(path, key, inside(TREE, path).with_name(f"{PurePosixPath(path).name}.part")) for path, key in placed.items() if path not in self.generations]
        for _, key, partial in arriving:
            remove_tree(partial)
            source = generation_dir(key)
            if self.link_generations:
                partial.parent.mkdir(parents=True, exist_ok=True)
                partial.symlink_to(source, target_is_directory=True)
            else:
                copies += [(Path(root) / name, partial / Path(root).relative_to(source) / name) for root, _, names in os.walk(source) for name in names if name != ".complete"]
        with ThreadPoolExecutor(VOLUME_READERS) as pool:
            list(pool.map(copy_whole, copies))
        for path, key, partial in arriving:
            os.replace(partial, inside(TREE, path))
            self.generations[path] = key
        for path, digest in changed:
            stat = inside(TREE, path).stat()
            self.laid[path] = (digest, stat.st_size, stat.st_mtime_ns)
        took = f"in {time.time() - started:.1f} s"
        if self.link_generations:
            return f"{len(changed)} files copied and {len(arriving)} brush generations linked {took}"
        return f"{len(changed)} files and {len(arriving)} brush generations ({len(copies)} files) copied {took}"

    def sweep(self) -> int:
        """
        Deletes every file under /studio it didn't lay, and the folders that leaves empty: what a run before wrote, so
        the next sees the caller's tree alone. Repositories' .git folders and node_modules stay. Returns how many files.
        """
        laid, generations, removed, folders = set(self.laid), set(self.generations), 0, []
        for root, dirs, names in os.walk(TREE):
            here = PurePosixPath(Path(root).relative_to(TREE).as_posix())
            dirs[:] = [d for d in dirs if d != ".git" and str(here / d) not in generations and not (str(here) == "." and d == "node_modules")]
            folders += [Path(root) / d for d in dirs]
            for name in names:
                if str(here / name) not in laid:
                    (Path(root) / name).unlink()
                    removed += 1
        for folder in reversed(folders):
            if not any(folder.iterdir()):
                folder.rmdir()
        return removed

    def index(self, repos: list) -> None:
        """
        Makes each of `repos` ({root, tracked}: '' the studio, 'work' its workspace) a git repository whose index holds
        the files the caller's tracks, as they are on the caller's disk; the rest stay untracked, as there. A repository
        a call before had and this one lacks is deleted whole.
        """
        if "work" not in {repo["root"] for repo in repos}:
            shutil.rmtree(TREE / "work", ignore_errors=True)
        for repo in repos:
            root = inside(TREE, repo["root"]) if repo["root"] else TREE
            if not (root / ".git").is_dir():
                subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            # node_modules here is a link, which git's `node_modules/` pattern (a folder) doesn't ignore.
            (root / ".git" / "info").mkdir(exist_ok=True)
            (root / ".git" / "info" / "exclude").write_text("/node_modules\n")
            (root / ".git" / "index").unlink(missing_ok=True)
            if repo["tracked"]:
                subprocess.run(
                    ["git", "add", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"],
                    cwd=root, input="\0".join(repo["tracked"]).encode(), check=True,
                )


@app.cls(
    image=image, gpu=RENDER["gpu"], volumes={str(BLOBS): volume},
    cpu=(RENDER["cpu"]["request"], RENDER["cpu"]["limit"]), memory=(RENDER["memoryMiB"]["request"], RENDER["memoryMiB"]["limit"]),
    scaledown_window=SETTINGS["warmSeconds"], min_containers=0, max_containers=RENDER["maxContainers"], timeout=3600,
)
class StudioRenderServer:
    @modal.enter()
    def start(self) -> None:
        self.started = container_started()
        self.last_ended: float | None = None
        self.tree = StudioTree(link_generations=False)
        self.keeper: subprocess.Popen | None = None
        self.keeper_code: str | None = None
        self.gpu_name = gpu_name()

    def ensure_keeper(self, files: list) -> None:
        """Starts the browser keeper, again when it ended or its code changed, and waits until it has begun."""
        code = hashlib.sha256(json.dumps(sorted(f for f in files if f[0].startswith(KEEPER_CODE))).encode()).hexdigest()
        if self.keeper and self.keeper.poll() is None and self.keeper_code == code:
            return
        self.stop_keeper()
        log = open("/tmp/keeper.log", "ab")
        # One browser more than the pieces: a share's sound draws beside them (remote-render-job-run.ts). It paints
        # nothing, so it needs none of the GPU's memory a painting browser holds.
        self.keeper = subprocess.Popen(
            ["node", "cli/studio.ts", "remote", "keep-browsers", "--dir", str(KEPT), "--count", str(RENDER["browsers"] + 1)],
            cwd=TREE, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        self.keeper_code = code
        # It writes keeper.json before it opens its browsers; a borrower before that would find no keeper.
        while not (KEPT / "keeper.json").exists():
            if self.keeper.poll() is not None:
                raise RuntimeError(f"the render browser keeper ended (exit {self.keeper.returncode}): {Path('/tmp/keeper.log').read_text()[-4000:]}")
            time.sleep(0.1)

    def stop_keeper(self) -> None:
        if self.keeper and self.keeper.poll() is None:
            self.keeper.send_signal(signal.SIGTERM)
            try:
                self.keeper.wait(15)
            except subprocess.TimeoutExpired:
                os.killpg(self.keeper.pid, signal.SIGKILL)
                self.keeper.wait()
        self.keeper = None

    @modal.method()
    def run(self, request: dict) -> dict:
        """
        Runs a call's job on its files; answers with the files it made ([name, bytes]) and this call's report. What
        renders write in the tree (bundles, out/) stays for the next call.
        """
        called = time.time()
        cpu_before, memory = cgroup_cpu_seconds(), MemoryPeak()
        try:
            volume.reload()
            print(f"on {self.gpu_name}: Volume reloaded in {time.time() - called:.1f} s; {self.tree.lay_out(request['files'], request['generations'])}", flush=True)
            self.ensure_keeper(request["files"])
            code, made = self.run_job(request["job"])
        finally:
            peak = memory.stop()
        ended = time.time()
        report = call_report(self.gpu_name, self.started, self.last_ended, called, ended, (cpu_before, cgroup_cpu_seconds()), peak)
        self.last_ended = ended
        return {"ok": code == 0, "error": None if code == 0 else f"studio remote job exited {code} (its output is above)", "files": made, "report": report}

    def run_job(self, job_text: str) -> tuple[int, list]:
        """Runs `studio remote job` on the job, its output printed as it comes; its exit code and the files it made."""
        with tempfile.TemporaryDirectory(prefix="studio-job-") as work:
            job, out = Path(work) / "job.json", Path(work) / "out"
            job.write_text(job_text)
            proc = subprocess.Popen(
                ["node", "cli/studio.ts", "remote", "job", str(job), "--out", str(out)],
                cwd=TREE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
                env={**os.environ, "STUDIO_KEPT_RENDER_BROWSERS": str(KEPT)},
            )
            for line in proc.stdout:
                print(line, end="", flush=True)
            code = proc.wait()
            return code, [[f.name, f.read_bytes()] for f in sorted(out.iterdir()) if f.is_file()] if code == 0 and out.exists() else []

    @modal.exit()
    def finish(self) -> None:
        self.stop_keeper()


# Looks undersized: every call sizes its container (GPU, cores, memory, warm window) through the SDK's withOptions,
# from remote-run.ts; these apply to none.
@app.cls(
    image=image, volumes={str(BLOBS): volume}, cpu=2.0, memory=4096,
    scaledown_window=SETTINGS["checkWarmSeconds"], min_containers=0, max_containers=CHECK_MAX_CONTAINERS, timeout=1800,
)
class StudioCheckServer:
    @modal.enter()
    def start(self) -> None:
        self.started = container_started()
        self.last_ended: float | None = None
        self.tree = StudioTree(link_generations=True)
        self.gpu_name = gpu_name()

    @modal.method()
    def run(self, request: dict) -> dict:
        """
        Runs `npm run <script>` in the caller's checkout as its request lays it out, on `cores` of the container's
        processors, its output streamed and kept; answers with its exit code, its output, what laying out did and the
        call's report.
        """
        called = time.time()
        cpu_before, memory = cgroup_cpu_seconds(), MemoryPeak()
        try:
            volume.reload()
            reloaded = time.time() - called
            laid = self.tree.lay_out(request["files"], request["generations"])
            swept = self.tree.sweep()
            self.tree.index(request["repos"])
            setup = f"Volume reloaded in {reloaded:.1f} s; {laid}; {swept} left by a run before deleted; ready {time.time() - called:.1f} s into the call"
            code, output, seconds = self.run_script(request["script"], request["cores"])
        finally:
            peak = memory.stop()
        ended = time.time()
        report = call_report(self.gpu_name, self.started, self.last_ended, called, ended, (cpu_before, cgroup_cpu_seconds()), peak)
        self.last_ended = ended
        return {"exitCode": code, "output": output, "seconds": seconds, "setup": setup, "report": report}

    def run_script(self, script: str, cores: int) -> tuple[int, str, float]:
        """
        Runs the script on `cores` processors, its output printed as it comes; its exit code, output and seconds. The
        container shows every processor of its host whatever it reserved, and `node --test` runs a file on each but
        one: the affinity makes what it sees what was reserved.
        """
        cpus = ",".join(str(cpu) for cpu in sorted(os.sched_getaffinity(0))[:cores])
        started, lines = time.time(), []
        proc = subprocess.Popen(
            ["taskset", "--cpu-list", cpus, "npm", "run", "--silent", script],
            cwd=TREE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1,
        )
        for line in proc.stdout:
            print(line, end="", flush=True)
            lines.append(line)
        return proc.wait(), "".join(lines), time.time() - started
