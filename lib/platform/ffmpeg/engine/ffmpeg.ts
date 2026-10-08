// ffmpeg.ts: the one place the studio starts ffmpeg or ffprobe. Everything else passes its arguments through here,
// so which binary runs, and how, has one owner (the sdk-containment check holds it).
import {
  execFile, execFileSync, spawn, spawnSync,
  type ChildProcess, type ExecFileOptions, type ExecFileSyncOptions, type ExecFileSyncOptionsWithBufferEncoding,
  type ExecFileSyncOptionsWithStringEncoding, type SpawnOptions,
} from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Runs ffmpeg to completion; its stdout, as a string when an encoding is given. Throws on a non-zero exit. */
export function runFfmpeg(args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding): string;
export function runFfmpeg(args: readonly string[], options?: ExecFileSyncOptionsWithBufferEncoding): Buffer;
export function runFfmpeg(args: readonly string[], options?: ExecFileSyncOptions): string | Buffer {
  return execFileSync('ffmpeg', args, options);
}

/** Runs ffprobe to completion; its stdout, as a string when an encoding is given. Throws on a non-zero exit. */
export function runFfprobe(args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding): string;
export function runFfprobe(args: readonly string[], options?: ExecFileSyncOptionsWithBufferEncoding): Buffer;
export function runFfprobe(args: readonly string[], options?: ExecFileSyncOptions): string | Buffer {
  return execFileSync('ffprobe', args, options);
}

/** ffmpeg without blocking the event loop, for encodes run side by side. */
export async function runFfmpegAsync(args: readonly string[], options: ExecFileOptions = {}): Promise<void> {
  await execFileAsync('ffmpeg', args, options);
}

/**
 * ffmpeg whose report is on stderr (a filter's measurements: ebur128, psnr). Never throws on the exit code: the caller
 * reads `status` beside the text.
 */
export function measureWithFfmpeg(args: readonly string[]): { stderr: string; status: number | null } {
  const { stderr, status } = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  return { stderr, status };
}

/** ffmpeg as a running process, for streaming its output. */
export function spawnFfmpeg(args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  return spawn('ffmpeg', args, options);
}

/**
 * ffmpeg reading its input from stdin, as `write` gives it: each write is awaited until ffmpeg has room for more, so a
 * writer faster than the encode waits for it. `finish` ends the input and waits for ffmpeg to exit; `abandon` kills it.
 */
export function openFfmpegInput(args: readonly string[]) {
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-4000);
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`))));
  });
  // Read by the writes and finish; a write to a dead ffmpeg fails there, by its exit.
  exited.catch(() => {});
  child.stdin.on('error', () => {});
  return {
    async write(data: Uint8Array): Promise<void> {
      if (!child.stdin.write(data)) await Promise.race([new Promise((resolve) => child.stdin.once('drain', resolve)), exited]);
    },
    async finish(): Promise<void> {
      child.stdin.end();
      await exited;
    },
    abandon: () => child.kill('SIGKILL'),
  };
}

/** A media file's duration in seconds, from its container. */
export function probeMediaSeconds(file: string): number {
  return Number(runFfprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}

/** How many frames a video file's first video stream holds, counted packet by packet rather than taken from its header. */
export function countVideoFrames(file: string): number {
  return Number(runFfprobe(['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim());
}
